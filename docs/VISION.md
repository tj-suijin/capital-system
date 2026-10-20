# PROJECT VISION DOCUMENT
## Multi-Bucket Autonomous Capital System

**Last updated:** October 19, 2026 (Karpathy agent guidelines added, doc conflicts resolved, OS-neutral wording; section 17 wins wherever it conflicts with sections 1–16, including section 2)  
**Purpose:** Complete context for any coding agent (especially Cursor) so work can continue without the user re-explaining history, philosophy, architecture, or constraints.

> **Current scope in one line:** v1 is the Majors Trader bucket and nothing else. Next comes the thesis, the kill criteria and the backtester, in that order, before any more paper running. Read section 17 first.

**Canonical copy:** `docs/VISION.md` in the repository root, tracked in git. This is the only maintained copy. The old standalone copy, `PROJECT_VISION_MultiBucket_Trading_System.md` (outside the repo, on the Windows PC), is no longer kept in sync.

---

## 1. Origin & Current Codebase

**Starting repository:** https://github.com/tj-suijin/trading-bot

What it currently is:
- Autonomous ETH/USDC trading bot on **Base** chain
- Originally built around **Aerodrome Slipstream** (concentrated liquidity)
- Pure on-chain data approach (Alchemy WebSocket + `eth_getLogs`, candles from `sqrtPriceX96`)
- Modular event-driven architecture (v3.0.0)
- Components: Watcher → Analyst (indicators + regime) → Strategies (TrendFollowing + MeanReversion) → Risk Manager → Trader (paper/live) → Telegram alerts
- SQLite persistence, paper mode by default, backtester, early capital allocation thinking
- Last meaningful development ~ late March 2026

**Key strengths worth preserving:**
- Clean modular separation
- Paper-first philosophy and security hygiene
- Regime-aware strategies
- Solid risk controls (position sizing, loss limits, drawdown halt, gas guards)
- Telegram as control plane

**Decision on the existing code:**  
The user is okay with a **semi-restart**. Fork the repository and reuse the good architectural ideas, risk primitives, paper mode, and Telegram integration. Do **not** feel obligated to keep the Aerodrome-specific data and execution code if switching venues.

---

## 2. Core Philosophy & Edge Thesis

> **Superseded in part (October 19, 2026).** Where this section conflicts with section 17, section 17 wins. In particular, discipline and 24/7 consistency are necessary but are not an edge by themselves: Majors Trader needs a written thesis. The user may rewrite this section.

The system is **not** primarily a high-win-rate gambler or a pure memecoin sniper.

**Desired identity:**
> A tireless, disciplined capital allocator whose edge comes from never getting tired, emotional, or FOMO’d; being able to run multiple processes in parallel; enforcing risk rules without exception; and compounding small, repeatable edges over long periods.

Key principles:
- Make as much money as possible while not being a dangerous dumbass about the process.
- The main edge is 24/7 consistency and lack of mental fatigue, **not** going all-in on high-probability setups.
- “No trade” is a valid and often preferred outcome.
- Consistency and process discipline > hero trades.

Realism the user accepts:
- 24/7 multiplies whatever edge (or lack of edge) exists. It does not create positive expectancy by itself.
- Most retail bots lose money due to fees, slippage, adverse selection, or overfitted strategies.
- AI is an excellent coding and research accelerator, not an oracle.

---

## 3. Evolution of Thinking

1. Started with liquid directional trading on ETH/USDC (Base / Aerodrome).
2. Considered a hard pivot to pure memecoin trading for higher activity.
3. Refined goal: multi-strategy capital manager is a better fit for the stated edge (process consistency + risk discipline).
4. Added a tightly constrained, low-capital **degen/memecoin bucket** as an experimental sleeve (paper for months) to satisfy curiosity without dominating the system.
5. Imported strong engineering patterns from advanced FOMO/memecoin desks (staged filtering, code-vs-judgment split, shadow mode, rejection memory, strict position limits).

---

## 4. Target Architecture: Multi-Bucket System

**High-level identity:**  
An application that can allocate and trade capital in multiple distinct ways. Each way is a **bucket**. Each bucket contains one or more strategies. The top level is a portfolio manager.

