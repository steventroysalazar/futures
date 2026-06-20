// ============================================
// FUTURES EDGE — Position Size Calculator
// Professional TP/SL/Liquidation calculator
// ============================================

const Calculator = (() => {

  /**
   * Calculate full position sizing with TP/SL levels
   * @param {Object} params
   * @param {number} params.balance - Account balance in USDT
   * @param {number} params.riskPercent - Risk per trade (e.g. 1 for 1%)
   * @param {number} params.entryPrice - Entry price
   * @param {number} params.leverage - Leverage multiplier (2-5)
   * @param {string} params.direction - 'long' or 'short'
   * @param {number} [params.stopLossPrice] - Custom stop loss price (optional)
   * @returns {Object} Full position breakdown
   */
  function calculate(params) {
    const {
      balance,
      riskPercent = 1,
      entryPrice,
      leverage = 3,
      direction = 'long',
      stopLossPrice = null,
    } = params;

    if (!balance || !entryPrice || balance <= 0 || entryPrice <= 0) {
      return null;
    }

    const riskAmount = balance * (riskPercent / 100); // Max $ to lose
    const isLong = direction === 'long';

    // If stop loss is provided, calculate position from it
    // Otherwise, default stop loss = 1% from entry for 3x → ~3% account risk
    let sl;
    if (stopLossPrice && stopLossPrice > 0) {
      sl = stopLossPrice;
    } else {
      // Default: risk amount determines stop distance
      // stopDistance = riskAmount / (positionSize)
      // positionSize = margin * leverage
      // We need to solve simultaneously
      // Use a reasonable default: stop = entry * (1 ± riskPercent / leverage / 100)
      const stopPct = riskPercent / leverage / 100;
      sl = isLong
        ? entryPrice * (1 - stopPct)
        : entryPrice * (1 + stopPct);
    }

    // Stop distance in price
    const stopDistance = Math.abs(entryPrice - sl);
    const stopDistancePct = (stopDistance / entryPrice) * 100;

    // Position size = riskAmount / (stopDistance / entryPrice)
    const positionSize = riskAmount / (stopDistance / entryPrice);
    const margin = positionSize / leverage;

    // If margin exceeds balance, cap it
    const actualMargin = Math.min(margin, balance * 0.8); // Max 80% of account
    const actualPositionSize = actualMargin * leverage;

    // Recalculate actual risk
    const actualRisk = actualPositionSize * (stopDistance / entryPrice);
    const actualRiskPercent = (actualRisk / balance) * 100;

    // Liquidation price (simplified, assumes isolated margin, no maintenance margin buffer)
    const maintenanceRate = 0.004; // 0.4% typical
    const liqPrice = isLong
      ? entryPrice * (1 - (1 / leverage) + maintenanceRate)
      : entryPrice * (1 + (1 / leverage) - maintenanceRate);

    // Take profit levels (R-multiples based on risk distance)
    const r1 = stopDistance * 1; // 1R
    const r2 = stopDistance * 2; // 2R
    const r3 = stopDistance * 3; // 3R

    const tp1 = isLong ? entryPrice + r1 : entryPrice - r1;
    const tp2 = isLong ? entryPrice + r2 : entryPrice - r2;
    const tp3 = isLong ? entryPrice + r3 : entryPrice - r3;

    // Profit at each TP (considering leverage)
    const profitTP1 = actualPositionSize * (r1 / entryPrice);
    const profitTP2 = actualPositionSize * (r2 / entryPrice);
    const profitTP3 = actualPositionSize * (r3 / entryPrice);

    // Scale-out plan: 25% at TP1, 25-50% at TP2, rest at TP3
    const scaleOutProfit =
      profitTP1 * 0.25 +
      profitTP2 * 0.375 +
      profitTP3 * 0.375;

    // ROI at each level
    const roiTP1 = (profitTP1 / actualMargin) * 100;
    const roiTP2 = (profitTP2 / actualMargin) * 100;
    const roiTP3 = (profitTP3 / actualMargin) * 100;

    return {
      // Input summary
      direction,
      leverage,
      balance,
      riskPercent: actualRiskPercent,

      // Position
      margin: round(actualMargin, 2),
      positionSize: round(actualPositionSize, 2),
      contracts: round(actualPositionSize / entryPrice, 6),

      // Levels
      entryPrice: round(entryPrice, getPrecision(entryPrice)),
      stopLoss: round(sl, getPrecision(entryPrice)),
      stopDistancePct: round(stopDistancePct, 2),
      liquidationPrice: round(liqPrice, getPrecision(entryPrice)),

      // Take profits
      tp1: round(tp1, getPrecision(entryPrice)),
      tp2: round(tp2, getPrecision(entryPrice)),
      tp3: round(tp3, getPrecision(entryPrice)),

      // P&L
      maxLoss: round(actualRisk, 2),
      maxLossPct: round(actualRiskPercent, 2),
      profitTP1: round(profitTP1, 2),
      profitTP2: round(profitTP2, 2),
      profitTP3: round(profitTP3, 2),
      scaleOutProfit: round(scaleOutProfit, 2),

      // ROI
      roiTP1: round(roiTP1, 1),
      roiTP2: round(roiTP2, 1),
      roiTP3: round(roiTP3, 1),

      // Scale-out plan
      scaleOut: [
        { level: 'TP1', price: round(tp1, getPrecision(entryPrice)), percent: 25, profit: round(profitTP1 * 0.25, 2) },
        { level: 'TP2', price: round(tp2, getPrecision(entryPrice)), percent: 37.5, profit: round(profitTP2 * 0.375, 2) },
        { level: 'TP3', price: round(tp3, getPrecision(entryPrice)), percent: 37.5, profit: round(profitTP3 * 0.375, 2) },
      ],

      // Distance from entry to liquidation
      liqDistancePct: round(Math.abs(liqPrice - entryPrice) / entryPrice * 100, 2),
    };
  }

  function round(value, decimals) {
    return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  function getPrecision(price) {
    if (price >= 10000) return 1;
    if (price >= 1000) return 2;
    if (price >= 100) return 3;
    if (price >= 10) return 4;
    if (price >= 1) return 4;
    if (price >= 0.1) return 5;
    return 6;
  }

  /**
   * Format a number for display
   */
  function formatUSD(value) {
    if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
  }

  function formatPrice(price) {
    return price.toFixed(getPrecision(price));
  }

  function formatPct(pct) {
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  }

  return {
    calculate,
    formatUSD,
    formatPrice,
    formatPct,
  };

})();
