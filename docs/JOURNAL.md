# Development Journal

A running record of everything built and changed, newest entry first. Each entry covers what changed, why, the decisions made, what is still unvalidated, and what comes next.

---

## October 14, 2026 (session 5): Bucket 1, paper run setup

**Area:** LiquidDirectional bucket, part 5 of 5 (getting ready for the long paper run). It also touches the portfolio shell's operations and Telegram, and adds a new Exerciser test bucket. Part 4 was committed as `e77d595`.

**What changed:**
- **Restarts.** `npm run paper` runs `scripts/paper-run.ps1`, a supervisor that restarts the system after a crash. It waits 15 seconds, doubling up to 5 minutes, and gives up after 5 crashes in an hour with a Telegram message. `scripts/install-task.ps1` registers it as a Windows scheduled task at logon.
- **One copy only.** A lock file, `data/capital.lock`, stops a second copy from trading the same database. The second copy exits with code 3 and sends a Telegram warning. `npm run market` takes the same lock.
- **Crashes are logged.** An uncaught exception is now logged as fatal and exits with code 1. Each start records whether the previous stop was clean, and Telegram reports an unclean one along with the number of open positions.
- **Telegram.** The poll loop now backs off on error replies (5 seconds up to 5 minutes), and every request has a timeout. A digest arrives at 08:00 and 21:00 local time: equity, trades, decisions, top no-trade reasons, rejections, near misses and health. `/digest [hours]` gives one on demand. New alerts cover a feed that has been down for 10 minutes (and its recovery) and bursts of errors.
- **Event history.** A new `system_events` table records starts, stops, outages, error bursts, halts and operator actions. The heartbeat now logs memory use and the feed's reconnect count.
- **`npm run report`.** It writes a Markdown review of the run to `reports/`, covering:
  - uptime and gaps, restarts, outages and errors, and memory and disk use
  - decisions, the inferred regime, near misses and rejections for each bucket
  - every trade, with a check of its fill against that minute's candle
  - a comparison with simply holding ETH
- **Bucket 1:**
  - In paper mode it enters at 45% confidence. Shadow and live keep 55%.
  - Before the first live swap it says "waiting for first live swap" instead of "price feed stale".
- **Exerciser bucket.** A test bucket, not a strategy. It opens a $30 long at every :00 and :30 using bucket 1's price feed, with a 0.3% stop and target, a 75-minute limit, at most 2 open and a 2% daily loss limit.
- **Capital.** Paper capital rises from \$1,000 to \$4,000. The split is now 60% for LiquidDirectional, 3% Degen, 2% Exerciser and 35% Reserve.
- **Stop and target anchoring (bug fix).** Stops and targets are now placed from the market price at entry, not the fill price.
- **Tests.** 28 new tests, 94 in total, all passing. They include:
  - a 3-day synthetic replay through the full pipeline, checking every minute that cash plus in-use equals allocation plus realized P&L
  - a restart while two positions are open
  - the exerciser tripping its position cap and its daily loss limit
  - the lock, the health monitor, Telegram backoff, the digest and the report

**Why:** The paper run has to last days on the user's gaming PC without anyone watching. It needs to restart itself, report silence as well as problems, and leave behind enough data to review. Entries were too rare at 55% to exercise anything (none in the 9 replayable hours), so the user lowered the paper threshold and asked for a test bucket that trades on a schedule.