```
Portfolio Manager (top level)
├── Capital Allocator
├── Global Risk Engine
├── Bucket Registry
│   ├── LiquidDirectional     ← first bucket (majors on Base)
│   ├── Yield / Carry
│   ├── Swing / Day
│   ├── DegenMemecoin         ← low capital, paper-first (likely Solana later)
│   └── Reserve
├── Shared Services
│   ├── Data / Watchers / Collectors
│   ├── Execution adapters (per venue / chain)
│   ├── Alerts / Telegram
│   └── Persistence
└── Future: Dashboard / UI
```

Each bucket owns:
- Its own capital allocation
- Its own risk limits
- Its own data sources and candidate generation
- Its own entry/exit logic
- Independent paper vs live mode
- Independent performance tracking

**v1 priority (revised October 15, 2026, see section 17):**
1. Portfolio shell + Capital Allocator + Global Risk (done)
2. Majors Trader (the old LiquidDirectional bucket): this is the only bucket in v1, and the work now is proving it has an edge
3. Everything else (Memecoin Lab, Yield, Swing) is future work, frozen until Majors Trader has a thesis, a backtested result and a reviewed track record

Avoid building five perfect buckets at once.

**Working style: one bucket at a time.** The user wants to build and debug one bucket at a time, so problems are easy to isolate. A bucket is not started until the previous one runs cleanly in paper mode. Each bucket can be paused on its own without affecting the others.

**"Bucket 1" = the old bot's logic.** The original trading-bot is effectively bucket 1. Its ETH/USDC strategies (trend-following, mean reversion, regime detection) become the LiquidDirectional bucket. The old bot's portfolio-level parts (the capital split, loss limits, Telegram) move up into the shared portfolio shell instead of living inside the bucket.

---

## 5. Network & DEX Decisions (Updated October 13, 2026)

### Primary Network: **Base**

- Base currently has stronger overall DeFi depth and activity than Arbitrum.
- Extremely low fees (solves the Ethereum mainnet fee problem).
- User preference: master **one** primary EVM network first to reduce complexity.
- All non-Solana buckets should live on Base for now.
- Solana is deliberately excluded from this decision and will be a separate execution path for the degen bucket later (“bridge to cross another day”).

### Primary DEX on Base: **Uniswap V3 / V4**

**Decision:** Make Uniswap (V3 + V4 where useful) the **primary** execution venue.

Reasons:
- Excellent liquidity depth on major pairs on Base.
- Extremely mature, well-documented, and standardized interfaces → lower maintenance burden and easier long-term development.
- Better future optionality (same mental model and code patterns work on many chains if ever needed).
- Aerodrome is still the volume leader on Base and is **not** outdated, but for a semi-restart with multi-bucket ambitions, Uniswap is the cleaner primary choice.

**Aerodrome status:**  
Keep as a possible secondary/optional venue later for best-price routing on certain pairs. Do **not** make it the foundation of the new version.

**Summary of stack for the first buckets:**
- Network: **Base**
- Primary DEX: **Uniswap V3/V4**
- Data approach: Prefer pure on-chain where practical (same philosophy as the original bot)
- Execution: Clean adapter interface so additional venues can be added later

---

## 6. The Degen / Memecoin Bucket (Experimental Sleeve)

> **Frozen (October 15, 2026).** Memecoin Lab (this bucket) stays off and gets no work until Majors Trader is done. See section 17. The description below is the long-term intent, not the current plan.

- Purpose: Scratch the high-activity itch and generate learning/data.
- Capital: Very low allocation (conceptually 1–5% of total).
- Mode: Pure paper / shadow for at least 1–2 months of real market time before any live size.
- Position limits: Strict (probably 1 concurrent position while learning).
- Heavy staged filtering before any trade is considered.
- This bucket will most likely live on **Solana** when implemented. Treat it as a completely separate execution adapter.

---

## 7. Engineering Patterns to Adopt System-Wide

Imported from strong external designs and judged useful beyond pure memecoin trading:

1. **Staged filtering** (cheap deterministic checks → cheaper external data → limited expensive calls → model judgment only on survivors).
2. **Strict separation**: Code owns data, arithmetic, sizing, and hard risk limits. Any model only performs structured judgment.
3. Prefer **typed / probabilistic outputs** over free-text when using models.
4. **Shadow / paper mode** as a first-class citizen for every new bucket or major logic change.
5. **“No trade” is a valid and desirable outcome**.
6. **Rejection memory / cooldown** (especially important for high-candidate-volume buckets).
7. **Very few concurrent positions** in high-risk buckets.

These are system design principles.

---

## 8. Relationship to the Existing Codebase

