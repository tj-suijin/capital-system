import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tradeIntent } from '../src/buckets/intent.js';
import { ControlApi } from '../src/control/controlApi.js';
import { TelegramControl } from '../src/alerts/telegram.js';
import { markPosition } from '../src/portfolio/valuation.js';
import { makePortfolio, testConfig } from './helpers.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const intent = (extra = {}) => tradeIntent({ symbol: 'WETH/USDC', price: 2000, reason: 'test setup', ...extra });

async function openOne(opts) {
  const ctx = makePortfolio(opts);
  ctx.pm.init();
  ctx.registry.get('alpha').entries.push(intent());
  await ctx.pm.runBucketCycle('alpha');
  return { ...ctx, pos: ctx.store.getOpenPositions('alpha')[0] };
}

test('markPosition: value, unrealized P&L net of the open fee, and the at-cost fallback', () => {
  const p = { qty: 0.03, notional_usd: 60, open_fee_usd: 0.03, opened_at: 0 };
  const m = markPosition(p, { price: 2100, ts: 1_000 }, 4_000);
  assert.equal(m.priced, true);
  close(m.valueUsd, 63);
  close(m.unrealizedPnlUsd, 2.97);
  assert.equal(m.markAgeMs, 3_000);
  assert.equal(m.heldMs, 4_000);

  for (const mark of [null, { price: 0, ts: 0 }, { price: NaN, ts: 0 }]) {
    const c = markPosition(p, mark, 4_000);
    assert.equal(c.priced, false);
    close(c.valueUsd, 60);
    close(c.unrealizedPnlUsd, -0.03);
  }
});

test('equity, sizing and status follow the mark price', async () => {
  const { pm, store, registry, pos } = await openOne();
  close(pm.allocator.totalEquity(), 1000);          // no mark yet → at cost (zero fees in test config)

  registry.get('alpha').marks['WETH/USDC'] = 1800;  // -10% on $60
  close(pm.allocator.equity('alpha'), 594);
  close(pm.allocator.totalEquity(), 994);
  close(pm.globalRisk.refresh().drawdownPct, 0.006);

  const s = pm.status();
  const alpha = s.buckets.find(b => b.id === 'alpha');
  close(alpha.unrealizedPnlUsd, -6);
  close(alpha.equityUsd, 594);
  close(s.risk.equityUsd, 994);

  const [marked] = new ControlApi({ portfolio: pm, store }).getOpenPositions();
  assert.equal(marked.id, pos.id);
  close(marked.markPrice, 1800);

  registry.get('alpha').entries.push(intent());     // the next entry is sized off marked equity
  await pm.runBucketCycle('alpha');
  const second = store.getOpenPositions('alpha')[1];
  close(second.notional_usd, 59.4);                 // 10% of $594
});

test('unrealized gains raise the high-water mark; giving them back counts as drawdown', async () => {
  const { pm, registry } = await openOne();
  registry.get('alpha').marks['WETH/USDC'] = 2400;  // +$12
  pm.globalRisk.refresh();
  close(pm.globalRisk.state.hwm, 1012);

  registry.get('alpha').marks['WETH/USDC'] = 2000;
  close(pm.globalRisk.refresh().drawdownPct, 12 / 1012);
});

test('drawdown halt trips on unrealized losses during a normal bucket cycle', async () => {
  const config = testConfig({
    buckets:    { alpha: { risk: { maxPositionPctOfBucket: 1, maxRiskPerTradePct: 1 } } },
    globalRisk: { maxGrossExposurePct: 1 },
  });
  const { pm, registry, pos } = await openOne({ config });
  close(pos.notional_usd, 600);

  registry.get('alpha').marks['WETH/USDC'] = 1400;  // -30% on $600 = 18% of the portfolio
  await pm.runBucketCycle('alpha');
  assert.equal(pm.globalRisk.isHalted(), true);
  assert.equal(pm.globalRisk.state.haltCode, 'GR_003');
});

test('gross exposure uses market value', async () => {
  const config = testConfig({
    buckets:    { alpha: { risk: { maxPositionPctOfBucket: 1, maxRiskPerTradePct: 1 } } },
    globalRisk: { maxGrossExposurePct: 0.7 },
  });
  const { pm, registry, pos } = await openOne({ config });
  close(pos.notional_usd, 600);
  registry.get('alpha').marks['WETH/USDC'] = 2400;     // +20%: worth $720, equity $1120
  close(pm.globalRisk.status().grossExposurePct, 720 / 1120);
  // $80 more would be 68% at cost (680 / 1000) but 71.4% at market value (800 / 1120).
  assert.equal(pm.globalRisk.checkEntry(80).code, 'GR_004');

});

test('a failing mark lookup values the position at cost instead of breaking the cycle', async () => {
  const { pm, store, registry } = await openOne();
  registry.get('alpha').marks['WETH/USDC'] = () => { throw new Error('boom'); };
  close(pm.allocator.totalEquity(), 1000);
  await pm.runBucketCycle('alpha');
  assert.notEqual(store.getRecentDecisions(1, 'alpha')[0].outcome, 'ERROR');
});

test('heartbeat snapshots record unrealized P&L', async () => {
  const { pm, store, registry } = await openOne();
  registry.get('alpha').marks['WETH/USDC'] = 2200;
  pm.heartbeat();
  const api = new ControlApi({ portfolio: pm, store });
  const [portfolio] = api.getEquityHistory();
  close(portfolio.unrealized_pnl_usd, 6);
  close(portfolio.equity_usd, 1006);
  close(api.getEquityHistory({ bucketId: 'alpha' })[0].unrealized_pnl_usd, 6);
});

test('telegram /positions shows the mark and unrealized P&L', async () => {
  const { pm, store, registry } = await openOne();
  const tg = new TelegramControl({ api: new ControlApi({ portfolio: pm, store }), token: null, chatId: null });
  assert.match(await tg.handle('/positions'), /No price — valued at cost/);

  registry.get('alpha').marks['WETH/USDC'] = 1900;
  const reply = await tg.handle('/positions alpha');
  assert.match(reply, /Mark 1900\.00 \(0s old\) \| P&amp;L -\$3\.00/);
  assert.match(await tg.handle('/positions beta'), /No open positions/);
  assert.match(await tg.handle('/status'), /\$597\.00 \| 1 open \(-\$3\.00\) \| P&amp;L 24h \+\$0\.00/);
});
