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

**Equity is marked to market** (Oct 13, 2026, bucket 1 part 4). Equity is cash plus the market value of open positions, minus the opening fees already paid. It replaces the at-cost valuation of the shell, and it is used everywhere equity is used: sizing, bucket and global risk, snapshots, status and Telegram.

**Marks are mid prices.** The estimated close fee and slippage are not deducted, so a position closes slightly below its last mark (about 0.15% with the paper settings). Deducting them would tie valuation to one executor's cost model.

**Each bucket prices its own positions** through `markPrice(symbol, now)`, because each bucket owns its market data. A bucket that has no price (the degen placeholder, or a failed lookup) leaves the position at cost instead of guessing.

**Bucket 1 marks from its own pool.** It uses the last swap the feed accepted. When the feed hasn't ticked (still starting, or a separate `npm run status` process), it uses the newest stored 1-minute candle. A stale mark is still used, because it is the last trusted price, and its age is shown in `/positions`. A second reference price to guard against pool manipulation is left for later. With the current limits (at most two positions of 10% of a \$600 bucket), even a total loss on both positions could not reach the 15% drawdown halt.

**Drawdown includes unrealized P&L.** Unrealized gains raise the high-water mark, and giving them back counts as drawdown. The halt is now checked at the end of every bucket cycle as well as on closes and heartbeats, because marks move between heartbeats.

**Daily and weekly loss limits stay realized-only.** Counting open losses would block entries whenever a position is temporarily under water. The drawdown halt already covers large open losses. This can be revisited.

**Gross exposure uses market value,** so a position that has grown takes up more of the 50% cap.

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

**Stops are clamped to between 0.3% and 3% below the market price at entry.** One-minute swing lows can sit almost at the price, which would make the risk-based size cap meaningless and get stopped out by noise. Stops much wider than 3% are not what these short-hold strategies intend. A strategy stop at or above the price means no trade.

**Targets must be at least 0.4% away.** The paper round trip costs about 0.3% (a 0.05% fee and 0.10% slippage, each way). A closer target would lose money even when it's hit. Trend following has no target; it exits on its own signal, the stop or the time limit.

**Exits wait for a live price.** When the feed is stale, no exit is requested, because a paper fill at an old price would misstate P&L, and a live fill would need a fresh quote anyway. Exits resume as soon as the feed recovers.

**If market data fails to start, the bucket answers no-trade and retries every minute.** The whole system keeps running, so an RPC outage at boot doesn't take down the other buckets or Telegram.

**Positions carry a `tag`** (the strategy that opened them), so only that strategy's exit signal closes them.

