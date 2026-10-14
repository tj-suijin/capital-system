// PriceStream — live pool prices.
//   WebSocket mode: subscribes to Swap logs (every swap is a tick).
//   Poll mode:      reads slot0() every pollIntervalMs (no volume, no gap fill).
//
// A watchdog reconnects the WebSocket if no swap arrives for staleAfterMs.
// Reconnects back off up to 60s and never give up.
//
// Events:
//   'tick'        { price, volumeQuote, blockNumber, logIndex }
//   'reconnected' {}   — WebSocket re-subscribed; the caller may fill the gap
import { EventEmitter } from 'node:events';
import { E } from '../shared/errors.js';
import { createLogger } from '../shared/logger.js';
import { SWAP_TOPIC, decodeSwapData, readPoolPrice } from './uniswapV3.js';

const MAX_BACKOFF_MS = 60_000;

export class PriceStream extends EventEmitter {
  constructor({ ethers, pool, wsUrl, httpProvider, pollIntervalMs, staleAfterMs, clock = Date.now }) {
    super();
    this.ethers         = ethers;
    this.pool           = pool;
    this.wsUrl          = wsUrl;
    this.http           = httpProvider;
    this.pollIntervalMs = pollIntervalMs;
    this.staleAfterMs   = staleAfterMs;
    this.clock          = clock;
    this.log            = createLogger('STREAM');
    this.mode           = wsUrl ? 'websocket' : 'poll';
    this.ws             = null;
    this.running        = false;
    this.lastTickAt     = null;
    this.reconnects     = 0;
    this._attempt       = 0;
    this._timers        = [];
    this._reconnecting  = false;
  }

  async start() {
    this.running = true;
    if (this.mode === 'poll') {
      this.log.warn({ everyMs: this.pollIntervalMs }, 'No WebSocket URL — polling slot0()');
      this._poll();
      this._timers.push(setInterval(() => this._poll(), this.pollIntervalMs));
      return;
    }
    await this._connect();
    this._timers.push(setInterval(() => this._watchdog(), Math.max(5_000, this.staleAfterMs / 4)));
  }

  async stop() {
    this.running = false;
    for (const t of this._timers) { clearInterval(t); clearTimeout(t); }
    this._timers = [];
    await this._destroyWs();
  }

  status() {
    return { mode: this.mode, running: this.running, lastTickAt: this.lastTickAt, reconnects: this.reconnects };
  }

  // ------------------------------------------------------------ websocket

  async _connect() {
    await this._destroyWs();
    const ws = new this.ethers.WebSocketProvider(this.wsUrl);
    this.ws = ws;
    const sock = ws.websocket;
    const onDown = () => { if (this.running && this.ws === ws) this._scheduleReconnect('socket closed'); };
    if (sock?.addEventListener) {
      sock.addEventListener('close', onDown);
      sock.addEventListener('error', onDown);
    } else {
      sock?.on?.('close', onDown);
      sock?.on?.('error', onDown);
    }

    await ws.getBlockNumber(); // fails fast if the socket cannot connect
    await ws.on({ address: this.pool.address, topics: [SWAP_TOPIC] }, l => this._onLog(l));
    this.lastTickAt = this.clock();
    this._attempt = 0;
    this.log.info({ pool: this.pool.id }, 'Subscribed to swaps');
  }

  _onLog(l) {
    if (l.removed) return;
    let decoded;
    try {
      decoded = decodeSwapData(l.data, this.pool);
    } catch (err) {
      this.log.error({ code: E.DATA_STREAM.code, err: err.message }, 'Swap decode failed');
      return;
    }
    this.lastTickAt = this.clock();
    this.emit('tick', { ...decoded, blockNumber: l.blockNumber, logIndex: l.index ?? 0 });
  }

  _watchdog() {
    if (!this.running || this._reconnecting) return;
    if (this.clock() - this.lastTickAt > this.staleAfterMs) {
      this._scheduleReconnect(`no swaps for ${Math.round((this.clock() - this.lastTickAt) / 1000)}s`);
    }
  }

  _scheduleReconnect(reason) {
    if (this._reconnecting || !this.running) return;
    this._reconnecting = true;
    this._attempt++;
    const delay = Math.min(5_000 * this._attempt, MAX_BACKOFF_MS);
    this.log.warn({ code: E.DATA_STREAM.code, reason, attempt: this._attempt, delayMs: delay }, 'Reconnecting price stream');
    const t = setTimeout(async () => {
      try {
        await this._connect();
        this.reconnects++;
        this._reconnecting = false;
        this.emit('reconnected', {});
      } catch (err) {
        this.log.error({ code: E.DATA_STREAM.code, err: err.message }, 'Reconnect failed');
        this._reconnecting = false;
        this._scheduleReconnect('retry');
      }
    }, delay);
    this._timers.push(t);
  }

  async _destroyWs() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try { await ws.destroy(); } catch { /* already closed */ }
  }

  // ----------------------------------------------------------------- poll

  async _poll() {
    if (!this.running) return;
    try {
      const price = await readPoolPrice(this.ethers, this.http, this.pool);
      this.lastTickAt = this.clock();
      this.emit('tick', { price, volumeQuote: 0, blockNumber: null, logIndex: 0 });
    } catch (err) {
      this.log.error({ code: E.DATA_STREAM.code, err: err.message }, 'Poll failed');
    }
  }
}

export default PriceStream;
