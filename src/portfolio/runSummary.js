// Summaries of what happened in a time window, from the database alone.
// Used by the Telegram digest (through ControlApi) and by `npm run report`.
//
// Decisions are not stored with their regime, so the regime is inferred from
// bucket 1's reason text: a mean-reversion reason means RANGING, a
// trend-following reason means TRENDING_UP, and so on.

// Numbers vary from minute to minute; replacing them groups similar reasons.
export function reasonKey(reason) {
  return String(reason ?? '').replace(/-?\d+(\.\d+)?/g, '#').trim();
}

// "mean_reversion: confidence 51% below 55%" → 0.51
export function nearMissConfidence(reason) {
  const m = /confidence (\d+)% below (\d+)%/.exec(reason ?? '');
  return m ? Number(m[1]) / 100 : null;
}

export function regimeFromReason(reason) {
  const r = reason ?? '';
  if (/^mean_reversion[ :]/.test(r) || /\[RANGING\]/.test(r))       return 'RANGING';
  if (/^trend_following[ :]/.test(r) || /\[TRENDING_UP\]/.test(r))  return 'TRENDING_UP';
  if (r.startsWith('downtrend'))                                    return 'TRENDING_DOWN';
  if (r.startsWith('regime uncertain'))                             return 'UNCERTAIN';
  return null;
}

const STALE_REASONS = new Set(['price feed stale', 'waiting for first live swap']);

export function summarizeWindow({ store, sinceMs, untilMs }) {
  const buckets = {};
  const bucketOf = id => (buckets[id] ??= {
    total: 0, counts: {}, noTrade: {}, rejections: {}, regimes: {}, nearMisses: [], staleMinutes: 0, errors: [],
  });

  for (const g of store.decisionGroupsBetween(sinceMs, untilMs)) {
    const b = bucketOf(g.bucket_id);
    b.total += g.n;
    b.counts[g.outcome] = (b.counts[g.outcome] ?? 0) + g.n;
    if (g.outcome === 'NO_TRADE') {
      const key = reasonKey(g.reason);
      b.noTrade[key] = (b.noTrade[key] ?? 0) + g.n;
      if (STALE_REASONS.has(g.reason)) b.staleMinutes += g.n;
      const c = nearMissConfidence(g.reason);
      if (c != null) for (let i = 0; i < g.n; i++) b.nearMisses.push(c);
    } else if (g.outcome === 'REJECTED') {
      const key = `${g.stage} ${g.code ?? ''}`.trim();
      b.rejections[key] = (b.rejections[key] ?? 0) + g.n;
    } else if (g.outcome === 'ERROR') {
      b.errors.push({ reason: g.reason, n: g.n });
    }
    const regime = regimeFromReason(g.reason);
    if (regime) b.regimes[regime] = (b.regimes[regime] ?? 0) + g.n;
  }
  for (const b of Object.values(buckets)) {
    b.topNoTrade = Object.entries(b.noTrade).sort((x, y) => y[1] - x[1]).map(([reason, n]) => ({ reason, n }));
    b.nearMisses.sort((x, y) => y - x);
  }

  const opened = store.positionsOpenedBetween(sinceMs, untilMs);
  const closed = store.positionsClosedBetween(sinceMs, untilMs);
  const trades = {};
  const tradesOf = id => (trades[id] ??= { opened: 0, closed: 0, wins: 0, pnlUsd: 0, feesUsd: 0, byExit: {} });
  for (const p of opened) tradesOf(p.bucket_id).opened++;
  for (const p of closed) {
    const t = tradesOf(p.bucket_id);
    t.closed++;
    if (p.pnl_usd > 0) t.wins++;
    t.pnlUsd  += p.pnl_usd;
    t.feesUsd += (p.open_fee_usd ?? 0) + (p.close_fee_usd ?? 0);
    const exit = (p.exit_reason ?? 'unknown').split(' ')[0];
    t.byExit[exit] = (t.byExit[exit] ?? 0) + 1;
  }

  const events = store.eventsBetween(sinceMs, untilMs);
  const ofType = t => events.filter(e => e.type === t);
  return {
    sinceMs, untilMs,
    buckets,
    opened, closed, trades,
    events: {
      starts:      ofType('START'),
      unclean:     ofType('START').filter(e => e.detail?.previousExit === 'unclean'),
      stops:       ofType('STOP'),
      dataDown:    ofType('DATA_DOWN'),
      dataUp:      ofType('DATA_UP'),
      errorBursts: ofType('ERROR_BURST'),
      halts:       ofType('HALT'),
      controls:    events.filter(e => ['PAUSE', 'RESUME', 'WIND_DOWN', 'WIND_DOWN_OFF', 'UNHALT'].includes(e.type)),
    },
  };
}
