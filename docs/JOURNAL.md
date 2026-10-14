# Development Journal

A running record of everything built and changed, newest entry first. Each entry covers what changed, why, the decisions made, what is still unvalidated, and what comes next.

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