- **Decision (Oct 13, 2026):** instead of a GitHub fork, the work happens in a **fresh repository, `capital-system`**. Selected ideas and code are ported from https://github.com/tj-suijin/trading-bot. The old local clone of `trading-bot` (on the Windows PC) stays untouched as a reference; it still has some uncommitted changes of the user's.
- Reuse: modular structure ideas, risk primitives, paper mode, SQLite patterns, Telegram control plane, overall engineering quality.
- Rewrite / replace: Aerodrome-specific watcher, pool math (`sqrtPriceX96` → Uniswap tick/sqrtPrice), and execution paths.
- Goal: Clean Uniswap-on-Base implementation of the LiquidDirectional bucket first, sitting under a simple portfolio shell.

---

## 9. AI / Tooling Context

User has API tokens, Cursor, and willingness to iterate.  
AI should be used as a force multiplier for implementation speed and research. Final risk parameters and go-live decisions stay under explicit human control.

Guidance for coding agents:
- Prefer small, reviewable increments.
- Default every new trading path to paper/shadow.
- Surface assumptions and unvalidated parameters clearly.
- Keep model judgment (if any) behind structured interfaces.
- Optimize for process quality and survivability, not maximum trade count.

---

## 10. Near-Term Success Criteria

- Clear multi-bucket shape in the repository (even if only one bucket is real). The shape exists; no more is being added until Majors Trader is proven.
- Majors Trader has a written thesis, written kill criteria, and a backtest over at least 6 months that the user has read, including if it says "no edge".
- Majors Trader running cleanly on **Base + Uniswap** in paper mode, as an operational test after the backtest.
- Simple portfolio / capital allocation / global risk concepts exist.
- ~~Degen bucket exists at least as a paper skeleton~~ Dropped from v1 on October 15, 2026. The placeholder and its config stay, dormant.
- System can run unattended in paper mode for extended periods.
- “No trade” happens frequently and is treated as normal.
- User can reason about each bucket’s performance and risk separately.

Profit is a later concern. Survivability, observability, and clean architecture come first.

---

## 11. Instructions for the Coding Agent (Cursor)

When this document is provided:

