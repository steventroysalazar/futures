// ============================================
// FUTURES EDGE — Binance API Data Layer
// REST + WebSocket for real-time futures data
// ============================================

const BinanceAPI = (() => {

  const REST_BASE = 'https://fapi.binance.com';
  const WS_BASE = 'wss://fstream.binance.com/ws';
  const USE_LOCAL_BACKEND = ['localhost', '127.0.0.1'].includes(location.hostname);

  // Active WebSocket connections
  const connections = {};
  let onConnectionChange = null;

  // ── REST API ──

  async function fetchJSON(endpoint, params = {}) {
    const buildUrl = (local) => {
      const url = local ? new URL('/api/binance', location.origin) : new URL(REST_BASE + endpoint);
      if (local) url.searchParams.set('endpoint', endpoint);
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
      });
      return url;
    };

    const request = async (url) => {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Binance API ${res.status}: ${res.statusText}`);
      return res.json();
    };

    if (!USE_LOCAL_BACKEND) return request(buildUrl(false));

    try {
      return await request(buildUrl(true));
    } catch (error) {
      console.warn('[API] Local REST proxy failed, falling back direct:', error.message || error);
      return request(buildUrl(false));
    }
  }

  /**
   * Get historical klines (candlestick data)
   * @param {string} symbol - e.g. 'BTCUSDT'
   * @param {string} interval - e.g. '1h', '4h', '1d'
   * @param {number} limit - Max 1500
   * @returns {Object[]} Array of {time, open, high, low, close, volume}
   */
  async function getKlines(symbol, interval = '4h', limit = 500) {
    const data = await fetchJSON('/fapi/v1/klines', { symbol, interval, limit });
    return data.map(k => ({
      time: Math.floor(k[0] / 1000), // Convert ms to seconds
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  /**
   * Get 24hr ticker for all symbols
   * @returns {Object[]}
   */
  async function get24hrTickers() {
    const data = await fetchJSON('/fapi/v1/ticker/24hr');
    return data
      .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 0)
      .map(t => ({
        symbol: t.symbol,
        lastPrice: parseFloat(t.lastPrice),
        priceChange: parseFloat(t.priceChange),
        priceChangePercent: parseFloat(t.priceChangePercent),
        highPrice: parseFloat(t.highPrice),
        lowPrice: parseFloat(t.lowPrice),
        volume: parseFloat(t.volume),
        quoteVolume: parseFloat(t.quoteVolume),
        weightedAvgPrice: parseFloat(t.weightedAvgPrice),
      }));
  }

  async function get24hrTicker(symbol) {
    const t = await fetchJSON('/fapi/v1/ticker/24hr', { symbol });
    return {
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      priceChange: parseFloat(t.priceChange),
      priceChangePercent: parseFloat(t.priceChangePercent),
      highPrice: parseFloat(t.highPrice),
      lowPrice: parseFloat(t.lowPrice),
      volume: parseFloat(t.volume),
      quoteVolume: parseFloat(t.quoteVolume),
      weightedAvgPrice: parseFloat(t.weightedAvgPrice),
    };
  }

  /**
   * Get funding rate for a symbol
   * @param {string} symbol
   * @param {number} limit
   * @returns {Object[]}
   */
  async function getFundingRate(symbol, limit = 100) {
    const data = await fetchJSON('/fapi/v1/fundingRate', { symbol, limit });
    return data.map(f => ({
      symbol: f.symbol,
      fundingRate: parseFloat(f.fundingRate),
      fundingTime: f.fundingTime,
      markPrice: parseFloat(f.markPrice || 0),
    }));
  }

  /**
   * Get current open interest
   * @param {string} symbol
   * @returns {{symbol: string, openInterest: number}}
   */
  async function getOpenInterest(symbol) {
    const data = await fetchJSON('/fapi/v1/openInterest', { symbol });
    return {
      symbol: data.symbol,
      openInterest: parseFloat(data.openInterest),
    };
  }

  /**
   * Get exchange info (all symbols and their details)
   * @returns {Object[]}
   */
  async function getExchangeInfo() {
    const data = await fetchJSON('/fapi/v1/exchangeInfo');
    return data.symbols
      .filter(s => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
      .map(s => ({
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        pricePrecision: s.pricePrecision,
        quantityPrecision: s.quantityPrecision,
      }));
  }

  /**
   * Get mark price and funding for a symbol
   * @param {string} symbol
   * @returns {Object}
   */
  async function getMarkPrice(symbol) {
    const data = await fetchJSON('/fapi/v1/premiumIndex', { symbol });
    return {
      symbol: data.symbol,
      markPrice: parseFloat(data.markPrice),
      indexPrice: parseFloat(data.indexPrice),
      lastFundingRate: parseFloat(data.lastFundingRate),
      nextFundingTime: data.nextFundingTime,
      interestRate: parseFloat(data.interestRate),
    };
  }

  /**
   * Get mark price for ALL symbols
   * @returns {Object[]}
   */
  async function getAllMarkPrices() {
    const data = await fetchJSON('/fapi/v1/premiumIndex');
    return data
      .filter(d => d.symbol.endsWith('USDT'))
      .map(d => ({
        symbol: d.symbol,
        markPrice: parseFloat(d.markPrice),
        lastFundingRate: parseFloat(d.lastFundingRate),
        nextFundingTime: d.nextFundingTime,
      }));
  }

  // ── WebSocket Streams ──

  /**
   * Subscribe to kline (candlestick) stream
   * @param {string} symbol - e.g. 'btcusdt' (lowercase)
   * @param {string} interval - e.g. '1h'
   * @param {Function} onMessage - Callback for each kline update
   * @returns {string} Connection ID for cleanup
   */
  function subscribeKline(symbol, interval, onMessage) {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    return _connect(`kline_${symbol}_${interval}`, stream, (msg) => {
      if (msg.e === 'kline') {
        const k = msg.k;
        onMessage({
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          isClosed: k.x,
        });
      }
    });
  }

  /**
   * Subscribe to mark price stream
   * @param {string} symbol
   * @param {Function} onMessage
   * @returns {string} Connection ID
   */
  function subscribeMarkPrice(symbol, onMessage) {
    const stream = `${symbol.toLowerCase()}@markPrice@1s`;
    return _connect(`markPrice_${symbol}`, stream, (msg) => {
      if (msg.e === 'markPriceUpdate') {
        onMessage({
          symbol: msg.s,
          markPrice: parseFloat(msg.p),
          indexPrice: parseFloat(msg.i),
          fundingRate: parseFloat(msg.r),
          nextFundingTime: msg.T,
        });
      }
    });
  }

  /**
   * Subscribe to all tickers stream
   * @param {Function} onMessage
   * @returns {string} Connection ID
   */
  function subscribeAllTickers(onMessage) {
    const stream = '!ticker@arr';
    return _connect('allTickers', stream, (data) => {
      if (Array.isArray(data)) {
        const tickers = data
          .filter(t => t.s.endsWith('USDT'))
          .map(t => ({
            symbol: t.s,
            lastPrice: parseFloat(t.c),
            priceChangePercent: parseFloat(t.P),
            volume: parseFloat(t.v),
            quoteVolume: parseFloat(t.q),
          }));
        onMessage(tickers);
      }
    });
  }

  /**
   * Internal WebSocket connection manager with auto-reconnect
   */
  function _connect(id, stream, handler) {
    if (USE_LOCAL_BACKEND) return _connectLocal(id, stream, handler);
    return _connectDirect(id, stream, handler);
  }

  function _connectDirect(id, stream, handler) {
    // Close existing connection if any
    const generation = (connections[id]?.generation || 0) + 1;
    if (connections[id]) {
      connections[id].intentionalClose = true;
      if (connections[id].ws) connections[id].ws.close();
      if (connections[id].source) connections[id].source.close();
      clearTimeout(connections[id].reconnectTimer);
    }

    const url = `${WS_BASE}/${stream}`;
    let ws;
    let reconnectAttempts = 0;

    function connect() {
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log(`[WS] Connected: ${id}`);
        reconnectAttempts = 0;
        notifyConnectionChange();
      };

      ws.onmessage = (event) => {
        try {
          if (!connections[id] || connections[id].generation !== generation) return;
          const data = JSON.parse(event.data);
          handler(data);
        } catch (e) {
          console.error(`[WS] Parse error on ${id}:`, e);
        }
      };

      ws.onerror = (error) => {
        console.error(`[WS] Error on ${id}:`, error);
      };

      ws.onclose = () => {
        console.log(`[WS] Disconnected: ${id}`);
        setTimeout(notifyConnectionChange, 0);
        // Auto-reconnect after 3 seconds
        if (connections[id] && connections[id].generation === generation && !connections[id].intentionalClose) {
          reconnectAttempts += 1;
          const delay = Math.min(3000 * reconnectAttempts, 15000);
          connections[id].reconnectTimer = setTimeout(() => {
            console.log(`[WS] Reconnecting: ${id}`);
            connect();
          }, delay);
        }
      };

      connections[id] = { ws, reconnectTimer: null, intentionalClose: false, generation };
    }

    connect();
    return id;
  }

  function _connectLocal(id, stream, handler) {
    const generation = (connections[id]?.generation || 0) + 1;
    if (connections[id]) {
      connections[id].intentionalClose = true;
      if (connections[id].source) connections[id].source.close();
      if (connections[id].ws) connections[id].ws.close();
      clearTimeout(connections[id].reconnectTimer);
    }

    let upstreamConnected = false;
    const source = new EventSource(`/api/stream?stream=${encodeURIComponent(stream)}`);
    const fallbackTimer = setTimeout(() => {
      if (!connections[id] || connections[id].generation !== generation || upstreamConnected) return;
      console.warn(`[SSE] Upstream not ready, falling back to direct WebSocket: ${id}`);
      connections[id].intentionalClose = true;
      source.close();
      _connectDirect(id, stream, handler);
    }, 7000);

    source.onopen = () => {
      console.log(`[SSE] Connected: ${id}`);
      notifyConnectionChange();
    };
    source.onmessage = (event) => {
      if (!connections[id] || connections[id].generation !== generation) return;
      try {
        handler(JSON.parse(event.data));
      } catch (e) {
        console.error(`[SSE] Parse error on ${id}:`, e);
      }
    };
    source.addEventListener('status', (event) => {
      try {
        const status = JSON.parse(event.data);
        upstreamConnected = !!status.connected;
        if (upstreamConnected) clearTimeout(fallbackTimer);
        console.log(`[SSE] ${status.connected ? 'Upstream connected' : 'Upstream reconnecting'}: ${id}`);
      } catch (e) {
        /* ignore status parse errors */
      }
      notifyConnectionChange();
    });
    source.onerror = () => {
      console.warn(`[SSE] Reconnecting: ${id}`);
      notifyConnectionChange();
    };

    connections[id] = {
      source,
      reconnectTimer: fallbackTimer,
      intentionalClose: false,
      generation,
    };
    notifyConnectionChange();
    return id;
  }

  function notifyConnectionChange() {
    if (onConnectionChange) onConnectionChange(isConnected());
  }

  /**
   * Unsubscribe from a stream
   * @param {string} id - Connection ID
   */
  function unsubscribe(id) {
    if (connections[id]) {
      connections[id].intentionalClose = true;
      if (connections[id].ws) connections[id].ws.close();
      if (connections[id].source) connections[id].source.close();
      clearTimeout(connections[id].reconnectTimer);
      delete connections[id];
      setTimeout(notifyConnectionChange, 0);
    }
  }

  /**
   * Unsubscribe from all streams
   */
  function unsubscribeAll() {
    Object.keys(connections).forEach(id => unsubscribe(id));
  }

  /**
   * Set connection status callback
   * @param {Function} callback
   */
  function setConnectionCallback(callback) {
    onConnectionChange = callback;
  }

  /**
   * Check if any WebSocket is connected
   * @returns {boolean}
   */
  function isConnected() {
    return Object.values(connections).some(c =>
      (c.ws && c.ws.readyState === WebSocket.OPEN) ||
      (c.source && c.source.readyState === EventSource.OPEN)
    );
  }

  return {
    // REST
    getKlines,
    get24hrTickers,
    get24hrTicker,
    getFundingRate,
    getOpenInterest,
    getExchangeInfo,
    getMarkPrice,
    getAllMarkPrices,
    // WebSocket
    subscribeKline,
    subscribeMarkPrice,
    subscribeAllTickers,
    unsubscribe,
    unsubscribeAll,
    setConnectionCallback,
    isConnected,
  };

})();