**Decisions** (all the user's; details are in `DECISIONS.md`):
- The run lasts 7 days, on a fresh database. The old one is archived to `data/archive/`, not deleted.
- Paper capital is \$4,000.
- Bucket 1's paper threshold is 45%. A separate `paperMinConfidence` is used only in paper mode.
- The Exerciser uses the numbers above, funded from the reserve.
- The supervisor restarts the system automatically, but stops after 5 crashes in an hour.
- Digests arrive at 08:00 and 21:00.
- Stops and targets are anchored to the market price, not the fill. The replay showed the problem: paper slippage had moved every stop and target up 0.1%, so the exerciser's "0.3%" stop sat 0.2% below the market and its target 0.4% above. In the replay it hit its stop 33 times and its target twice. The same shift applied to bucket 1.
- The user runs the system from their own PowerShell window or the logon task, not from inside Cursor.

**Replay of stored candles:** Only 9.1 hours of the stored candles (Oct 13, 15:54 to Oct 14, 00:56 local time) have the regime warm-up behind them. In that window bucket 1 would have entered 0 times at 55%, 3 times at 50% and 4 times at 45%. All 4 were trend-following. Lowering the threshold below 45% adds nothing, because the next-best setups scored 34%. Mean reversion never cleared 45%, even though the market was ranging 78% of the time.

**Smoke run** (on a separate database, `data/smoke/`, so the run clock wasn't started):
- The supervisor started the system, which created the \$2,400 / \$120 / \$80 / \$1,400 ledgers and backfilled 19,251 swaps in 12 seconds.
- A second copy was refused with exit code 3.
- The exerciser opened \$30 at 01:30. Hard-killing the process 10 seconds later was handled correctly: the supervisor restarted it after 15 seconds, the new process logged the unclean stop with 1 open position, and it kept marking that position.
- At 02:00 a second position opened. At 02:30 the position cap rejected a third, live.
- At 02:46 the restarted process closed position 1 on its 75-minute limit, for −\$0.08.
- Two Telegram polls failed briefly. One hung until the new 35-second timeout, and one hit a network error. Both recovered after a single 5-second wait.
- Memory held at 81–91 MB after the restart, and the feed stayed live with no reconnects.
- `npm run report` on the smoke database rendered every section correctly: 100% heartbeat coverage, 2 starts (1 unclean), the cap rejection and the trade table.

The smoke run used the code from before the anchoring fix.

**Unvalidated:**
- the 45% paper threshold
- the Exerciser's numbers
- the alert thresholds (10 minutes for a data outage, 10 errors in 10 minutes)
- the supervisor's backoff and its 5-crashes-an-hour cap
- \$4,000 of paper capital

The synthetic replay says nothing about real stop and target rates, or about bucket 1's results.

**Not verified:**
- a clean Ctrl+C stop through the supervisor (the agent can't send Ctrl+C; covered by a unit test)
- registering the scheduled task
- a digest arriving at its scheduled time
- a live data-down alert
- how the Telegram messages look on the phone
- memory over several days
- Alchemy compute usage over a week

**Next steps:**
1. The user reviews and commits.
2. Pause Windows Update for the week, and put off GPU driver updates.
3. Archive `data/capital.db` (and its `-wal` and `-shm` files) to `data/archive/`. The smoke database in `data/smoke/` can be deleted.
4. Start the run from your own PowerShell with `npm run paper`, or register the task with `scripts\install-task.ps1`. Leave the window minimized and don't close it.
5. Check the first digest, and `/status` and `/digest` in Telegram. Check the Alchemy dashboard after the first day.
6. After 7 days, run `npm run report` and review it together.

**Open questions:** whether bucket 1 should record its regime in each decision instead of having the report infer it from the reason text. The earlier open questions in `DECISIONS.md` still stand.

---

## October 13, 2026 (session 4): Bucket 1, mark-to-market valuation

**Area:** LiquidDirectional bucket, part 4 of 5, and the portfolio shell's equity and risk. Part 3 was committed as `9896957`.

**What changed:**
- New `src/portfolio/valuation.js`. Each open position is valued at quantity times the mark price. Its unrealized P&L is that value minus the notional and the opening fee already paid. A position without a price is valued at cost.
- Buckets now have a `markPrice(symbol, now)` method. The base class returns no price. Bucket 1 returns the last swap its feed accepted, or the newest stored 1-minute candle if the feed hasn't ticked yet. That fallback also gives `npm run status` real marks.
- Equity is now cash plus in use plus unrealized P&L, everywhere: position sizing, the bucket's max-size check, the high-water mark, the drawdown halt, gross exposure (now at market value), heartbeat logs and equity snapshots.
- The drawdown halt is now also checked at the end of every bucket cycle (every 60 seconds), not only on closes and the 5-minute heartbeat.
- `equity_snapshots` has a new `unrealized_pnl_usd` column. Existing databases get it automatically; the migration ran cleanly on the real database.
- `ControlApi.getOpenPositions()` returns each position with its mark price, mark age, time held, value and unrealized P&L.
- Telegram: `/status` shows realized and unrealized P&L per bucket, and a new `/positions [bucket]` (or `/p`) lists open positions with their mark, P&L, stop, target and time held.
- A failing mark lookup is logged with the new code `MK_001` and leaves the position at cost, so it cannot break a cycle.
- 9 new tests (66 in total, all passing), including a drawdown halt caused purely by an open loss, the high-water mark rising on open gains, and exposure at market value.

**Why:** Until now drawdown, the halt and sizing only saw realized losses, so an open position could lose a lot without any risk control noticing until it closed. The paper run (part 5) needs equity and drawdown that reflect the live price.

**Decisions** (also in `DECISIONS.md`):
- Marks are mid prices. Estimated exit costs are not deducted, so a close comes in about 0.15% under the last mark with the paper settings.
- Bucket 1 marks from its own pool. There is no second reference price yet.
- A stale mark is still used, because it is the last trusted price; `/positions` shows its age.
- Drawdown includes unrealized P&L, so unrealized gains raise the high-water mark and giving them back counts as drawdown.
- Daily and weekly loss limits stay realized-only.

**Unvalidated:** Whether mid-price marks (rather than marks net of exit costs) are the right basis for the halt. No new numeric parameters were added.

**Not verified:** No position has been open yet on the real feed, so marks have only been exercised in tests. `npm run status` ran cleanly against the real database.

**Telegram set up:** The user created a new bot token and found the chat ID. A first start failed with a 401 because `.env` still held an old, revoked token. With the current token, `npm start` delivered the startup message to the user's phone. Startup, the backfill and the heartbeat (showing \$0 unrealized P&L) all looked normal.

**Next steps:**
1. The user reviews and commits.
2. Optionally run `npm start` for a few minutes and check `/status` and `/positions`.
3. Part 5: the long paper run.

**Open questions:** Should bucket 1 add a second reference price (for example Chainlink ETH/USD) for marks and exits? Should the daily and weekly loss limits count unrealized losses?

---

## October 13, 2026 (session 3, continued): Bucket 1, the bucket itself

**Area:** LiquidDirectional bucket, part 3 of 5. Parts 1 and 2 were committed as `d361a61`.

**What changed:**
- `LiquidDirectionalBucket` replaces the placeholder for bucket 1. It starts its own market data, turns the analyst's view into trade intents, and asks for exits.
- **Entry checks:** no trade while market data is down, the feed is stale, the candles have a gap, or the history is still warming up. The strategy's stop must be below the price, and its distance is clamped to between 0.3% and 3%. A target must be at least 0.4% away so it covers the round-trip costs of about 0.3%.
- **Exits:** stop loss, take profit, the opening strategy's own exit signal, and the 4-hour time limit the user chose. They are checked every minute at the live pool price, and deferred while the feed is stale.
- Positions now have a `tag` column (the strategy that opened them). Existing databases get the column added automatically.
- If market data fails to start, the bucket answers no-trade and retries every minute instead of stopping the system.
- Telegram `/status` shows bucket 1's regime and its latest reasoning, or a warning if market data is down.
- 7 new tests (57 in total, all passing), including a full trip through the portfolio pipeline: a paper position opens on a mean-reversion dip and closes at its stop.

**Live check:** `npm start` ran for about 2 minutes on the real feed. It created the ledgers (\$600 for bucket 1, \$30 for the degen bucket, \$370 in reserve), verified the pool, backfilled only the 10 missing minutes in 0.2 seconds, and recorded "no trade" decisions with real reasons (for example, a mean-reversion exit signal near the upper band). No positions were opened.

**Known limitation:** `npm run status` runs as a separate process, so its `running` flag and each bucket's `detail` describe that process, not the running system. The decisions, ledgers and positions it shows are correct.

**Unvalidated:** the stop clamp (0.3%–3%), the 0.4% minimum target, and the 4-hour limit.

**Next steps:**
1. The user reviews and commits.
2. Part 4: mark-to-market valuation of open positions, so equity, drawdown and the halt reflect the live price.
3. Part 5: the long paper run.

---

## October 13, 2026 (session 3): Bucket 1, market data and strategies

**Area:** LiquidDirectional bucket (v1 step 3), parts 1 and 2 of 5.

**What changed:**
- **Market data** (`src/data/`): a verified price feed for the Uniswap V3 WETH/USDC 0.05% pool on Base (`0xd0b53D9277642d899DF5C87A3966A349A798F224`). At startup it checks the pool against the official Uniswap factory and stops if anything differs. It backfills 24 hours of candle history from swap logs, then streams live swaps over Alchemy's WebSocket, or polls the pool if there is no WebSocket. It builds 1-minute and 5-minute candles in a new `candles` table. After a reconnect it fetches the swaps it missed.
- **Indicators** (`src/analysis/indicators.js`), and the **regime detector, trend-following and mean-reversion strategies, and analyst** (`src/buckets/liquidDirectional/`), ported from the old bot.
- **`npm run market`**: runs the feed on its own and logs what the analyst thinks at every closed 1-minute candle. Nothing trades.
- Added `ethers` as a dependency and `ALCHEMY_API_KEY` to `.env.example`.
- 27 new tests (50 in total, all passing).
- Fixed `.gitignore`: the `data/` entry meant for the database folder also hid `src/data/`, so the market data code would never have been committed. `data/` and `logs/` are now anchored to the repo root.

**Bugs fixed from the old bot:**
- The outlier filter froze on any genuine price move of more than 2%, because rejected prices never entered its comparison window.
- ADX was a single raw reading instead of a smoothed average, so trend strength was much noisier than intended.
- RSI used a simple average, not the Wilder smoothing that the old docs claimed.
- The trend stop used the lowest close instead of the lowest low.

**Decisions:**
- The pool address is checked on-chain at startup instead of being trusted blindly.
- The reconnect logic never gives up, and a watchdog forces a reconnect after 2 minutes without swaps.
- Gaps of up to 5 candles are filled flat; longer gaps are left empty so the bucket can see that data is missing.
- The backfill shrinks its request size automatically when the provider rejects it.
- The strategies take their parameters as arguments instead of reading a global config, so the backtester can reuse them later.

**Observation:** With the current numbers, trend-following entries will be rare. Even a textbook pullback in a clean uptrend scores 68% × 78% = 53%, under the 55% minimum. Mean-reversion entries clear it more easily.

**Live check:** With the user's Alchemy key, `npm run market` verified the pool at \$2,510 per ETH and backfilled 24 hours (about 19,500 swaps over 43,000 blocks) in 12 seconds. The default 2,000-block log range worked, and no prices were rejected as outliers. The WebSocket subscribed, the gap fill recovered 8 swaps, and the analyst read the market as RANGING (80%) with no setup. A first reading showed no price until the first live swap; it is now seeded from the pool check.

**Unvalidated:** All strategy numbers (`strategy` in `config/portfolio.js`); the 2% outlier threshold; the 2-minute staleness limit; the 5-candle gap fill.

**Next steps:**
1. The user reviews and commits.
2. Part 3: the LiquidDirectional bucket itself (entries through the pipeline, exits on stop, target, strategy exit or time limit, no trade on stale or gappy data, stop sanity checks).
3. Part 4: mark-to-market valuation. Part 5: the paper run.

**Decided by the user:** Positions close after 4 hours if nothing else has closed them. This will be built in part 3.

**Open question:** Should trend-following's confidence formula be loosened, or left alone until a backtest says otherwise?

---

## October 13, 2026 (session 2): Documentation

**Area:** Documentation (no code changes).

**What changed:** Wrote the documents that were interrupted at the end of session 1:
- `CHANGELOG.md`, with the 0.1.0 entry covering the portfolio shell's trading logic.
- `README.md`, covering setup, commands, layout and links to the other docs.
- `docs/ARCHITECTURE.md`, which explains how the pipeline, capital, risk, modes and persistence work.
- `docs/DECISIONS.md`, which records each decision and its reason, plus a table of every unvalidated parameter and a list of open questions.
- `docs/GUI_VISION.md`, the GUI plan, including a proposed mapping from `ControlApi` methods to HTTP routes.
- This journal, and `.cursor/rules/journal.mdc`, an always-on rule that tells every agent session to add an entry here.

**Vision copy:** `docs/VISION.md` is now the only maintained copy. Syncing the old copy at `W:\DEV\PROJECT_VISION_MultiBucket_Trading_System.md` triggered an approval prompt every time, because the file is outside the workspace.

**Why:** The vision document lists these as the first next step, and the user needs them to review the shell before committing.

**Environment fix:** The agent's terminal failed because Cursor's sandbox does not work on this Windows machine. The user switched Cursor to Allowlist mode with sandboxing off and allowlisted the common test and git commands. After that, all 23 tests passed.

**Unvalidated:** Every number in `config/portfolio.js` (see the table in `DECISIONS.md`).

**Next steps:**
1. The user reviews the shell and the docs, sets a git user name and email, and makes the first commit.
2. Bucket 1 (LiquidDirectional): port the old ETH/USDC logic, replace Aerodrome data and execution with Uniswap V3 on Base in paper mode, and add mark-to-market pricing.

**Open questions:** How manual rebalancing should work, which price source to use for mark-to-market, and whether drawdown should include unrealized losses. Details are in `DECISIONS.md`.

---

## October 13, 2026 (session 1): Portfolio shell

**Area:** Portfolio shell (v1 step 1).

**What changed:** Built the portfolio shell in a fresh repository at `W:\DEV\capital-system`:
- A portfolio manager that runs each bucket on a timer and sends every request through the same pipeline: sizer, bucket risk, global risk, capital allocator, executor. Every outcome is logged.
- A capital allocator with one ledger per bucket and a reserve that is never traded.
- Global and per-bucket risk limits, a halt and unhalt, a wind-down switch, and per-bucket pause.
- A paper executor, and a live stub that refuses to trade.
- SQLite persistence, `ControlApi` as the single operator surface, and Telegram as a client of it.
- 23 tests, all passing.

Both buckets are placeholders that always answer "no trade", so the shell can run unattended.

**Why:** The vision calls for the portfolio shell first, so each later bucket plugs into risk and capital rules that already work.

**Decisions:** A fresh repository instead of a fork; `node:sqlite` to avoid Windows native builds; rolling-window loss limits; a persisted drawdown halt; exits never blocked; a four-condition live gate; ledgers that are not moved by config changes. Reasons are in `DECISIONS.md`.

**Unvalidated:** All starting parameters, including $1000 paper capital and a 60% / 3% / 37% split.

**Next steps:** Finish the docs, then the user reviews and commits.
