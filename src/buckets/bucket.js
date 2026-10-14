// Bucket base class. A bucket owns strategy logic only: it never sizes,
// never touches capital, and never calls an executor directly.
import { noTrade } from './intent.js';

export class Bucket {
  /**
   * @param {object} opts
   * @param {string} opts.id      — must match a key in config.buckets
   * @param {object} opts.config  — that bucket's config block
   */
  constructor({ id, config }) {
    this.id     = id;
    this.name   = config.name ?? id;
    this.config = config;
    this.mode   = config.mode ?? 'paper'; // paper | shadow | live
  }

  async start(_ctx) {}
  async stop() {}

  // Return noTrade(reason) or tradeIntent({...}).
  async evaluate(_ctx) {
    return noTrade('evaluate() not implemented');
  }

  // Return an array of closeRequest({...}) for positions that should exit.
  async reviewPositions(_openPositions, _ctx) {
    return [];
  }

  // Latest trusted price for a symbol this bucket trades: { price, ts } or null.
  // null means open positions in that symbol are valued at cost.
  markPrice(_symbol, _now) {
    return null;
  }

  // Data health for alerting: { ok, reason? }. A bucket that is not ok for
  // config.alerts.dataDownAlertMs triggers a DATA_DOWN alert.
  health(_now) {
    return { ok: true };
  }

  onFill(_position) {}
  onClose(_position) {}

  status() {
    return {};
  }
}

export default Bucket;
