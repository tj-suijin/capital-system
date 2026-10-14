# capital-system

A multi-bucket autonomous capital system. A portfolio manager splits capital into **buckets**. Each bucket runs its own strategy, has its own risk limits, and can run in paper, shadow or live mode on its own. Global risk rules apply on top of all of them.

The system is paper-first. **No live trading path exists yet.** Both buckets are currently placeholders that always answer "no trade", so the shell can run unattended while real strategies are built one at a time.

The product vision is in [`docs/VISION.md`](docs/VISION.md).

## Requirements

- Node 24 or newer. The database is Node's built-in `node:sqlite`, so no native build tools are needed.

## Setup

```powershell
npm install
Copy-Item .env.example .env   # optional: add Telegram keys
```

Without Telegram keys the system still runs. Only the Telegram controls are turned off.

Bucket 1's price feed needs a Base RPC. Put an Alchemy key in `.env` as `ALCHEMY_API_KEY`, or set `BASE_RPC_URL` and `BASE_WS_URL` for another provider.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Runs the portfolio manager (paper mode by default). Stop with Ctrl+C. |
| `npm run status` | Prints the current portfolio status as JSON and exits. |
| `npm run market` | Runs bucket 1's price feed on its own and logs the analyst's view each minute. Nothing trades. |
| `npm test` | Runs the test suite (`node:test`). |

Data is stored in `data/capital.db`. Logs go to the console (pretty), `logs/app.log` (JSON), and `logs/errors.log` (errors only).

## Telegram commands

`/status`, `/buckets`, `/positions [bucket]`, `/decisions [bucket]`, `/pause <bucket>`, `/resume <bucket>`, `/winddown [off]`, `/halt`, `/unhalt`, `/help`. Only messages from `TELEGRAM_CHAT_ID` are accepted. There is intentionally no command that turns on live trading.

## Layout

```
config/portfolio.js        every tunable number (all UNVALIDATED)
src/portfolio/             portfolio manager and capital allocator
src/risk/                  global risk, bucket risk, position sizer
src/buckets/               bucket base class, intents, registry, placeholder bucket
src/buckets/liquidDirectional/  bucket 1: regime detector, strategies, analyst
src/analysis/              technical indicators
src/data/                  Uniswap V3 pool, backfill, price stream, candles
src/tools/                 standalone commands (npm run market)
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
