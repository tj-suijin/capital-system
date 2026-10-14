// ControlApi — the single query/command surface for every operator interface.
// Telegram uses it today; the future GUI (via a local HTTP/WebSocket server)
// will use the same methods and events. Nothing outside src/portfolio should
// call PortfolioManager directly.
//
// There is deliberately no command that enables live trading.

export const EVENTS = ['decision', 'fill', 'close', 'risk', 'heartbeat', 'control'];

export class ControlApi {
  constructor({ portfolio, store }) {
    this.pm    = portfolio;
    this.store = store;
  }

  // ---- Queries ----
  getStatus() {
    return this.pm.status();
  }

  listBuckets() {
    return this.pm.status().buckets.map(({ id, name, mode, paused, equityUsd, openPositions }) =>
      ({ id, name, mode, paused, equityUsd, openPositions }));
  }

  getDecisions({ bucketId = null, limit = 20 } = {}) {
    return this.store.getRecentDecisions(limit, bucketId);
  }

  getTrades({ bucketId = null, limit = 20 } = {}) {
    return this.store.getRecentTrades(limit, bucketId);
  }

  getOpenPositions({ bucketId = null } = {}) {
    return this.store.getOpenPositions(bucketId);
  }

  getEquityHistory({ bucketId = 'portfolio', sinceMs = 0, limit = 2000 } = {}) {
    return this.store.getEquityHistory(bucketId, sinceMs, limit);
  }

  // ---- Commands ----
  pause(bucketId, reason = 'operator pause') {
    this.pm.pauseBucket(bucketId, reason);
  }

  resume(bucketId) {
    this.pm.resumeBucket(bucketId);
  }

  windDown(on = true) {
    this.pm.setWindDown(on);
  }

  halt(reason = 'operator halt') {
    this.pm.halt(reason);
  }

  unhalt() {
    this.pm.unhalt();
  }

  // ---- Events ----
  // Returns an unsubscribe function.
  on(event, handler) {
    if (!EVENTS.includes(event)) throw new Error(`Unknown event: ${event}`);
    this.pm.events.on(event, handler);
    return () => this.pm.events.off(event, handler);
  }
}

export default ControlApi;
