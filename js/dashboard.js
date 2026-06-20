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
      .filter(r => r.signal !== 'neutral' && r.confidence >= 40)
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
    };
  }

  function updateSignals(results) {
    const signals = results
      .filter(r => r.signal !== 'neutral' && r.confidence >= 35)
      .slice(0, 15);

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
    applyLiveTickers,
    applyLiveMarkPrice,
    updateHeroStats,
    getSignalLog,
  };

})();
