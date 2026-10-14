import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tradeIntent } from '../src/buckets/intent.js';
import { nearMissConfidence, reasonKey, regimeFromReason, summarizeWindow } from '../src/portfolio/runSummary.js';
import { buildReport } from '../src/tools/report.js';
import { makePortfolio } from './helpers.js';

const MIN = 60_000;

test('summary helpers: group reasons, read near misses and infer the regime', () => {
  assert.equal(reasonKey('mean_reversion: no setup (RSI oversold 29.6)'), 'mean_reversion: no setup (RSI oversold #)');
  assert.equal(reasonKey('mean_reversion: confidence 51% below 55%'), 'mean_reversion: confidence #% below #%');
  assert.equal(nearMissConfidence('trend_following: confidence 44% below 45%'), 0.44);
  assert.equal(nearMissConfidence('price feed stale'), null);
  assert.equal(regimeFromReason('mean_reversion: no setup'), 'RANGING');
  assert.equal(regimeFromReason('trend_following 53%: [TRENDING_UP] pullback'), 'TRENDING_UP');
  assert.equal(regimeFromReason('downtrend — long-only, no entries'), 'TRENDING_DOWN');
  assert.equal(regimeFromReason('regime uncertain (ADX 18)'), 'UNCERTAIN');
  assert.equal(regimeFromReason('price feed stale'), null);
});

async function scenario() {
  const { pm, store, registry, clock } = makePortfolio();
  const start = clock();
  await pm.start();
  for (const t of pm._timers) clearInterval(t);
  const alpha = registry.get('alpha');
  alpha.marks['ETH/USDC'] = 100;
  const noTrade = reason => ({ type: 'NO_TRADE', reason });
  alpha.entries.push(noTrade('mean_reversion: confidence 51% below 55%'), noTrade('price feed stale'),
    tradeIntent({ symbol: 'ETH/USDC', price: 100, confidence: 1, stopLossPct: 0.02, reason: 'test' }));
  for (let i = 0; i < 3; i++) { clock.advance(MIN); await pm.runBucketCycle('alpha'); }
  const [p] = store.getOpenPositions('alpha');
  alpha.exits.push({ positionId: p.id, price: 99, reason: 'stop loss 99.00' });
  clock.advance(MIN);
  await pm.runBucketCycle('alpha');
  pm.heartbeat();
  await pm.stop();
  return { pm, store, start, end: clock() + 1 };
}

test('summary: counts decisions, near misses, stale minutes and trades in the window', async () => {
  const { store, start, end } = await scenario();
  const s = summarizeWindow({ store, sinceMs: start, untilMs: end });
  const a = s.buckets.alpha;
  assert.deepEqual(a.counts, { NO_TRADE: 4, APPROVED: 1 });
  assert.deepEqual(a.nearMisses, [0.51]);
  assert.equal(a.staleMinutes, 1);
  assert.equal(a.regimes.RANGING, 1);
  assert.deepEqual({ ...s.trades.alpha, pnlUsd: Math.round(s.trades.alpha.pnlUsd * 100) / 100 },
    { opened: 1, closed: 1, wins: 0, pnlUsd: -0.6, feesUsd: 0, byExit: { stop: 1 } });
  assert.deepEqual([s.events.starts.length, s.events.stops.length, s.events.unclean.length], [1, 1, 0]);
});

test('report: renders every section from the database', async () => {
  const { pm, store, start, end } = await scenario();
  const md = buildReport({ store, config: pm.config, sinceMs: start, untilMs: end, logDir: 'no-such-dir', dbPath: ':memory:' });
  for (const s of ['# Paper run report', '## Operation', 'Process starts: 1, of which 0 followed an unclean stop', '## Alpha (`alpha`)',
    'Trades: 1 opened, 1 closed. Won 0 (0%)', 'Exits: stop 1.', 'Near misses (confidence below the minimum): 1 minutes, best 51%',
    '| mean_reversion: confidence #% below #% | 1 |', 'Closed trades:']) {
    assert.ok(md.includes(s), `missing: ${s}\n\n${md}`);
  }
});
