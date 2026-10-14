# PROJECT VISION DOCUMENT
## Multi-Bucket Autonomous Capital System

**Last updated:** October 13, 2026 (revised after the second build session; see sections 12–16)  
**Purpose:** Complete context for any coding agent (especially Cursor) so work can continue without the user re-explaining history, philosophy, architecture, or constraints.

**Canonical copy:** `W:\DEV\capital-system\docs\VISION.md`, tracked in git. This is the only maintained copy. The old `W:\DEV\PROJECT_VISION_MultiBucket_Trading_System.md` is no longer kept in sync.

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

**v1 priority:**
1. Portfolio shell + Capital Allocator + Global Risk
2. LiquidDirectional bucket (clean implementation on the chosen stack)
3. DegenMemecoin bucket (paper only, very low notional)
4. Only then consider Yield or Swing

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

- **Decision (Oct 13, 2026):** instead of a GitHub fork, the work happens in a **fresh repository at `W:\DEV\capital-system`**. Selected ideas and code are ported from https://github.com/tj-suijin/trading-bot. The old local clone at `W:\DEV\trading-bot` stays untouched as a reference; it still has some uncommitted changes of the user's.
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

- Clear multi-bucket shape in the repository (even if only 1–2 buckets are real).
- LiquidDirectional bucket running cleanly on **Base + Uniswap** in paper mode.
- Simple portfolio / capital allocation / global risk concepts exist.
- Degen bucket exists at least as a paper skeleton (Solana path can come later).
- System can run unattended in paper mode for extended periods.
- “No trade” happens frequently and is treated as normal.
- User can reason about each bucket’s performance and risk separately.

Profit is a later concern. Survivability, observability, and clean architecture come first.

---

## 11. Instructions for the Coding Agent (Cursor)

When this document is provided:

1. Treat it as the source of truth for product vision and constraints.
2. Prefer forking/extending the existing trading-bot repository over pure greenfield.
3. Primary stack for the first buckets: **Base + Uniswap V3/V4**.
4. Default every new trading path to paper/shadow mode.
5. Preserve the modular, risk-aware style of the original project.
6. When implementing the degen bucket, apply staged filtering, rejection memory, and strict position discipline. Expect it to eventually live on Solana.
7. Keep the overall identity as a multi-bucket capital allocator, not a pure memecoin sniper.
8. Ask clarifying questions only when a decision would significantly change architecture or risk posture. Otherwise make reasonable choices and document them.
9. Surface any place where parameters remain unvalidated.
10. Work in the `W:\DEV\capital-system` workspace, not the home folder.
11. Follow the repo's `.cursorrules`:
    - never commit without the user's review
    - use Pino structured logging
    - add a one-line `CHANGELOG.md` entry for any trading-logic change or bug fix
12. Add a development journal entry (section 15) at the end of every session that changes anything.
13. Route every operator feature (Telegram, the future GUI) through `ControlApi` (section 16).
14. Tell the user directly when their environment needs fixing, rather than working around it.

The user wants to hit the ground running. Optimize for clarity, safety, and incremental progress that can be left running in paper mode.

---

## 12. Build Status (as of October 13, 2026, bucket 1 part 4)

**v1 step 1, the portfolio shell, has been coded, tested (23 passing tests), reviewed and committed.** No real strategy exists yet. Both buckets are placeholders that always answer "no trade", so the shell can run unattended.

What exists in `W:\DEV\capital-system`:
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

**Bucket 1 (LiquidDirectional), in progress.** Parts 1 and 2 of 5 are coded, tested (50 tests passing), reviewed and committed (`d361a61`):
1. Done: market data for the Uniswap V3 WETH/USDC 0.05% pool on Base (on-chain verification, backfill, live stream, candles). Verified against the live chain with the user's Alchemy key.
2. Done: indicators (with the ADX and RSI fixes), regime detector, both strategies, and the analyst.
3. Done and committed (`9896957`): the bucket class (entries, exits including the 4-hour limit, stale-data and stop sanity checks). 57 tests passing; ran live with `npm start`.
4. Done and committed ("Bucket 1 part 4: mark-to-market valuation"): mark-to-market valuation. Equity, sizing, the high-water mark, the drawdown halt, exposure, snapshots, status and a new Telegram `/positions` command all use the live pool price. 66 tests passing.
5. Next: the paper run.

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
  - $1000 paper capital
  - LiquidDirectional 60%, DegenMemecoin 3%, Reserve 37% (the reserve also holds the future Yield/Swing share)
  - Paper fee 0.05%, slippage 0.10%
  - Buckets evaluate every 60 seconds; heartbeat every 5 minutes

---

## 14. User Environment Notes

- Windows, PowerShell, Node 24.
- **Open `W:\DEV\capital-system` as the Cursor workspace.** Working from the home folder makes every file write prompt for approval.
- Git identity is set globally (`wave!`, a personal Gmail address). Switch to GitHub's no-reply email before pushing to any public repo.
- `gh` (the GitHub CLI) is installed on Windows and logged in as `tj-suijin`. GitHub is also linked to the user's Cursor account. The repo uses LF line endings via `.gitattributes`.
- npm warns `Unknown env config "devdir"`, probably left over from the Build Tools attempt. The user should remove that setting.
- Telegram keys go in `.env` (template: `.env.example`). Without them the Telegram controls are off.
- Cursor's agent sandbox does not work on this Windows machine, so agent terminal commands fail inside it. Fixed in session 2: Cursor Settings > Agents uses Allowlist mode with sandboxing off, and `npm test`, `npm run status`, `git status`, `git diff` and `git log` are allowlisted. Other commands ask for approval.

---

## 15. Development Journal (requested by the user)

The user wants a running journal of everything built and changed.
- `docs/JOURNAL.md`: newest entry first. Each entry covers: date, bucket or area, what changed, why, decisions, unvalidated items, next steps and open questions. Write in plain, complete sentences for the user, not agent shorthand.
- `.cursor/rules/journal.mdc`: an always-on rule so every agent session adds an entry automatically.
- `CHANGELOG.md` stays separate: a terse list of trading-logic changes.

---

## 16. GUI (planned, not built)

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

**End of Vision Document**
