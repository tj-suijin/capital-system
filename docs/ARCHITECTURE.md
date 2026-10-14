# Architecture

This describes the code as it stands after v1 step 1 (the portfolio shell). The reasons behind the choices are in `DECISIONS.md`.

## Shape

```
src/index.js
 └── PortfolioManager                    src/portfolio/portfolioManager.js
      ├── CapitalAllocator               src/portfolio/capitalAllocator.js
      ├── GlobalRiskEngine               src/risk/globalRisk.js
      ├── BucketRisk                     src/risk/bucketRisk.js
      ├── sizePosition                   src/risk/positionSizer.js
      ├── BucketRegistry → buckets       src/buckets/
      ├── executors (one per bucket)     src/execution/
      └── events (EventEmitter)
 ControlApi                              src/control/controlApi.js
 └── TelegramControl                     src/alerts/telegram.js
 Store (SQLite)                          src/persistence/db.js
```

## The rule of ownership

- **A bucket owns strategy logic only.** It reads data and answers either `noTrade(reason)` or `tradeIntent({...})`. It never sizes a trade, never touches capital and never calls an executor.
- **The portfolio manager owns everything after that:** sizing, risk checks, capital, execution, persistence and events.
- **Operators reach the system only through `ControlApi`.** Telegram is a thin client of it, and the future GUI will be too.

## The pipeline

Each bucket runs on its own timer (`evaluateIntervalMs`, 60 seconds by default). A cycle does two things, in this order.

**1. Review exits.** The bucket gets its open positions and may return `closeRequest`s. Closes always go through. Halts, pauses and wind-down never block an exit, because closing reduces risk.

**2. Evaluate an entry.** The bucket's answer goes through these stages. The first one that says no ends the attempt.

| Stage | Checks |
| --- | --- |
| portfolio | Not halted, not winding down |
| sizer | Size greater than zero after all caps |
| bucket risk | Not paused, under max concurrent positions, under max position size, under the bucket's daily loss limit |
| global risk | Under the 24h and 7d loss limits, under the gross exposure cap |
| shadow | In shadow mode, stop here and log what would have happened |
| allocator | Enough free cash in the bucket's ledger; the capital is locked |
| executor | Fill (paper or live). On failure, the capital is released |

Every outcome is written to the `decisions` table and emitted as a `decision` event:

- `NO_TRADE`: the bucket saw no setup. This is normal and expected.
- `REJECTED`: a stage said no. The stage and an error code are recorded.
- `SHADOW`: every check passed, but no capital moved.
- `APPROVED`: a position was opened.
- `ERROR`: the bucket's cycle threw an exception.

## Sizing

```
size = bucketEquity × maxPositionPctOfBucket × confidence
size = min(size, requestedUsd)                                   if the bucket asked for a size
size = min(size, bucketEquity × maxRiskPerTradePct / stopLoss)   if a stop loss is given
size = min(size, free cash)
```

## Capital

Each bucket has a persisted ledger with four fields: allocated, cash, in use, and realized P&L. Equity is cash plus in use. Positions are valued **at cost** until a price feed exists. Capital not given to any bucket sits in the `reserve` ledger, which can never open a position.

Ledgers are created on first run from `config/portfolio.js`. After that they are the source of truth. Changing percentages in config only logs a warning.

## Risk

**Global** (`GlobalRiskEngine`):
- The high-water mark updates whenever equity rises.
- If realized losses over the last 24 hours or 7 days exceed their limits, new entries are blocked. The block clears itself as the window rolls forward.
- If drawdown from the high-water mark reaches the limit, a persisted **halt** is set. Only `unhalt` clears it, and unhalting resets the high-water mark to current equity so the halt does not immediately trip again.
- Gross exposure is open notional divided by total equity, and a new entry may not push it over the cap.

**Per bucket** (`BucketRisk`): pause state, max concurrent positions, max position size, and a daily loss limit measured against the bucket's allocation.

## Modes and the live gate