**Time limit: a position closes after 4 hours** if neither the stop, the target nor a strategy exit has triggered (user's choice, Oct 13, 2026). This frees stuck capital. The old bot aimed for 15-minute to 2-hour holds but never enforced them. UNVALIDATED.

## Paper run (bucket 1 part 5, Oct 14, 2026)

**The run lasts 7 days on a fresh database with $4,000 of paper capital** (user's choice). The old database is archived to `data/archive/` rather than deleted. It held only test decisions and no trades. A fresh start is needed because existing ledgers are never resized by a config change, and it gives the report a clean window. The run window starts at the first start on the new database (`settings.runStartedAt`).

**Bucket 1 enters at 45% confidence in paper mode only** (user's choice). A separate `paperMinConfidence` is used only when the bucket's mode is `paper`. Shadow and live keep `minConfidence` (55%), so the looser threshold cannot reach live trading by accident. A replay of the 9 hours of stored candles that had the regime warm-up behind them found no entries at 55%, 3 at 50% and 4 at 45%, all trend-following. Lowering the threshold below 45% adds none, because the next-best setups scored 34%. Positions scale with confidence, so a 45% entry is about $108 ($2,400 × 10% × 0.45).

**An Exerciser bucket stresses the machinery** (user's choice). It is not a strategy and is expected to lose roughly its costs. It has $80 (2%, taken from the reserve) and opens a $30 long at every :00 and :30 slot. It closes at a 0.3% stop, a 0.3% target or after 75 minutes, holds at most 2 positions, and has a 2% ($1.60) daily loss limit. It uses bucket 1's price feed instead of opening a second WebSocket, so there are no duplicate candles. Bucket 1 owns the data alerts for that feed. After a restart it waits for the next slot, so it can't open twice in one slot. The report keeps it separate from bucket 1. Its global impact is bounded: about $1.60 a day against the $120 global daily limit.

**The supervisor restarts after crashes, but at most 5 times an hour** (user's choice). It waits 15 seconds, doubling up to 5 minutes. A clean stop (exit 0) or a refused second copy (exit 3) is not restarted. When it gives up it sends a Telegram message, because the system itself can no longer do so. It runs from a scheduled task at logon, not as a background service, so the console stays visible and Ctrl+C still stops it cleanly. A reboot therefore pauses the run until the next logon, which is why Windows Update must be paused during the run.

**One copy per database.** A lock file next to the database (`data/capital.lock`) holds the owner's pid. A lock left by a dead process is taken over. `npm run status` and `npm run report` only read, so they don't take the lock; `npm run market` does, because it writes candles.

**Clean or unclean stops are recorded.** A `cleanShutdown` flag is cleared at every start and set by a clean stop. The next start records whether the previous one was clean, and Telegram says so with the number of open positions.

**Alerts:** a feed that has been unhealthy for 10 minutes sends one alert, and another when it recovers. Shorter outages show up only in the digest and the report as stale-feed minutes. Ten error lines within 10 minutes send an error-burst alert, at most once an hour. Telegram's own errors are not counted, so an unreachable Telegram can't alert about itself.

**Digests at 08:00 and 21:00 local time** (user's choice). Each covers the time since the previous digest (12 hours after a restart). A digest that doesn't arrive is the signal that the system is down. Error counts and reconnect counts come from the running process, so they reset at a restart.

**Stops and targets are anchored to the market price at entry** (user's choice, Oct 14, 2026). The portfolio manager used to set them as a percentage of the fill price. Paper fills include 0.10% slippage, so every stop and target moved up by that much: a 0.3% stop sat about 0.2% below the market and a 0.3% target about 0.4% above it. They are now a percentage of the price in the bucket's intent, which is the price the strategy measured its stop and target against. A trade closed at its stop still pays slippage and fees on both sides, about 0.3% of the position on top of the stop distance with the paper settings.

**The report infers bucket 1's regime from its reason text,** because decisions are not stored with their regime. Reports are written to `reports/`, which is not tracked in git. The conclusions go into the journal.

## Unvalidated parameters

None of these numbers have been backtested or reviewed for live capital. They exist so the shell can run in paper mode. All are in `config/portfolio.js`.

| Parameter | Value |
| --- | --- |
| Paper capital | $4,000 (was $1,000 until the paper run) |
| Allocation: LiquidDirectional / DegenMemecoin / Exerciser / Reserve | 60% / 3% / 2% / 35% |
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
| Bucket 1: minimum entry confidence | 55% (strategy × regime) in shadow and live; 45% in paper |
| Bucket 1: regime | 200 × 5m candles; EMA 20/50/200; ADX 14 with trending > 25 and weak < 20; Bollinger squeeze < 3% and wide > 6%; uncertain below 45% |
| Bucket 1: trend following | EMA 20/50; RSI 40–65; pullback within 0.5% of EMA 20; stop at the 10-candle swing low |
| Bucket 1: mean reversion | Bollinger 20 / 2σ; RSI oversold < 30 and overbought > 70; target the middle band; stop 1% under the lower band |
| Bucket 1: outlier filter | 2% from the median of the last 21 prices |
| Bucket 1: stale feed | 2 minutes without a swap |
| Bucket 1: gap fill | up to 5 candles |
| Bucket 1: stop clamp | 0.3% to 3% below entry |
| Bucket 1: minimum target distance | 0.4% |
| Bucket 1: max hold | 4 hours |
| Exerciser | $30 every 30 minutes; 0.3% stop and target; 75-minute limit; max 2 open; 40% max size; 2% daily loss |
| Data-down alert | after 10 minutes |
| Error-burst alert | 10 errors in 10 minutes, at most once an hour |
| Supervisor | restart after 15s doubling to 5 minutes; stop after 5 crashes in an hour |

## Open questions

- How should a manual rebalance between ledgers work, and should it require the portfolio to be flat first?
- Should bucket 1 add a second reference price (for example a Chainlink ETH/USD feed) to guard its marks and exits against pool manipulation? For now it marks from its own pool.
- Should trend-following's confidence formula be loosened, or left until a backtest?
- Should the daily and weekly loss limits count unrealized losses? For now they count realized losses only.