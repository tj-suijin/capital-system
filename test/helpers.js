import { Bucket } from '../src/buckets/bucket.js';
import { noTrade } from '../src/buckets/intent.js';
import { BucketRegistry } from '../src/buckets/registry.js';
import { openStore } from '../src/persistence/db.js';
import { PortfolioManager } from '../src/portfolio/portfolioManager.js';

export function testConfig(overrides = {}) {
  const base = {
    mode: 'paper',
    capital: { totalUsd: 1000 },
    buckets: {
      alpha: {
        enabled: true, name: 'Alpha', mode: 'paper', live: false, allocationPct: 0.60, evaluateIntervalMs: 60_000,
        risk: { maxConcurrentPositions: 2, maxPositionPctOfBucket: 0.10, maxRiskPerTradePct: 0.01, dailyLossLimitPct: 0.05 },
      },
      beta: {
        enabled: true, name: 'Beta', mode: 'paper', live: false, paperOnly: true, allocationPct: 0.03, evaluateIntervalMs: 60_000,
        risk: { maxConcurrentPositions: 1, maxPositionPctOfBucket: 0.25, maxRiskPerTradePct: 0.05, dailyLossLimitPct: 0.10 },
      },
    },
    globalRisk: { dailyLossLimitPct: 0.03, weeklyLossLimitPct: 0.08, maxDrawdownPct: 0.15, maxGrossExposurePct: 0.50 },
    paper: { feePct: 0, slippagePct: 0 },
    heartbeatIntervalMs: 300_000,
  };
  return deepMerge(base, overrides);
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object'
      ? deepMerge(a[k], v)
      : v;
  }
  return out;
}

// A bucket whose next answers are queued by the test.
export class ScriptedBucket extends Bucket {
  constructor(opts) {
    super(opts);
    this.entries = [];
    this.exits   = [];
    this.marks   = {}; // symbol → price, or a function that throws
  }
  markPrice(symbol, now) {
    const m = this.marks[symbol];
    if (typeof m === 'function') return m();
    return m == null ? null : { price: m, ts: now };
  }
  async evaluate() {
    return this.entries.shift() ?? noTrade('script empty');
  }
  async reviewPositions() {
    const out = this.exits;
    this.exits = [];
    return out;
  }
}

export function fakeClock(start = Date.UTC(2026, 9, 13)) {
  let t = start;
  const clock = () => t;
  clock.advance = ms => { t += ms; };
  return clock;
}

export function makePortfolio({ config = testConfig(), clock = fakeClock(), store = openStore(':memory:'), liveAdapters } = {}) {
  const registry = new BucketRegistry();
  for (const [id, cfg] of Object.entries(config.buckets)) {
    if (cfg.enabled) registry.register(new ScriptedBucket({ id, config: cfg }));
  }
  const pm = new PortfolioManager({ config, store, registry, clock, liveAdapters });
  return { pm, store, registry, clock, config };
}
