// ============================================
// FUTURES EDGE - Signal Journal
// Local paper tracking and win-rate analytics
// ============================================

const Journal = (() => {

  const STORAGE_KEY = 'futuresEdge.signalJournal.v1';
  const MAX_ACTIVE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const USE_LOCAL_BACKEND = ['localhost', '127.0.0.1'].includes(location.hostname);
  let entries = load();
  let recordingPaused = false;
  syncFromDisk();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[Journal] Could not load saved journal:', e);
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.warn('[Journal] Could not save journal:', e);
    }
    if (USE_LOCAL_BACKEND) {
      fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entries),
      }).catch(e => console.warn('[Journal] Could not sync journal to disk:', e));
    }
  }

  async function syncFromDisk() {
    if (!USE_LOCAL_BACKEND) return;
    try {
      const res = await fetch('/api/journal', { cache: 'no-store' });
      if (!res.ok) return;
      const diskEntries = await res.json();
      if (Array.isArray(diskEntries) && diskEntries.length) {
        entries = diskEntries;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      }
    } catch (e) {
      console.warn('[Journal] Could not load journal from disk:', e);
    }
  }

  function recordSignals(signals, source = 'scanner') {
    if (recordingPaused) return [];
    if (!Array.isArray(signals)) return [];

    const now = Date.now();
    const created = [];

    signals
      .filter(s => s.signal !== 'neutral' && s.entry && s.stopLoss && s.tp1 && !s.missedEntry)
      .forEach(signal => {
        const duplicate = entries.find(entry =>
          entry.symbol === signal.symbol &&
          entry.signal === signal.signal &&
          entry.strategy === signal.strategy &&
          entry.status === 'open' &&
          Math.abs(entry.entry - signal.entry) / signal.entry < 0.003 &&
          now - entry.createdAt < 6 * 60 * 60 * 1000
        );
        if (duplicate) return;

        const entry = {
          id: `${signal.symbol}-${signal.strategy || 'strategy'}-${signal.signal}-${now}-${Math.round(signal.entry * 100000)}`,
          symbol: signal.symbol,
          strategy: signal.strategy || signal.strategyName || 'Strategy',
          signal: signal.signal,
          confidence: signal.confidence || 0,
          entry: signal.entry,
          stopLoss: signal.stopLoss,
          tp1: signal.tp1,
          tp2: signal.tp2,
          tp3: signal.tp3,
          leverage: signal.leverage,
          idealEntry: signal.idealEntry,
          entryStatus: signal.entryStatus,
          entryLabel: signal.entryLabel,
          entryMeta: signal.entryMeta,
          reason: signal.reason,
          source,
          status: 'open',
          outcome: 'tracking',
          createdAt: now,
          updatedAt: now,
          firstHitAt: null,
          lastPrice: signal.price || signal.entry,
          maxFavorableR: 0,
          maxAdverseR: 0,
          rMultiple: 0,
        };

        entries.unshift(entry);
        created.push(entry);
      });

    entries = entries.slice(0, 500);
    if (created.length) save();
    return created;
  }

  function updateFromTickers(tickers) {
    if (!Array.isArray(tickers) || !tickers.length) return;
    const bySymbol = new Map(tickers.map(t => [t.symbol, t.lastPrice]));
    let changed = false;

    entries.forEach(entry => {
      const price = bySymbol.get(entry.symbol);
      if (!price || entry.status !== 'open') return;
      changed = updateOpenProgress(entry, price, Date.now()) || changed;
    });

    expireOldEntries();
    if (changed) save();
  }

  async function refreshOpenEntries() {
    const open = entries.filter(entry => entry.status === 'open');
    if (!open.length) return;

    let changed = false;
    const symbols = [...new Set(open.map(entry => entry.symbol))];

    for (const symbol of symbols) {
      try {
        const candles = await BinanceAPI.getKlines(symbol, '15m', 96);
        const related = open.filter(entry => entry.symbol === symbol);
        candles.forEach(candle => {
          related.forEach(entry => {
            if (entry.status !== 'open' || candle.time * 1000 < entry.createdAt) return;
            changed = evaluateCandle(entry, candle) || changed;
          });
        });
      } catch (e) {
        console.warn(`[Journal] Could not refresh ${symbol}:`, e);
      }
    }

    expireOldEntries();
    if (changed) save();
  }

  function evaluateCandle(entry, candle) {
    const isLong = entry.signal === 'long';
    const hitStop = isLong ? candle.low <= entry.stopLoss : candle.high >= entry.stopLoss;
    const hitTp1 = entry.tp1 && (isLong ? candle.high >= entry.tp1 : candle.low <= entry.tp1);
    const hitTp2 = entry.tp2 && (isLong ? candle.high >= entry.tp2 : candle.low <= entry.tp2);
    const hitTp3 = entry.tp3 && (isLong ? candle.high >= entry.tp3 : candle.low <= entry.tp3);

    if (hitStop && !hitTp1) {
      closeEntry(entry, 'loss', 'stop', candle.time * 1000, entry.stopLoss, -1);
      return true;
    }
    if (hitTp3) {
      closeEntry(entry, 'win', 'tp3', candle.time * 1000, entry.tp3, 3);
      return true;
    }
    if (hitTp2) {
      closeEntry(entry, 'win', 'tp2', candle.time * 1000, entry.tp2, 2);
      return true;
    }
    if (hitTp1) {
      closeEntry(entry, 'win', 'tp1', candle.time * 1000, entry.tp1, 1);
      return true;
    }

    const closePrice = candle.close;
    return updateOpenProgress(entry, closePrice, candle.time * 1000);
  }

  function updateOpenProgress(entry, price, timestamp) {
    entry.lastPrice = price;
    entry.updatedAt = timestamp;

    const r = riskDistance(entry);
    if (!r) return true;

    const direction = entry.signal === 'long' ? 1 : -1;
    const currentR = ((price - entry.entry) * direction) / r;
    entry.rMultiple = round(currentR, 2);
    entry.maxFavorableR = Math.max(entry.maxFavorableR || 0, round(currentR, 2));
    entry.maxAdverseR = Math.min(entry.maxAdverseR || 0, round(currentR, 2));

    return true;
  }

  function closeEntry(entry, outcome, hitLevel, timestamp, exitPrice, rMultiple) {
    entry.status = 'closed';
    entry.outcome = outcome;
    entry.hitLevel = hitLevel;
    entry.exitPrice = exitPrice;
    entry.firstHitAt = timestamp;
    entry.updatedAt = timestamp;
    entry.rMultiple = rMultiple;
  }

  function expireOldEntries() {
    const now = Date.now();
    let changed = false;
    entries.forEach(entry => {
      if (entry.status === 'open' && now - entry.createdAt > MAX_ACTIVE_AGE_MS) {
        entry.status = 'expired';
        entry.outcome = 'expired';
        entry.updatedAt = now;
        changed = true;
      }
    });
    if (changed) save();
  }

  function riskDistance(entry) {
    return Math.abs(entry.entry - entry.stopLoss);
  }

  function getStats() {
    const closed = entries.filter(entry => entry.status === 'closed');
    const wins = closed.filter(entry => entry.outcome === 'win');
    const losses = closed.filter(entry => entry.outcome === 'loss');
    const avgR = closed.length
      ? closed.reduce((sum, entry) => sum + (entry.rMultiple || 0), 0) / closed.length
      : 0;

    return {
      total: entries.length,
      open: entries.filter(entry => entry.status === 'open').length,
      closed: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
      avgR,
      tp1Wins: closed.filter(entry => ['tp1', 'tp2', 'tp3'].includes(entry.hitLevel)).length,
      tp2Wins: closed.filter(entry => ['tp2', 'tp3'].includes(entry.hitLevel)).length,
    };
  }

  function groupStats(key) {
    const groups = {};
    entries
      .filter(entry => entry.status === 'closed')
      .forEach(entry => {
        const label = entry[key] || 'Unknown';
        if (!groups[label]) groups[label] = { label, total: 0, wins: 0, avgR: 0 };
        groups[label].total += 1;
        if (entry.outcome === 'win') groups[label].wins += 1;
        groups[label].avgR += entry.rMultiple || 0;
      });

    return Object.values(groups)
      .map(group => ({
        ...group,
        winRate: group.total ? (group.wins / group.total) * 100 : 0,
        avgR: group.total ? group.avgR / group.total : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }

  function clear() {
    entries = [];
    recordingPaused = true;
    save();
  }

  function resumeRecording() {
    recordingPaused = false;
  }

  function round(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  return {
    recordSignals,
    updateFromTickers,
    refreshOpenEntries,
    getStats,
    groupStats,
    clear,
    resumeRecording,
    get entries() { return entries; },
    get recordingPaused() { return recordingPaused; },
  };

})();
