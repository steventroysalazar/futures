// ============================================
// FUTURES EDGE - TradingView Chart Module
// Candles, volume pane, RSI pane, indicators, and signal markers
// ============================================

const ChartModule = (() => {

  let chart = null;
  let volumeChart = null;
  let rsiChart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let rsiSeries = null;
  let indicatorSeries = {};
  let currentSymbol = 'BTCUSDT';
  let currentInterval = '15m';
  let currentCandles = [];
  let wsKlineId = null;
  let wsMarkPriceId = null;
  let markerApi = null;
  let tradeSetup = null;
  let setupPriceLines = [];
  let livePriceLine = null;

  let indicators = {
    ema20: true,
    sma50: true,
    sma200: true,
    rsi: false,
    vol: true,
  };

  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    destroy();

    container.innerHTML = `
      <div class="chart-main-pane" id="chart-main-pane"></div>
      <div class="chart-setup-panel" id="chart-setup-panel"></div>
      <div class="chart-sub-pane" id="chart-volume-pane"></div>
      <div class="chart-sub-pane chart-rsi-pane" id="chart-rsi-pane"></div>
    `;

    const mainPane = document.getElementById('chart-main-pane');
    const volumePane = document.getElementById('chart-volume-pane');
    const rsiPane = document.getElementById('chart-rsi-pane');

    chart = createBaseChart(mainPane, {
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(0, 212, 170, 0.3)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#0a0e17',
        },
        horzLine: {
          color: 'rgba(0, 212, 170, 0.3)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#0a0e17',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
    });

    volumeChart = createBaseChart(volumePane, {
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        timeVisible: true,
        secondsVisible: false,
        visible: false,
      },
    });

    rsiChart = createBaseChart(rsiPane, {
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    });

    candleSeries = addSeries(chart, 'candlestick', {
      upColor: '#00e676',
      downColor: '#ff1744',
      borderUpColor: '#00e676',
      borderDownColor: '#ff1744',
      wickUpColor: '#00e676',
      wickDownColor: '#ff1744',
    });

    volumeSeries = addSeries(volumeChart, 'histogram', {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    });

    rsiSeries = addSeries(rsiChart, 'line', {
      color: '#00bcd4',
      lineWidth: 1,
      title: 'RSI 14',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    rsiSeries.createPriceLine({ price: 70, color: 'rgba(255, 23, 68, 0.45)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false });
    rsiSeries.createPriceLine({ price: 30, color: 'rgba(0, 230, 118, 0.45)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false });

    volumePane.style.display = indicators.vol ? 'block' : 'none';
    rsiPane.style.display = indicators.rsi ? 'block' : 'none';

    syncTimeScales([chart, volumeChart, rsiChart]);

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: mainPane.clientWidth, height: mainPane.clientHeight });
      volumeChart.applyOptions({ width: volumePane.clientWidth, height: volumePane.clientHeight });
      rsiChart.applyOptions({ width: rsiPane.clientWidth, height: rsiPane.clientHeight });
    });
    resizeObserver.observe(container);

    return chart;
  }

  function createBaseChart(container, overrides = {}) {
    return LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: 'solid', color: '#0a0e17' },
        textColor: '#94a3b8',
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true },
      ...overrides,
    });
  }

  function addSeries(targetChart, type, options) {
    if (type === 'candlestick') {
      return targetChart.addCandlestickSeries
        ? targetChart.addCandlestickSeries(options)
        : targetChart.addSeries(LightweightCharts.CandlestickSeries, options);
    }
    if (type === 'histogram') {
      return targetChart.addHistogramSeries
        ? targetChart.addHistogramSeries(options)
        : targetChart.addSeries(LightweightCharts.HistogramSeries, options);
    }
    return targetChart.addLineSeries
      ? targetChart.addLineSeries(options)
      : targetChart.addSeries(LightweightCharts.LineSeries, options);
  }

  function syncTimeScales(charts) {
    let syncing = false;
    charts.forEach(source => {
      source.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (syncing || !range) return;
        syncing = true;
        charts.forEach(target => {
          if (target !== source) target.timeScale().setVisibleLogicalRange(range);
        });
        syncing = false;
      });
    });
  }

  async function loadSymbol(symbol, interval) {
    if (!chart) return [];

    if (wsKlineId) BinanceAPI.unsubscribe(wsKlineId);
    if (wsMarkPriceId) BinanceAPI.unsubscribe(wsMarkPriceId);

    currentSymbol = symbol;
    currentInterval = interval || currentInterval;
    updateSymbolLabel(symbol);

    try {
      const candles = await BinanceAPI.getKlines(symbol, currentInterval, 1000);
      currentCandles = candles;

      candleSeries.setData(candles.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })));

      volumeSeries.setData(candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(0, 230, 118, 0.35)' : 'rgba(255, 23, 68, 0.35)',
      })));

      updatePriceDisplay(candles[candles.length - 1].close);
      updateIndicators(candles);
      updateSignalMarkers(candles);
      if (tradeSetup && tradeSetup.symbol === symbol) {
        renderTradeSetup(tradeSetup);
      } else {
        clearTradeSetup();
        const panel = document.getElementById('chart-setup-panel');
        if (panel) panel.classList.remove('visible');
      }

      wsKlineId = BinanceAPI.subscribeKline(symbol, currentInterval, (kline) => {
        const candle = {
          time: kline.time,
          open: kline.open,
          high: kline.high,
          low: kline.low,
          close: kline.close,
          volume: kline.volume,
        };

        candleSeries.update(candle);
        volumeSeries.update({
          time: kline.time,
          value: kline.volume,
          color: kline.close >= kline.open ? 'rgba(0, 230, 118, 0.35)' : 'rgba(255, 23, 68, 0.35)',
        });
        updatePriceDisplay(kline.close);

        const existing = currentCandles.findIndex(c => c.time === kline.time);
        if (existing >= 0) {
          currentCandles[existing] = candle;
        } else {
          currentCandles.push(candle);
        }

        if (kline.isClosed) {
          updateIndicators(currentCandles);
          updateSignalMarkers(currentCandles);
        }
      });

      wsMarkPriceId = BinanceAPI.subscribeMarkPrice(symbol, (data) => {
        updateMarkPriceDisplay(data);
        updateLiveCandleFromPrice(data.markPrice);
      });

      try {
        const markPrice = await BinanceAPI.getMarkPrice(symbol);
        updateMarkPriceDisplay(markPrice);
      } catch (e) {
        console.warn('Mark price fetch failed:', e);
      }

      chart.timeScale().fitContent();
      volumeChart.timeScale().fitContent();
      rsiChart.timeScale().fitContent();

      return candles;
    } catch (e) {
      console.error('[Chart] Load failed:', e);
      return [];
    }
  }

  function updateIndicators(candles) {
    if (!chart || !candles.length) return;

    Object.values(indicatorSeries).forEach(s => {
      try { chart.removeSeries(s); } catch (e) { /* ignore */ }
    });
    indicatorSeries = {};

    if (indicators.ema20) {
      const ema20Data = Indicators.ema(candles, 20);
      if (ema20Data.length) {
        indicatorSeries.ema20 = addSeries(chart, 'line', {
          color: '#ffc107',
          lineWidth: 1,
          title: 'EMA 20',
          priceLineVisible: false,
          lastValueVisible: false,
        });
        indicatorSeries.ema20.setData(ema20Data);
      }
    }

    if (indicators.sma50) {
      const sma50Data = Indicators.sma(candles, 50);
      if (sma50Data.length) {
        indicatorSeries.sma50 = addSeries(chart, 'line', {
          color: '#2196f3',
          lineWidth: 1,
          title: 'SMA 50',
          priceLineVisible: false,
          lastValueVisible: false,
        });
        indicatorSeries.sma50.setData(sma50Data);
      }
    }

    if (indicators.sma200) {
      const sma200Data = Indicators.sma(candles, 200);
      if (sma200Data.length) {
        indicatorSeries.sma200 = addSeries(chart, 'line', {
          color: '#e040fb',
          lineWidth: 2,
          title: 'SMA 200',
          priceLineVisible: false,
          lastValueVisible: false,
        });
        indicatorSeries.sma200.setData(sma200Data);
      }
    }

    if (rsiSeries) {
      rsiSeries.setData(Indicators.rsi(candles, 14));
    }
  }

  function updateSignalMarkers(candles) {
    if (!candleSeries || !candles || candles.length < 220) return;

    const markers = [];
    const step = Math.max(12, Math.floor(candles.length / 80));
    for (let i = 220; i < candles.length; i += step) {
      const slice = candles.slice(Math.max(0, i - 240), i + 1);
      const signal = Strategies.analyze({ candles: slice }, 'all');
      if (signal.signal === 'long' && signal.confidence >= 60) {
        markers.push({
          time: candles[i].time,
          position: 'belowBar',
          color: '#00e676',
          shape: 'arrowUp',
          text: `${signal.confidence}% LONG`,
        });
      } else if (signal.signal === 'short' && signal.confidence >= 60) {
        markers.push({
          time: candles[i].time,
          position: 'aboveBar',
          color: '#ff1744',
          shape: 'arrowDown',
          text: `${signal.confidence}% SHORT`,
        });
      }
    }

    const latest = Strategies.analyze({ candles }, 'all');
    if (latest.signal !== 'neutral' && latest.confidence >= 50) {
      markers.push({
        time: candles[candles.length - 1].time,
        position: latest.signal === 'long' ? 'belowBar' : 'aboveBar',
        color: latest.signal === 'long' ? '#00e676' : '#ff1744',
        shape: latest.signal === 'long' ? 'arrowUp' : 'arrowDown',
        text: `${latest.confidence}% ${latest.signal.toUpperCase()}`,
      });
    }

    const limitedMarkers = markers.slice(-80);
    if (candleSeries.setMarkers) {
      candleSeries.setMarkers(limitedMarkers);
    } else if (LightweightCharts.createSeriesMarkers) {
      if (markerApi && markerApi.setMarkers) {
        markerApi.setMarkers(limitedMarkers);
      } else {
        markerApi = LightweightCharts.createSeriesMarkers(candleSeries, limitedMarkers);
      }
    }
  }

  function toggleIndicator(name) {
    if (!Object.prototype.hasOwnProperty.call(indicators, name)) return false;

    indicators[name] = !indicators[name];
    if (name === 'vol') {
      const pane = document.getElementById('chart-volume-pane');
      if (pane) pane.style.display = indicators.vol ? 'block' : 'none';
    } else if (name === 'rsi') {
      const pane = document.getElementById('chart-rsi-pane');
      if (pane) pane.style.display = indicators.rsi ? 'block' : 'none';
      updateIndicators(currentCandles);
    } else {
      updateIndicators(currentCandles);
    }

    setTimeout(() => {
      if (chart) chart.timeScale().fitContent();
      if (volumeChart) volumeChart.timeScale().fitContent();
      if (rsiChart) rsiChart.timeScale().fitContent();
    }, 0);

    return indicators[name];
  }

  async function changeTimeframe(interval) {
    currentInterval = interval;
    await loadSymbol(currentSymbol, interval);
  }

  function refreshCurrentSymbol() {
    return loadSymbol(currentSymbol, currentInterval);
  }

  async function refreshLatestCandle() {
    if (!candleSeries || !volumeSeries || !currentSymbol) return;

    try {
      const candles = await BinanceAPI.getKlines(currentSymbol, currentInterval, 2);
      candles.forEach(c => {
        const candle = {
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        };
        candleSeries.update(candle);
        volumeSeries.update({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(0, 230, 118, 0.35)' : 'rgba(255, 23, 68, 0.35)',
        });

        const existing = currentCandles.findIndex(item => item.time === c.time);
        if (existing >= 0) currentCandles[existing] = candle;
        else currentCandles.push(candle);
      });

      const latest = candles[candles.length - 1];
      if (latest) updatePriceDisplay(latest.close);
    } catch (e) {
      console.warn('[Chart] Latest candle fallback failed:', e);
    }
  }

  function setTradeSetup(setup) {
    tradeSetup = setup;
    renderTradeSetup(setup);
  }

  function renderTradeSetup(setup) {
    if (!candleSeries || !setup) return;

    clearTradeSetup();
    const panel = document.getElementById('chart-setup-panel');
    const isLong = setup.signal === 'long';
    const rows = [
      { label: 'Entry', value: setup.entry, color: '#00d4aa', style: LightweightCharts.LineStyle.Solid },
      { label: 'Stop', value: setup.stopLoss, color: '#ff1744', style: LightweightCharts.LineStyle.Dashed },
      { label: 'TP1', value: setup.tp1, color: '#00e676', style: LightweightCharts.LineStyle.Dashed },
      { label: 'TP2', value: setup.tp2, color: '#00bfa5', style: LightweightCharts.LineStyle.Dashed },
    ].filter(row => Number.isFinite(row.value));

    setupPriceLines = rows.map(row => candleSeries.createPriceLine({
      price: row.value,
      color: row.color,
      lineWidth: row.label === 'Entry' ? 2 : 1,
      lineStyle: row.style,
      axisLabelVisible: true,
      title: row.label,
    }));

    if (panel) {
      panel.innerHTML = `
        <div class="setup-panel-header">
          <span class="signal-badge ${setup.signal}">${setup.signal.toUpperCase()}</span>
          <span>${setup.strategy || 'Strategy Setup'}</span>
          <span class="text-muted">${setup.confidence || 0}% confidence</span>
        </div>
        <div class="setup-level-grid">
          ${rows.map(row => `
            <div class="setup-level">
              <span class="label">${row.label}</span>
              <span class="value" style="color: ${row.color}">$${Scanner.formatNumber(row.value)}</span>
            </div>
          `).join('')}
          <div class="setup-level">
            <span class="label">Leverage</span>
            <span class="value text-accent">${setup.leverage || '--'}x</span>
          </div>
          <div class="setup-level">
            <span class="label">Bias</span>
            <span class="value ${isLong ? 'text-bullish' : 'text-bearish'}">${isLong ? 'Long continuation' : 'Short continuation'}</span>
          </div>
          ${setup.targetMeta ? `
            <div class="setup-level">
              <span class="label">TP1 Quality</span>
              <span class="value">${setup.targetMeta.tp1Realism} / ${setup.targetMeta.tp1R.toFixed(2)}R</span>
            </div>
            <div class="setup-level">
              <span class="label">TP2 Quality</span>
              <span class="value">${setup.targetMeta.tp2Realism} / ${setup.targetMeta.tp2R.toFixed(2)}R</span>
            </div>
            <div class="setup-level">
              <span class="label">Moves Needed</span>
              <span class="value">${setup.targetMeta.tp1MovePct.toFixed(1)}% / ${setup.targetMeta.tp2MovePct.toFixed(1)}%</span>
            </div>
          ` : ''}
        </div>
        <div class="setup-reason">${setup.reason || ''}</div>
      `;
      panel.classList.add('visible');
    }
  }

  function clearTradeSetup() {
    if (candleSeries && setupPriceLines.length) {
      setupPriceLines.forEach(line => {
        try { candleSeries.removePriceLine(line); } catch (e) { /* ignore */ }
      });
    }
    setupPriceLines = [];
  }

  function updateSymbolLabel(symbol) {
    const nameEl = document.getElementById('chart-symbol-name');
    if (nameEl) {
      nameEl.textContent = symbol.replace('USDT', '/USDT');
      nameEl.dataset.symbol = symbol;
    }
  }

  function updatePriceDisplay(price) {
    const el = document.getElementById('chart-current-price');
    if (el) {
      const prevPrice = parseFloat(el.dataset.price || 0);
      el.textContent = `$${Scanner.formatNumber(price)}`;
      el.dataset.price = price;

      if (price > prevPrice) {
        el.style.color = 'var(--bullish)';
      } else if (price < prevPrice) {
        el.style.color = 'var(--bearish)';
      }
      setTimeout(() => {
        el.style.color = 'var(--text-primary)';
      }, 500);
    }
  }

  function getIntervalSeconds(interval) {
    const value = parseInt(interval, 10);
    if (interval.endsWith('m')) return value * 60;
    if (interval.endsWith('h')) return value * 60 * 60;
    if (interval.endsWith('d')) return value * 24 * 60 * 60;
    if (interval.endsWith('w')) return value * 7 * 24 * 60 * 60;
    return 60;
  }

  function updateLiveCandleFromPrice(price) {
    if (!candleSeries || !Number.isFinite(price) || !currentCandles.length) return;

    const intervalSeconds = getIntervalSeconds(currentInterval);
    const now = Math.floor(Date.now() / 1000);
    const bucketTime = Math.floor(now / intervalSeconds) * intervalSeconds;
    const latest = currentCandles[currentCandles.length - 1];
    let candle = latest;

    if (bucketTime > latest.time) {
      candle = {
        time: bucketTime,
        open: latest.close,
        high: Math.max(latest.close, price),
        low: Math.min(latest.close, price),
        close: price,
        volume: 0,
      };
      currentCandles.push(candle);
      if (currentCandles.length > 1200) currentCandles = currentCandles.slice(-1000);
    } else {
      candle = {
        ...latest,
        close: price,
        high: Math.max(latest.high, price),
        low: Math.min(latest.low, price),
      };
      currentCandles[currentCandles.length - 1] = candle;
    }

    candleSeries.update({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });

    if (livePriceLine) {
      try { candleSeries.removePriceLine(livePriceLine); } catch (e) { /* ignore */ }
    }
    livePriceLine = candleSeries.createPriceLine({
      price,
      color: '#00d4aa',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: 'Live',
    });

    updatePriceDisplay(price);
  }

  function updateMarkPriceDisplay(data) {
    const fundingEl = document.getElementById('chart-funding-rate');
    const rate = data.fundingRate ?? data.lastFundingRate ?? 0;
    if (fundingEl) {
      const pct = (rate * 100).toFixed(4);
      fundingEl.textContent = `${pct}%`;
      fundingEl.style.color = rate > 0 ? 'var(--bullish)' : rate < 0 ? 'var(--bearish)' : 'var(--text-secondary)';
    }

    const markEl = document.getElementById('chart-mark-price');
    if (markEl && data.markPrice) {
      markEl.textContent = `$${Scanner.formatNumber(data.markPrice)}`;
    }

    const nextFundingEl = document.getElementById('chart-next-funding');
    if (nextFundingEl && data.nextFundingTime) {
      const diff = data.nextFundingTime - Date.now();
      if (diff > 0) {
        const hours = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        nextFundingEl.textContent = `${hours}h ${mins}m`;
      }
    }
  }

  function getCurrentAnalysis() {
    if (!currentCandles.length) return null;
    return Strategies.analyze({ candles: currentCandles }, 'all');
  }

  function getState() {
    return {
      symbol: currentSymbol,
      interval: currentInterval,
      indicators,
      candleCount: currentCandles.length,
    };
  }

  function destroy() {
    if (wsKlineId) BinanceAPI.unsubscribe(wsKlineId);
    if (wsMarkPriceId) BinanceAPI.unsubscribe(wsMarkPriceId);
    wsKlineId = null;
    wsMarkPriceId = null;
    markerApi = null;
    clearTradeSetup();
    if (candleSeries && livePriceLine) {
      try { candleSeries.removePriceLine(livePriceLine); } catch (e) { /* ignore */ }
    }
    livePriceLine = null;

    if (chart) chart.remove();
    if (volumeChart) volumeChart.remove();
    if (rsiChart) rsiChart.remove();

    chart = null;
    volumeChart = null;
    rsiChart = null;
    candleSeries = null;
    volumeSeries = null;
    rsiSeries = null;
    indicatorSeries = {};
  }

  return {
    init,
    loadSymbol,
    changeTimeframe,
    refreshCurrentSymbol,
    refreshLatestCandle,
    setTradeSetup,
    toggleIndicator,
    getCurrentAnalysis,
    getState,
    destroy,
    get currentSymbol() { return currentSymbol; },
    get currentInterval() { return currentInterval; },
    get currentCandles() { return currentCandles; },
  };

})();
