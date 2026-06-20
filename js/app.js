// ============================================
// FUTURES EDGE — Application Controller
// View routing, state management, lifecycle
// ============================================

const App = (() => {

  let currentView = 'dashboard';
  let currentStrategy = 'all';
  let isInitialized = false;
  let autoRefreshTimer = null;
  let tickerRefreshTimer = null;
  let chartRefreshTimer = null;
  let btcFallbackTimer = null;
  let journalRefreshTimer = null;
  let liveTickerWsId = null;
  let btcMarkWsId = null;
  let isAutoRefreshing = false;
  let pendingChartSymbol = null;
  let pendingChartSetup = null;

  const TICKER_REFRESH_MS = 10000;
  const SCAN_REFRESH_MS = 15000;
  const BTC_FALLBACK_MS = 3000;
  const CHART_REST_REFRESH_MS = 3000;

  const views = ['dashboard', 'chart', 'calculator', 'scanner', 'signals'];
  const strategyMap = {
    'all': { name: 'All Strategies', icon: '⚡' },
    'trend': { name: 'Trend Following', icon: '📈' },
    'structure': { name: 'Market Structure', icon: '🏗️' },
    'crossover': { name: 'MA Crossover', icon: '✖️' },
    'funding': { name: 'Funding Rate Edge', icon: '💰' },
    'swing': { name: 'Weekly Swing', icon: '🎯' },
  };

  /**
   * Initialize the application
   */
  async function init() {
    if (isInitialized) return;
    isInitialized = true;

    console.log('[App] Initializing Futures Edge...');

    // Set connection status callback
    BinanceAPI.setConnectionCallback((connected) => {
      const dot = document.getElementById('live-dot');
      const label = document.getElementById('live-label');
      if (dot) {
        dot.className = connected ? 'live-dot' : 'live-dot disconnected';
      }
      if (label) {
        label.textContent = connected ? 'Live' : 'Reconnecting';
      }
    });

    // Setup navigation
    setupNavigation();
    setupStrategySelector();
    setupSymbolSearch();

    // Load initial view
    await navigateTo('dashboard');
    startAutoRefresh();

    console.log('[App] Initialized successfully');
  }

  /**
   * Navigate to a view
   * @param {string} viewId
   */
  async function navigateTo(viewId) {
    if (!views.includes(viewId)) return;

    // Update active state
    currentView = viewId;
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewId);
    });
    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('active', v.id === `view-${viewId}`);
    });

    // Load view-specific content
    switch (viewId) {
      case 'dashboard':
        await Dashboard.render();
        break;
      case 'chart':
        ChartModule.init('chart-canvas');
        await ChartModule.loadSymbol(pendingChartSymbol || ChartModule.currentSymbol, ChartModule.currentInterval);
        if (pendingChartSetup) ChartModule.setTradeSetup(pendingChartSetup);
        pendingChartSymbol = null;
        pendingChartSetup = null;
        setupChartControls();
        break;
      case 'calculator':
        renderCalculator();
        break;
      case 'scanner':
        await renderScanner();
        break;
      case 'signals':
        renderSignals();
        break;
    }
  }

  /**
   * Open chart for a specific symbol
   * @param {string} symbol
   */
  async function openChart(symbol, setup = null) {
    pendingChartSymbol = symbol;
    pendingChartSetup = setup;

    // Update symbol display
    const nameEl = document.getElementById('chart-symbol-name');
    if (nameEl) {
      nameEl.textContent = symbol.replace('USDT', '/USDT');
      nameEl.dataset.symbol = symbol;
    }

    // Navigate to chart view
    await navigateTo('chart');
  }

  // ── Navigation Setup ──
  function setupNavigation() {
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(item.dataset.view);
      });
    });
  }

  // ── Strategy Selector ──
  function setupStrategySelector() {
    const btn = document.getElementById('strategy-btn');
    const dropdown = document.getElementById('strategy-dropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('visible');
      dropdown.classList.toggle('visible', !isOpen);
      btn.classList.toggle('open', !isOpen);
    });

    // Close on outside click
    document.addEventListener('click', () => {
      dropdown.classList.remove('visible');
      btn.classList.remove('open');
    });

    // Option clicks
    dropdown.querySelectorAll('.strategy-option').forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = option.dataset.strategy;
        setStrategy(id);
        dropdown.classList.remove('visible');
        btn.classList.remove('open');
      });
    });
  }

  function setStrategy(id) {
    currentStrategy = id;
    const info = strategyMap[id];

    // Update button text
    const btn = document.getElementById('strategy-btn');
    if (btn) {
      btn.querySelector('.strategy-name').textContent = info.name;
      btn.querySelector('.strategy-icon').textContent = info.icon;
    }

    // Update active state in dropdown
    document.querySelectorAll('.strategy-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.strategy === id);
    });

    // Toast
    showToast(`Strategy: ${info.name}`, 'accent');

    // Refresh current view if dashboard or scanner
    if (currentView === 'dashboard') {
      Dashboard.refreshOpportunities();
    } else if (currentView === 'scanner') {
      renderScanner();
    }
  }

  // ── Symbol Search ──
  function startAutoRefresh() {
    stopAutoRefresh();

    liveTickerWsId = BinanceAPI.subscribeAllTickers((tickers) => {
      Scanner.applyTickerUpdates(tickers);
      Journal.updateFromTickers(tickers);
      if (currentView === 'dashboard') {
        Dashboard.applyLiveTickers(tickers);
      } else if (currentView === 'scanner') {
        Scanner.render('scanner-results');
      } else if (currentView === 'signals') {
        renderSignals();
      }
    });

    btcMarkWsId = BinanceAPI.subscribeMarkPrice('BTCUSDT', (data) => {
      if (currentView === 'dashboard') {
        Dashboard.applyLiveMarkPrice(data);
      }
    });

    tickerRefreshTimer = setInterval(async () => {
      try {
        await Scanner.init();
        if (currentView === 'dashboard') {
          Dashboard.updateHeroStats();
          await Dashboard.renderMarketOverview();
        } else if (currentView === 'scanner') {
          Scanner.render('scanner-results');
        }
      } catch (e) {
        console.warn('[App] Ticker refresh failed:', e);
      }
    }, TICKER_REFRESH_MS);

    btcFallbackTimer = setInterval(async () => {
      if (currentView !== 'dashboard') return;
      try {
        const mark = await BinanceAPI.getMarkPrice('BTCUSDT');
        Dashboard.applyLiveMarkPrice(mark);
      } catch (e) {
        console.warn('[App] BTC fallback failed:', e);
      }
    }, BTC_FALLBACK_MS);

    autoRefreshTimer = setInterval(refreshVisibleData, SCAN_REFRESH_MS);

    chartRefreshTimer = setInterval(async () => {
      if (currentView === 'chart') {
        try {
          await ChartModule.refreshLatestCandle();
        } catch (e) {
          console.warn('[App] Chart candle fallback failed:', e);
        }
      }
    }, CHART_REST_REFRESH_MS);

    journalRefreshTimer = setInterval(async () => {
      await Journal.refreshOpenEntries();
      if (currentView === 'signals') renderSignals();
    }, 60000);
  }

  function stopAutoRefresh() {
    if (liveTickerWsId) BinanceAPI.unsubscribe(liveTickerWsId);
    if (btcMarkWsId) BinanceAPI.unsubscribe(btcMarkWsId);
    if (tickerRefreshTimer) clearInterval(tickerRefreshTimer);
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    if (chartRefreshTimer) clearInterval(chartRefreshTimer);
    if (btcFallbackTimer) clearInterval(btcFallbackTimer);
    if (journalRefreshTimer) clearInterval(journalRefreshTimer);
    liveTickerWsId = null;
    btcMarkWsId = null;
    tickerRefreshTimer = null;
    autoRefreshTimer = null;
    chartRefreshTimer = null;
    btcFallbackTimer = null;
    journalRefreshTimer = null;
  }

  async function refreshVisibleData() {
    if (isAutoRefreshing) return;
    isAutoRefreshing = true;

    try {
      if (currentView === 'dashboard') {
        await Dashboard.refreshOpportunities({ silent: true });
      } else if (currentView === 'scanner') {
        await Scanner.init();
        await Scanner.scan(currentStrategy, 30);
        Scanner.render('scanner-results');
        const status = document.getElementById('scanner-refresh-status');
        if (status) status.textContent = `Updated ${new Date().toLocaleTimeString()} - auto every ${Math.round(SCAN_REFRESH_MS / 1000)}s`;
      } else if (currentView === 'signals') {
        await Scanner.init();
        const results = await Scanner.scan(currentStrategy, 30);
        Journal.recordSignals(results.filter(r => r.signal !== 'neutral'), 'signals');
        await Journal.refreshOpenEntries();
        renderSignals();
      }
    } catch (e) {
      console.warn('[App] Auto refresh failed:', e);
    } finally {
      isAutoRefreshing = false;
    }
  }

  function setupSymbolSearch() {
    const overlay = document.getElementById('symbol-search-overlay');
    const input = document.getElementById('symbol-search-input');
    const results = document.getElementById('symbol-search-results');
    const trigger = document.getElementById('chart-symbol-name');

    if (!overlay || !input) return;

    // Open search
    if (trigger) {
      trigger.addEventListener('click', () => openSymbolSearch());
    }

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        openSymbolSearch();
      }
      if (e.key === 'Escape') {
        closeSymbolSearch();
      }
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeSymbolSearch();
    });

    // Search input
    input.addEventListener('input', async () => {
      const query = input.value.toUpperCase().trim();
      if (query.length < 1) {
        results.innerHTML = '';
        return;
      }

      // Search from cached tickers
      let tickers = Scanner.allTickers;
      if (!tickers.length) {
        tickers = await BinanceAPI.get24hrTickers();
      }

      const matches = tickers
        .filter(t => t.symbol.includes(query))
        .sort((a, b) => b.quoteVolume - a.quoteVolume)
        .slice(0, 20);

      results.innerHTML = matches.map(t => `
        <div class="symbol-search-item" data-symbol="${t.symbol}">
          <div>
            <span class="sym-name">${t.symbol.replace('USDT', '')}</span>
            <span style="color: var(--text-faint); font-size: 0.78rem">/USDT</span>
          </div>
          <div style="text-align: right">
            <div class="sym-price">$${Scanner.formatNumber(t.lastPrice)}</div>
            <div style="font-size: 0.72rem; color: ${t.priceChangePercent >= 0 ? 'var(--bullish)' : 'var(--bearish)'}">
              ${t.priceChangePercent >= 0 ? '+' : ''}${t.priceChangePercent.toFixed(2)}%
            </div>
          </div>
        </div>
      `).join('');

      // Click handlers
      results.querySelectorAll('.symbol-search-item').forEach(item => {
        item.addEventListener('click', () => {
          openChart(item.dataset.symbol);
          closeSymbolSearch();
        });
      });
    });
  }

  function openSymbolSearch() {
    const overlay = document.getElementById('symbol-search-overlay');
    const input = document.getElementById('symbol-search-input');
    if (overlay) {
      overlay.classList.add('visible');
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  }

  function closeSymbolSearch() {
    const overlay = document.getElementById('symbol-search-overlay');
    if (overlay) overlay.classList.remove('visible');
  }

  // ── Chart Controls ──
  function setupChartControls() {
    // Timeframe buttons
    document.querySelectorAll('.tf-btn').forEach(btn => {
      if (btn.dataset.bound === 'true') return;
      btn.dataset.bound = 'true';
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ChartModule.changeTimeframe(btn.dataset.tf);
      });
    });

    // Indicator toggles
    document.querySelectorAll('.ind-toggle').forEach(btn => {
      if (btn.dataset.bound === 'true') return;
      btn.dataset.bound = 'true';
      btn.addEventListener('click', () => {
        const active = ChartModule.toggleIndicator(btn.dataset.indicator);
        btn.classList.toggle('active', active);
      });
    });

    // Set initial active states
    const state = ChartModule.getState();
    document.querySelectorAll('.tf-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tf === state.interval);
    });
    document.querySelectorAll('.ind-toggle').forEach(btn => {
      btn.classList.toggle('active', state.indicators[btn.dataset.indicator]);
    });
  }

  // ── Calculator View ──
  function renderCalculator() {
    const view = document.getElementById('view-calculator');
    if (!view) return;

    // Check if already rendered
    if (view.querySelector('.calculator-view')) return;

    view.innerHTML = `
      <div class="calculator-view">
        <div class="calc-layout">
          <!-- Input Panel -->
          <div class="panel">
            <div class="panel-header">
              <div class="panel-title">
                <span class="icon">🧮</span>
                Position Calculator
              </div>
            </div>
            <div class="panel-body">
              <div class="calc-input-group">
                <label>Account Balance (USDT)</label>
                <input type="number" id="calc-balance" placeholder="1000" value="1000" step="100">
              </div>
              <div class="calc-input-row">
                <div class="calc-input-group">
                  <label>Risk Per Trade (%)</label>
                  <input type="number" id="calc-risk" placeholder="1" value="1" step="0.5" min="0.5" max="5">
                </div>
                <div class="calc-input-group">
                  <label>Leverage</label>
                  <select id="calc-leverage">
                    <option value="2">2x</option>
                    <option value="3" selected>3x</option>
                    <option value="4">4x</option>
                    <option value="5">5x</option>
                  </select>
                </div>
              </div>
              <div class="calc-input-group">
                <label>Symbol</label>
                <select id="calc-symbol">
                  <option value="BTCUSDT">BTC/USDT</option>
                  <option value="ETHUSDT">ETH/USDT</option>
                  <option value="custom">Custom Price</option>
                </select>
              </div>
              <div class="calc-input-group">
                <label>Entry Price</label>
                <input type="number" id="calc-entry" placeholder="Entry price" step="0.01">
              </div>
              <div class="calc-input-row">
                <div class="calc-input-group">
                  <label>Direction</label>
                  <select id="calc-direction">
                    <option value="long">LONG</option>
                    <option value="short">SHORT</option>
                  </select>
                </div>
                <div class="calc-input-group">
                  <label>Custom Stop Loss (optional)</label>
                  <input type="number" id="calc-stoploss" placeholder="Auto" step="0.01">
                </div>
              </div>
              <button class="calc-submit" onclick="App.calculatePosition()">
                ⚡ Calculate Position
              </button>
            </div>
          </div>

          <!-- Results Panel -->
          <div id="calc-results-container">
            <div class="loading-container" style="padding: 80px 24px">
              <span style="font-size: 2rem; margin-bottom: 8px">🧮</span>
              <span>Enter your trade parameters and click Calculate</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Auto-fill entry price when symbol changes
    const symbolSelect = document.getElementById('calc-symbol');
    const entryInput = document.getElementById('calc-entry');

    symbolSelect.addEventListener('change', async () => {
      const sym = symbolSelect.value;
      if (sym !== 'custom') {
        try {
          const tickers = Scanner.allTickers;
          const ticker = tickers.find(t => t.symbol === sym);
          if (ticker) {
            entryInput.value = ticker.lastPrice;
          } else {
            const klines = await BinanceAPI.getKlines(sym, '1h', 1);
            if (klines.length) entryInput.value = klines[0].close;
          }
        } catch (e) {
          console.warn('Could not fetch price:', e);
        }
      }
    });

    // Populate with more symbols if available
    if (Scanner.allTickers.length > 0) {
      populateCalcSymbols();
    }

    // Trigger initial price load
    symbolSelect.dispatchEvent(new Event('change'));
  }

  function populateCalcSymbols() {
    const select = document.getElementById('calc-symbol');
    if (!select) return;

    const topSymbols = Scanner.allTickers
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, 30);

    select.innerHTML = topSymbols.map(t => `
      <option value="${t.symbol}">${t.symbol.replace('USDT', '')}/USDT</option>
    `).join('') + '<option value="custom">Custom Price</option>';
  }

  function calculatePosition() {
    const balance = parseFloat(document.getElementById('calc-balance').value);
    const riskPercent = parseFloat(document.getElementById('calc-risk').value);
    const leverage = parseInt(document.getElementById('calc-leverage').value);
    const entryPrice = parseFloat(document.getElementById('calc-entry').value);
    const direction = document.getElementById('calc-direction').value;
    const stopLossPrice = parseFloat(document.getElementById('calc-stoploss').value) || null;

    if (!balance || !entryPrice) {
      showToast('Please fill in balance and entry price', 'bearish');
      return;
    }

    const result = Calculator.calculate({
      balance,
      riskPercent,
      entryPrice,
      leverage,
      direction,
      stopLossPrice,
    });

    if (!result) {
      showToast('Invalid inputs', 'bearish');
      return;
    }

    renderCalcResults(result);
  }

  function renderCalcResults(r) {
    const container = document.getElementById('calc-results-container');
    if (!container) return;

    const isLong = r.direction === 'long';

    container.innerHTML = `
      <div class="calc-results">
        <!-- Position Size -->
        <div class="calc-result-card">
          <div class="result-title">📐 Position Size</div>
          <div class="calc-result-item">
            <span class="label">Margin Used</span>
            <span class="value">${Calculator.formatUSD(r.margin)}</span>
          </div>
          <div class="calc-result-item">
            <span class="label">Position Size</span>
            <span class="value text-accent">${Calculator.formatUSD(r.positionSize)}</span>
          </div>
          <div class="calc-result-item">
            <span class="label">Leverage</span>
            <span class="value">${r.leverage}x</span>
          </div>
          <div class="calc-result-item">
            <span class="label">Direction</span>
            <span class="value"><span class="signal-badge ${r.direction}">${r.direction.toUpperCase()}</span></span>
          </div>
        </div>

        <!-- Risk Management -->
        <div class="calc-result-card">
          <div class="result-title">🛡️ Risk Management</div>
          <div class="calc-result-item">
            <span class="label">Entry Price</span>
            <span class="value">$${Calculator.formatPrice(r.entryPrice)}</span>
          </div>
          <div class="calc-result-item">
            <span class="label">Stop Loss</span>
            <span class="value text-bearish">$${Calculator.formatPrice(r.stopLoss)} (${r.stopDistancePct}%)</span>
          </div>
          <div class="calc-result-item">
            <span class="label">Max Loss</span>
            <span class="value text-bearish">${Calculator.formatUSD(r.maxLoss)} (${r.maxLossPct.toFixed(2)}%)</span>
          </div>
          <div class="calc-result-item">
            <span class="label">Liquidation</span>
            <span class="value" style="color: #ff6b6b">$${Calculator.formatPrice(r.liquidationPrice)} (${r.liqDistancePct}% away)</span>
          </div>
        </div>

        <!-- Take Profit Levels -->
        <div class="calc-result-card">
          <div class="result-title">🎯 Take Profit Levels</div>
          <div class="calc-result-item">
            <span class="label">TP1 (+1R)</span>
            <span class="value text-bullish">$${Calculator.formatPrice(r.tp1)} → +${Calculator.formatUSD(r.profitTP1)} (${r.roiTP1}% ROI)</span>
          </div>
          <div class="calc-result-item">
            <span class="label">TP2 (+2R)</span>
            <span class="value text-bullish">$${Calculator.formatPrice(r.tp2)} → +${Calculator.formatUSD(r.profitTP2)} (${r.roiTP2}% ROI)</span>
          </div>
          <div class="calc-result-item">
            <span class="label">TP3 (+3R)</span>
            <span class="value text-bullish">$${Calculator.formatPrice(r.tp3)} → +${Calculator.formatUSD(r.profitTP3)} (${r.roiTP3}% ROI)</span>
          </div>
        </div>

        <!-- Scale-Out Plan -->
        <div class="calc-result-card scale-out-plan">
          <div class="result-title">📊 Scale-Out Plan (Professional Exit Strategy)</div>
          <div class="scale-out-bar">
            <div class="scale-out-segment sl" style="flex: ${r.stopDistancePct}">SL</div>
            <div class="scale-out-segment tp1" style="flex: 25">TP1: 25%</div>
            <div class="scale-out-segment tp2" style="flex: 37.5">TP2: 37.5%</div>
            <div class="scale-out-segment tp3" style="flex: 37.5">TP3: 37.5%</div>
          </div>
          <div style="margin-top: 16px">
            ${r.scaleOut.map(s => `
              <div class="calc-result-item">
                <span class="label">${s.level}: Sell ${s.percent}% at $${Calculator.formatPrice(s.price)}</span>
                <span class="value text-bullish">+${Calculator.formatUSD(s.profit)}</span>
              </div>
            `).join('')}
            <div class="calc-result-item" style="border-top: 2px solid var(--accent); margin-top: 8px; padding-top: 12px">
              <span class="label font-bold">Total Expected Profit (Scale-Out)</span>
              <span class="value text-accent font-bold">${Calculator.formatUSD(r.scaleOutProfit)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Scanner View ──
  async function renderScanner() {
    const view = document.getElementById('view-scanner');
    if (!view) return;

    view.innerHTML = `
      <div class="scanner-view">
        <div class="panel-header" style="padding: 0; border: none; margin-bottom: 4px">
          <div class="panel-title">
            <span class="icon">🔍</span>
            Market Scanner
          </div>
          <button class="filter-chip active" onclick="App.refreshScanner()" id="scanner-refresh-btn">
            ↻ Scan Now
          </button>
        </div>
        <div class="scanner-filters" id="scanner-filters">
          <span class="filter-chip active" data-filter="all" onclick="App.setScanFilter('all')">All</span>
          <span class="filter-chip" data-filter="long" onclick="App.setScanFilter('long')">🟢 Longs Only</span>
          <span class="filter-chip" data-filter="short" onclick="App.setScanFilter('short')">🔴 Shorts Only</span>
          <span class="filter-chip" data-filter="volatile" onclick="App.setScanFilter('volatile')">🔥 High Volatility</span>
        </div>
        <div class="panel" style="flex: 1; overflow: hidden">
          <div class="panel-body no-padding" style="overflow-y: auto; max-height: calc(100vh - 220px)" id="scanner-results">
            <div class="loading-container">
              <div class="loading-spinner"></div>
              <span>Scanning markets...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Run scan
    await Scanner.init();
    const results = await Scanner.scan(currentStrategy, 30);
    Journal.recordSignals(results.filter(r => r.signal !== 'neutral'), 'scanner');
    Scanner.render('scanner-results');
  }

  async function refreshScanner() {
    const btn = document.getElementById('scanner-refresh-btn');
    if (btn) btn.textContent = '⏳ Scanning...';

    const results = await Scanner.scan(currentStrategy, 30);
    Journal.recordSignals(results.filter(r => r.signal !== 'neutral'), 'scanner');
    Scanner.render('scanner-results');

    if (btn) btn.textContent = '↻ Scan Now';
  }

  function setScanFilter(mode) {
    Scanner.setFilter(mode);
    Scanner.render('scanner-results');

    // Update filter chips
    document.querySelectorAll('#scanner-filters .filter-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === mode);
    });
  }

  // ── Signals View ──
  function renderSignals() {
    const view = document.getElementById('view-signals');
    if (!view) return;

    view.innerHTML = `
      <div class="signals-view">
        <div class="panel-header" style="padding: 0; border: none; margin-bottom: 4px">
          <div class="panel-title">
            <span class="icon">📡</span>
            Signal Log
          </div>
          <span class="text-muted" style="font-size: 0.78rem">All signals from current session</span>
        </div>
        <div id="signals-container">
          <div class="loading-container">
            <span>Signals will appear here after scanning from the Dashboard or Scanner.</span>
          </div>
        </div>
      </div>
    `;

    // If we have signals from dashboard, render them
    const results = Scanner.getResults();
    if (results.length > 0) {
      const signalsContainer = document.getElementById('signals-container');
      const signals = results
        .filter(r => r.signal !== 'neutral')
        .slice(0, 20);

      if (signals.length > 0) {
        signalsContainer.innerHTML = signals.map(s => `
          <div class="signal-card" onclick="App.openChart('${s.symbol}')">
            <div class="signal-direction ${s.signal}"></div>
            <div class="signal-info">
              <div class="signal-top">
                <span class="signal-symbol">${s.symbol.replace('USDT', '')}</span>
                <span class="signal-badge ${s.signal}">${s.signal.toUpperCase()}</span>
                <span class="signal-time">${s.strategy} · Confidence: ${s.confidence}%</span>
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px">${s.reason || '—'}</div>
              <div class="signal-levels">
                <div class="signal-level">
                  <span class="label">Entry</span>
                  <span class="value">$${Scanner.formatNumber(s.entry)}</span>
                </div>
                <div class="signal-level">
                  <span class="label">Stop Loss</span>
                  <span class="value text-bearish">${s.stopLoss ? '$' + Scanner.formatNumber(s.stopLoss) : '—'}</span>
                </div>
                <div class="signal-level">
                  <span class="label">TP1</span>
                  <span class="value text-bullish">${s.tp1 ? '$' + Scanner.formatNumber(s.tp1) : '—'}</span>
                </div>
                <div class="signal-level">
                  <span class="label">TP2</span>
                  <span class="value text-bullish">${s.tp2 ? '$' + Scanner.formatNumber(s.tp2) : '—'}</span>
                </div>
                <div class="signal-level">
                  <span class="label">TP3</span>
                  <span class="value text-bullish">${s.tp3 ? '$' + Scanner.formatNumber(s.tp3) : '—'}</span>
                </div>
                <div class="signal-level">
                  <span class="label">Leverage</span>
                  <span class="value text-accent">${s.leverage}x</span>
                </div>
              </div>
            </div>
          </div>
        `).join('');
      }
    }
  }

  // ── Toast Notifications ──
  function renderSignals() {
    const view = document.getElementById('view-signals');
    if (!view) return;

    const stats = Journal.getStats();
    const entries = Journal.entries;
    const byStrategy = Journal.groupStats('strategy').slice(0, 6);

    view.innerHTML = `
      <div class="signals-view">
        <div class="panel-header" style="padding: 0; border: none; margin-bottom: 4px">
          <div class="panel-title">
            <span class="icon">%</span>
            Signal Journal
          </div>
          <div class="flex items-center gap-sm">
            <button class="filter-chip" onclick="App.resumeJournal()">Resume Saving</button>
            <button class="filter-chip" onclick="App.clearJournal()">Clear Journal</button>
          </div>
        </div>

        <div class="journal-stats-grid">
          <div class="stat-card accent">
            <div class="stat-label">Win Rate</div>
            <div class="stat-value">${stats.closed ? stats.winRate.toFixed(1) + '%' : '--'}</div>
            <div class="stat-sub">${stats.wins} wins / ${stats.losses} losses</div>
          </div>
          <div class="stat-card bullish">
            <div class="stat-label">Open Signals</div>
            <div class="stat-value">${stats.open}</div>
            <div class="stat-sub">${stats.total} saved total</div>
          </div>
          <div class="stat-card neutral">
            <div class="stat-label">Avg R</div>
            <div class="stat-value">${stats.closed ? stats.avgR.toFixed(2) + 'R' : '--'}</div>
            <div class="stat-sub">${stats.closed} resolved trades</div>
          </div>
          <div class="stat-card bearish">
            <div class="stat-label">TP2+ Hits</div>
            <div class="stat-value">${stats.tp2Wins}</div>
            <div class="stat-sub">${stats.tp1Wins} reached TP1+</div>
          </div>
        </div>

        ${Journal.recordingPaused ? `
          <div class="journal-paused">
            Journal saving is paused after clear. Click Resume Saving when you want to start collecting fresh signals again.
          </div>
        ` : ''}

        <div class="journal-layout">
          <div class="panel">
            <div class="panel-header">
              <div class="panel-title">Saved Signals</div>
              <span class="text-muted" style="font-size: 0.78rem">Saved locally in this browser</span>
            </div>
            <div class="panel-body no-padding">
              ${renderJournalTable(entries)}
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div class="panel-title">By Strategy</div>
            </div>
            <div class="panel-body">
              ${byStrategy.length ? byStrategy.map(group => `
                <div class="strategy-stat-row">
                  <div>
                    <div class="font-semibold">${group.label}</div>
                    <div class="text-muted" style="font-size: 0.74rem">${group.total} resolved</div>
                  </div>
                  <div class="text-mono ${group.winRate >= 50 ? 'text-bullish' : 'text-bearish'}">${group.winRate.toFixed(1)}%</div>
                  <div class="text-mono">${group.avgR.toFixed(2)}R</div>
                </div>
              `).join('') : '<div class="loading-container"><span>No resolved strategy stats yet.</span></div>'}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderJournalTable(entries) {
    if (!entries.length) {
      return '<div class="loading-container"><span>No saved signals yet. Leave the dashboard running and signals will be journaled automatically.</span></div>';
    }

    return `
      <table class="data-table journal-table">
        <thead>
          <tr>
            <th>Signal</th>
            <th>Strategy</th>
            <th>Entry</th>
            <th>Stop</th>
            <th>TP1 / TP2</th>
            <th>Status</th>
            <th>R</th>
            <th>Saved</th>
          </tr>
        </thead>
        <tbody>
          ${entries.slice(0, 120).map(entry => `
            <tr onclick='App.openChart("${entry.symbol}", ${JSON.stringify(entry)})'>
              <td>
                <div class="symbol-cell">${entry.symbol.replace('USDT', '')}<span style="color: var(--text-faint); font-weight: 400">/USDT</span></div>
                <span class="signal-badge ${entry.signal}">${entry.signal.toUpperCase()}</span>
              </td>
              <td style="color: var(--text-secondary); font-size: 0.78rem">${entry.strategy}</td>
              <td class="price-cell">$${Scanner.formatNumber(entry.entry)}</td>
              <td class="text-bearish text-mono">$${Scanner.formatNumber(entry.stopLoss)}</td>
              <td class="text-bullish text-mono">$${Scanner.formatNumber(entry.tp1)} / ${entry.tp2 ? '$' + Scanner.formatNumber(entry.tp2) : '--'}</td>
              <td><span class="journal-status ${entry.outcome}">${formatJournalStatus(entry)}</span></td>
              <td class="text-mono ${entry.rMultiple >= 0 ? 'text-bullish' : 'text-bearish'}">${entry.rMultiple ? entry.rMultiple.toFixed(2) : '0.00'}R</td>
              <td style="color: var(--text-muted); font-size: 0.74rem">${new Date(entry.createdAt).toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function formatJournalStatus(entry) {
    if (entry.status === 'open') return 'Tracking';
    if (entry.outcome === 'win') return `${entry.hitLevel.toUpperCase()} hit`;
    if (entry.outcome === 'loss') return 'Stopped';
    return entry.outcome || entry.status;
  }

  function clearJournal() {
    if (!confirm('Clear all saved signal journal data from this browser?')) return;
    Journal.clear();
    renderSignals();
  }

  function resumeJournal() {
    Journal.resumeRecording();
    refreshVisibleData();
    renderSignals();
  }

  function showToast(message, type = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  return {
    init,
    navigateTo,
    openChart,
    calculatePosition,
    refreshScanner,
    setScanFilter,
    refreshVisibleData,
    clearJournal,
    resumeJournal,
    showToast,
    get currentStrategy() { return currentStrategy; },
    get currentView() { return currentView; },
  };

})();

// ── Bootstrap ──
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
