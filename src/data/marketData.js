// MarketData — one pool's verified price feed and candle history.
//
//   start(): verify pool on-chain → backfill candles → live stream
//   After a WebSocket reconnect, missed swaps are fetched with eth_getLogs
//   while live ticks are buffered, then the buffer is replayed.
//
// Events:
//   'candle' { timeframe, candle }  — a candle completed (including flat gap fills)
//   'price'  { price, ts }
import { EventEmitter } from 'node:events';
import { E, TradingError } from '../shared/errors.js';
import { createLogger } from '../shared/logger.js';
import { backfill, fetchSwapTicks } from './backfill.js';
import { CandleBuilder } from './candleBuilder.js';
import { PriceStream } from './priceStream.js';
import { getPool, verifyPool } from './uniswapV3.js';

export class MarketData extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ethers  — the ethers module (injected for testing)
   * @param {Store}  opts.store
   * @param {object} opts.market  — bucket market config
   * @param {object} opts.chain   — { chainId, rpcUrl, wsUrl }
   */
  constructor({ ethers, store, market, chain, clock = Date.now }) {
    super();
    this.ethers     = ethers;
    this.store      = store;
    this.market     = market;
    this.chain      = chain;
    this.clock      = clock;
    this.pool       = getPool(market.pool);
    this.log        = createLogger('MARKET');
    this.lastPrice  = null;
    this.lastTickAt = null;
    this._lastBlock = null;
    this._buffer    = null;
    this.stream     = null;
    this.http       = null;
    this.builder    = null;
    this.backfillStats = null;
  }

  async start() {
    if (!this.chain.rpcUrl) throw new TradingError(E.DATA_NO_RPC);
    this.http = new this.ethers.JsonRpcProvider(this.chain.rpcUrl, this.chain.chainId, { staticNetwork: true });

    const price = await verifyPool(this.ethers, this.http, this.pool);
    this.log.info({ pool: this.pool.id, address: this.pool.address, price: +price.toFixed(2) }, 'Pool verified on-chain');
    this.lastPrice = price;

    this.backfillStats = await backfill({ provider: this.http, store: this.store, pool: this.pool, market: this.market, clock: this.clock });
    this._lastBlock = this.backfillStats.toBlock;

    this.builder = new CandleBuilder({
      store: this.store, pool: this.pool, timeframes: this.market.timeframes,
      outlierPct: this.market.outlierPct, maxGapFillCandles: this.market.maxGapFillCandles,
      onClose: (timeframe, candle) => this.emit('candle', { timeframe, candle }),
    });
    this.builder.resume();

    this.stream = new PriceStream({
      ethers: this.ethers, pool: this.pool, wsUrl: this.chain.wsUrl, httpProvider: this.http,
      pollIntervalMs: this.market.pollIntervalMs, staleAfterMs: this.market.staleAfterMs, clock: this.clock,
    });
    this.stream.on('tick', t => this._onTick(t));
    this.stream.on('reconnected', () => this._fillGap());
    await this.stream.start();
    this._fillGap();
  }

  async stop() {
    await this.stream?.stop();
    this.builder?.flush();
    this.http?.destroy();
  }

  // Most recent `limit` candles, oldest first (the last one may be in progress).
  getCandles(timeframe, limit) {
    return this.store.getCandles(this.pool.id, timeframe, limit);
  }

  isStale(now = this.clock()) {
    return this.lastTickAt == null || now - this.lastTickAt > this.market.staleAfterMs;
  }

  status() {
    return {
      pool:       this.pool.id,
      lastPrice:  this.lastPrice,
      lastTickAt: this.lastTickAt,
      stale:      this.isStale(),
      stream:     this.stream?.status() ?? null,
      rejected:   this.builder?.rejected ?? 0,
    };
  }

  _onTick(t) {
    const tick = { ...t, ts: this.clock() };
    if (this._buffer) this._buffer.push(tick);
    else this._apply(tick);
  }

  _apply(t) {
    if (t.blockNumber != null) {
      if (this._lastBlock != null && t.blockNumber < this._lastBlock) return;
      this._lastBlock = t.blockNumber;
    }
    if (!this.builder.tick(t.price, t.ts, t.volumeQuote)) return;
    this.builder.flush();
    this.lastPrice  = t.price;
    this.lastTickAt = t.ts;
    this.emit('price', { price: t.price, ts: t.ts });
  }

  // Fetch swaps between the last block seen and now, then replay buffered live ticks.
  async _fillGap() {
    if (this._buffer || this._lastBlock == null || this.stream?.mode !== 'websocket') return;
    this._buffer = [];
    const from = this._lastBlock + 1;
    try {
      const latest = await this.http.getBlockNumber();
      if (latest >= from) {
        const { ticks } = await fetchSwapTicks(this.http, this.pool, from, latest, { chunkBlocks: this.market.logChunkBlocks });
        for (const t of ticks) this._apply(t);
        this._lastBlock = Math.max(this._lastBlock, latest);
        if (ticks.length) this.log.info({ from, to: latest, swaps: ticks.length }, 'Filled stream gap');
      }
    } catch (err) {
      this.log.error({ code: E.DATA_BACKFILL.code, err: err.message }, 'Gap fill failed');
    } finally {
      const buffered = this._buffer;
      this._buffer = null;
      for (const t of buffered) {
        if (t.blockNumber != null && t.blockNumber <= this._lastBlock) continue;
        this._apply(t);
      }
    }
  }
}

export default MarketData;
