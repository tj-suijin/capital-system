# capital-system

A multi-bucket autonomous capital system. A portfolio manager splits capital into **buckets**. Each bucket runs its own strategy, has its own risk limits, and can run in paper, shadow or live mode on its own. Global risk rules apply on top of all of them.

The system is paper-first. **No live trading path exists yet.** Three buckets are configured; the ID in brackets is what Telegram commands take:
- **Majors Trader** (`majorsTrader`) is bucket 1. It trades ETH/USDC on Uniswap V3 on Base in paper mode.
- **Memecoin Lab** (`memecoinLab`) is still a placeholder that always answers "no trade". It is off.
- **System Test** (`systemTest`) is a test bucket, not a strategy. It opens small positions on a schedule to keep the machinery busy during long paper runs. It is off since the first paper run proved those paths.

**Current scope (since Oct 15, 2026):** Majors Trader only. The other buckets stay off and get no work. Next come a written thesis, kill criteria and a backtester; the paper run is postponed until after the backtest. See section 17 of [`docs/VISION.md`](docs/VISION.md).

The product vision is in [`docs/VISION.md`](docs/VISION.md).

## Requirements

- Node 24 or newer. The database is Node's built-in `node:sqlite`, so no native build tools are needed.

## Setup

```sh
npm install
cp .env.example .env   # optional: add Telegram keys (Windows PowerShell: Copy-Item .env.example .env)
```

Without Telegram keys the system still runs. Only the Telegram controls are turned off.

Bucket 1's price feed needs a Base RPC. Put an Alchemy key in `.env` as `ALCHEMY_API_KEY`, or set `BASE_RPC_URL` and `BASE_WS_URL` for another provider.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Runs the portfolio manager (paper mode by default). Stop with Ctrl+C. |
| `npm run paper` | Runs it under the restart supervisor (`scripts/paper-run.ps1`), for unattended runs. Windows only for now, because the supervisor is a PowerShell script. Stop with Ctrl+C. |
| `npm run status` | Prints the current portfolio status as JSON and exits. |
| `npm run report` | Writes a summary of the paper run to `reports/` and prints it. Add `-- --since 2026-10-14T08:00` to choose the window. |
| `npm run market` | Runs bucket 1's price feed on its own and logs the analyst's view each minute. Nothing trades. Cannot run beside `npm start`. |
| `npm test` | Runs the test suite (`node:test`). |

Data is stored in `data/capital.db`. Only one copy of the system can run against it (`data/capital.lock`). Logs go to the console (pretty), `logs/app.log` (JSON), `logs/errors.log` (errors only) and `logs/supervisor.log` (restarts).

## Running unattended on Windows

The restart supervisor is PowerShell-only today, so this section is Windows-specific. On other systems, run `npm start` and restart it yourself if it stops. There is no cross-platform supervisor yet.

1. Pause Windows Update for the length of the run. The scheduled task only starts after you log on, so an update reboot stops the run.
2. Run it outside Cursor, so closing the editor doesn't stop it. Either open a PowerShell window in the repo and run `npm run paper`, or register the logon task (an elevated PowerShell may be needed):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-task.ps1
   Start-ScheduledTask -TaskName CapitalSystemPaperRun
   ```

   Remove it later with `scripts\install-task.ps1 -Remove`.
3. Telegram sends a digest at 08:00 and 21:00, and alerts on crashes, restarts, data outages of 10 minutes or more, and bursts of errors. If a digest doesn't arrive, the system is down.

## Telegram commands

`/status`, `/buckets`, `/positions [bucket]`, `/decisions [bucket]`, `/digest [hours]`, `/pause <bucket>`, `/resume <bucket>`, `/winddown [off]`, `/halt`, `/unhalt`, `/help`. Only messages from `TELEGRAM_CHAT_ID` are accepted. There is intentionally no command that turns on live trading.

## Layout

```
config/portfolio.js        every tunable number (all UNVALIDATED)
src/portfolio/             portfolio manager, capital allocator, health monitor, run summaries
src/risk/                  global risk, bucket risk, position sizer
src/buckets/               bucket base class, intents, registry, placeholder bucket
src/buckets/liquidDirectional/  Majors Trader (bucket 1): regime detector, strategies, analyst, fast-move filter
src/buckets/exerciser/     System Test bucket for long paper runs (not a strategy)
src/analysis/              technical indicators
src/data/                  Uniswap V3 pool, backfill, price stream, candles
src/tools/                 standalone commands (market, report, notify)
scripts/                   paper-run supervisor and scheduled-task installer (PowerShell)
src/execution/             adapter interface, paper executor, live stub
src/persistence/db.js      SQLite store
src/control/controlApi.js  the single operator surface (Telegram, future GUI)
src/alerts/telegram.js     Telegram client of ControlApi
test/                      tests
docs/                      vision, architecture, decisions, journal, GUI plan
```

## Documentation

- [`docs/VISION.md`](docs/VISION.md): goals, philosophy and constraints
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the pieces fit together
- [`docs/DECISIONS.md`](docs/DECISIONS.md): decisions made and parameters still unvalidated
- [`docs/JOURNAL.md`](docs/JOURNAL.md): development journal, newest first
- [`docs/GUI_VISION.md`](docs/GUI_VISION.md): the planned GUI
- [`CHANGELOG.md`](CHANGELOG.md): trading-logic changes
