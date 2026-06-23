// ============================================
// FUTURES EDGE - Dashboard View
// Overview with opportunities, market mini charts, and signal feed
// ============================================

const Dashboard = (() => {

  let signalLog = [];
  const MAX_SIGNALS = 50;

  async function render() {
    const view = document.getElementById('view-dashboard');
    if (!view) return;

    view.innerHTML = `
      <div class="dashboard-view">
        <div class="dashboard-hero" id="dash-hero">
          <div class="stat-card accent">
            <div class="stat-label">BTC Price</div>
            <div class="stat-value" id="dash-btc-price">Loading...</div>
            <div class="stat-sub" id="dash-btc-change"></div>
          </div>
          <div class="stat-card bullish">
            <div class="stat-label">Active Signals</div>
            <div class="stat-value" id="dash-signal-count">0</div>
            <div class="stat-sub" id="dash-signal-sub">Scanning...</div>
          </div>
          <div class="stat-card neutral">
            <div class="stat-label">Market Sentiment</div>
            <div class="stat-value" id="dash-sentiment">--</div>
            <div class="stat-sub" id="dash-sentiment-sub"></div>
          </div>
          <div class="stat-card bearish">
            <div class="stat-label">Top Volatility</div>
            <div class="stat-value" id="dash-top-vol">--</div>
            <div class="stat-sub" id="dash-top-vol-sub"></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="icon">~</span>
              Market Overview
            </div>
            <span class="text-muted" style="font-size: 0.78rem" id="dash-dominance">BTC futures dominance: --</span>
          </div>
          <div class="panel-body">
            <div class="market-overview-grid" id="dash-market-overview">
              <div class="loading-container">
                <div class="loading-spinner"></div>
                <span>Loading mini charts...</span>
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="icon">*</span>
              Top Opportunities
            </div>
            <button class="filter-chip active" onclick="Dashboard.refreshOpportunities()" id="dash-refresh-btn">
              Refresh
            </button>
          </div>
          <div class="panel-body" id="dash-opportunities">
            <div class="loading-container">
              <div class="loading-spinner"></div>
              <span>Scanning markets for opportunities...</span>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="icon">#</span>
              Catalyst Radar
            </div>
            <span class="text-muted" style="font-size: 0.78rem" id="dash-news-time">News scan: --</span>
          </div>
          <div class="panel-body" id="dash-catalysts">
            <div class="loading-container">
              <div class="loading-spinner"></div>
              <span>Checking news and market pressure...</span>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="icon">+</span>
              New Listings Radar
            </div>
            <span class="text-muted" style="font-size: 0.78rem" id="dash-new-time">Fresh futures pairs</span>
          </div>
          <div class="panel-body" id="dash-new-listings">
            <div class="loading-container">
              <div class="loading-spinner"></div>
              <span>Scanning fresh listings...</span>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="icon">!</span>
              Recent Signals
            </div>
            <span class="text-muted" style="font-size: 0.78rem" id="dash-signal-time">Last updated: --</span>
          </div>
          <div class="panel-body no-padding" id="dash-signals">
            <div class="loading-container">
              <span>Signals will appear here after scanning.</span>
            </div>
          </div>
        </div>
      </div>
    `;

    await loadDashboardData();
  }

  async function loadDashboardData() {
    try {
      await Scanner.init();
      updateHeroStats();
      await renderMarketOverview();
      const results = await Scanner.scan(App.currentStrategy, 25);
      renderOpportunities(results);
      await renderCatalystRadar(results);
      await renderNewListingsRadar();
      updateSignals(results);
    } catch (e) {
      console.error('[Dashboard] Load failed:', e);
      const oppEl = document.getElementById('dash-opportunities');
      if (oppEl) {
        oppEl.innerHTML = `
          <div class="loading-container">
            <span style="color: var(--bearish)">Failed to load market data. Check your internet connection.</span>
            <button class="filter-chip" onclick="Dashboard.refreshOpportunities()" style="margin-top: 12px">Try Again</button>
          </div>
        `;
      }
    }
  }

  function updateHeroStats() {
    const tickers = Scanner.allTickers;
    if (!tickers.length) return;

    const btc = tickers.find(t => t.symbol === 'BTCUSDT');
    if (btc) {
      const btcEl = document.getElementById('dash-btc-price');
      const btcChangeEl = document.getElementById('dash-btc-change');
      if (btcEl) btcEl.textContent = `$${btc.lastPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      if (btcChangeEl) {
        btcChangeEl.textContent = `${btc.priceChangePercent >= 0 ? '+' : ''}${btc.priceChangePercent.toFixed(2)}% today`;
        btcChangeEl.style.color = btc.priceChangePercent >= 0 ? 'var(--bullish)' : 'var(--bearish)';
      }
    }

    const upCount = tickers.filter(t => t.priceChangePercent > 0).length;
    const downCount = tickers.filter(t => t.priceChangePercent < 0).length;
    const sentimentPct = Math.round((upCount / Math.max(upCount + downCount, 1)) * 100);
    const sentEl = document.getElementById('dash-sentiment');
    const sentSubEl = document.getElementById('dash-sentiment-sub');
    if (sentEl) {
      if (sentimentPct >= 60) {
        sentEl.textContent = 'Bullish';
        sentEl.style.color = 'var(--bullish)';
      } else if (sentimentPct <= 40) {
        sentEl.textContent = 'Bearish';
        sentEl.style.color = 'var(--bearish)';
      } else {
        sentEl.textContent = 'Neutral';
        sentEl.style.color = 'var(--neutral)';
      }
    }
    if (sentSubEl) sentSubEl.textContent = `${upCount} up / ${downCount} down`;

    const sorted = [...tickers].sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent));
    const topVol = sorted[0];
    if (topVol) {
      const volEl = document.getElementById('dash-top-vol');
      const volSubEl = document.getElementById('dash-top-vol-sub');
      if (volEl) {
        volEl.textContent = topVol.symbol.replace('USDT', '');
        volEl.style.color = topVol.priceChangePercent >= 0 ? 'var(--bullish)' : 'var(--bearish)';
      }
      if (volSubEl) {
        volSubEl.textContent = `${topVol.priceChangePercent >= 0 ? '+' : ''}${topVol.priceChangePercent.toFixed(2)}%`;
        volSubEl.style.color = topVol.priceChangePercent >= 0 ? 'var(--bullish)' : 'var(--bearish)';
      }
    }

    const totalVolume = tickers.reduce((sum, t) => sum + t.quoteVolume, 0);
    const btcDominance = btc && totalVolume > 0 ? (btc.quoteVolume / totalVolume) * 100 : 0;
    const dominanceEl = document.getElementById('dash-dominance');
    if (dominanceEl) dominanceEl.textContent = `BTC futures dominance: ${btcDominance.toFixed(1)}%`;
  }

  async function renderMarketOverview() {
    const container = document.getElementById('dash-market-overview');
    if (!container) return;

    const tickers = Scanner.allTickers;
    const topMovers = [...tickers]
      .filter(t => !['USDCUSDT', 'BUSDUSDT', 'TUSDUSDT', 'FDUSDUSDT'].includes(t.symbol))
      .sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent))
      .slice(0, 3);
    const symbols = [...new Set(['BTCUSDT', 'ETHUSDT', ...topMovers.map(t => t.symbol)])].slice(0, 5);

    const cards = await Promise.all(symbols.map(async symbol => {
      const ticker = tickers.find(t => t.symbol === symbol);
      try {
        const candles = await BinanceAPI.getKlines(symbol, '1h', 36);
        return renderSparklineCard(symbol, ticker, candles);
      } catch (e) {
        return renderSparklineCard(symbol, ticker, []);
      }
    }));

    container.innerHTML = cards.join('');
  }

  function renderSparklineCard(symbol, ticker, candles) {
    const prices = candles.map(c => c.close);
    const isUp = ticker ? ticker.priceChangePercent >= 0 : prices[prices.length - 1] >= prices[0];
    return `
      <div class="market-mini-card" onclick="App.openChart('${symbol}')">
        <div class="market-mini-top">
          <div>
            <div class="market-mini-symbol">${symbol.replace('USDT', '')}<span>/USDT</span></div>
            <div class="market-mini-price text-mono" data-live-price="${symbol}">${ticker ? '$' + Scanner.formatNumber(ticker.lastPrice) : '--'}</div>
            <div class="market-mini-sub">${ticker ? Scanner.formatVolume(ticker.quoteVolume) : '--'} volume</div>
          </div>
          <div class="${isUp ? 'text-bullish' : 'text-bearish'} text-mono" data-live-change="${symbol}">
            ${ticker ? `${ticker.priceChangePercent >= 0 ? '+' : ''}${ticker.priceChangePercent.toFixed(2)}%` : '--'}
          </div>
        </div>
        ${sparklineSvg(prices, isUp, symbol)}
      </div>
    `;
  }

  function sparklineSvg(values, isUp, symbol) {
    if (!values.length) return '<div class="sparkline-empty">No chart data</div>';
    const width = 220;
    const height = 54;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((value, i) => {
      const x = values.length === 1 ? 0 : (i / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const color = isUp ? '#00e676' : '#ff1744';
    return `
      <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true" data-spark-values="${values.join(',')}">
        <polyline data-live-sparkline="${symbol}" fill="none" stroke="${color}" stroke-width="2" points="${points}" />
      </svg>
    `;
  }

  function applyLiveTickers(tickers) {
    if (!Array.isArray(tickers) || !tickers.length) return;

    updateHeroStats();

    tickers.forEach(ticker => {
      const priceEl = document.querySelector(`[data-live-price="${ticker.symbol}"]`);
      if (priceEl && ticker.lastPrice) {
        const prev = parseFloat(priceEl.dataset.price || 0);
        priceEl.textContent = `$${Scanner.formatNumber(ticker.lastPrice)}`;
        priceEl.dataset.price = ticker.lastPrice;
        priceEl.style.color = ticker.lastPrice >= prev ? 'var(--bullish)' : 'var(--bearish)';
        clearTimeout(priceEl._resetTimer);
        priceEl._resetTimer = setTimeout(() => {
          priceEl.style.color = 'var(--text-primary)';
        }, 450);
      }

      const changeEl = document.querySelector(`[data-live-change="${ticker.symbol}"]`);
      if (changeEl && ticker.priceChangePercent !== undefined) {
        changeEl.textContent = `${ticker.priceChangePercent >= 0 ? '+' : ''}${ticker.priceChangePercent.toFixed(2)}%`;
        changeEl.classList.toggle('text-bullish', ticker.priceChangePercent >= 0);
        changeEl.classList.toggle('text-bearish', ticker.priceChangePercent < 0);
      }

      updateLiveSparkline(ticker);
    });
  }

  function applyLiveMarkPrice(data) {
    if (!data || data.symbol !== 'BTCUSDT' || !data.markPrice) return;

    const btcEl = document.getElementById('dash-btc-price');
    if (btcEl) {
      const prev = parseFloat(btcEl.dataset.price || 0);
      btcEl.textContent = `$${Math.round(data.markPrice).toLocaleString('en-US')}`;
      btcEl.dataset.price = data.markPrice;
      btcEl.style.color = data.markPrice >= prev ? 'var(--bullish)' : 'var(--bearish)';
      clearTimeout(btcEl._resetTimer);
      btcEl._resetTimer = setTimeout(() => {
        btcEl.style.color = 'var(--text-primary)';
      }, 450);
    }

    const timeEl = document.getElementById('dash-signal-time');
    if (timeEl) timeEl.textContent = `Live tick: ${new Date().toLocaleTimeString()}`;

    const miniPrice = document.querySelector('[data-live-price="BTCUSDT"]');
    if (miniPrice) {
      miniPrice.textContent = `$${Scanner.formatNumber(data.markPrice)}`;
      miniPrice.dataset.price = data.markPrice;
    }
  }

  function updateLiveSparkline(ticker) {
    const line = document.querySelector(`[data-live-sparkline="${ticker.symbol}"]`);
    if (!line || !ticker.lastPrice) return;

    const svg = line.closest('svg');
    const values = (svg.dataset.sparkValues || '')
      .split(',')
      .map(Number)
      .filter(value => Number.isFinite(value));
    if (!values.length) return;

    values[values.length - 1] = ticker.lastPrice;
    svg.dataset.sparkValues = values.join(',');

    const width = 220;
    const height = 54;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((value, i) => {
      const x = values.length === 1 ? 0 : (i / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    line.setAttribute('points', points);
    line.setAttribute('stroke', ticker.priceChangePercent >= 0 ? '#00e676' : '#ff1744');
  }

  function renderOpportunities(results) {
    const container = document.getElementById('dash-opportunities');
    if (!container) return;

    const opportunities = results
      .filter(r => r.signal !== 'neutral' && r.confidence >= 40 && !r.missedEntry)
      .sort((a, b) => entryPriority(a) - entryPriority(b) || b.score - a.score)
      .slice(0, 8);

    const countEl = document.getElementById('dash-signal-count');
    const subEl = document.getElementById('dash-signal-sub');
    if (countEl) countEl.textContent = opportunities.length;
    if (subEl) subEl.textContent = `of ${results.length} scanned`;

    if (!opportunities.length) {
      container.innerHTML = `
        <div class="loading-container">
          <span>No high-confidence setups right now. The algorithm is being selective.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="dashboard-grid">
        ${opportunities.map(opp => `
          <div class="opportunity-card" onclick='App.openChart("${opp.symbol}", ${JSON.stringify(toChartSetup(opp))})'>
            <div class="opp-header">
              <div>
                <div class="opp-symbol">${opp.symbol.replace('USDT', '')}<span style="color: var(--text-faint); font-weight: 400">/USDT</span></div>
                <div class="opp-strategy">${opp.strategy}</div>
              </div>
              <span class="signal-badge ${opp.signal}">${opp.signal.toUpperCase()}</span>
            </div>
            <div class="confidence-bar">
              <div class="confidence-fill ${opp.confidence >= 60 ? 'high' : ''}" style="width: ${opp.confidence}%"></div>
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 6px">${opp.confidence}% confidence</div>
            <div class="opp-details">
              <div class="opp-detail">
                <span class="label">Price</span>
                <span class="value">$${Scanner.formatNumber(opp.price)}</span>
              </div>
              <div class="opp-detail">
                <span class="label">24h</span>
                <span class="value ${opp.change24h >= 0 ? 'text-bullish' : 'text-bearish'}">${opp.change24h >= 0 ? '+' : ''}${opp.change24h.toFixed(2)}%</span>
              </div>
              <div class="opp-detail">
                <span class="label">Funding</span>
                <span class="value">${opp.fundingRate !== null ? (opp.fundingRate * 100).toFixed(4) + '%' : '--'}</span>
              </div>
              <div class="opp-detail">
                <span class="label">Open Interest</span>
                <span class="value">${opp.openInterest ? Scanner.formatVolume(opp.openInterest) : '--'}</span>
              </div>
              <div class="opp-detail">
                <span class="label">Entry</span>
                <span class="value">$${opp.entry ? Scanner.formatNumber(opp.entry) : '--'}</span>
              </div>
              <div class="opp-detail">
                <span class="label">Ideal Entry</span>
                <span class="value ${opp.entryStatus === 'stretched' ? 'text-bearish' : 'text-accent'}">${opp.idealEntry ? '$' + Scanner.formatNumber(opp.idealEntry) : '--'} ${opp.entryLabel ? `<span class="target-tag ${opp.entryStatus === 'stretched' ? 'stretch' : ''}">${opp.entryLabel}</span>` : ''}</span>
              </div>
              <div class="opp-detail">
                <span class="label">Stop Loss</span>
                <span class="value text-bearish">${opp.stopLoss ? '$' + Scanner.formatNumber(opp.stopLoss) : '--'}</span>
              </div>
              <div class="opp-detail">
                <span class="label">TP1</span>
                <span class="value text-bullish">${opp.tp1 ? '$' + Scanner.formatNumber(opp.tp1) : '--'} ${opp.targetMeta ? `<span class="target-tag">${opp.targetMeta.tp1Realism}</span>` : ''}</span>
              </div>
              <div class="opp-detail">
                <span class="label">TP2</span>
                <span class="value text-bullish">${opp.tp2 ? '$' + Scanner.formatNumber(opp.tp2) : '--'} ${opp.targetMeta ? `<span class="target-tag stretch">${opp.targetMeta.tp2Realism}</span>` : ''}</span>
              </div>
              ${opp.targetMeta ? `
                <div class="opp-detail">
                  <span class="label">TP1 Move</span>
                  <span class="value">${opp.targetMeta.tp1MovePct.toFixed(1)}% / ${opp.targetMeta.tp1R.toFixed(2)}R</span>
                </div>
                <div class="opp-detail">
                  <span class="label">TP2 Move</span>
                  <span class="value">${opp.targetMeta.tp2MovePct.toFixed(1)}% / ${opp.targetMeta.tp2R.toFixed(2)}R</span>
                </div>
              ` : ''}
              <div class="opp-detail">
                <span class="label">Leverage</span>
                <span class="value text-accent">${opp.leverage}x</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function toChartSetup(opp) {
    return {
      symbol: opp.symbol,
      signal: opp.signal,
      confidence: opp.confidence,
      strategy: opp.strategy,
      reason: opp.reason,
      entry: opp.entry,
      stopLoss: opp.stopLoss,
      tp1: opp.tp1,
      tp2: opp.tp2,
      tp3: opp.tp3,
      leverage: opp.leverage,
      targetMeta: opp.targetMeta,
      idealEntry: opp.idealEntry,
      entryStatus: opp.entryStatus,
      entryLabel: opp.entryLabel,
      entryMeta: opp.entryMeta,
    };
  }

  function entryPriority(item) {
    if (item.entryStatus === 'ideal') return 0;
    if (item.entryStatus === 'actionable') return 1;
    if (item.entryStatus === 'stretched') return 2;
    return 3;
  }

  async function renderCatalystRadar(results = []) {
    const container = document.getElementById('dash-catalysts');
    if (!container) return;

    try {
      const res = await fetch('/api/news', { cache: 'no-store' });
      if (!res.ok) throw new Error(`News ${res.status}`);
      const payload = await res.json();
      const items = Array.isArray(payload.items) ? payload.items : [];
      const catalysts = buildCatalysts(results, items);
      const timeEl = document.getElementById('dash-news-time');
      if (timeEl) timeEl.textContent = `News scan: ${new Date(payload.updatedAt || Date.now()).toLocaleTimeString()}`;

      if (!catalysts.length) {
        container.innerHTML = '<div class="loading-container"><span>No strong catalyst cluster right now.</span></div>';
        return;
      }

      container.innerHTML = `
        <div class="catalyst-grid">
          ${catalysts.map(item => `
            <div class="catalyst-card">
              <div class="catalyst-top">
                <div>
                  <div class="opp-symbol">${item.symbol.replace('USDT', '')}<span style="color: var(--text-faint); font-weight: 400">/USDT</span></div>
                  <div class="opp-strategy">${item.label}</div>
                </div>
                <div class="catalyst-score ${item.score >= 75 ? 'hot' : ''}">${item.score}</div>
              </div>
              <div class="confidence-bar">
                <div class="confidence-fill ${item.score >= 75 ? 'high' : ''}" style="width: ${Math.min(item.score, 100)}%"></div>
              </div>
              <div class="catalyst-metrics">
                <div><span>24h</span><b class="${item.change24h >= 0 ? 'text-bullish' : 'text-bearish'}">${item.change24h >= 0 ? '+' : ''}${item.change24h.toFixed(2)}%</b></div>
                <div><span>Volume</span><b>${Scanner.formatVolume(item.quoteVolume)}</b></div>
                <div><span>News</span><b>${item.news.length}</b></div>
              </div>
              <div class="catalyst-reason">${escapeHtml(item.reason)}</div>
              ${item.news.length ? `
                <div class="catalyst-news">
                  ${item.news.slice(0, 2).map(news => `
                    <a href="${news.link}" target="_blank" rel="noopener noreferrer" class="news-chip">
                      <span>${escapeHtml(news.source)}</span>
                      ${escapeHtml(news.title)}
                    </a>
                  `).join('')}
                </div>
              ` : ''}
              <button class="filter-chip catalyst-chart-btn" onclick="App.openChart('${item.symbol}')">Open Chart</button>
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) {
      console.warn('[Dashboard] News catalyst scan failed:', e);
      container.innerHTML = '<div class="loading-container"><span>News radar unavailable. Market scanner is still running.</span></div>';
    }
  }

  function buildCatalysts(results, newsItems) {
    const stableBases = new Set(['USDC', 'BUSD', 'TUSD', 'FDUSD', 'USDP', 'DAI']);
    const noisyBases = new Set(['1000', 'THE', 'ONE', 'HOT', 'SUN']);
    const tickers = Scanner.allTickers
      .filter(t => t.symbol.endsWith('USDT'))
      .filter(t => !stableBases.has(t.symbol.replace('USDT', '')))
      .filter(t => Number.isFinite(t.quoteVolume) && t.quoteVolume > 0);
    const maxVolume = Math.max(...tickers.map(t => t.quoteVolume), 1);
    const setupBySymbol = new Map(results.map(r => [r.symbol, r]));

    return tickers.map(ticker => {
      const base = ticker.symbol.replace('USDT', '');
      const setup = setupBySymbol.get(ticker.symbol);
      const news = noisyBases.has(base) ? [] : matchNews(base, ticker.symbol, newsItems);
      const momentumScore = Math.min(Math.max(ticker.priceChangePercent, 0) * 4, 38);
      const volatilityScore = Math.min(Math.abs(ticker.priceChangePercent) * 1.5, 18);
      const volumeScore = Math.min((ticker.quoteVolume / maxVolume) * 28, 28);
      const setupScore = setup?.signal === 'long' ? Math.min(setup.confidence / 2, 40) : setup?.signal === 'short' ? -8 : 0;
      const newsScore = Math.min(news.length * 18, 42);
      const score = Math.round(Math.max(0, Math.min(100, momentumScore + volatilityScore + volumeScore + setupScore + newsScore)));

      const label = news.length && setup?.signal === 'long'
        ? 'News + long setup'
        : news.length
          ? 'News catalyst'
          : setup?.signal === 'long'
            ? 'Momentum setup'
            : 'Market anomaly';
      const reasonParts = [];
      if (ticker.priceChangePercent > 0) reasonParts.push(`${ticker.priceChangePercent.toFixed(2)}% 24h momentum`);
      if (news.length) reasonParts.push(`${news.length} recent news mention${news.length > 1 ? 's' : ''}`);
      if (setup?.signal === 'long') reasonParts.push(`${setup.confidence}% long setup`);
      if (!reasonParts.length) reasonParts.push('unusual futures activity');

      return {
        symbol: ticker.symbol,
        score,
        label,
        reason: reasonParts.join(' + '),
        change24h: ticker.priceChangePercent,
        quoteVolume: ticker.quoteVolume,
        news,
      };
    })
      .filter(item => item.score >= 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  function matchNews(base, symbol, items) {
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const basePattern = new RegExp(`(^|[^A-Z0-9])${escapedBase}([^A-Z0-9]|$)`, 'i');
    const symbolPattern = new RegExp(escapedSymbol, 'i');
    return items.filter(item => {
      const text = `${item.title || ''} ${item.description || ''}`;
      return basePattern.test(text) || symbolPattern.test(text);
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function renderNewListingsRadar() {
    const container = document.getElementById('dash-new-listings');
    if (!container) return;

    try {
      const listings = await Scanner.scanNewListings({ maxAgeDays: 60, limit: 8 });
      const timeEl = document.getElementById('dash-new-time');
      if (timeEl) timeEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;

      if (!listings.length) {
        container.innerHTML = '<div class="loading-container"><span>No fresh Binance futures listings found right now.</span></div>';
        return;
      }

      container.innerHTML = `
        <div class="new-listing-grid">
          ${listings.map(item => `
            <div class="new-listing-card" onclick="App.openChart('${item.symbol}')">
              <div class="catalyst-top">
                <div>
                  <div class="opp-symbol">${item.symbol.replace('USDT', '')}<span style="color: var(--text-faint); font-weight: 400">/USDT</span></div>
                  <div class="opp-strategy">${formatListingAge(item)}</div>
                </div>
                <div class="catalyst-score ${item.score >= 75 ? 'hot' : ''}">${item.score}</div>
              </div>
              <div class="confidence-bar">
                <div class="confidence-fill ${item.score >= 75 ? 'high' : ''}" style="width: ${Math.min(item.score, 100)}%"></div>
              </div>
              <div class="catalyst-metrics">
                <div><span>24h</span><b class="${item.change24h >= 0 ? 'text-bullish' : 'text-bearish'}">${item.change24h >= 0 ? '+' : ''}${item.change24h.toFixed(2)}%</b></div>
                <div><span>Volume</span><b>${Scanner.formatVolume(item.volume24h)}</b></div>
                <div><span>Signal</span><b class="${item.signal === 'long' ? 'text-bullish' : item.signal === 'short' ? 'text-bearish' : ''}">${item.signal === 'neutral' ? '--' : item.signal.toUpperCase()}</b></div>
              </div>
              <div class="new-listing-reason">
                ${escapeHtml(buildNewListingReason(item))}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) {
      console.warn('[Dashboard] New listing scan failed:', e);
      container.innerHTML = '<div class="loading-container"><span>New listing radar unavailable right now.</span></div>';
    }
  }

  function formatListingAge(item) {
    if (Number.isFinite(item.ageDays)) {
      if (item.ageDays < 1) return 'Listed today';
      return `Listed ${Math.floor(item.ageDays)}d ago`;
    }
    return 'Fresh listing candidate';
  }

  function buildNewListingReason(item) {
    const parts = [formatListingAge(item)];
    if (item.change24h > 0) parts.push(`${item.change24h.toFixed(2)}% 24h momentum`);
    else parts.push(`${Math.abs(item.change24h).toFixed(2)}% 24h volatility`);
    parts.push(`${Scanner.formatVolume(item.volume24h)} volume`);
    if (item.signal !== 'neutral') parts.push(`${item.confidence}% ${item.signal} setup`);
    return parts.join(' + ');
  }

  function updateSignals(results) {
    // Only record the ones that show up in Top Opportunities
    const signals = results
      .filter(r => r.signal !== 'neutral' && r.confidence >= 40 && !r.missedEntry)
      .sort((a, b) => entryPriority(a) - entryPriority(b) || b.score - a.score)
      .slice(0, 8);

    const now = new Date();
    signals.forEach(s => {
      const duplicate = signalLog.find(existing =>
        existing.symbol === s.symbol &&
        existing.signal === s.signal &&
        existing.strategy === s.strategy &&
        now - existing.timestamp < 10 * 60 * 1000
      );
      if (!duplicate) signalLog.unshift({ ...s, timestamp: now });
    });
    signalLog = signalLog.slice(0, MAX_SIGNALS);

    Journal.recordSignals(signals, 'dashboard');

    renderSignalFeed();

    const timeEl = document.getElementById('dash-signal-time');
    if (timeEl) timeEl.textContent = `Last updated: ${now.toLocaleTimeString()}`;
  }

  function renderSignalFeed() {
    const container = document.getElementById('dash-signals');
    if (!container) return;

    if (!signalLog.length) {
      container.innerHTML = '<div class="loading-container"><span>No active signals in this session yet.</span></div>';
      return;
    }

    container.innerHTML = signalLog.slice(0, 10).map(s => `
      <div class="signal-card" onclick="App.openChart('${s.symbol}')">
        <div class="signal-direction ${s.signal}"></div>
        <div class="signal-info">
          <div class="signal-top">
            <span class="signal-symbol">${s.symbol.replace('USDT', '')}</span>
            <span class="signal-badge ${s.signal}">${s.signal.toUpperCase()}</span>
            <span class="signal-time">${s.timestamp.toLocaleTimeString()} - ${s.strategy}</span>
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px">
            ${s.reason ? s.reason.substring(0, 120) : '--'}
          </div>
          <div class="signal-levels">
            <div class="signal-level">
              <span class="label">Entry</span>
              <span class="value">$${s.entry ? Scanner.formatNumber(s.entry) : '--'}</span>
            </div>
            <div class="signal-level">
              <span class="label">Stop Loss</span>
              <span class="value text-bearish">${s.stopLoss ? '$' + Scanner.formatNumber(s.stopLoss) : '--'}</span>
            </div>
            <div class="signal-level">
              <span class="label">TP1</span>
              <span class="value text-bullish">${s.tp1 ? '$' + Scanner.formatNumber(s.tp1) : '--'}</span>
            </div>
            <div class="signal-level">
              <span class="label">TP2</span>
              <span class="value text-bullish">${s.tp2 ? '$' + Scanner.formatNumber(s.tp2) : '--'}</span>
            </div>
            <div class="signal-level">
              <span class="label">Confidence</span>
              <span class="value text-accent">${s.confidence}%</span>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }

  async function refreshOpportunities({ silent = false } = {}) {
    const btn = document.getElementById('dash-refresh-btn');
    if (btn && !silent) btn.textContent = 'Scanning...';

    const container = document.getElementById('dash-opportunities');
    if (container && !silent) {
      container.innerHTML = `
        <div class="loading-container">
          <div class="loading-spinner"></div>
          <span>Re-scanning markets...</span>
        </div>
      `;
    }

    await Scanner.init();
    const results = await Scanner.scan(App.currentStrategy, 25);
    updateHeroStats();
    await renderMarketOverview();
    renderOpportunities(results);
    await renderCatalystRadar(results);
    await renderNewListingsRadar();
    updateSignals(results);

    if (btn) btn.textContent = 'Refresh';
  }

  function getSignalLog() {
    return [...signalLog];
  }

  return {
    render,
    refreshOpportunities,
    loadDashboardData,
    renderMarketOverview,
    renderCatalystRadar,
    renderNewListingsRadar,
    applyLiveTickers,
    applyLiveMarkPrice,
    updateHeroStats,
    getSignalLog,
    entryPriority,
  };

})();
