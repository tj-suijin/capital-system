# Development Journal

A running record of everything built and changed, newest entry first. Each entry covers what changed, why, the decisions made, what is still unvalidated, and what comes next.

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
