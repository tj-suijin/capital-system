// Backfill — rebuilds candles from historical Swap logs (eth_getLogs).
//
// Timestamps are interpolated linearly between the first and last block of
// the range, which is accurate on Base's fixed 2-second blocks.
import { E, TradingError } from '../shared/errors.js';
import { createLogger } from '../shared/logger.js';
import { CandleBuilder } from './candleBuilder.js';
import { SWAP_TOPIC, decodeSwapData } from './uniswapV3.js';

const log = createLogger('BACKFILL');

const BASE_BLOCK_MS   = 2000;
const BLOCK_MARGIN    = 30;
const MIN_CHUNK       = 5;
const MAX_RATE_RETRY  = 6;

const RANGE_ERR = /block range|response size|too many|query returned more than|range is too large|limit exceeded/i;
const RATE_ERR  = /429|rate limit|capacity|compute units|request limit|too many requests/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function errText(err) {
  return [err?.message, err?.error?.message, err?.info?.error?.message, err?.shortMessage].filter(Boolean).join(' | ');
}

/**
 * Fetch and decode Swap logs in [fromBlock, toBlock], oldest first.
 * Returns { ticks: [{ price, volumeQuote, blockNumber, logIndex, ts }], chunkBlocks }.
 */
export async function fetchSwapTicks(provider, pool, fromBlock, toBlock, { chunkBlocks = 2000, sleepFn = sleep } = {}) {
  if (toBlock < fromBlock) return { ticks: [], chunkBlocks };

  const [first, last] = await Promise.all([provider.getBlock(fromBlock), provider.getBlock(toBlock)]);
  const t0 = first.timestamp * 1000;
  const msPerBlock = toBlock > fromBlock ? (last.timestamp * 1000 - t0) / (toBlock - fromBlock) : 0;

  const ticks = [];
  let chunk = chunkBlocks;
  let cur = fromBlock;
  let rateRetries = 0;
  let lastReport = Date.now();

  while (cur <= toBlock) {
    const end = Math.min(cur + chunk - 1, toBlock);
    let logs;
    try {
      logs = await provider.getLogs({ address: pool.address, topics: [SWAP_TOPIC], fromBlock: cur, toBlock: end });
    } catch (err) {
      const text = errText(err);
      if (RANGE_ERR.test(text) && chunk > MIN_CHUNK) {
        chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2));
        log.warn({ chunkBlocks: chunk }, 'Provider rejected log range — shrinking chunk');
        continue;
      }
      if (RATE_ERR.test(text) && rateRetries < MAX_RATE_RETRY) {
        rateRetries++;
        await sleepFn(1000 * 2 ** (rateRetries - 1));
        continue;
      }
      throw new TradingError(E.DATA_BACKFILL, `blocks ${cur}-${end}: ${text}`);
    }
    rateRetries = 0;

    for (const l of logs) {
      if (l.removed) continue;
      let decoded;
      try { decoded = decodeSwapData(l.data, pool); } catch { continue; }
      ticks.push({ ...decoded, blockNumber: l.blockNumber, logIndex: l.index ?? l.logIndex ?? 0, ts: Math.round(t0 + (l.blockNumber - fromBlock) * msPerBlock) });
    }
    cur = end + 1;

    if (Date.now() - lastReport > 10_000) {
      lastReport = Date.now();
      log.info({ pct: Math.round(((cur - fromBlock) / (toBlock - fromBlock + 1)) * 100), swaps: ticks.length }, 'Backfill progress');
    }
  }

  ticks.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  return { ticks, chunkBlocks: chunk };
}

/**
 * Bring stored candles up to date. Starts from the beginning of the last
 * stored candle of the largest timeframe (so it is rebuilt whole), or from
 * backfillHours ago, whichever is later.
 */
export async function backfill({ provider, store, pool, market, clock = Date.now, sleepFn }) {
  const largestMs = Math.max(...Object.values(market.timeframes));
  const largestTf = Object.entries(market.timeframes).find(([, ms]) => ms === largestMs)[0];
  const now = clock();
  const horizon = Math.floor((now - market.backfillHours * 3_600_000) / largestMs) * largestMs;
  const lastStored = store.getLastCandle(pool.id, largestTf);
  const fromTs = lastStored && lastStored.ts > horizon ? lastStored.ts : horizon;

  const latest = await provider.getBlockNumber();
  const latestBlock = await provider.getBlock(latest);
  const behindBlocks = Math.ceil((latestBlock.timestamp * 1000 - fromTs) / BASE_BLOCK_MS);
  const fromBlock = Math.max(0, latest - behindBlocks - BLOCK_MARGIN);

  log.info({ pool: pool.id, fromTs: new Date(fromTs).toISOString(), blocks: latest - fromBlock + 1 }, 'Backfill starting');
  const started = Date.now();
  const { ticks, chunkBlocks } = await fetchSwapTicks(provider, pool, fromBlock, latest, { chunkBlocks: market.logChunkBlocks, sleepFn });

  const builder = new CandleBuilder({
    store, pool, timeframes: market.timeframes,
    outlierPct: market.outlierPct, maxGapFillCandles: market.maxGapFillCandles,
  });
  builder.resume(fromTs);
  let accepted = 0;
  for (const t of ticks) {
    if (t.ts < fromTs) continue;
    if (builder.tick(t.price, t.ts, t.volumeQuote)) accepted++;
  }
  builder.flush();

  const stats = { fromBlock, toBlock: latest, swaps: ticks.length, accepted, rejected: builder.rejected, chunkBlocks, ms: Date.now() - started };
  log.info(stats, 'Backfill complete');
  return stats;
}
