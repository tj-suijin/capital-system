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
    totalUsd: 4000, // UNVALIDATED — paper capital (user's choice for the 7-day paper run)
  },

  // The long paper run (bucket 1 part 5). Used for the "day N of 7" in digests and the report.
  paperRun: {
    days: 7,
  },

  alerts: {
    digestTimes:     ['08:00', '21:00'], // local time of this machine
    dataDownAlertMs: 10 * 60_000,        // alert when a bucket's feed has been down this long
    errorBurst:      { count: 10, windowMs: 10 * 60_000, cooldownMs: 60 * 60_000 },
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
        cooldownAfterStopMs:    15 * 60_000, // UNVALIDATED — three 5m candles, so the regime can catch up
        minEntrySpacingMs:      10 * 60_000, // UNVALIDATED — between entries on the same side
        noEntryWhileLosing:     true,        // no adding to a position that is under water
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
      trade: {
        symbol:           'ETH/USDC',
        maxHoldMs:        4 * 3_600_000, // user's choice — UNVALIDATED
        minStopPct:       0.003,  // UNVALIDATED — tighter strategy stops are widened to this
        maxStopPct:       0.03,   // UNVALIDATED — wider strategy stops are tightened to this
        minTargetPct:     0.004,  // UNVALIDATED — targets closer than this don't cover round-trip costs
        marketRetryMs:    60_000, // retry interval if market data fails to start
        // No entries while a 1m candle (the forming one or one of the last
        // calmCandles) has a high-low range of at least
        // max(minRangePct, avgMultiple × the average of the lookback candles before).
        // UNVALIDATED — picked from 2 days of candles (Oct 13–14, 2026): about 1.6% of minutes blocked.
        fastMove: { minRangePct: 0.004, avgMultiple: 3, lookback: 60, calmCandles: 5 },
      },
      // Ported from trading-bot. Every number is UNVALIDATED.
      strategy: {
        minConfidence:      0.55, // on strategy confidence × regime confidence (shadow and live)
        paperMinConfidence: 0.45, // UNVALIDATED — user's choice for the paper run; used only in paper mode
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
        cooldownAfterStopMs:    15 * 60_000, // UNVALIDATED
        minEntrySpacingMs:      10 * 60_000, // UNVALIDATED
        noEntryWhileLosing:     true,
      },
    },
    // Not a strategy. Opens a small ETH/USDC position on a fixed schedule so the
    // open, close, restart and alert paths (and its own position cap and daily
    // loss limit) are exercised during the paper run. Expected to lose its costs.
    exerciser: {
      enabled:            true,
      name:               'Exerciser (test only)',
      mode:               'paper',
      live:               false,
      paperOnly:          true,
      allocationPct:      0.02,
      evaluateIntervalMs: 60_000,
      feed:               'liquidDirectional', // uses this bucket's price feed; must be listed before it
      // No cooldown, spacing or losing-position rules: the fixed schedule is the test.
      risk: {
        maxConcurrentPositions: 2,
        maxPositionPctOfBucket: 0.40,
        maxRiskPerTradePct:     0.05,
        dailyLossLimitPct:      0.02,
      },
      trade: {
        symbol:    'ETH/USDC',
        sizeUsd:   30,
        everyMs:   30 * 60_000, // one entry attempt per wall-clock slot (:00 and :30)
        stopPct:   0.003,
        targetPct: 0.003,
        maxHoldMs: 75 * 60_000,
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
    feePct:             0.0005, // UNVALIDATED — Uniswap 0.05% tier
    slippagePct:        0.001,  // UNVALIDATED — base slippage
    rangeSlippageShare: 0.25,   // UNVALIDATED — plus this share of the bucket's recent 1m range; only live fills can check it
  },

  heartbeatIntervalMs: 5 * 60_000,

  db:  { path: process.env.DB_PATH || './data/capital.db' },
  log: { level: process.env.LOG_LEVEL || 'info', dir: './logs' },
};

export default CONFIG;
