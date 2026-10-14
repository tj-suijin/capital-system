# Decisions

Each entry records what was decided, why, and whether it can be revisited. The full product vision is in `VISION.md`.

## Repository and stack

**Fresh repository instead of a GitHub fork** (Oct 13, 2026). The work lives in `W:\DEV\capital-system`. Selected ideas and code are ported from [tj-suijin/trading-bot](https://github.com/tj-suijin/trading-bot). The old clone at `W:\DEV\trading-bot` is left untouched as a reference, because it still holds some uncommitted changes of the user's.

**Node 24, ESM, plain JavaScript.** Same language as the old bot, so its logic ports directly.

**`node:sqlite` instead of `better-sqlite3`.** It is built into Node and needs no native compilation, which avoids the Windows Visual Studio Build Tools problem.

**`node:test` for tests and Pino for logging.** No test framework dependency. Pino is required by `.cursorrules`.

**Base as the network, Uniswap V3/V4 as the primary venue.** Aerodrome may come back later as a secondary venue for best-price routing. See VISION section 5.

## Risk

**Loss limits use rolling windows.** The 24-hour and 7-day limits are measured over rolling windows, not calendar days, so there is no reset at midnight to game. They block new entries and clear on their own.

**Loss limits are measured against the high-water mark,** not current equity, so the allowed loss does not shrink as losses grow.

**Max drawdown is a persisted hard halt.** It survives restarts. Only a human `/unhalt` clears it, and unhalting resets the high-water mark to current equity. Without that reset, the halt would trip again on the next check.

**Exits are never blocked.** Halts, pauses and wind-down stop only new entries, because closing a position reduces risk.

**Gross exposure is capped at 50% of total equity,** counting the reserve. This keeps the portfolio at least half in cash.

**Long-only spot for now.** The old bot's Aave short logic is not carried over yet.

## Capital

**Ledgers are the source of truth after the first run.** Changing allocation percentages in config does not move capital that is already in a ledger. Rebalancing will be a deliberate, manual act, and it has no command yet.

**The reserve is never traded.** It also holds the future Yield and Swing shares until those buckets exist.

**Equity is valued at cost** until bucket 1 brings a price feed. Until then, drawdown only reflects realized losses.

## Modes

**Three modes per bucket: paper, shadow and live.** Shadow runs every check but moves no capital, which makes it useful for watching a strategy without letting it touch even the paper ledger.

**The live gate needs four independent conditions** (see `ARCHITECTURE.md`). Any failure stops startup instead of silently falling back to paper, so a misconfiguration is obvious.

**The Degen bucket is `paperOnly`.** Live is rejected outright, no matter what the other settings say.

**No live-trading switch in Telegram or the GUI.** Going live is a config and code change that a human makes deliberately.

## Operator surface

**Everything goes through `ControlApi`.** Telegram is a thin client of it, and the future GUI will be too. That keeps a single place where commands are defined and checked.

## Bucket 1 market data and strategies

**Uniswap V3 WETH/USDC 0.05% pool on Base** (`0xd0b53D9277642d899DF5C87A3966A349A798F224`). It's the standard fee tier for this pair. At startup the address, token order and fee are checked against the official Uniswap V3 factory, and any mismatch stops startup. V4 is not used yet: its pools live inside one shared contract and emit a different event, so it would be a separate adapter.

**Swap logs instead of a price API.** This keeps the old bot's pure on-chain approach. Uniswap V3 emits the same swap event as Aerodrome's concentrated-liquidity pools, so the decoding carried over unchanged.

**1-minute entry candles, 5-minute regime candles,** as in the old bot. The regime detector needs 200 five-minute candles, about 17 hours, so the backfill covers 24 hours.

**Outlier filter compares against all recent prices.** The old filter only added accepted prices to its window, so a real move of more than 2% was rejected forever. Now a single spike is outvoted, while a sustained move shifts the median and gets accepted after about ten swaps.

**Gaps:** up to 5 missing candles are filled flat at the last close. Longer gaps are left empty, so the bucket can refuse to trade on missing data instead of trusting invented candles.

**Streaming never gives up.** The old bot stopped after 10 failed reconnects. An unattended system should keep trying, with up to a minute between attempts, and a watchdog forces a reconnect after 2 minutes without swaps.

**The backfill shrinks its request range** when the provider rejects it, since providers and plan tiers limit `eth_getLogs` differently.

**Indicator fixes change signals compared with the old bot.** ADX is now properly smoothed and RSI uses Wilder smoothing. The old parameters were never validated, so nothing validated is lost.

**Entry confidence is strategy confidence × regime confidence,** as in the old bot. With the current numbers, trend-following entries rarely clear the 55% minimum. The same holds for mean reversion: at a typical 80% ranging confidence, its own score must be at least 69%, which in practice requires price to close below the lower Bollinger band. Being near the band with oversold RSI scores 65% (seen live on Oct 13, 2026 as "confidence 52% below 55%"). This stays as is until a backtest says otherwise.

**Long-only: a downtrend means no entries.**

**Stops are clamped to between 0.3% and 3% below entry.** One-minute swing lows can sit almost at the price, which would make the risk-based size cap meaningless and get stopped out by noise. Stops much wider than 3% are not what these short-hold strategies intend. A strategy stop at or above the price means no trade.

**Targets must be at least 0.4% away.** The paper round trip costs about 0.3% (a 0.05% fee and 0.10% slippage, each way). A closer target would lose money even when it's hit. Trend following has no target; it exits on its own signal, the stop or the time limit.

**Exits wait for a live price.** When the feed is stale, no exit is requested, because a paper fill at an old price would misstate P&L, and a live fill would need a fresh quote anyway. Exits resume as soon as the feed recovers.

**If market data fails to start, the bucket answers no-trade and retries every minute.** The whole system keeps running, so an RPC outage at boot doesn't take down the other buckets or Telegram.

**Positions carry a `tag`** (the strategy that opened them), so only that strategy's exit signal closes them.

**Time limit: a position closes after 4 hours** if neither the stop, the target nor a strategy exit has triggered (user's choice, Oct 13, 2026). This frees stuck capital. The old bot aimed for 15-minute to 2-hour holds but never enforced them. UNVALIDATED.

## Unvalidated parameters

None of these numbers have been backtested or reviewed for live capital. They exist so the shell can run in paper mode. All are in `config/portfolio.js`.

| Parameter | Value |
| --- | --- |
| Paper capital | $1000 |
| Allocation: LiquidDirectional / DegenMemecoin / Reserve | 60% / 3% / 37% |
| Global daily loss limit | 3% of high-water mark |
| Global weekly loss limit | 8% of high-water mark |
| Max drawdown (hard halt) | 15% |
| Max gross exposure | 50% of equity |
| LiquidDirectional: max positions, max size, risk per trade, daily loss | 2, 10% of bucket, 1%, 5% |
| DegenMemecoin: max positions, max size, risk per trade, daily loss | 1, 25% of bucket, 5%, 10% |
| Paper fee | 0.05% (Uniswap 0.05% tier) |
| Paper slippage | 0.10% |
| Evaluation interval | 60 seconds per bucket |
| Heartbeat interval | 5 minutes |
| Bucket 1: minimum entry confidence | 55% (strategy × regime) |
| Bucket 1: regime | 200 × 5m candles; EMA 20/50/200; ADX 14 with trending > 25 and weak < 20; Bollinger squeeze < 3% and wide > 6%; uncertain below 45% |
| Bucket 1: trend following | EMA 20/50; RSI 40–65; pullback within 0.5% of EMA 20; stop at the 10-candle swing low |
| Bucket 1: mean reversion | Bollinger 20 / 2σ; RSI oversold < 30 and overbought > 70; target the middle band; stop 1% under the lower band |
| Bucket 1: outlier filter | 2% from the median of the last 21 prices |
| Bucket 1: stale feed | 2 minutes without a swap |
| Bucket 1: gap fill | up to 5 candles |
| Bucket 1: stop clamp | 0.3% to 3% below entry |
| Bucket 1: minimum target distance | 0.4% |
| Bucket 1: max hold | 4 hours |

## Open questions

- How should a manual rebalance between ledgers work, and should it require the portfolio to be flat first?
- Which price source should mark-to-market use for bucket 1: the Uniswap pool itself, or a second reference to guard against pool manipulation?
- Should trend-following's confidence formula be loosened, or left until a backtest?
- Should drawdown include unrealized losses once mark-to-market exists? It should, but this changes how often the halt can trip.
