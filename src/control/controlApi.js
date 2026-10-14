// ControlApi — the single query/command surface for every operator interface.
// Telegram uses it today; the future GUI (via a local HTTP/WebSocket server)
// will use the same methods and events. Nothing outside src/portfolio should
// call PortfolioManager directly.
//
// There is deliberately no command that enables live trading.
import { summarizeWindow } from '../portfolio/runSummary.js';

export const EVENTS = ['decision', 'fill', 'close', 'risk', 'heartbeat', 'control', 'alert'];

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

  // Each position carries priced, markPrice, markTs, markAgeMs, heldMs, valueUsd and unrealizedPnlUsd.
  getOpenPositions({ bucketId = null } = {}) {
    return this.pm.openPositions(bucketId);
  }

  getEquityHistory({ bucketId = 'portfolio', sinceMs = 0, limit = 2000 } = {}) {
    return this.store.getEquityHistory(bucketId, sinceMs, limit);
  }

  // { startedAt, days, day, endsAt, complete } for the current paper run.
  getRunInfo() {
    return this.pm.runInfo();
  }

  // { previousExit: 'first' | 'clean' | 'unclean', pid, openPositions } for this process, or null.
  getStartInfo() {
    return this.pm.startInfo;
  }

  // What happened between sinceMs and untilMs (see runSummary.js), plus the
  // live feed health and error count, which only cover the current process.
  getRunSummary({ sinceMs, untilMs = this.pm.clock() + 1 }) {
    const summary = summarizeWindow({ store: this.store, sinceMs, untilMs });
    summary.health = Object.fromEntries(this.pm.registry.list().map(b => [b.id, b.health(untilMs)]));
    summary.errorsLogged = this.pm.health.errorsSince(sinceMs);
    summary.memoryMb = Math.round(process.memoryUsage().rss / 1048576);
    return summary;
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
