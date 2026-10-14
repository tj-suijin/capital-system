# GUI Vision (planned, not built)

A visual version of the Telegram commands, with the feel of the peak DeFi days (DeFi Summer 2020–21). Nothing here is built yet.

## Look

- Dark background with neon accents: Uniswap pink and magenta, synthwave purple and cyan.
- Glowing cards with gradient borders.
- Retro or monospace numbers.

## Screens

- **Portfolio home:** equity, P&L, high-water mark, a drawdown gauge, an exposure bar, and a clear halt banner.
- **Bucket cards,** styled like yield-farm pool cards: mode badge, equity, P&L, open positions, 24-hour decision counts, and a pause toggle.
- **Reserve card:** visibly distinct and "locked", since the reserve is never traded.
- **Decision ticker:** a live feed of decisions. "No trade" should look calm and normal, not like a failure.
- **Positions and trades tables.**
- **Equity charts** built from `equity_snapshots`. Snapshots are already recorded at every heartbeat, so charts will have history from the first day.
- **Controls:** big glowing wind-down, halt and unhalt buttons, each with a confirmation dialog.

## Safety

- **No live-trading toggle.** Going live stays a deliberate config and code change.
- The server listens on localhost only.

## Plumbing

```
React + Vite frontend  ──HTTP + WebSocket (localhost)──▶  small server  ──▶  ControlApi
```

- The server wraps `ControlApi`. Queries map to HTTP GET routes, commands to POST routes, and `ControlApi.on()` events are pushed over a WebSocket.
- The frontend never imports trading modules. It only talks to the server.

| ControlApi | Proposed route |
| --- | --- |
| `getStatus()` | `GET /api/status` |
| `listBuckets()` | `GET /api/buckets` |
| `getDecisions({ bucketId, limit })` | `GET /api/decisions` |
| `getTrades({ bucketId, limit })` | `GET /api/trades` |
| `getOpenPositions({ bucketId })` | `GET /api/positions` |
| `getEquityHistory({ bucketId, sinceMs, limit })` | `GET /api/equity` |
| `pause(bucketId, reason)` / `resume(bucketId)` | `POST /api/buckets/:id/pause` and `/resume` |
| `windDown(on)` | `POST /api/winddown` |
| `halt(reason)` / `unhalt()` | `POST /api/halt` and `/api/unhalt` |
| events | `WS /ws` |

The routes are a proposal and will be settled when the GUI is built.

## When

After bucket 1 runs cleanly in paper mode. Any new operator feature must be added to `ControlApi` first, so Telegram and the GUI stay in step.
