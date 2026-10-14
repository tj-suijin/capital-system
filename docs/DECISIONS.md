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

## Open questions

- How should a manual rebalance between ledgers work, and should it require the portfolio to be flat first?
- Which price source should mark-to-market use for bucket 1: the Uniswap pool itself, or a second reference to guard against pool manipulation?
- Should drawdown include unrealized losses once mark-to-market exists? It should, but this changes how often the halt can trip.
