import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchSwapTicks, backfill } from '../src/data/backfill.js';
import { CandleBuilder, isContiguous } from '../src/data/candleBuilder.js';
import { MarketData } from '../src/data/marketData.js';
import { POOLS, decodeSwapData, sqrtPriceX96ToPrice } from '../src/data/uniswapV3.js';
import { openStore } from '../src/persistence/db.js';

const POOL = POOLS['base:uniswap-v3:WETH/USDC:500'];
const MIN = 60_000;
const MARKET = {
  pool: POOL.id, timeframes: { '1m': MIN, '5m': 5 * MIN }, backfillHours: 1,
  maxGapFillCandles: 2, outlierPct: 0.02, pollIntervalMs: 10_000, staleAfterMs: 120_000, logChunkBlocks: 50,
};

const word = v => (BigInt.asUintN(256, BigInt(v))).toString(16).padStart(64, '0');
function sqrtFor(price) {
  return BigInt(Math.round(Math.sqrt(price * 10 ** (POOL.token1.decimals - POOL.token0.decimals)) * 2 ** 96));
}
// Swap data: pool pays out `eth` WETH (negative amount0) for `usdc` USDC in.
function swapData(price, usdc = 1000) {
  return '0x' + word(-BigInt(Math.round((usdc / price) * 1e18))) + word(BigInt(Math.round(usdc * 1e6))) + word(sqrtFor(price)) + word(10n ** 18n) + word(-195000);
}

function builder(store, extra = {}) {
  return new CandleBuilder({ store, pool: POOL, timeframes: MARKET.timeframes, outlierPct: 0.02, maxGapFillCandles: 2, ...extra });
}

