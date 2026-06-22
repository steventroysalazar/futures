// ============================================
// FUTURES EDGE — Strategy Signal Engine
// 5 professional trading strategies
// ============================================

const Strategies = (() => {

  const STRATEGY_LIST = [
    { id: 'trend', name: 'Trend Following', icon: '📈', desc: '200 MA filter + 20 EMA pullback', timeframes: ['4h', '1d'] },
    { id: 'structure', name: 'Market Structure', icon: '🏗️', desc: 'HH/HL longs, LH/LL shorts', timeframes: ['1h', '4h'] },
    { id: 'crossover', name: 'MA Crossover', icon: '✖️', desc: '50/200 MA golden & death cross', timeframes: ['4h', '1d'] },
    { id: 'funding', name: 'Funding Rate Edge', icon: '💰', desc: 'Contrarian funding + trend', timeframes: ['4h', '1d'] },
    { id: 'swing', name: 'Weekly Swing', icon: '🎯', desc: 'Daily trend + 4H pullback', timeframes: ['4h', '1d'] },
  ];

  /**
   * Run all strategies on a given symbol's data
   * @param {Object} data - { candles, fundingRate, openInterest }
   * @param {string} strategyId - Which strategy to run (or 'all')
   * @returns {Object} Signal result
   */
  function analyze(data, strategyId = 'all') {
    const { candles } = data;
    if (!candles || candles.length < 201) {
      return { signal: 'neutral', confidence: 0, reason: 'Insufficient data' };
    }

    if (strategyId === 'all') {
      // Run all strategies and combine
      const results = STRATEGY_LIST.map(s => ({
        ...runStrategy(s.id, data),
        strategy: s.id,
        strategyName: s.name,
      }));

      // Find the highest confidence signal
      const best = results.reduce((a, b) => b.confidence > a.confidence ? b : a, results[0]);
      return {
        ...best,
        allSignals: results,
      };
    }

    return {
      ...runStrategy(strategyId, data),
      strategy: strategyId,
      strategyName: STRATEGY_LIST.find(s => s.id === strategyId)?.name || strategyId,
    };
  }

  function runStrategy(id, data) {
    switch (id) {
      case 'trend': return trendFollowing(data);
      case 'structure': return marketStructureStrategy(data);
      case 'crossover': return maCrossover(data);
      case 'funding': return fundingRateEdge(data);
      case 'swing': return weeklySwing(data);
      default: return { signal: 'neutral', confidence: 0, reason: 'Unknown strategy' };
    }
  }

  // ── Strategy 1: Trend Following ──
  function trendFollowing(data) {
    const { candles } = data;
    const ma200 = Indicators.sma(candles, 200);
    const ema20 = Indicators.ema(candles, 20);
    const atr = Indicators.atr(candles, 14);

    const lastPrice = candles[candles.length - 1].close;
    const lastMA200 = Indicators.lastValue(ma200);
    const lastEMA20 = Indicators.lastValue(ema20);
    const lastATR = Indicators.lastValue(atr);

    if (!lastMA200 || !lastEMA20 || !lastATR) {
      return { signal: 'neutral', confidence: 0, reason: 'Insufficient indicator data' };
    }

    const aboveMA200 = lastPrice > lastMA200;
    const nearEMA20 = Math.abs(lastPrice - lastEMA20) / lastEMA20 < 0.02; // within 2%
    const pullbackDown = candles[candles.length - 1].low < candles[candles.length - 2].low;
    const bullishClose = Indicators.isBullishCandle(candles[candles.length - 1]);
    const bearishClose = Indicators.isBearishCandle(candles[candles.length - 1]);

    // Calculate distances
    const distFromMA200 = ((lastPrice - lastMA200) / lastMA200) * 100;
    const distFromEMA20 = ((lastPrice - lastEMA20) / lastEMA20) * 100;

    let signal = 'neutral';
    let confidence = 0;
    let reason = '';

    if (aboveMA200) {
      // Look for longs
      confidence += 30; // Base: above 200 MA
      reason = 'Price above 200 MA. ';

      if (nearEMA20) {
        confidence += 25;
        reason += 'Near 20 EMA pullback zone. ';
      }

      if (bullishClose) {
        confidence += 20;
        reason += 'Bullish candle confirmation. ';
      }

      if (distFromMA200 > 3 && distFromMA200 < 30) {
        confidence += 10;
        reason += 'Good distance from 200 MA. ';
      }

      // Volume confirmation
      const vol = Indicators.volumeAnalysis(candles);
      if (vol.isHigh) {
        confidence += 15;
        reason += `Volume ${vol.ratio}x average. `;
      }

      if (confidence >= 50) signal = 'long';
    } else {
      // Look for shorts
      confidence += 30;
      reason = 'Price below 200 MA. ';

      if (nearEMA20) {
        confidence += 25;
        reason += 'Near 20 EMA pullback zone. ';
      }

      if (bearishClose) {
        confidence += 20;
        reason += 'Bearish candle confirmation. ';
      }

      if (distFromMA200 < -3 && distFromMA200 > -30) {
        confidence += 10;
      }

      const vol = Indicators.volumeAnalysis(candles);
      if (vol.isHigh) {
        confidence += 15;
        reason += `Volume ${vol.ratio}x average. `;
      }

      if (confidence >= 50) signal = 'short';
    }

    confidence = Math.min(confidence, 100);

    return finalizeSignal(candles, {
      signal,
      confidence,
      reason: reason.trim(),
      entry: lastPrice,
      stopLoss: signal === 'long'
        ? lastPrice - (lastATR * 1.5)
        : signal === 'short' ? lastPrice + (lastATR * 1.5) : null,
      tp1: signal === 'long'
        ? lastPrice + (lastATR * 2)
        : signal === 'short' ? lastPrice - (lastATR * 2) : null,
      tp2: signal === 'long'
        ? lastPrice + (lastATR * 3.5)
        : signal === 'short' ? lastPrice - (lastATR * 3.5) : null,
      tp3: signal === 'long'
        ? lastPrice + (lastATR * 5)
        : signal === 'short' ? lastPrice - (lastATR * 5) : null,
      leverage: 3,
    });
  }

  // ── Strategy 2: Market Structure ──
  function marketStructureStrategy(data) {
    const { candles } = data;
    const structure = Indicators.marketStructure(candles);
    const atr = Indicators.atr(candles, 14);
    const lastATR = Indicators.lastValue(atr);
    const lastPrice = candles[candles.length - 1].close;
    const rsi = Indicators.rsi(candles, 14);
    const lastRSI = Indicators.lastValue(rsi);

    let signal = 'neutral';
    let confidence = 0;
    let reason = '';

    if (structure === 'bullish') {
      confidence += 35;
      reason = 'Bullish structure (HH + HL). ';

      // Check for pullback to support
      const { support } = Indicators.supportResistance(candles, 8);
      const nearSupport = support.some(s => Math.abs(lastPrice - s) / s < 0.02);

      if (nearSupport) {
        confidence += 25;
        reason += 'Price at support level. ';
      }

      if (Indicators.isBullishCandle(candles[candles.length - 1])) {
        confidence += 15;
        reason += 'Bullish candle confirmation. ';
      }

      if (lastRSI && lastRSI > 30 && lastRSI < 65) {
        confidence += 10;
        reason += `RSI ${lastRSI.toFixed(0)} — room to run. `;
      }

      const vol = Indicators.volumeAnalysis(candles);
      if (vol.isHigh) {
        confidence += 15;
        reason += `Volume surge ${vol.ratio}x. `;
      }

      if (confidence >= 45) signal = 'long';
    } else if (structure === 'bearish') {
      confidence += 35;
      reason = 'Bearish structure (LH + LL). ';

      const { resistance } = Indicators.supportResistance(candles, 8);
      const nearResistance = resistance.some(r => Math.abs(lastPrice - r) / r < 0.02);

      if (nearResistance) {
        confidence += 25;
        reason += 'Price at resistance level. ';
      }

      if (Indicators.isBearishCandle(candles[candles.length - 1])) {
        confidence += 15;
        reason += 'Bearish candle confirmation. ';
      }

      if (lastRSI && lastRSI > 40 && lastRSI < 75) {
        confidence += 10;
        reason += `RSI ${lastRSI.toFixed(0)} — room to fall. `;
      }

      const vol = Indicators.volumeAnalysis(candles);
      if (vol.isHigh) {
        confidence += 15;
      }

      if (confidence >= 45) signal = 'short';
    } else {
      reason = 'No clear market structure. Ranging.';
    }

    confidence = Math.min(confidence, 100);

    return finalizeSignal(candles, {
      signal,
      confidence,
      reason: reason.trim(),
      entry: lastPrice,
      stopLoss: signal === 'long'
        ? lastPrice - (lastATR * 2)
        : signal === 'short' ? lastPrice + (lastATR * 2) : null,
      tp1: signal === 'long' ? lastPrice + (lastATR * 2) : signal === 'short' ? lastPrice - (lastATR * 2) : null,
      tp2: signal === 'long' ? lastPrice + (lastATR * 4) : signal === 'short' ? lastPrice - (lastATR * 4) : null,
      tp3: signal === 'long' ? lastPrice + (lastATR * 6) : signal === 'short' ? lastPrice - (lastATR * 6) : null,
      leverage: 3,
    });
  }

  // ── Strategy 3: MA Crossover ──
  function maCrossover(data) {
    const { candles } = data;
    const ma50 = Indicators.sma(candles, 50);
    const ma200 = Indicators.sma(candles, 200);
    const atr = Indicators.atr(candles, 14);
    const lastATR = Indicators.lastValue(atr);
    const lastPrice = candles[candles.length - 1].close;

    if (ma50.length < 5 || ma200.length < 5) {
      return { signal: 'neutral', confidence: 0, reason: 'Not enough MA data' };
    }

    const lastMA50 = Indicators.lastValue(ma50);
    const lastMA200 = Indicators.lastValue(ma200);
    const prevMA50 = ma50[ma50.length - 5].value;
    const prevMA200 = ma200[ma200.length - 5].value;

    const goldenCross = lastMA50 > lastMA200;
    const deathCross = lastMA50 < lastMA200;
    const recentCross50Above = prevMA50 <= prevMA200 && lastMA50 > lastMA200;
    const recentCross50Below = prevMA50 >= prevMA200 && lastMA50 < lastMA200;

    let signal = 'neutral';
    let confidence = 0;
    let reason = '';

    if (goldenCross) {
      confidence += 30;
      reason = '50 MA above 200 MA (Golden Cross). ';

      // Price retesting the 50 MA
      const distTo50 = Math.abs(lastPrice - lastMA50) / lastMA50;
      if (distTo50 < 0.015) {
        confidence += 30;
        reason += 'Price retesting 50 MA — ideal entry. ';
      } else if (distTo50 < 0.03) {
        confidence += 15;
        reason += 'Price near 50 MA. ';
      }

      if (recentCross50Above) {
        confidence += 20;
        reason += 'Recent golden cross — fresh momentum. ';
      }

      if (Indicators.isBullishCandle(candles[candles.length - 1])) {
        confidence += 10;
        reason += 'Bullish candle. ';
      }

      if (confidence >= 50) signal = 'long';
    } else if (deathCross) {
      confidence += 30;
      reason = '50 MA below 200 MA (Death Cross). ';

      const distTo50 = Math.abs(lastPrice - lastMA50) / lastMA50;
      if (distTo50 < 0.015) {
        confidence += 30;
        reason += 'Price retesting 50 MA — ideal short entry. ';
      } else if (distTo50 < 0.03) {
        confidence += 15;
        reason += 'Price near 50 MA. ';
      }

      if (recentCross50Below) {
        confidence += 20;
        reason += 'Recent death cross — fresh selling pressure. ';
      }

      if (Indicators.isBearishCandle(candles[candles.length - 1])) {
        confidence += 10;
        reason += 'Bearish candle. ';
      }

      if (confidence >= 50) signal = 'short';
    }

    confidence = Math.min(confidence, 100);

    return finalizeSignal(candles, {
      signal,
      confidence,
      reason: reason.trim(),
      entry: lastPrice,
      stopLoss: signal === 'long'
        ? lastMA200 - (lastATR * 0.5)
        : signal === 'short' ? lastMA200 + (lastATR * 0.5) : null,
      tp1: signal === 'long' ? lastPrice + (lastATR * 2) : signal === 'short' ? lastPrice - (lastATR * 2) : null,
      tp2: signal === 'long' ? lastPrice + (lastATR * 3.5) : signal === 'short' ? lastPrice - (lastATR * 3.5) : null,
      tp3: signal === 'long' ? lastPrice + (lastATR * 5.5) : signal === 'short' ? lastPrice - (lastATR * 5.5) : null,
      leverage: 2,
    });
  }

  // ── Strategy 4: Funding Rate Edge ──
  function fundingRateEdge(data) {
    const { candles, fundingRate, openInterest } = data;
    const ma200 = Indicators.sma(candles, 200);
    const ema20 = Indicators.ema(candles, 20);
    const atr = Indicators.atr(candles, 14);
    const lastATR = Indicators.lastValue(atr);
    const lastPrice = candles[candles.length - 1].close;
    const lastMA200 = Indicators.lastValue(ma200);

    let signal = 'neutral';
    let confidence = 0;
    let reason = '';

    const trendUp = lastPrice > lastMA200;
    const trendDown = lastPrice < lastMA200;

    // Funding analysis
    let fundingState = 'unknown';
    let lastFunding = getLatestFundingValue(fundingRate);
    if (lastFunding !== null) {
      if (lastFunding < -0.0001) fundingState = 'negative';
      else if (lastFunding > 0.0005) fundingState = 'highly_positive';
      else if (lastFunding > 0.0001) fundingState = 'positive';
      else fundingState = 'neutral';
    }

    if (trendUp) {
      confidence += 25;
      reason = 'Uptrend (above 200 MA). ';

      if (fundingState === 'negative') {
        confidence += 35;
        reason += '⚡ Negative funding in uptrend — squeeze potential! ';
      } else if (fundingState === 'neutral') {
        confidence += 20;
        reason += 'Neutral funding — healthy uptrend. ';
      } else if (fundingState === 'highly_positive') {
        confidence -= 15;
        reason += '⚠️ Very high funding — crowded long, be cautious. ';
      } else if (fundingState === 'positive') {
        confidence += 5;
        reason += 'Moderate positive funding. ';
      }

      if (Indicators.isBullishCandle(candles[candles.length - 1])) {
        confidence += 10;
      }

      const vol = Indicators.volumeAnalysis(candles);
      if (vol.isHigh) {
        confidence += 10;
        reason += `Volume ${vol.ratio}x avg. `;
      }

      if (openInterest && openInterest.openInterest) {
        confidence += 5;
        reason += 'Open interest confirmed. ';
      }

      if (confidence >= 50) signal = 'long';
    } else if (trendDown) {
      confidence += 25;
      reason = 'Downtrend (below 200 MA). ';

      if (fundingState === 'highly_positive') {
        confidence += 35;
        reason += '⚡ High positive funding in downtrend — long liquidation cascade potential! ';
      } else if (fundingState === 'neutral') {
        confidence += 15;
        reason += 'Neutral funding. ';
      } else if (fundingState === 'negative') {
        confidence -= 10;
        reason += '⚠️ Negative funding already — shorts may be crowded. ';
      }

      if (Indicators.isBearishCandle(candles[candles.length - 1])) {
        confidence += 10;
      }

      if (openInterest && openInterest.openInterest) {
        confidence += 5;
        reason += 'Open interest confirmed. ';
      }

      if (confidence >= 50) signal = 'short';
    }

    confidence = Math.max(0, Math.min(confidence, 100));

    return finalizeSignal(candles, {
      signal,
      confidence,
      reason: reason.trim(),
      entry: lastPrice,
      stopLoss: signal === 'long' ? lastPrice - (lastATR * 2) : signal === 'short' ? lastPrice + (lastATR * 2) : null,
      tp1: signal === 'long' ? lastPrice + (lastATR * 2) : signal === 'short' ? lastPrice - (lastATR * 2) : null,
      tp2: signal === 'long' ? lastPrice + (lastATR * 4) : signal === 'short' ? lastPrice - (lastATR * 4) : null,
      tp3: signal === 'long' ? lastPrice + (lastATR * 6) : signal === 'short' ? lastPrice - (lastATR * 6) : null,
      leverage: 3,
      fundingRate: lastFunding,
    });
  }

  function getLatestFundingValue(fundingRate) {
    if (fundingRate === undefined || fundingRate === null) return null;
    if (typeof fundingRate === 'number') return fundingRate;
    if (Array.isArray(fundingRate)) {
      if (!fundingRate.length) return null;
      const last = fundingRate[fundingRate.length - 1];
      return typeof last === 'number' ? last : last.fundingRate ?? null;
    }
    if (typeof fundingRate === 'object') return fundingRate.fundingRate ?? fundingRate.lastFundingRate ?? null;
    return null;
  }

  // ── Strategy 5: Weekly Swing ──
  function weeklySwing(data) {
    const { candles } = data;
    // This strategy uses daily for trend and 4H for entry
    // We'll analyze the single timeframe we have and assess
    const ma200 = Indicators.sma(candles, 200);
    const ema50 = Indicators.ema(candles, 50);
    const ema20 = Indicators.ema(candles, 20);
    const rsi = Indicators.rsi(candles, 14);
    const atr = Indicators.atr(candles, 14);

    const lastPrice = candles[candles.length - 1].close;
    const lastMA200 = Indicators.lastValue(ma200);
    const lastEMA50 = Indicators.lastValue(ema50);
    const lastEMA20 = Indicators.lastValue(ema20);
    const lastRSI = Indicators.lastValue(rsi);
    const lastATR = Indicators.lastValue(atr);

    let signal = 'neutral';
    let confidence = 0;
    let reason = '';

    // Daily trend bullish: price > 200 MA and 50 EMA > 200 MA
    const dailyTrendUp = lastPrice > lastMA200 && lastEMA50 > lastMA200;
    const dailyTrendDown = lastPrice < lastMA200 && lastEMA50 < lastMA200;

    if (dailyTrendUp) {
      confidence += 30;
      reason = 'Daily trend bullish (50 EMA > 200 MA). ';

      // 4H pullback: price near 20 EMA
      const pullbackToEMA = Math.abs(lastPrice - lastEMA20) / lastEMA20 < 0.02;
      const priceAboveEMA50 = lastPrice > lastEMA50;

      if (pullbackToEMA) {
        confidence += 25;
        reason += '4H pullback to 20 EMA. ';
      }

      if (priceAboveEMA50) {
        confidence += 10;
        reason += 'Holding above 50 EMA. ';
      }

      // RSI not overbought
      if (lastRSI && lastRSI < 65 && lastRSI > 35) {
        confidence += 15;
        reason += `RSI ${lastRSI.toFixed(0)} — not overbought. `;
      }

      if (Indicators.isBullishCandle(candles[candles.length - 1])) {
        confidence += 10;
        reason += 'Bullish candle. ';
      }

      const vol = Indicators.volumeAnalysis(candles);
      if (vol.isHigh) {
        confidence += 10;
        reason += `Volume ${vol.ratio}x. `;
      }

      if (confidence >= 50) signal = 'long';
    } else if (dailyTrendDown) {
      confidence += 30;
      reason = 'Daily trend bearish (50 EMA < 200 MA). ';

      const pullbackToEMA = Math.abs(lastPrice - lastEMA20) / lastEMA20 < 0.02;

      if (pullbackToEMA) {
        confidence += 25;
        reason += '4H pullback to 20 EMA. ';
      }

      if (lastRSI && lastRSI > 40 && lastRSI < 70) {
        confidence += 15;
        reason += `RSI ${lastRSI.toFixed(0)} — not oversold. `;
      }

      if (Indicators.isBearishCandle(candles[candles.length - 1])) {
        confidence += 10;
        reason += 'Bearish candle. ';
      }

      if (confidence >= 50) signal = 'short';
    } else {
      reason = 'No clear daily trend for swing setup.';
    }

    confidence = Math.min(confidence, 100);

    // Weekly swing uses slightly wider stops and higher leverage potential
    return finalizeSignal(candles, {
      signal,
      confidence,
      reason: reason.trim(),
      entry: lastPrice,
      stopLoss: signal === 'long'
        ? lastPrice - (lastATR * 2.5)
        : signal === 'short' ? lastPrice + (lastATR * 2.5) : null,
      tp1: signal === 'long' ? lastPrice + (lastATR * 2.5) : signal === 'short' ? lastPrice - (lastATR * 2.5) : null,
      tp2: signal === 'long' ? lastPrice + (lastATR * 5) : signal === 'short' ? lastPrice - (lastATR * 5) : null,
      tp3: signal === 'long' ? lastPrice + (lastATR * 8) : signal === 'short' ? lastPrice - (lastATR * 8) : null,
      leverage: 4,
    });
  }

  function finalizeSignal(candles, result) {
    if (!result || result.signal === 'neutral' || !result.entry || !result.stopLoss) {
      return result;
    }

    const targets = realisticTargets(candles, result.signal, result.entry, result.stopLoss);
    const entryMeta = entryQuality(candles, result.signal, result.entry, result.stopLoss);
    return {
      ...result,
      ...targets,
      ...entryMeta,
      reason: `${result.reason}${entryMeta.entryNote ? ` ${entryMeta.entryNote}` : ''}${targets.targetNote ? ` ${targets.targetNote}` : ''}`.trim(),
    };
  }

  function entryQuality(candles, signal, currentPrice, stopLoss) {
    const isLong = signal === 'long';
    const atr = Indicators.lastValue(Indicators.atr(candles, 14)) || Math.abs(currentPrice - stopLoss);
    const risk = Math.abs(currentPrice - stopLoss) || atr;
    const idealEntry = findIdealEntry(candles, signal, currentPrice);
    const favorableMove = isLong ? currentPrice - idealEntry : idealEntry - currentPrice;
    const distance = Math.max(0, favorableMove);
    const distancePct = currentPrice ? (distance / currentPrice) * 100 : 0;
    const distanceAtr = atr ? distance / atr : 0;
    const distanceR = risk ? distance / risk : 0;

    let entryStatus = 'ideal';
    let entryLabel = 'Ideal entry zone';
    let entryNote = 'Entry is near the ideal zone.';

    if (distanceAtr > 0.9 || distanceR > 0.55 || distancePct > 3.5) {
      entryStatus = 'missed';
      entryLabel = 'Missed entry';
      entryNote = `Price already moved ${distancePct.toFixed(2)}% from ideal entry. Wait for pullback.`;
    } else if (distanceAtr > 0.55 || distanceR > 0.35 || distancePct > 2) {
      entryStatus = 'stretched';
      entryLabel = 'Stretched entry';
      entryNote = `Entry is stretched ${distancePct.toFixed(2)}% from ideal. Size down or wait.`;
    } else if (distanceAtr > 0.25 || distanceR > 0.18 || distancePct > 0.8) {
      entryStatus = 'actionable';
      entryLabel = 'Actionable pullback';
      entryNote = `Entry is still actionable, ${distancePct.toFixed(2)}% from ideal.`;
    }

    return {
      idealEntry,
      entryStatus,
      entryLabel,
      missedEntry: entryStatus === 'missed',
      entryMeta: {
        idealEntry,
        distancePct,
        distanceAtr,
        distanceR,
        status: entryStatus,
        label: entryLabel,
      },
      entryNote,
    };
  }

  function findIdealEntry(candles, signal, currentPrice) {
    const isLong = signal === 'long';
    const recent = candles.slice(-120);
    const ema20 = Indicators.lastValue(Indicators.ema(candles, 20));
    const ema50 = Indicators.lastValue(Indicators.ema(candles, 50));
    const { support, resistance } = Indicators.supportResistance(recent, 4);
    const levels = [
      ema20,
      ema50,
      ...(isLong ? support : resistance),
    ].filter(Number.isFinite);

    const valid = levels
      .filter(level => isLong ? level <= currentPrice : level >= currentPrice)
      .map(level => ({ level, distance: Math.abs(currentPrice - level) }))
      .sort((a, b) => a.distance - b.distance);

    if (valid.length) return valid[0].level;

    const last = candles[candles.length - 1];
    return isLong ? Math.min(currentPrice, last.low) : Math.max(currentPrice, last.high);
  }

  function realisticTargets(candles, signal, entry, stopLoss) {
    const isLong = signal === 'long';
    const risk = Math.abs(entry - stopLoss);
    const atr = Indicators.lastValue(Indicators.atr(candles, 14)) || risk;
    const recent = candles.slice(-120, -1);
    const levels = getStructureTargets(recent, entry, isLong);
    const fallbackTp1 = isLong ? entry + risk : entry - risk;
    const fallbackTp2 = isLong ? entry + (risk * 1.6) : entry - (risk * 1.6);

    const maxTp1Move = Math.max(atr * 1.5, entry * 0.06);
    const maxTp2Move = Math.max(atr * 2.8, entry * 0.12);

    let tp1 = chooseTarget(levels, entry, isLong, risk * 0.55, risk * 1.15) || fallbackTp1;
    tp1 = capTarget(tp1, entry, isLong, maxTp1Move);

    let tp2 = chooseTarget(levels, entry, isLong, Math.abs(tp1 - entry) + risk * 0.35, risk * 1.9) || fallbackTp2;
    tp2 = capTarget(tp2, entry, isLong, maxTp2Move);

    if (isLong && tp2 <= tp1) tp2 = Math.min(entry + maxTp2Move, tp1 + risk * 0.45);
    if (!isLong && tp2 >= tp1) tp2 = Math.max(entry - maxTp2Move, tp1 - risk * 0.45);

    const tp3 = isLong
      ? entry + Math.min(maxTp2Move * 1.35, risk * 2.4)
      : entry - Math.min(maxTp2Move * 1.35, risk * 2.4);

    const tp1R = Math.abs(tp1 - entry) / risk;
    const tp2R = Math.abs(tp2 - entry) / risk;
    const tp1MovePct = Math.abs(tp1 - entry) / entry * 100;
    const tp2MovePct = Math.abs(tp2 - entry) / entry * 100;
    const tp1Realism = targetRealism(tp1MovePct, tp1R);
    const tp2Realism = targetRealism(tp2MovePct, tp2R);

    return {
      tp1,
      tp2,
      tp3,
      targetMeta: {
        tp1R,
        tp2R,
        tp1MovePct,
        tp2MovePct,
        tp1Realism,
        tp2Realism,
      },
      targetNote: `Targets adjusted to nearby structure/volatility. TP1 ${tp1Realism}, TP2 ${tp2Realism}.`,
    };
  }

  function getStructureTargets(candles, entry, isLong) {
    if (!candles.length) return [];
    const { support, resistance } = Indicators.supportResistance(candles, 4);
    const levels = (isLong ? resistance : support)
      .filter(level => isLong ? level > entry : level < entry)
      .map(level => ({ level, distance: Math.abs(level - entry) }))
      .sort((a, b) => a.distance - b.distance)
      .map(item => item.level);

    const recentHigh = Math.max(...candles.map(c => c.high));
    const recentLow = Math.min(...candles.map(c => c.low));
    levels.push(isLong ? recentHigh : recentLow);
    return [...new Set(levels.filter(Number.isFinite))];
  }

  function chooseTarget(levels, entry, isLong, minDistance, maxDistance) {
    return levels.find(level => {
      const distance = Math.abs(level - entry);
      const correctSide = isLong ? level > entry : level < entry;
      return correctSide && distance >= minDistance && distance <= maxDistance;
    });
  }

  function capTarget(target, entry, isLong, maxMove) {
    if (!target) return target;
    return isLong
      ? Math.min(target, entry + maxMove)
      : Math.max(target, entry - maxMove);
  }

  function targetRealism(movePct, rMultiple) {
    if (movePct <= 5 && rMultiple <= 1.2) return 'Conservative';
    if (movePct <= 10 && rMultiple <= 1.8) return 'Normal';
    return 'Stretch';
  }

  /**
   * Score a symbol for "opportunity" based on quick analysis
   * Used by the scanner to rank coins
   */
  function quickScore(candles, fundingRate) {
    if (!candles || candles.length < 50) return 0;

    let score = 0;
    const lastPrice = candles[candles.length - 1].close;

    // Volatility (higher = better for us)
    const recentCandles = candles.slice(-20);
    const avgRange = recentCandles.reduce((sum, c) => sum + (c.high - c.low) / c.close, 0) / recentCandles.length;
    score += Math.min(avgRange * 1000, 30); // Up to 30 points for volatility

    // Trend strength
    if (candles.length >= 50) {
      const sma50 = Indicators.sma(candles.slice(-60), 50);
      if (sma50.length > 0) {
        const trendPct = Math.abs((lastPrice - sma50[sma50.length - 1].value) / sma50[sma50.length - 1].value) * 100;
        score += Math.min(trendPct * 2, 25); // Up to 25 points for trend strength
      }
    }

    // Volume surge
    const vol = Indicators.volumeAnalysis(candles);
    if (vol.isHigh) score += Math.min(vol.ratio * 10, 25); // Up to 25 points

    // Funding anomaly
    const latestFunding = getLatestFundingValue(fundingRate);
    if (latestFunding !== null) {
      const absFunding = Math.abs(latestFunding);
      if (absFunding > 0.0005) score += 20;
      else if (absFunding > 0.0002) score += 10;
    }

    return Math.round(score);
  }

  return {
    STRATEGY_LIST,
    analyze,
    quickScore,
  };

})();
