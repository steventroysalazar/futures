// ============================================
// FUTURES EDGE — Technical Indicators Engine
// Pure math functions for SMA, EMA, RSI, ATR
// ============================================

const Indicators = (() => {

  /**
   * Simple Moving Average
   * @param {number[]} data - Array of values (typically close prices)
   * @param {number} period - Lookback period
   * @returns {{time: number, value: number}[]}
   */
  function sma(candles, period) {
    const result = [];
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += candles[j].close;
      }
      result.push({
        time: candles[i].time,
        value: sum / period
      });
    }
    return result;
  }

  /**
   * Exponential Moving Average
   * @param {Object[]} candles - OHLCV candles
   * @param {number} period - Lookback period
   * @returns {{time: number, value: number}[]}
   */
  function ema(candles, period) {
    if (candles.length < period) return [];
    const multiplier = 2 / (period + 1);
    const result = [];

    // First EMA value = SMA of first 'period' candles
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += candles[i].close;
    }
    let prevEma = sum / period;
    result.push({ time: candles[period - 1].time, value: prevEma });

    for (let i = period; i < candles.length; i++) {
      const currentEma = (candles[i].close - prevEma) * multiplier + prevEma;
      result.push({ time: candles[i].time, value: currentEma });
      prevEma = currentEma;
    }
    return result;
  }

  /**
   * Relative Strength Index
   * @param {Object[]} candles - OHLCV candles
   * @param {number} period - Lookback period (typically 14)
   * @returns {{time: number, value: number}[]}
   */
  function rsi(candles, period = 14) {
    if (candles.length < period + 1) return [];
    const result = [];

    let gainSum = 0;
    let lossSum = 0;

    // Initial average gain/loss
    for (let i = 1; i <= period; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) gainSum += change;
      else lossSum += Math.abs(change);
    }

    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;

    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    let rsiVal = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    result.push({ time: candles[period].time, value: rsiVal });

    // Smoothed RSI
    for (let i = period + 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiVal = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
      result.push({ time: candles[i].time, value: rsiVal });
    }
    return result;
  }

  /**
   * Average True Range
   * @param {Object[]} candles - OHLCV candles
   * @param {number} period - Lookback period (typically 14)
   * @returns {{time: number, value: number}[]}
   */
  function atr(candles, period = 14) {
    if (candles.length < period + 1) return [];
    const result = [];
    const trValues = [];

    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trValues.push({ time: candles[i].time, value: tr });
    }

    // First ATR = average of first 'period' true ranges
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += trValues[i].value;
    }
    let prevAtr = sum / period;
    result.push({ time: trValues[period - 1].time, value: prevAtr });

    // Smoothed ATR
    for (let i = period; i < trValues.length; i++) {
      const currentAtr = (prevAtr * (period - 1) + trValues[i].value) / period;
      result.push({ time: trValues[i].time, value: currentAtr });
      prevAtr = currentAtr;
    }
    return result;
  }

  /**
   * Detect swing highs and lows for market structure
   * @param {Object[]} candles - OHLCV candles
   * @param {number} lookback - Number of candles to look back/forward
   * @returns {{highs: Object[], lows: Object[]}}
   */
  function swingPoints(candles, lookback = 5) {
    const highs = [];
    const lows = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      let isHigh = true;
      let isLow = true;

      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].high >= candles[i].high) isHigh = false;
        if (candles[j].low <= candles[i].low) isLow = false;
      }

      if (isHigh) highs.push({ time: candles[i].time, price: candles[i].high, index: i });
      if (isLow) lows.push({ time: candles[i].time, price: candles[i].low, index: i });
    }

    return { highs, lows };
  }

  /**
   * Detect market structure (HH/HL = bullish, LH/LL = bearish)
   * @param {Object[]} candles
   * @returns {'bullish'|'bearish'|'neutral'}
   */
  function marketStructure(candles) {
    const { highs, lows } = swingPoints(candles, 5);
    if (highs.length < 2 || lows.length < 2) return 'neutral';

    const lastHighs = highs.slice(-3);
    const lastLows = lows.slice(-3);

    let hhCount = 0, hlCount = 0, lhCount = 0, llCount = 0;

    for (let i = 1; i < lastHighs.length; i++) {
      if (lastHighs[i].price > lastHighs[i - 1].price) hhCount++;
      else lhCount++;
    }
    for (let i = 1; i < lastLows.length; i++) {
      if (lastLows[i].price > lastLows[i - 1].price) hlCount++;
      else llCount++;
    }

    if (hhCount >= 1 && hlCount >= 1) return 'bullish';
    if (lhCount >= 1 && llCount >= 1) return 'bearish';
    return 'neutral';
  }

  /**
   * Volume analysis — detect unusual volume
   * @param {Object[]} candles
   * @param {number} period - Lookback for average volume
   * @returns {{isHigh: boolean, ratio: number, avgVolume: number}}
   */
  function volumeAnalysis(candles, period = 20) {
    if (candles.length < period + 1) return { isHigh: false, ratio: 1, avgVolume: 0 };

    let sum = 0;
    for (let i = candles.length - period - 1; i < candles.length - 1; i++) {
      sum += candles[i].volume;
    }
    const avgVolume = sum / period;
    const currentVolume = candles[candles.length - 1].volume;
    const ratio = currentVolume / avgVolume;

    return {
      isHigh: ratio > 1.5,
      ratio: Math.round(ratio * 100) / 100,
      avgVolume
    };
  }

  /**
   * Find support and resistance levels
   * @param {Object[]} candles
   * @returns {{support: number[], resistance: number[]}}
   */
  function supportResistance(candles, lookback = 10) {
    const { highs, lows } = swingPoints(candles, lookback);
    return {
      support: lows.map(l => l.price),
      resistance: highs.map(h => h.price)
    };
  }

  /**
   * Detect pullback to a moving average
   * @param {Object[]} candles
   * @param {number[]} maValues - The MA values aligned with candles
   * @param {number} threshold - % distance to consider "near" the MA
   * @returns {boolean}
   */
  function isPullbackToMA(candles, maValues, threshold = 0.01) {
    if (maValues.length < 2) return false;
    const lastCandle = candles[candles.length - 1];
    const lastMA = maValues[maValues.length - 1].value;
    const distance = Math.abs(lastCandle.close - lastMA) / lastMA;
    return distance <= threshold;
  }

  /**
   * Detect bullish candle confirmation
   * @param {Object} candle
   * @returns {boolean}
   */
  function isBullishCandle(candle) {
    const bodySize = candle.close - candle.open;
    const totalRange = candle.high - candle.low;
    if (totalRange === 0) return false;
    return bodySize > 0 && (bodySize / totalRange) > 0.4;
  }

  /**
   * Detect bearish candle confirmation
   * @param {Object} candle
   * @returns {boolean}
   */
  function isBearishCandle(candle) {
    const bodySize = candle.open - candle.close;
    const totalRange = candle.high - candle.low;
    if (totalRange === 0) return false;
    return bodySize > 0 && (bodySize / totalRange) > 0.4;
  }

  /**
   * Calculate the latest value from indicator array
   */
  function lastValue(arr) {
    return arr.length > 0 ? arr[arr.length - 1].value : null;
  }

  return {
    sma,
    ema,
    rsi,
    atr,
    swingPoints,
    marketStructure,
    volumeAnalysis,
    supportResistance,
    isPullbackToMA,
    isBullishCandle,
    isBearishCandle,
    lastValue
  };

})();