Each bucket has a mode:
- `paper`: the shared `PaperExecutor`, which simulates fee and slippage.
- `shadow`: no executor; the pipeline stops at the shadow stage.
- `live`: a real adapter, allowed only if all four conditions hold: `TRADING_MODE=live`, the bucket has `live: true`, the bucket is not `paperOnly`, and a live adapter is registered for it. If any condition fails, startup fails. No live adapter exists yet, and `liveExecutor.js` is a stub that refuses to trade.

## Execution adapters

`ExecutionAdapter` defines `open()` and `close()`. There will be one adapter per venue: Uniswap V3/V4 on Base for bucket 1, and a Solana venue for the degen bucket later.

## Persistence

SQLite through `node:sqlite`. The tables are:

| Table | Holds |
| --- | --- |
| `buckets` | Registered buckets and their modes |
| `ledger` | One capital ledger per bucket plus the reserve |
| `positions` | Open and closed positions |
| `trades` | Every open and close fill |
| `decisions` | Every pipeline outcome |
| `risk_state` | Global halt and high-water mark, per-bucket pause |
| `settings` | Wind-down flag and other switches |
| `equity_snapshots` | Per-bucket and portfolio equity, taken at every heartbeat |
| `candles` | OHLC, quote volume and swap count per pool, timeframe and interval |

## Events

`PortfolioManager.events` emits `decision`, `fill`, `close`, `risk`, `heartbeat` and `control`. `ControlApi.on()` exposes the same events and returns an unsubscribe function.

## Heartbeat

Every 5 minutes the manager refreshes global risk, writes equity snapshots, and logs equity, drawdown, halt state and decision counts.

## Market data (bucket 1)

`src/data/` is a shared service. A bucket gets a `MarketData` instance for its pool.

```
MarketData.start()
  verifyPool       pool address, token order and fee checked against the Uniswap factory
  backfill         eth_getLogs swap history → candles (24h, or from the last stored candle)
  PriceStream      WebSocket swap subscription, or slot0() polling without a WebSocket URL
  CandleBuilder    swaps → 1m and 5m candles in the `candles` table
```

- **Prices** are decoded from each swap's `sqrtPriceX96` (`uniswapV3.js`) and quoted as ETH in USDC. Quote volume comes from the USDC leg of the swap.
- **Outliers:** a price more than 2% from the median of the last 21 prices is dropped. Prices outside the pool's sanity band (\$100 to \$100,000) are also dropped.
- **Gaps:** up to 5 missing candles are filled flat, marked by `swaps = 0`. Longer gaps stay empty, and `isContiguous()` lets callers detect them.
- **Reconnects:** a watchdog reconnects after 2 minutes without swaps. After reconnecting, the missed blocks are fetched with `eth_getLogs`, live ticks are buffered meanwhile, and duplicates are dropped by block number.
- **Events:** `candle` fires when a candle completes, and `price` fires on each accepted swap.

`npm run market` runs this on its own and logs the analyst's view at every closed 1-minute candle.

## Bucket 1 analysis

`src/analysis/indicators.js` holds pure indicator math: EMA, Wilder RSI, MACD, Bollinger Bands, Wilder ADX and swing low.

`src/buckets/liquidDirectional/` holds the strategy logic. It's all pure functions that take candles and parameters:

| Regime (5m candles) | Strategy (1m candles) |
| --- | --- |
| `TRENDING_UP` | `trendFollowing`: buy pullbacks to EMA 20 |
| `RANGING` | `meanReversion`: buy at the lower Bollinger band |
| `TRENDING_DOWN` | none (long-only) |
| `UNCERTAIN` | none |

`analyze()` returns a view of the form `{ regime, entry | null, noTradeReason, exits, signals }`. `exits` holds each strategy's current exit signal, whatever the regime, so positions can be closed by the strategy that opened them. The bucket class that turns this view into intents is the next step.

## Adding a bucket

1. Subclass `Bucket` in `src/buckets/<name>/`, implementing `evaluate()` and, if needed, `reviewPositions()`.
2. Replace its `NullBucket` factory in `src/buckets/registry.js`.
3. Give it a config block in `config/portfolio.js` with `mode: 'paper'`.
4. Add tests, then run it in paper mode until it is clean before starting the next bucket.
