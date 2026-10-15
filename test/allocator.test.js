import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESERVE_ID } from '../config/portfolio.js';
import { openStore } from '../src/persistence/db.js';
import { CapitalAllocator } from '../src/portfolio/capitalAllocator.js';
import { testConfig } from './helpers.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('init splits capital by allocation and puts the rest in reserve', () => {
  const a = new CapitalAllocator({ store: openStore(), config: testConfig() });
  a.init();
  close(a.available('alpha'), 600);
  close(a.available('beta'), 30);
  close(a.equity(RESERVE_ID), 370);
  close(a.totalEquity(), 1000);
});

test('init refuses to add ledgers that would hand out capital twice (a renamed bucket on an old database)', () => {
  const store = openStore();
  new CapitalAllocator({ store, config: testConfig() }).init();

  const renamed = testConfig();
  renamed.buckets = { alphaNew: renamed.buckets.alpha, beta: renamed.buckets.beta };
  assert.throws(() => new CapitalAllocator({ store, config: renamed }).init(), /would exceed the \$1000\.00 total\. Archive the database/);

  const disabled = testConfig({ buckets: { beta: { enabled: false } } });
  assert.doesNotThrow(() => new CapitalAllocator({ store, config: disabled }).init(), 'turning a bucket off keeps its ledger');
});

test('reserve bucket can never be allocated from', () => {
  const a = new CapitalAllocator({ store: openStore(), config: testConfig() });
  a.init();
  assert.equal(a.available(RESERVE_ID), 0);
  const r = a.reserve(RESERVE_ID, 1);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CA_002');
});

test('reserve and release move cash and record P&L', () => {
  const a = new CapitalAllocator({ store: openStore(), config: testConfig() });
  a.init();
  assert.equal(a.reserve('alpha', 100).ok, true);
  close(a.available('alpha'), 500);
  close(a.totalInUse(), 100);

  a.release('alpha', 100, -10);
  const l = a.ledger('alpha');
  close(l.cash_usd, 590);
  close(l.in_use_usd, 0);
  close(l.realized_pnl_usd, -10);
});

test('cannot reserve more than free cash', () => {
  const a = new CapitalAllocator({ store: openStore(), config: testConfig() });
  a.init();
  const r = a.reserve('beta', 31);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CA_001');
  close(a.available('beta'), 30);
});

test('allocations above 100% are refused', () => {
  const config = testConfig({ buckets: { alpha: { allocationPct: 0.98 } } });
  const a = new CapitalAllocator({ store: openStore(), config });
  assert.throws(() => a.init(), /> 100%/);
});

test('ledger persists across allocator instances', () => {
  const store = openStore();
  const a1 = new CapitalAllocator({ store, config: testConfig() });
  a1.init();
  a1.reserve('alpha', 50);
  const a2 = new CapitalAllocator({ store, config: testConfig() });
  a2.init();
  close(a2.available('alpha'), 550);
});
