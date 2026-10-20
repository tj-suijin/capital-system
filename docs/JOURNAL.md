# Development Journal

A running record of everything built and changed, newest entry first. Each entry covers what changed, why, the decisions made, what is still unvalidated, and what comes next.

---

## October 19, 2026 (session 8, continued): Doc conflict cleanup

**Area:** Docs and agent rules. No trading code was changed.

**What happened:** The user asked for a read-only check for conflicts between the docs and the rules. It found three real conflicts, some unclear wording and some stale text. The user then decided each item, and the agent made only those changes.

**What changed:**
- `.cursorrules`: the commit rule now says the agent never commits unless the user has reviewed the changes and approved the commit. The old wording ("user review strings") was unclear.
- `docs/VISION.md`:
  - Section 11.8 and 11.16: the Karpathy guidelines now win over the old "only ask for big decisions" rule. The agent asks when something is unclear, including small choices.
  - Section 2 has a note that section 17 wins where they conflict. Section 17.7 no longer lists section 2 as unchanged.
  - Section 16 and 17.7: the GUI is deferred until the user has made real money.
  - Section 17.3: the thesis and kill criteria apply to Majors Trader only, and `docs/THESIS.md` now exists as a template.
  - Section 17.5 step 1, section 12 (build status) and the test counts: stale text fixed.
  - Section 14 and the `W:\` paths: made OS-neutral, with the Windows PC and Mac labeled separately.
- `docs/GUI_VISION.md`: "When" now matches the deferral.
- `docs/THESIS.md`: new template. The thesis, kill-criteria numbers and dates are blank placeholders for the user.
- `README.md` and `docs/ARCHITECTURE.md`: the setup command works on both systems, and the PowerShell supervisor is labeled Windows-only.
- `docs/DECISIONS.md`: the Karpathy entry was updated and a new "Doc conflict decisions" section was added.
- `docs/ARCHITECTURE.md`: "Adding a bucket" now says the user has frozen progress on additional buckets, so it no longer conflicts with the scope freeze.
- `.cursor/rules/model-reminder.mdc`: the reminder is now one light line that does not stop work.

**Why:** The user wants to be more involved, wants one clear answer on which rule wins, and works on two machines.

**Decisions** (also in `docs/DECISIONS.md`):
- The Karpathy guidelines win over the older "decide small things yourself" rule.
- The GUI is deferred until after real money.
- Section 17 wins over section 2, and the thesis applies to Majors Trader only.
- Commits need the user's approval of the commit.
- The docs are OS-neutral.

**Left alone on purpose (the user's choice):** the "three numbers" wording in 17.3, the old bucket names in `VISION.md` sections 1 to 8, and the old "next steps" in session 6 of this journal. One item stays open: whether doc-only work should trigger the model reminder at all (not decided; the reminder is now only a light nudge).

**Not verified:**
- The test count. `npm test` fails on the Mac: `node_modules` does not exist and Node is v22.22.2, while the project needs 24 or newer. The docs now say "108 tests passed at the last run, on the Windows PC on October 15", not that they pass today.
- `npm start` on the Mac has not been tried.
- The agent read the Windows-specific text but did not check any code for other Windows assumptions beyond `package.json` and the PowerShell scripts' names.

**Next steps and open questions:**
1. The user's work: write the thesis and kill criteria in `docs/THESIS.md`. The user is still working on the thesis and may revise section 2.
2. On the Mac, install Node 24 and run `npm install` before running tests or the system.
3. A cross-platform replacement for the PowerShell supervisor is not scheduled. The backtester comes first.
4. Then the backtester spec, as before. Do not restart the paper run or tune parameters.

---

## October 19, 2026 (session 8): Karpathy guidelines added to Cursor rules

**Area:** Cursor agent rules and docs. No trading code was changed.

**What changed:**
- The user added `.cursor/rules/karpathy-guidelines.mdc`, an always-on Cursor rule. It tells the agent to think before coding, keep the minimum that solves the problem, make surgical changes, and define verifiable success criteria before looping.
- `docs/DECISIONS.md`: recorded the choice and the user's theory.
- `docs/VISION.md` section 11: added a pointer so the vision still lists the agent rules in one place.

**Why:** The user believes these guidelines will help the project in a positive way. The file itself says they bias toward caution over speed, and that they are working if diffs get smaller, rewrites from overcomplication drop, and clarifying questions come before implementation rather than after mistakes.

**Decisions:**
- The Karpathy guidelines are now part of how the agent is supposed to work on this repo, alongside `.cursorrules`, the journal rule, and the model reminder.
- They merge with the existing project rules. Scope freeze and thesis ownership still apply. (The first version of this entry said small product defaults could be decided without asking. The user reversed that later the same day; see the next entry.)

**Unvalidated:** Whether the guidelines actually help. That is the user's theory. It has not been measured. The test the file names is fewer unnecessary changes in diffs, fewer rewrites, and questions coming earlier.

**Not verified:** No tests were run, because no code changed. The user is on the Mac now and said they will commit at the end of this work, so these files may still be uncommitted.

**Next steps:** Same as session 7. Thesis, kill criteria, then the backtester spec. Do not restart the paper run or tune parameters until the backtest has been read.

---

## October 15, 2026 (session 7): Scope freeze to Majors Trader

**Area:** Docs and agent rules only. No code was changed, and nothing was committed.

**What happened:** The user shared notes (`deepseekconvo.md`) from a discussion with an outside advisor. The conclusion: the project built the portfolio layer before any strategy had a proven edge, and the first paper run's flat result is the risk system working with nothing to protect. The user chose to narrow the project to one bucket and to put the backtester ahead of the paper run.

**What changed:**
- `docs/VISION.md`: added section 17 (scope freeze, the two missing pieces, rules for the AI worker, the new order of work, a starting backtester spec). It wins over sections 1–16 where they conflict. Also updated the header, the v1 priority list in section 4, a note on section 6, the success criteria in section 10, items 2 and 15 in section 11, and the "next steps" line in section 12.
- `.cursorrules`: added a Scope section with the rules for the agent.
- `docs/DECISIONS.md`: added "Scope freeze" and new open questions.

**Why:** The user wants to focus on one thing at a time. A strategy needs a written thesis and kill criteria before its results can be interpreted. Otherwise the user would adjust parameters after each loss, which is how overfitting happens.

**Decisions:**
- v1 is Majors Trader only. The shell, bucket abstraction and the other buckets' config stay, dormant.
- The 7-day paper run is postponed until after a backtest over at least 6 months.
- The thesis and kill criteria are the user's, and the agent only helps structure them.
- The advisor's suggestion that System Test should test failure paths (forced rejection, risk-limit hit, halt, restart mid-position) is recorded as proposed. The user has not confirmed it.

**Things the agent noticed while updating the docs:**
- The notes quote the round-trip cost as "roughly 0.15%". With the paper settings it is about 0.3%, so I used that figure in section 17.3. The thesis should be measured against 0.3%.
- The entry rules and the fast-move filter from session 6 were calibrated on about 2 days of candles and in response to one event. The backtester should test them like any other parameter.
- "Same code as live" means Majors Trader needs a replay clock and a candle-fed data source. Today it runs on the wall clock with a live feed.
- Six months of `eth_getLogs` needs a chunked, resumable backfill, and a check of the Alchemy compute cost. One-minute candles cannot reproduce tick-level stops, so raw swap storage is an open design question.

**Unvalidated:** every parameter is still unvalidated. The backtester is meant to change that.

**Not verified:** the docs were checked only by the agent and the user's skim. `docs/THESIS.md` is mentioned in section 17.3 but does not exist yet. The user would create it. No tests were run, since no code changed.

**Wrap-up:** The user asked the agent to commit these changes. The user chose not to have `Downloads\adviceVISION.md` read, so it was not read and has no effect on these docs. The 7-day paper run was not started and stays postponed.

**Pick up tomorrow (in this order):**
1. **Thesis (user's work, three sentences).** What do you believe about ETH/USDC on Base? Why would trend-following, mean reversion and the regime switch capture it? Why would that beat the roughly 0.3% round-trip cost? Ask the agent for questions or labeled candidates if stuck. Put it in `docs/THESIS.md`.
2. **Kill criteria (user's work, four numbers).** N trades and X expectancy, Y max drawdown, Z allowed gap between backtest and paper or live results. Write them while not attached to the outcome, and make them slightly pessimistic.
3. **Backtester spec** (VISION section 17.6). Use Opus for the design. Open design questions: replay clock and candle-fed data source so the real code runs, raw swaps versus 1-minute candles, and the Alchemy compute cost of a 6-month backfill. Build it in small increments after the spec.
4. **Do not** restart the paper run, tune parameters or touch other buckets until the backtest has been read.

**Model for tomorrow:** Opus (about 200k context, high effort if wanted extra care) for the backtester design and any look at results. Sonnet for the plumbing once the design is settled.

---

## October 15, 2026 (session 6, continued): Model reminder before coding

**Area:** Cursor agent rules, not trading code.

**What changed:** Added `.cursor/rules/model-reminder.mdc` so every chat reminds the user which model to pick before writing code.

**Why:** The user wants to stop defaulting to Claude Opus 5.5 with 1M context and high effort. That setup is overkill for this repo and burns Cursor's Other Models pool (or an Anthropic bill) on work Sonnet can do. They asked for a reminder until the habit sticks.

**Decisions:**
- Everyday building uses Claude Sonnet at about 200k context and medium effort.
- Opus at about 200k, with high effort if they want extra care, is for money decisions: entries, exits, risk, sizing, allocation, backtester design, and reviews of paper runs or backtests.
- 1M context is only for a chat that is actually full.
- DeepSeek is optional for isolated mechanical work, not the main model for this project.

**Not verified:** The reminder will show up in the next coding session. This chat did not write trading code.

**Session wrap-up:** The user is stopping here and will most likely continue on the MacBook. This rule and journal note were committed and pushed so that machine has them after a pull. The 7-day paper run was not started.

**Next steps:** On the MacBook, pull `main`, then design the backtester. Use Sonnet for everyday building and Opus only for money decisions. Start the 7-day paper run on the PC when leaving for a few days, and do not pull or restart the bot mid-run.

---

## October 15, 2026 (session 6, continued): Renames, Telegram cleanup, and ready to restart

**Area:** Bucket names and IDs, Telegram, the capital allocator, logging, and the restart of the 7-day run.

**What happened:**
- **The fixes were committed and pushed.** The agent committed them as `6be9bf7`, at the user's request, and pushed it together with `0c46d45` to GitHub.
- **The buckets were renamed, IDs included,** so Telegram commands use the new IDs, such as `/pause majorsTrader`. The code folders and class names keep their old names.

  | Old ID | New ID | Name |
  | --- | --- | --- |
  | `liquidDirectional` | `majorsTrader` | Majors Trader |
  | `degenMemecoin` | `memecoinLab` | Memecoin Lab |
  | `exerciser` | `systemTest` | System Test |
- **Memecoin Lab and System Test are off** (`enabled: false`). A disabled bucket gets no ledger, so on a fresh database the reserve holds 40% ($1,600) and Majors Trader holds $2,400.
- **The Telegram cleanup**, in the layout the user approved:
  - `/status` shows the portfolio in two lines. Each running bucket gets a line with its equity, open positions and their P&L, and its realized P&L over 24 hours, plus its regime. Each bucket that is off or only a placeholder gets one line: "⚪ Memecoin Lab: OFF".
  - `/buckets` lists every bucket with the ID the commands take.
  - The start message lists which buckets are running and which are off.
  - The digest adds the same OFF lines and shows rejection reasons in words instead of codes like `BR_006`.
  - Open, close, alert, `/positions` and `/decisions` messages use bucket names instead of IDs. Underscores in reasons are shown as spaces, and dollar amounts get thousands separators.
- **New guard in the allocator.** On an existing database, a renamed or newly enabled bucket would get a new ledger while the old ledgers kept their capital, so it would be counted twice. Startup now refuses and says to archive the database.
- **Logging fix.** The agent had set `LOG_LEVEL=error` in its shell for a replay script and then ran the tests in the same shell. That made the test processes write their deliberate errors (fake halts, failed price lookups) into the real `logs/app.log` and `logs/errors.log` between 01:43 and 02:01. Test processes now never write to the log files, whatever `LOG_LEVEL` says. The stray lines are older than the new run, and the report only reads log lines inside the run window, so they don't affect it.
- **Run 1's database was archived** to `data/archive/run1-2026-10-14/capital.db`. `data/capital.db` no longer exists, so the next start creates a fresh one.
- **Smoke run.** The agent ran a smoke test on a separate database (`data/smoke/`, deleted afterwards) for about 5 minutes.
  - **Ledgers:** only `majorsTrader` ($2,400) and the reserve ($1,600) were created.
  - **Data:** 24 hours of candles were backfilled and live candles kept arriving.
  - **Decisions:** Majors Trader decided every minute; the market was in a downtrend, so there were no entries.
  - **Telegram:** it sent its start message to the user's phone. The agent ended the process with a kill, so no "stopped" message was sent.

**Decisions:** all recorded in `docs/DECISIONS.md` ("Plain names, short messages" and "Bucket names").

**Not verified:**
- No position opened during the smoke run, so tick-level stops have only been exercised by the tests (108 passing).
- How the new Telegram messages look on the phone, apart from the start message.

**Next steps:**
1. The user starts the 7-day run from their own PowerShell window: `npm run paper`. Windows Update is still paused, but its pause may need extending to cover the full 7 days.
2. Design the backtester while the run goes.
3. Later: research on indicators and regimes, then risk profiles and dynamic allocation.

---

## October 15, 2026 (session 6): Bucket 1 fixes after the first paper run

**Area:** Bucket 1 (LiquidDirectional), bucket risk, the paper executor and the portfolio manager's exit path.

**The user's notes for this phase.** Before anything changed, the user shared their plans. The user wants to discuss every change before it is made.
- **Backtesting:** every bucket should have a backtest feature, so new strategies can be tested and rolled out only if they pass.
- **Names:** clearer bucket names. Bucket 1 will be renamed **Majors Trader**.
- **Telegram:** cleaner messages. A bucket that isn't running should show one line such as "NOT ON" instead of a full set of stats.
- **Allocation:** capital allocation should change dynamically with the number of active buckets, with plug-and-play risk profiles. Some months could run at higher risk and trade more; others could sit in assets or farm stablecoins.
- **Research:** which indicators and regimes work for crypto and for particular pairs, so that real signals can be told apart from noise. This ties into the backtester.
- **Overview:** a refresher on what each part of the bot is for.

The agent recommended this order: fix bucket 1's mechanical flaws, rename the buckets and clean up Telegram, restart the 7-day run, build the backtester, do the research, and add allocation profiles last. The user agreed to start with the fixes.

**What changed (all five fixes the user chose):**
1. **Stops and targets are checked on every price tick.**
   - The portfolio manager subscribes to each bucket's price feed (`subscribePrices`). Bucket 1 forwards every accepted swap, and the Exerciser forwards bucket 1's.
   - On each fresh tick, `onPriceTick` asks the bucket for `tickExits`. By default these are only stops and targets, and the position closes at that tick's price. Strategy exits and the 4-hour limit stay on the 60-second cycle.
   - Ticks older than 10 seconds are ignored, for example swaps replayed after a reconnect.
   - A shared `levelExit()` helper now does the stop and target check for both buckets.
2. **No double closes.** A tick and a cycle could close the same position at the same moment, which would have released its capital twice. `closePosition` now lets only the first one through.
3. **Entry rules in bucket risk.** These are optional per-bucket settings, off unless configured:
   - `cooldownAfterStopMs` (BR_005): no entry within 15 minutes of a stop-out. A stop-out is a close whose reason starts with "stop loss".
   - `minEntrySpacingMs` (BR_006): at least 10 minutes between entries on the same side.
   - `noEntryWhileLosing` (BR_007): no entry while an open position is under water at its mark.

   They are set for bucket 1 and Degen. The Exerciser is left without them, because its fixed schedule is the test.
4. **Fast-move filter for bucket 1** (`fastMove.js`), applied to both strategies.
   - **Rule:** no entry while any of the newest 6 one-minute candles has a high-to-low range of at least the larger of 0.4% and 3 times the average of the 60 candles before them.
   - **Why the forming minute counts:** the newest candle is the one still forming, and the candle builder re-saves it on every swap. That's why entry #7 had seen the crash 28 seconds into the minute.
   - **Calm-down:** the block lasts until 5 calm candles have completed. The no-trade reason starts with the strategy's name, so the report still infers the regime.
5. **Paper slippage grows with volatility:** 0.10% plus 25% of the larger range of the bucket's newest two 1-minute candles (`rangeSlippageShare`). Two candles are used because early in a minute the forming candle has barely moved. At the moment #7 opened, this works out to about 0.31%.

**Calibration (read-only, from about 2 days of stored 1-minute candles, Oct 12 23:15 to Oct 15 00:56):**
- A typical minute moves 0.02%, and 99% of minutes move less than 0.32%.
- A rule based only on ratios (3 times the average range, or 4 times the usual swap count) would have blocked 31% of all minutes. Small wiggles in quiet hours look large in relative terms.
- Adding a minimum move of 0.4% leaves 7 episodes and 1.6% of minutes blocked. The user chose 0.4% over 0.3% (2.7% of minutes) and 0.5% (1.1%).
- Swap count adds nothing once the minimum is in place. Some minutes have about 40 swaps and no price change, probably arbitrage bots. It was dropped.

**Replay of the stored candles (agent's sanity check; not a backtest, and the script is not in the repo):**
- **Method:** the real bucket 1 code, once with the old settings and once with the new ones, over about 33 hours after warm-up. The replay only sees completed minutes, so the crash entries come one minute later than they did live.
- **Old settings:** 16 entries, 5 of them during the 21:22 crash.
- **New settings:** 4 entries, none during the crash.
  - The spacing rule collapsed two clusters of trend-following entries, one at 22:48–22:54 on Oct 13 and one at 03:25–03:26 on Oct 14.
  - The fast-move filter also blocked a mean-reversion entry at 07:31 on Oct 14.
- **Caveat:** exits were checked once a minute at the candle close, so P&L from this replay is not meaningful and isn't reported.

**Decisions:**
- All five fixes above, with a 0.4% minimum move. The paper threshold stays at 45%. Shadow and live stay at 55%.
- For the next 7-day run, the Degen placeholder and the Exerciser will both be turned off. That is part of the next step, not this one.
- Bucket 1 will be renamed Majors Trader in the next step. The agent pointed out that "Liquidity Pool Trader" would be confusing, because in DeFi "liquidity provider" means depositing into a pool, which bucket 1 doesn't do.

**Unvalidated:** every new number: the 15-minute cooldown, the 10-minute spacing, the 0.4% minimum, the 3× multiple, the 60-candle lookback, the 5 calm candles, and the 25% slippage share. The slippage share can only be checked against real fills.

**Not verified:**
- The code has not been run against the live feed. The 106 tests pass, including new tests for tick exits, the double-close guard, the entry rules, the fast-move filter and slippage.
- The tick handler's load during a crash (about 250 swaps a minute) has only been reasoned about: one small database query per tick per bucket.

**Next steps and open questions:**
1. Review and commit these fixes. `0c46d45` is still not pushed.
2. Rename the buckets, turn off Degen and the Exerciser, and clean up Telegram.
3. Archive `data/capital.db` (for example to `data/archive/run1-2026-10-14/`) and restart the 7-day run on a fresh database.
4. Design the backtester: months of candles from the chain, a simulated clock, the real pipeline, and pessimistic fills. Consider storing raw swaps, because one-minute candles hide moves inside the minute.
5. Later: research on indicators and regimes, and risk profiles with dynamic allocation.
6. The new rules cut entries sharply: 4 instead of 16 in the replay. If the 7-day run produces too few trades to learn from, revisit the spacing and the losing-position rule first.

---

## October 15, 2026 (session 5, continued): First 7.5 hours of the paper run, and review

**Area:** The bucket 1 paper run (part 5). No code was changed in this part of the session.

**What happened:**
- On Oct 14 the agent committed the paper run setup as `0c46d45`, at the user's request. It has **not been pushed** (`main` is 1 commit ahead of `origin/main`).
- The user paused Windows Update, archived the old database to `data/archive/`, deleted `data/smoke/`, and started `npm run paper` from their own PowerShell window at 17:31 on Oct 14. They used neither Cursor nor the scheduled task.
- The user stopped it with Ctrl+C at 00:56 on Oct 15, after about 7.5 hours, to discuss the results. The system recorded a clean stop.
- The agent read the data back read-only, then wrote `reports/paper-run-20261015-0059.md`: the generated report plus review notes with a minute-by-minute table of the 21:22 drop. `reports/` is gitignored, so the file exists only on this machine.

**Results:**

| | Start | End | Change |
| --- | --- | --- | --- |
| Portfolio | \$4,000.00 | \$3,994.76 | −\$5.24 |
| Bucket 1 (LiquidDirectional) | \$2,400.00 | \$2,396.28 | −\$3.72 over 3 trades, all stopped out |
| Exerciser | \$80.00 | \$78.48 | −\$1.52 over 13 trades |
| ETH | \$2,415.72 | \$2,348.86 | −2.77% |

**Operation passed:**
- Heartbeat coverage was 100%, with one start and one clean stop.
- There were no data outages, no errors in `errors.log` and no halts. Memory settled at about 85 MB, and the database grew to 0.6 MB.
- One candle gap (18:49) and the wait for the first live swap after startup each blocked a single cycle.
- Five Telegram polls timed out; each recovered after one 5-second retry. No sends failed. Whether the 21:00 digest arrived on the phone has not been confirmed.

**What bucket 1 did in the 21:22 drop.** ETH ranged near \$2,414, then fell about 3% in roughly 7 minutes. The 21:22 minute alone fell 1.1%, with 251 swaps against about 30 normally.
- The regime still read "ranging", so mean reversion bought \$120 at 21:22 and another \$120 at 21:23, both at 50% confidence.
- At 21:24 both positions hit their stops, and it opened a third in the same cycle.
- The regime switched to downtrend at 21:25, and the third position stopped out at 21:28.

**Findings:**
1. **The threshold:** all three entries scored 50%, so the paper-only 45% threshold let them through. At 55% none would have opened.
2. **The regime detector is slow to see a sudden move.** It uses 5-minute candles with long lookbacks, and it took three minutes to see the crash. Meanwhile mean reversion treated the falling price as a dip to buy.
3. **There's no cooldown after a stop-out and no spacing between entries.** The bucket added a second position in the same direction one minute after the first, and re-entered in the same cycle that stopped it out.
4. **Stops are checked once a minute, at the last price, so losses run past them.** Bucket 1's trade #7 had a 0.60% stop and lost 1.39%. The Exerciser's #6 had a 0.3% stop and lost 1.29%.
5. **Paper slippage is optimistic in a fast market.** Entry fills were 0.3–0.4% above that minute's close because price kept falling within the minute. That isn't a bug, but the 0.10% assumption is too low for moves like this.
6. **The risk limits never came close to triggering.** Bucket 1 lost \$3.72 against its \$120 daily limit. Peak gross exposure was at most about \$270, under 7% of equity.

**The Exerciser worked as designed.**
- It took 13 trades: 5 hit their target, 7 their stop and 1 the time limit. It tripped the position cap once.
- It reached −\$1.52 against its \$1.60 daily limit.
- Targets roughly break even, because a 0.3% target is about the round-trip cost (average win \$0.02, average loss \$0.20).
- Its trades confirm the stop-and-target fix: levels are set from the market price, not the fill.

**Decisions made in the conversation:**
- The user runs the system from their own PowerShell window, outside Cursor. The PC is also a gaming PC. The load is small (about 90 MB and almost no CPU), but closing the console window, or clicking into an old-style console with QuickEdit on, stops or freezes it.
- During the review the code stays unchanged. Reports and docs may be written.

**State left behind:**
- `data/capital.db` holds this partial run, and its `runStartedAt` is 17:31 on Oct 14. Restarting `npm run paper` on it continues the same run window and day count. For a clean 7 days after any strategy change, archive it again first, for example to `data/archive/run1-2026-10-14/`.
- The original pre-run database is in `data/archive/`.
- Windows Update is paused.

**Not verified:**
- the 21:00 digest arriving on the phone
- the logon task (not used yet)
- multi-day memory use and Alchemy usage, because the run was too short

**Next steps and open questions** (these are the topics the user wants to discuss in the next chat):
1. **Threshold:** keep 45% in paper, or go back to 50–55%?
2. **Fast-move filter:** for example, no mean-reversion entries when the last minute's range or swap count is far above normal.
3. **Cooldown and spacing:** a wait after a stop-out, and a minimum gap between same-direction entries in a bucket.
4. **Exit cadence:** check stops on every price tick, or every few seconds, instead of once a minute.
5. **Slippage:** model it according to volatility, or at least judge results with 0.2–0.3% as well.
6. **Restart:** start the 7-day run again after deciding on the above, on a fresh database.
7. **Push:** push `0c46d45` to GitHub.

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