// A fake JSON-RPC provider. Blocks are 2s apart starting at t = 1,000,000s.
function fakeProvider({ logs = [], latest = 1000, maxRange = Infinity, rateFailures = 0 } = {}) {
  return {
    rateFailures,
    calls: [],
    async getBlockNumber() { return latest; },
    async getBlock(n) { return { number: n, timestamp: 1_000_000 + n * 2 }; },
    async getLogs({ fromBlock, toBlock }) {
      this.calls.push([fromBlock, toBlock]);
      if (this.rateFailures > 0) { this.rateFailures--; throw new Error('429 Too Many Requests'); }
      if (toBlock - fromBlock + 1 > maxRange) throw new Error('eth_getLogs is limited to a 10 block range');
      return logs.filter(l => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
  };
}
const blockTs = n => (1_000_000 + n * 2) * 1000;

// ---- decoding ----

test('decode: sqrtPriceX96 and Swap data give ETH price in USDC and quote volume', () => {
  const p = sqrtPriceX96ToPrice(sqrtFor(2516.29), POOL);
  assert.ok(Math.abs(p - 2516.29) < 1e-6);
  const d = decodeSwapData(swapData(2500, 1234.5), POOL);
  assert.ok(Math.abs(d.price - 2500) < 1e-6);
  assert.ok(Math.abs(d.volumeQuote - 1234.5) < 1e-9);
});

// ---- candle builder ----

test('candles: OHLC, volume and swap counts per timeframe', () => {
  const store = openStore();
  const b = builder(store);
  const t = 10 * 5 * MIN;
  b.tick(2500, t, 10); b.tick(2510, t + 1000, 20); b.tick(2495, t + 2000, 5); b.tick(2505, t + 3000, 1);
  b.flush();
  const [m] = store.getCandles(POOL.id, '1m', 10);
  assert.deepEqual([m.open, m.high, m.low, m.close, m.volume_quote, m.swaps], [2500, 2510, 2495, 2505, 36, 4]);
  assert.equal(store.getCandles(POOL.id, '5m', 10).length, 1);
});

test('candles: a one-off spike is dropped, a sustained move is accepted', () => {
  const store = openStore();
  const b = builder(store);
  let t = 0;
  for (let i = 0; i < 10; i++) b.tick(2500, t += 1000);
  assert.equal(b.tick(2600, t += 1000), false);           // +4% spike
  assert.equal(b.tick(2500, t += 1000), true);
  // genuine move to 2600: rejected until it dominates the window, then accepted
  const accepted = [];
  for (let i = 0; i < 15; i++) accepted.push(b.tick(2600, t += 1000));
  assert.equal(accepted[0], false);
  assert.equal(accepted.at(-1), true);
  assert.equal(b.tick(50, t += 1000), false);             // outside the pool's sanity band
});

test('candles: short gaps are forward-filled, long gaps are left empty', () => {
  const store = openStore();
  const closed = [];
  const b = builder(store, { onClose: (tf, c) => tf === '1m' && closed.push(c) });
  b.tick(2500, 0);
  b.tick(2501, 3 * MIN);          // 2 missing minutes → filled flat
  b.flush();
  const rows = store.getCandles(POOL.id, '1m', 10);
  assert.deepEqual(rows.map(r => [r.ts / MIN, r.swaps]), [[0, 1], [1, 0], [2, 0], [3, 1]]);
  assert.equal(rows[1].close, 2500);
  assert.equal(closed.length, 3);
  assert.ok(isContiguous(rows, MIN, 3 * MIN));

  b.tick(2502, 10 * MIN);         // 6 missing minutes → left as a gap
  b.flush();
  const after = store.getCandles(POOL.id, '1m', 10);
  assert.equal(after.length, 5);
  assert.equal(isContiguous(after, MIN, 10 * MIN), false);
});

test('candles: late ticks are ignored; resume continues the stored candle', () => {
  const store = openStore();
  const b = builder(store);
  b.tick(2500, MIN + 1000);
  b.tick(2400 * 1.01, 1000);      // belongs to an earlier minute
  b.flush();
  assert.equal(store.getCandles(POOL.id, '1m', 10).length, 1);

  const b2 = builder(store);
  b2.resume();
  b2.tick(2520, MIN + 5000);
  b2.flush();
  const [c] = store.getCandles(POOL.id, '1m', 10);
  assert.deepEqual([c.open, c.high, c.close, c.swaps], [2500, 2520, 2520, 2]);
});

test('isContiguous: requires recent data', () => {
  const rows = [{ ts: 0 }, { ts: MIN }];
  assert.ok(isContiguous(rows, MIN, MIN + 30_000));
  assert.ok(isContiguous(rows, MIN, 2 * MIN + 30_000));
  assert.equal(isContiguous(rows, MIN, 5 * MIN), false);
  assert.equal(isContiguous([], MIN, 0), false);
});

// ---- backfill ----

test('fetchSwapTicks: shrinks the range on provider limits, retries rate limits, sorts', async () => {
  const logs = [
    { blockNumber: 30, index: 1, data: swapData(2501) },
    { blockNumber: 30, index: 0, data: swapData(2500) },
    { blockNumber: 12, index: 0, data: swapData(2499) },
    { blockNumber: 20, index: 0, data: swapData(9), removed: true },
  ];
  const p = fakeProvider({ logs, maxRange: 10, rateFailures: 2 });
  const { ticks, chunkBlocks } = await fetchSwapTicks(p, POOL, 10, 40, { chunkBlocks: 50, sleepFn: async () => {} });
  assert.ok(chunkBlocks <= 10);
  assert.deepEqual(ticks.map(t => [t.blockNumber, t.logIndex]), [[12, 0], [30, 0], [30, 1]]);
  assert.equal(ticks[0].ts, blockTs(12));
});

test('fetchSwapTicks: unknown provider errors fail loudly', async () => {
  const p = fakeProvider();
  p.getLogs = async () => { throw new Error('invalid params'); };
  await assert.rejects(fetchSwapTicks(p, POOL, 1, 5), /Backfill failed/);
});

test('backfill: builds candles from logs and resumes from the last stored candle', async () => {
  const store = openStore();
  const latest = 1000;
  const now = blockTs(latest);
  const logs = [];
  for (let b = 0; b <= latest; b += 3) logs.push({ blockNumber: b, index: 0, data: swapData(2500 + (b % 7)) });
  const p = fakeProvider({ logs, latest });

  const s1 = await backfill({ provider: p, store, pool: POOL, market: MARKET, clock: () => now, sleepFn: async () => {} });
  assert.ok(s1.accepted > 0);
  const oneMin = store.getCandles(POOL.id, '1m', 500);
  assert.ok(oneMin.length >= 30);
  assert.ok(isContiguous(oneMin, MIN, now));

  // Second run starts at the last stored 5m candle, not an hour back.
  p.calls = [];
  const s2 = await backfill({ provider: p, store, pool: POOL, market: MARKET, clock: () => now, sleepFn: async () => {} });
  assert.ok(latest - s2.fromBlock < 5 * 30 + 31);
  assert.deepEqual(store.getCandles(POOL.id, '1m', 500), oneMin);
});

// ---- gap fill after reconnect ----

test('market data: gap fill replays missed swaps and drops duplicate live ticks', async () => {
  const store = openStore();
  const logs = [105, 108, 110].map(b => ({ blockNumber: b, index: 0, data: swapData(2500 + b - 100) }));
  const md = new MarketData({ ethers: {}, store, market: MARKET, chain: {}, clock: () => blockTs(111) });
  md.http = fakeProvider({ logs, latest: 110 });
  md.stream = { mode: 'websocket' };
  md.builder = builder(store);
  md._lastBlock = 100;

  const filling = md._fillGap();
  md._onTick({ price: 2508, volumeQuote: 0, blockNumber: 108, logIndex: 0 }); // already in the gap logs
  md._onTick({ price: 2511, volumeQuote: 0, blockNumber: 111, logIndex: 0 });
  await filling;

  assert.equal(md._lastBlock, 111);
  assert.equal(md.lastPrice, 2511);
  const [c] = store.getCandles(POOL.id, '1m', 5).slice(-1);
  assert.equal(c.swaps, 4);
});
