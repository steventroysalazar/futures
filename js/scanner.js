// ============================================
// FUTURES EDGE — Market Scanner
// Scans all Binance Futures pairs for opportunities
// ============================================

const Scanner = (() => {

  let allTickers = [];
  let allMarkPrices = [];
  let scanResults = [];
  let isScanning = false;
  let sortField = 'score';
  let sortDir = 'desc';
  let filterMode = 'all'; // 'all', 'long', 'short', 'volatile'

  /**
   * Initialize scanner and load data
   */
  async function init() {
    try {
      const [tickers, markPrices] = await Promise.all([
        BinanceAPI.get24hrTickers(),
        BinanceAPI.getAllMarkPrices(),
      ]);
      allTickers = tickers;
      allMarkPrices = markPrices;
      return true;
    } catch (e) {
      console.error('[Scanner] Init failed:', e);
      return false;
    }
  }

  /**
   * Scan top coins and generate opportunity scores
   * @param {string} strategyId - Strategy to use for scanning
   * @param {number} topN - Number of coins to analyze in depth
   */
  async function scan(strategyId = 'all', topN = 30) {
    if (isScanning) return scanResults;
    isScanning = true;

    try {
      // Re-fetch tickers
      const [tickers, markPrices] = await Promise.all([
        BinanceAPI.get24hrTickers(),
        BinanceAPI.getAllMarkPrices(),
      ]);
      allTickers = tickers;
      allMarkPrices = markPrices;

      // Pre-filter: Only USDT pairs with decent volume
      // Exclude stablecoins and low-volume pairs
      const stablecoins = ['USDCUSDT', 'BUSDUSDT', 'TUSDUSDT', 'DAIUSDT', 'FDUSDUSDT', 'EURUSDT'];
      const candidates = allTickers
        .filter(t =>
          !stablecoins.includes(t.symbol) &&
          t.quoteVolume > 5000000 && // Min $5M 24h volume
          Math.abs(t.priceChangePercent) > 0.5 // At least 0.5% movement
        )
        .sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent))
        .slice(0, topN);

      // Deep scan each candidate
      const results = [];
      const batchSize = 5;

      for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map(async (ticker) => {
            try {
              const [candles, fundingHistory, openInterest] = await Promise.all([
                BinanceAPI.getKlines(ticker.symbol, '4h', 500),
                BinanceAPI.getFundingRate(ticker.symbol, 24).catch(() => []),
                BinanceAPI.getOpenInterest(ticker.symbol).catch(() => null),
              ]);

              const markData = allMarkPrices.find(m => m.symbol === ticker.symbol);
              const fundingRate = fundingHistory.length
                ? fundingHistory
                : markData ? markData.lastFundingRate : null;
              const latestFunding = fundingHistory.length
                ? fundingHistory[fundingHistory.length - 1].fundingRate
                : markData ? markData.lastFundingRate : null;

              // Run strategy analysis
              const signal = Strategies.analyze(
                { candles, fundingRate, openInterest },
                strategyId
              );

              // Quick opportunity score
              const score = Strategies.quickScore(candles, fundingRate);

              return {
                symbol: ticker.symbol,
                price: ticker.lastPrice,
                change24h: ticker.priceChangePercent,
                volume24h: ticker.quoteVolume,
                high24h: ticker.highPrice,
                low24h: ticker.lowPrice,
                fundingRate: latestFunding,
                fundingHistory,
                openInterest: openInterest ? openInterest.openInterest : null,
                signal: signal.signal,
                confidence: signal.confidence,
                reason: signal.reason,
                strategy: signal.strategyName || 'Combined',
                entry: signal.entry,
                stopLoss: signal.stopLoss,
                tp1: signal.tp1,
                tp2: signal.tp2,
                tp3: signal.tp3,
                leverage: signal.leverage,
                score: openInterest ? Math.min(score + 5, 100) : score,
              };
            } catch (e) {
              console.error(`[Scanner] Error analyzing ${ticker.symbol}:`, e);
              return null;
            }
          })
        );

        batchResults.forEach(r => {
          if (r.status === 'fulfilled' && r.value) {
            results.push(r.value);
          }
        });

        // Small delay between batches to respect rate limits
        if (i + batchSize < candidates.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Sort by opportunity score
      scanResults = results.sort((a, b) => b.score - a.score);
      isScanning = false;
      return scanResults;
    } catch (e) {
      console.error('[Scanner] Scan failed:', e);
      isScanning = false;
      return [];
    }
  }

  /**
   * Get filtered and sorted results
   */
  function getResults() {
    let filtered = [...scanResults];

    // Apply filter
    switch (filterMode) {
      case 'long':
        filtered = filtered.filter(r => r.signal === 'long');
        break;
      case 'short':
        filtered = filtered.filter(r => r.signal === 'short');
        break;
      case 'volatile':
        filtered = filtered.filter(r => Math.abs(r.change24h) > 5);
        break;
    }

    // Apply sort
    filtered.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string') {
        return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });

    return filtered;
  }

  /**
   * Set sort field and direction
   */
  function setSort(field) {
    if (sortField === field) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDir = 'desc';
    }
  }

  /**
   * Set filter mode
   */
  function setFilter(mode) {
    filterMode = mode;
  }

  function applyTickerUpdates(tickers) {
    if (!Array.isArray(tickers) || !tickers.length) return;

    const bySymbol = new Map(allTickers.map(t => [t.symbol, t]));
    tickers.forEach(ticker => {
      const existing = bySymbol.get(ticker.symbol) || {};
      bySymbol.set(ticker.symbol, {
        ...existing,
        ...ticker,
      });
    });
    allTickers = Array.from(bySymbol.values());

    scanResults = scanResults.map(result => {
      const ticker = bySymbol.get(result.symbol);
      if (!ticker) return result;
      return {
        ...result,
        price: ticker.lastPrice ?? result.price,
        change24h: ticker.priceChangePercent ?? result.change24h,
        volume24h: ticker.quoteVolume ?? result.volume24h,
      };
    });
  }

  /**
   * Render scanner table to DOM
   */
  function render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const results = getResults();

    if (isScanning) {
      container.innerHTML = `
        <div class="loading-container">
          <div class="loading-spinner"></div>
          <span>Scanning ${allTickers.length} markets...</span>
        </div>
      `;
      return;
    }

    if (results.length === 0) {
      container.innerHTML = `
        <div class="loading-container">
          <span>No opportunities found. Try a different strategy or filter.</span>
        </div>
      `;
      return;
    }

    const html = `
      <table class="data-table" id="scanner-table">
        <thead>
          <tr>
            <th data-sort="score">#</th>
            <th data-sort="symbol">Symbol</th>
            <th data-sort="price">Price</th>
            <th data-sort="change24h">24h Change</th>
            <th data-sort="volume24h">Volume</th>
            <th data-sort="fundingRate">Funding</th>
            <th data-sort="signal">Signal</th>
            <th data-sort="confidence">Confidence</th>
            <th>Strategy</th>
          </tr>
        </thead>
        <tbody>
          ${results.map((r, i) => `
            <tr data-symbol="${r.symbol}" onclick="App.openChart('${r.symbol}')">
              <td style="color: var(--text-faint)">${i + 1}</td>
              <td class="symbol-cell">${r.symbol.replace('USDT', '')}<span style="color: var(--text-faint); font-weight: 400">/USDT</span></td>
              <td class="price-cell">$${formatNumber(r.price)}</td>
              <td class="${r.change24h >= 0 ? 'change-positive' : 'change-negative'}" style="font-family: var(--font-mono); font-weight: 600">
                ${r.change24h >= 0 ? '+' : ''}${r.change24h.toFixed(2)}%
              </td>
              <td style="color: var(--text-secondary); font-family: var(--font-mono)">${formatVolume(r.volume24h)}</td>
              <td style="font-family: var(--font-mono); color: ${r.fundingRate > 0 ? 'var(--bullish)' : r.fundingRate < 0 ? 'var(--bearish)' : 'var(--text-muted)'}">
                ${r.fundingRate !== null ? (r.fundingRate * 100).toFixed(4) + '%' : '—'}
              </td>
              <td><span class="signal-badge ${r.signal}">${r.signal === 'neutral' ? '—' : r.signal.toUpperCase()}</span></td>
              <td>
                <div style="display: flex; align-items: center; gap: 8px">
                  <div class="confidence-bar" style="width: 60px">
                    <div class="confidence-fill ${r.confidence >= 60 ? 'high' : r.confidence < 35 ? 'low' : ''}" style="width: ${r.confidence}%"></div>
                  </div>
                  <span style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-secondary)">${r.confidence}%</span>
                </div>
              </td>
              <td style="color: var(--text-muted); font-size: 0.78rem">${r.strategy}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    container.innerHTML = html;

    // Add sort listeners
    container.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        setSort(th.dataset.sort);
        render(containerId);
      });
    });
  }

  function formatNumber(num) {
    if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 1) return num.toFixed(4);
    if (num >= 0.01) return num.toFixed(5);
    return num.toFixed(8);
  }

  function formatVolume(vol) {
    if (vol >= 1e9) return `$${(vol / 1e9).toFixed(1)}B`;
    if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`;
    if (vol >= 1e3) return `$${(vol / 1e3).toFixed(0)}K`;
    return `$${vol.toFixed(0)}`;
  }

  return {
    init,
    scan,
    getResults,
    setSort,
    setFilter,
    applyTickerUpdates,
    render,
    get isScanning() { return isScanning; },
    get allTickers() { return allTickers; },
    formatNumber,
    formatVolume,
  };

})();