1. Treat it as the source of truth for product vision and constraints.
2. Work in the fresh `capital-system` repository (section 8). The old trading-bot is a reference only.
3. Primary stack for the first buckets: **Base + Uniswap V3/V4**.
4. Default every new trading path to paper/shadow mode.
5. Preserve the modular, risk-aware style of the original project.
6. When implementing the degen bucket, apply staged filtering, rejection memory, and strict position discipline. Expect it to eventually live on Solana.
7. Keep the overall identity as a multi-bucket capital allocator, not a pure memecoin sniper.
8. Ask when something is unclear, including small choices, and state assumptions explicitly (user's choice, October 19, 2026: the user wants to be more involved; this follows `.cursor/rules/karpathy-guidelines.mdc`). Document the answer.
9. Surface any place where parameters remain unvalidated.
10. Work in the `capital-system` repository folder, not the home folder.
11. Follow the repo's `.cursorrules`:
    - never commit unless the user has reviewed the changes and approved the commit
    - use Pino structured logging
    - add a one-line `CHANGELOG.md` entry for any trading-logic change or bug fix
12. Add a development journal entry (section 15) at the end of every session that changes anything.
13. Route every operator feature (Telegram, the future GUI) through `ControlApi` (section 16).
14. Tell the user directly when their environment needs fixing, rather than working around it.
15. Scope is Majors Trader only. Follow the rules for the AI worker in section 17.4. They win wherever they conflict with items above.
16. Follow `.cursor/rules/karpathy-guidelines.mdc`: think before coding, keep the minimum that solves the problem, make surgical changes, and define verifiable success criteria. Where it conflicts with item 8 or any other item above, the Karpathy guidelines win, except that section 17.4 still wins over everything in this section.

The user wants to hit the ground running. Optimize for clarity, safety, and incremental progress that can be left running in paper mode.

---

## 12. Build Status (as of October 15, 2026, fixes after the first paper run)

**v1 step 1, the portfolio shell, has been coded, tested (23 tests when it was written), reviewed and committed.** No real strategy exists yet. Both buckets are placeholders that always answer "no trade", so the shell can run unattended.

What exists in the repository:
- `config/portfolio.js`: every number, each marked UNVALIDATED.
- `src/portfolio/portfolioManager.js`: runs each bucket on a timer and pushes every request through one pipeline: sizer, then bucket risk, then global risk, then capital allocator, then executor. Every outcome is written to a `decisions` table: NO_TRADE, REJECTED, SHADOW, APPROVED or ERROR.
- `src/portfolio/capitalAllocator.js`: one persisted ledger per bucket (cash, in-use, realized P&L) plus a reserve that can never be traded.
- `src/risk/globalRisk.js` and `src/risk/bucketRisk.js`: portfolio-wide and per-bucket limits (details in section 13).
- `src/risk/positionSizer.js`: the old sizing math, made relative to each bucket.
- `src/buckets/`: the bucket base class, intent helpers (`noTrade`, `tradeIntent`, `closeRequest`), the registry, and the placeholder `NullBucket`.
- `src/execution/`: the adapter interface, a paper executor (simulated fee and slippage), and a live stub that refuses to trade.
- `src/persistence/db.js`: SQLite. Tables: buckets, ledger, positions, trades, decisions, risk_state, settings, equity_snapshots.
- `src/control/controlApi.js`: the single command, query and event surface.
- `src/alerts/telegram.js`: Telegram as a thin client of ControlApi.
- `src/index.js`: entry point. `npm start` runs the system; `npm run status` prints status JSON.
- `test/`: tests for the allocator, risk rules, the full pipeline, and Telegram.

Docs written in session 2: `docs/JOURNAL.md`, `.cursor/rules/journal.mdc`, `CHANGELOG.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/GUI_VISION.md`.

The shell and docs were committed by the user on October 13, 2026 (commit `f06ec15`) and pushed to the private GitHub repo https://github.com/tj-suijin/capital-system.

**Bucket 1 (LiquidDirectional), in progress.** Parts 1 to 4 of 5 are done and committed, and part 5's setup is committed and pushed too. Only the 7-day run itself is postponed (see the superseded plan below):
1. Done: market data for the Uniswap V3 WETH/USDC 0.05% pool on Base (on-chain verification, backfill, live stream, candles). Verified against the live chain with the user's Alchemy key.
2. Done: indicators (with the ADX and RSI fixes), regime detector, both strategies, and the analyst.
3. Done and committed (`9896957`): the bucket class (entries, exits including the 4-hour limit, stale-data and stop sanity checks). 57 tests passing; ran live with `npm start`.
4. Done and committed ("Bucket 1 part 4: mark-to-market valuation"): mark-to-market valuation. Equity, sizing, the high-water mark, the drawdown halt, exposure, snapshots, status and a new Telegram `/positions` command all use the live pool price. 66 tests passing.
5. Setup done, run postponed: the 7-day paper run. The setup was coded, tested (94 tests at the time, including a 3-day replay through the full pipeline) and smoke-tested live. It adds:
   - a restart supervisor (`npm run paper`) and a logon scheduled task
   - a single-instance lock and crash logging
   - Telegram digests at 08:00 and 21:00, plus alerts for restarts, data outages and error bursts
   - `npm run report` for the end-of-run review
   - an Exerciser test bucket that trades on a schedule
   - a paper-only 45% minimum confidence for bucket 1
   - $4,000 of paper capital on a fresh database

   The setup was committed as `0c46d45` and later pushed. The run started at 17:31 on Oct 14, 2026, and the user stopped it after 7.5 hours to review.
   - Operation was clean.
   - Bucket 1 lost \$3.72 over 3 trades, all bought in the first minutes of a sudden 3% ETH drop.
   - The Exerciser behaved as designed.

   The findings and the open questions are in `docs/JOURNAL.md` (Oct 15, 2026) and in `reports/paper-run-20261015-0059.md`, which is local and gitignored.

   **Fixes from that review (session 6, Oct 15, 2026)** were committed as `6be9bf7` and pushed:
   - stops and targets are checked on every price tick;
   - the bucket-risk settings gain a cooldown after a stop-out, spacing between entries, and no adding to a losing position;
   - bucket 1 gains a fast-move filter;
   - paper slippage grows with volatility.

   **Then, in the same session:**
   - **Renames, IDs included:** bucket 1 is now Majors Trader (`majorsTrader`), the degen bucket Memecoin Lab (`memecoinLab`), and the Exerciser System Test (`systemTest`).
   - **Two buckets off:** Memecoin Lab and System Test are switched off, so the reserve is 40%.
   - **Telegram:** messages use names, and buckets that are off get one line.
   - **Allocator guard:** startup refuses to double-count capital after a rename.
   - **Logging:** tests no longer write to the log files.

   108 tests passed at the last run, on the Windows PC on October 15, 2026. They have not been re-run on the Mac (see section 14). Run 1's database is archived in `data/archive/run1-2026-10-14/`.

**Superseded plan (October 15, 2026, evening).** The 7-day run was going to restart next, with the backtester after it. That order is reversed. The 7-day run is now postponed until the thesis, the kill criteria and the backtester exist (section 17). The paper run setup stays in the repo, ready for later.

See `docs/JOURNAL.md` for details.

---

## 13. Technical Decisions from the First Build Session

- **Stack:** Node 24, ESM, plain JavaScript.
- **Database:** Node's built-in `node:sqlite`, not `better-sqlite3`. This avoids the Windows Visual Studio Build Tools problem.
- **Tests and logging:** `node:test` for tests; Pino for logs (pretty output on the console, JSON in `logs/app.log`, errors also in `logs/errors.log`).
- **Daily and weekly loss limits:** global limits of 3% and 8% of the high-water mark, measured over rolling windows. They **block new entries** and clear on their own as the window rolls.
- **Max drawdown (15% from the high-water mark):** causes a **persisted hard halt**. Only a human `/unhalt` clears it, and unhalting resets the high-water mark to current equity.
- **Gross exposure cap:** open positions may not exceed 50% of total equity.
- **Exits are never blocked** by halts, pauses or wind-down, because closing reduces risk.
- **Per-bucket limits:** max concurrent positions, max position size as a share of the bucket, risk per trade, and the bucket's own daily loss limit. Each bucket can also be paused on its own.
- **Modes per bucket:**
  - `paper`: simulated fills
  - `shadow`: every check runs, but no capital moves; logged as SHADOW
  - `live`
- **Live gate:** a bucket trades live only if all of these hold, otherwise the program refuses to start:
  1. `TRADING_MODE=live`
  2. The bucket has `mode: 'live'` and `live: true`
  3. The bucket is not `paperOnly` (the Degen bucket is)
  4. A real live adapter is registered. None exist yet.
- **Long-only spot for now.** The old Aave short logic is not carried over yet.
- **Equity is marked to market** (since bucket 1 part 4): open positions are valued at the bucket's latest price, and drawdown includes unrealized losses. Daily and weekly loss limits stay realized-only.
- **Changing allocation percentages in config does not move capital** that is already in the ledgers. Rebalancing is a deliberate, manual act.
- **Starting parameters (all UNVALIDATED):**
  - $4,000 paper capital (raised from $1,000 for the paper run)
  - Majors Trader 60%, Memecoin Lab 3% (off), System Test 2% (a test bucket; off), Reserve 35%, or 40% while both are off (the reserve also holds the future Yield/Swing share)
  - Bucket 1 enters at 55% confidence in shadow and live, 45% in paper
  - Paper fee 0.05%, slippage 0.10% plus 25% of the recent 1m range
  - Buckets evaluate every 60 seconds; heartbeat every 5 minutes

---

## 14. User Environment Notes

- The project needs Node 24 or newer (it uses the built-in `node:sqlite`). The user works on two machines:
  - **Windows PC:** PowerShell, Node 24. The restart supervisor (`npm run paper`) and the scheduled-task installer are PowerShell scripts, so they run only here for now.
  - **Mac:** Node is installed. On October 19, 2026 it was v22.22.2, below the required 24, and `npm install` had not been run (no `node_modules`), so the tests do not run there yet. There is no PowerShell, so `npm run paper` does not work there. `npm start` is the way to run it, but it has not been tried on the Mac.
- **Open the repository folder itself as the Cursor workspace.** Working from the home folder makes every file write prompt for approval (seen on Windows).
- Git identity is set globally (`wave!`, a personal Gmail address). Switch to GitHub's no-reply email before pushing to any public repo.
- `gh` (the GitHub CLI) is installed on Windows and logged in as `tj-suijin`. GitHub is also linked to the user's Cursor account. The repo uses LF line endings via `.gitattributes`.
- On the Windows PC, npm warns `Unknown env config "devdir"`, probably left over from the Build Tools attempt. The user should remove that setting.
- Telegram keys go in `.env` (template: `.env.example`). Without them the Telegram controls are off.
- On the Windows PC, Cursor's agent sandbox does not work, so agent terminal commands fail inside it. Fixed in session 2: Cursor Settings > Agents uses Allowlist mode with sandboxing off, and `npm test`, `npm run status`, `git status`, `git diff` and `git log` are allowlisted. Other commands ask for approval.

---

## 15. Development Journal (requested by the user)

The user wants a running journal of everything built and changed.
- `docs/JOURNAL.md`: newest entry first. Each entry covers: date, bucket or area, what changed, why, decisions, unvalidated items, next steps and open questions. Write in plain, complete sentences for the user, not agent shorthand.
- `.cursor/rules/journal.mdc`: an always-on rule so every agent session adds an entry automatically.
- `CHANGELOG.md` stays separate: a terse list of trading-logic changes.

---

## 16. GUI (planned, not built)

> **Deferred (October 19, 2026).** The GUI is not worked on until the user has made real money with this project.

The user wants a GUI: a more visual version of the Telegram commands, with the feel of the **peak DeFi days (DeFi Summer 2020–21)**.
- **Look:**
  - dark background with neon accents: Uniswap pink and magenta, synthwave purple and cyan
  - glowing cards with gradient borders
  - retro or monospace numbers
- **Screens:**
  - Portfolio home: equity, P&L, high-water mark, a drawdown gauge, an exposure bar, and a clear halt banner
  - Bucket cards styled like yield-farm pool cards: mode badge, equity, P&L, open positions, 24h decision counts, pause toggle
  - A distinct "locked" reserve card
  - A live decision ticker, where "no trade" looks calm and normal
  - Positions and trades tables
  - Equity charts built from `equity_snapshots`
  - Big glowing wind-down, halt and unhalt buttons with confirmation dialogs
- **Safety:** no live-trading toggle in the GUI.
- **Plumbing:** the GUI talks only to `ControlApi`, through a small localhost-only HTTP + WebSocket server. A separate frontend (likely React + Vite) connects to that server and never imports trading modules. Equity snapshots are already being recorded, so charts will have history from day one.

---

## 17. Scope Freeze and Strategy Focus (October 15, 2026)

**This section wins wherever it conflicts with sections 1–16.** It records the outcome of a discussion between the user and an external advisor. The user wrote the summary in `deepseekconvo.md`; this is the maintained version.

### 17.1 Why

The project drifted from its intent. The goal was a trading bot. It grew a multi-bucket portfolio layer (allocator, global risk, registry, decision pipeline, ControlApi, Telegram, placeholder buckets) before any single strategy had a validated edge. The architecture is good and stays. The ordering was wrong.

The user's own reading of the first paper run:

> The bot works fine, but results so far give me the feeling it will keep trading flat, since the systems are good at preventing losses.

That is the risk system succeeding in the absence of an edge to protect. It is not a bug. The machine is sound; the open question is whether Majors Trader has anything worth doing. The user also said:

> I went in wanting a pure trading bot and ended up creating a bot with multiple bucket capability. [...] I've been overthinking.

> I gotta focus on one thing at a time.

### 17.2 Scope: Majors Trader only

v1 is the Majors Trader bucket and nothing else. Memecoin Lab, System Test, Yield/Carry, Swing/Day and any traded reserve are future work. They are not built, expanded, refactored or optimized until Majors Trader has a documented thesis, a backtested result, and a paper or live track record that the user has reviewed and accepted.

This is a freeze, not a deletion:
- **Keep** the bucket base class, registry, intent helpers and `NullBucket`.
- **Keep** the config entries for Memecoin Lab and System Test. They stay off.
- **Do not** add shared services or abstractions justified only by a future bucket.
- **The reserve stays.** It is capital held back, which is the right default while no edge is validated.

### 17.3 Two missing pieces (both are the user's work)

Both apply to Majors Trader only (user's choice, October 19, 2026). If another bucket should use the same logic, the user will decide that when the time comes.

**A pre-registered thesis for Majors Trader.** Three sentences:
1. What the user believes about ETH/USDC on Base (for example, how trends and chop behave).
2. Why trend-following, mean reversion and the regime switch should capture that.
3. Why the captured behavior should be worth more than costs. The paper round trip costs about 0.3% (a 0.05% fee and 0.10% slippage each way, plus volatility slippage), so the thesis should be measured against that.

The thesis does not have to be right. It has to be specific enough to be wrong.

**Explicit kill criteria.** Three numbers, written before the run:
1. If after N trades expectancy is below X, stop.
2. If max drawdown exceeds Y before N trades, stop.
3. If live or paper results differ from the backtest by more than Z, stop and investigate.

They should feel slightly pessimistic. The point is to commit in advance, so that the user cannot later argue that a losing strategy "just needs more time".

**Where they live:** `docs/THESIS.md`. A template with blank placeholders was created on October 19, 2026. It stays blank until the user writes it.

| Item | Status |
| --- | --- |
| Thesis (3 sentences) | NOT WRITTEN. User's work. |
| Kill criteria N, X, Y, Z | NOT WRITTEN. User's work. |

The AI worker may ask questions, structure the text, or offer clearly labeled candidates. It does not choose what the user believes or what counts as failure.

### 17.4 Rules for the AI worker (these win over section 11)

1. **Scope is Majors Trader only.** If asked to work on another bucket, ask whether Majors Trader is done first.
2. **No abstractions for future buckets.** "We'll need it when bucket 3 arrives" is not a reason.
3. **The backtester is the next build,** before the paper run, any parameter tuning or any new strategy.
4. **The thesis and kill criteria are the user's.** If asked to write a thesis, give three candidates labeled as candidates, and ask which, if any, matches what the user believes.
5. **Surface the thesis and kill criteria when results come in.** Ask: "Did the thing you believed actually happen? Are we approaching a kill criterion?" Do not let "it just needs more time" go unnamed.
6. **Flag curve-fitting.** If a parameter change is proposed in response to a specific loss, say so, and ask whether the thesis or the outcome is driving it.
7. **Small, reviewable increments.**
8. **Do not drift back to multi-bucket work.** If a change to the shell, allocator, global risk or ControlApi is not required by Majors Trader, stop and ask.
9. **System Test should test failure paths** when it is next used: a forced rejection, a forced risk-limit hit, a forced halt and a restart mid-position. (Proposed by the advisor; the user has not yet confirmed.)

### 17.5 New order of work

1. Update `VISION.md` and `.cursorrules` (done).
2. User writes the thesis.
3. User writes the kill criteria.
4. Spec the backtester (17.6).
5. Build it.
6. Run it over at least 6 months of data.
7. Read the results, including "no edge".
8. Only then resume the paper run, as an operational test and not a strategy test. A week with a handful of trades cannot show an edge.
9. Decide: go live small, revise the thesis, or shelve Majors Trader.

### 17.6 Backtester: starting spec

The advisor wrote this as a starting spec, not a mandate. The user should edit it.

For a given strategy, parameter set and window, output:
- trade count (fewer than about 30 means the result is not meaningful, whatever the P&L);
- win rate, with a confidence interval;
- average win and average loss, in percent and dollars;
- **expectancy per trade**, the number that matters;
- max drawdown, peak to trough and its duration;
- Sharpe or Sortino, with the caveat that they are unstable at low trade counts;
- the equity curve, saved so runs can be compared;
- **parameter sensitivity:** the same run with key parameters moved by ±10% and ±20%, flagging loudly if the sign of expectancy flips;
- a **regime breakdown:** trend regimes against chop, to show whether the regime detector helps.

Constraints:
- It must use the **same code** as live for indicators, regime detection, strategies, sizing and risk. Separate implementations would make the backtest worthless.
- It logs to SQLite in a schema compatible with the live `decisions` table, so backtest, paper and live runs can be compared.

Engineering notes (from the agent, not the advisor):
- Majors Trader runs on the wall clock and a live feed today, so "same code" means a replay clock and a candle-fed data source in place of `MarketData`.
- The backfill is built for 24 hours. Six months of `eth_getLogs` on this pool needs chunking, resumability and a check on the Alchemy compute cost.
- One-minute candles hide moves inside the minute, so tick-level stops are not reproducible from candles alone. Whether to store raw swaps is an open design question.
- The entry rules and the fast-move filter added after the first paper run were calibrated on about 2 days of candles, in response to one event. The backtester should test them like any other parameter.

### 17.7 What does not change

The engineering patterns in section 7, the four-condition live gate, "exits are never blocked", the risk architecture, paper-first, the decision log (including `NO_TRADE`), ControlApi as the single operator surface (the GUI is deferred until the user has made real money, section 16), and the `.cursorrules` and journal practices.

Section 2 is the exception: section 17 wins where they conflict (see the note at the top of section 2).

---

**End of Vision Document**
