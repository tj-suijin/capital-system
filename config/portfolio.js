// ============================================================
// PORTFOLIO CONFIGURATION
//
// ALL NUMBERS BELOW ARE UNVALIDATED STARTING HYPOTHESES.
// They exist so the shell can run in paper mode. None of them have been
// backtested or reviewed for live capital. See docs/DECISIONS.md.
// ============================================================

export const RESERVE_ID = 'reserve';

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY || null;

export const CONFIG = {
  // paper | live. Live additionally requires bucket.mode === 'live',
  // bucket.live === true and a registered live execution adapter.
  mode: process.env.TRADING_MODE || 'paper',

  // URLs may contain the API key — never log them.
  chain: {
    name:    'base',
    chainId: 8453,
    rpcUrl:  process.env.BASE_RPC_URL || (ALCHEMY_KEY ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}` : null),
    wsUrl:   process.env.BASE_WS_URL  || (ALCHEMY_KEY ? `wss://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}` : null),
  },

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
      market: {
        pool:              'base:uniswap-v3:WETH/USDC:500',
        timeframes:        { '1m': 60_000, '5m': 300_000 },
        backfillHours:     24,      // must cover regime warm-up (200 × 5m ≈ 17h)
        maxGapFillCandles: 5,       // longer gaps are left as gaps, not invented
        outlierPct:        0.02,    // UNVALIDATED — from trading-bot
        pollIntervalMs:    10_000,  // HTTP fallback when no WebSocket URL
        staleAfterMs:      120_000, // no tick for this long → reconnect
        logChunkBlocks:    2_000,   // starting eth_getLogs range; halves on provider limits
      },
      // Ported from trading-bot. Every number is UNVALIDATED.
      strategy: {
        minConfidence: 0.55, // on strategy confidence × regime confidence
        regime: {
          timeframe:     '5m',
          minCandles:    200,
          minConfidence: 0.45,
          ema: { fast: 20, slow: 50, long: 200 },
          adx: { period: 14, trending: 25, weak: 20 },
          bb:  { period: 20, stdDev: 2, squeeze: 0.03, wide: 0.06 },
        },
        entry: { timeframe: '1m', minCandles: 60 },
        trendFollowing: {
          emaFast: 20, emaSlow: 50,
          rsiPeriod: 14, rsiMin: 40, rsiMax: 65,
          emaPullbackBuffer: 0.005,
          swingLookback: 10,
        },
        meanReversion: {
          bollingerPeriod: 20, bollingerStdDev: 2,
          rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
        },
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
