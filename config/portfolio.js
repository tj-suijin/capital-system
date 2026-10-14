// ============================================================
// PORTFOLIO CONFIGURATION
//
// ALL NUMBERS BELOW ARE UNVALIDATED STARTING HYPOTHESES.
// They exist so the shell can run in paper mode. None of them have been
// backtested or reviewed for live capital. See docs/DECISIONS.md.
// ============================================================

export const RESERVE_ID = 'reserve';

export const CONFIG = {
  // paper | live. Live additionally requires bucket.mode === 'live',
  // bucket.live === true and a registered live execution adapter.
  mode: process.env.TRADING_MODE || 'paper',

  capital: {
    totalUsd: 1000, // UNVALIDATED — paper capital
  },

  // Capital not assigned to a bucket sits in the reserve and is never traded.
  buckets: {
    liquidDirectional: {
      enabled:            true,
      name:               'Liquid Directional',
      mode:               'paper', // paper | shadow | live
      live:               false,
      allocationPct:      0.60,    // UNVALIDATED
      evaluateIntervalMs: 60_000,
      risk: {
        maxConcurrentPositions: 2,    // UNVALIDATED
        maxPositionPctOfBucket: 0.10, // UNVALIDATED
        maxRiskPerTradePct:     0.01, // UNVALIDATED — from trading-bot
        dailyLossLimitPct:      0.05, // UNVALIDATED — of bucket allocation
      },
    },
    degenMemecoin: {
      enabled:            true,
      name:               'Degen Memecoin',
      mode:               'paper',
      live:               false,
      paperOnly:          true,    // live is rejected outright
      allocationPct:      0.03,    // UNVALIDATED
      evaluateIntervalMs: 60_000,
      risk: {
        maxConcurrentPositions: 1,    // UNVALIDATED
        maxPositionPctOfBucket: 0.25, // UNVALIDATED
        maxRiskPerTradePct:     0.05, // UNVALIDATED
        dailyLossLimitPct:      0.10, // UNVALIDATED
      },
    },
  },

  globalRisk: {
    dailyLossLimitPct:   0.03, // UNVALIDATED — rolling 24h realized loss vs high-water mark
    weeklyLossLimitPct:  0.08, // UNVALIDATED — rolling 7d realized loss vs high-water mark
    maxDrawdownPct:      0.15, // UNVALIDATED — hard halt, manual unhalt required
    maxGrossExposurePct: 0.50, // UNVALIDATED — open notional / total equity
  },

  paper: {
    feePct:      0.0005, // UNVALIDATED — Uniswap 0.05% tier
    slippagePct: 0.001,  // UNVALIDATED
  },

  heartbeatIntervalMs: 5 * 60_000,

  db:  { path: process.env.DB_PATH || './data/capital.db' },
  log: { level: process.env.LOG_LEVEL || 'info', dir: './logs' },
};

export default CONFIG;
