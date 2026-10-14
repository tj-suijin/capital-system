// HealthMonitor — turns bucket data health and error logs into alerts.
//
//   DATA_DOWN / DATA_UP: a bucket's health() has not been ok for
//     dataDownAlertMs (one alert per outage), and later recovered.
//   ERROR_BURST: errorBurst.count error lines within errorBurst.windowMs,
//     at most once per cooldownMs. Telegram's own errors are not counted,
//     because an unreachable Telegram would otherwise alert about itself.
//
// Alerts are emitted as 'alert' events and recorded in system_events.
// Error counts are kept in memory, so they cover only the current process.

const DEFAULTS = {
  dataDownAlertMs: 10 * 60_000,
  errorBurst:      { count: 10, windowMs: 10 * 60_000, cooldownMs: 60 * 60_000 },
};
const KEEP_ERRORS_MS = 48 * 3_600_000;
const MAX_ERRORS     = 50_000;
const IGNORED_MODS   = new Set(['TELEGRAM']);

export class HealthMonitor {
  constructor({ config = {}, store, emit, clock = Date.now }) {
    this.cfg   = { ...DEFAULTS, ...config, errorBurst: { ...DEFAULTS.errorBurst, ...config.errorBurst } };
    this.store = store;
    this.emit  = emit;
    this.clock = clock;
    this._buckets    = new Map(); // bucketId → { downSince, alerted, reason }
    this._errors     = [];        // timestamps
    this._lastBurst  = -Infinity;
  }

  checkBucket(bucket, now = this.clock()) {
    const h = bucket.health(now) ?? { ok: true };
    const s = this._buckets.get(bucket.id) ?? { downSince: null, alerted: false, reason: null };
    this._buckets.set(bucket.id, s);

    if (!h.ok) {
      if (s.downSince == null) s.downSince = now;
      s.reason = h.reason ?? 'unhealthy';
      if (!s.alerted && now - s.downSince >= this.cfg.dataDownAlertMs) {
        s.alerted = true;
        this._alert('DATA_DOWN', bucket.id, { reason: s.reason, downSince: s.downSince, downForMs: now - s.downSince }, now);
      }
      return;
    }
    if (s.downSince != null) {
      if (s.alerted) this._alert('DATA_UP', bucket.id, { downSince: s.downSince, downForMs: now - s.downSince }, now);
      s.downSince = null;
      s.alerted   = false;
      s.reason    = null;
    }
  }

  onError(e) {
    if (IGNORED_MODS.has(e.mod)) return;
    const now = e.ts ?? this.clock();
    this._errors.push(now);
    if (this._errors.length > MAX_ERRORS || now - this._errors[0] > KEEP_ERRORS_MS) {
      this._errors = this._errors.filter(t => now - t <= KEEP_ERRORS_MS).slice(-MAX_ERRORS);
    }
    const { count, windowMs, cooldownMs } = this.cfg.errorBurst;
    const recent = this.errorsSince(now - windowMs);
    if (recent >= count && now - this._lastBurst >= cooldownMs) {
      this._lastBurst = now;
      this._alert('ERROR_BURST', null, { count: recent, windowMs, lastMod: e.mod, lastMsg: e.msg, lastCode: e.code }, now);
    }
  }

  errorsSince(sinceMs) {
    let n = 0;
    for (let i = this._errors.length - 1; i >= 0 && this._errors[i] >= sinceMs; i--) n++;
    return n;
  }

  _alert(type, bucketId, detail, ts) {
    this.store.insertEvent({ type, bucketId, detail, ts });
    this.emit('alert', { type, bucketId, ...detail, ts });
  }
}

export default HealthMonitor;
