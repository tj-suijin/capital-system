import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sizePosition } from '../src/risk/positionSizer.js';
import { fakeClock, makePortfolio } from './helpers.js';

// Opens and immediately closes a paper position with the given P&L in bucket alpha.
function bookPnl(store, clock, pnlUsd, bucketId = 'alpha') {
  const id = store.insertPosition({
    bucketId, symbol: 'TEST', side: 'BUY', mode: 'paper', venue: 'paper',
    entryPrice: 1, qty: 1, notionalUsd: 1, openFeeUsd: 0, reason: 'test', openedAt: clock(),
  });
  store.closePosition(id, { exitPrice: 1, closeFeeUsd: 0, pnlUsd, exitReason: 'test', closedAt: clock() });
}

// ---- sizer ----

test('sizer: confidence scales base size, stop-loss caps risk, cash caps all', () => {
  const s = { bucketEquityUsd: 600, availableCashUsd: 600, maxPositionPctOfBucket: 0.10, maxRiskPerTradePct: 0.01 };
  assert.equal(sizePosition({ ...s, confidence: 1 }), 60);
  assert.equal(sizePosition({ ...s, confidence: 0.5 }), 30);
  // 1% of 600 = $6 risk; 6 / 0.2 = 30
  assert.equal(sizePosition({ ...s, stopLossPct: 0.2 }), 30);
  assert.equal(sizePosition({ ...s, availableCashUsd: 10 }), 10);
  assert.equal(sizePosition({ ...s, requestedUsd: 5 }), 5);
  assert.equal(sizePosition({ ...s, confidence: 0 }), 0);
});

// ---- global risk ----

test('global: daily loss limit blocks entries and clears as the window rolls', () => {
  const clock = fakeClock();
  const { pm, store } = makePortfolio({ clock });
  pm.init();
  assert.equal(pm.globalRisk.checkEntry(10).ok, true);

  bookPnl(store, clock, -30); // 3% of $1000 HWM
  const r = pm.globalRisk.checkEntry(10);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'GR_001');

  clock.advance(25 * 60 * 60 * 1000);
  assert.equal(pm.globalRisk.checkEntry(10).ok, true);
});

test('global: weekly loss limit blocks entries', () => {
  const clock = fakeClock();
  const { pm, store } = makePortfolio({ clock });
  pm.init();
  for (let i = 0; i < 4; i++) { bookPnl(store, clock, -20); clock.advance(25 * 60 * 60 * 1000); }
  const r = pm.globalRisk.checkEntry(10);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'GR_002');
});

test('global: drawdown from high-water mark halts and the halt persists', () => {
  const clock = fakeClock();
  const { pm, store, config } = makePortfolio({ clock });
  pm.init();
  pm.allocator.release('alpha', 0, -160); // equity 1000 → 840 (16% DD)
  const r = pm.globalRisk.checkEntry(10);
  assert.equal(r.ok, false);
  assert.equal(pm.globalRisk.isHalted(), true);

  const again = makePortfolio({ clock, store, config });
  again.pm.init();
  assert.equal(again.pm.globalRisk.isHalted(), true, 'halt survives restart');

  again.pm.unhalt();
  assert.equal(again.pm.globalRisk.isHalted(), false);
  assert.equal(again.pm.globalRisk.checkEntry(10).ok, true, 'HWM reset prevents immediate re-trip');
});

test('global: gross exposure cap', () => {
  const { pm } = makePortfolio();
  pm.init();
  pm.allocator.reserve('alpha', 450);
  assert.equal(pm.globalRisk.checkEntry(40).ok, true);  // 49%
  const r = pm.globalRisk.checkEntry(60);               // 51%
  assert.equal(r.ok, false);
  assert.equal(r.code, 'GR_004');
});

// ---- bucket risk ----

test('bucket: pause, max concurrent, max size, daily loss', () => {
  const clock = fakeClock();
  const { pm, store } = makePortfolio({ clock });
  pm.init();
  const ctx = { bucketEquityUsd: 30, allocatedUsd: 30 };

  assert.equal(pm.bucketRisk.checkEntry('beta', 5, ctx).ok, true);
  assert.equal(pm.bucketRisk.checkEntry('beta', 8, ctx).code, 'BR_003'); // > 25% of 30

  pm.bucketRisk.pause('beta', 'test');
  assert.equal(pm.bucketRisk.checkEntry('beta', 5, ctx).code, 'BR_001');
  pm.bucketRisk.resume('beta');

  store.insertPosition({ bucketId: 'beta', symbol: 'X', side: 'BUY', mode: 'paper', venue: 'paper',
    entryPrice: 1, qty: 1, notionalUsd: 1, openFeeUsd: 0, openedAt: clock() });
  assert.equal(pm.bucketRisk.checkEntry('beta', 5, ctx).code, 'BR_002');
});

test('bucket: own daily loss limit', () => {
  const clock = fakeClock();
  const { pm, store } = makePortfolio({ clock });
  pm.init();
  bookPnl(store, clock, -3, 'beta'); // 10% of $30
  const r = pm.bucketRisk.checkEntry('beta', 1, { bucketEquityUsd: 27, allocatedUsd: 30 });
  assert.equal(r.code, 'BR_004');
});
