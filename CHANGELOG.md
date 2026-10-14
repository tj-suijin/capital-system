# Changelog

Terse list of trading-logic changes and bug fixes. The narrative history lives in `docs/JOURNAL.md`.

## 0.1.0 (unreleased)

- Portfolio shell: every bucket intent goes through sizer, bucket risk, global risk, capital allocator and executor, and each outcome is logged to `decisions`.
- Capital allocator: one persisted ledger per bucket plus a reserve that is never traded; changing config allocations does not move existing capital.
- Global risk: rolling 24h (3%) and 7d (8%) realized-loss limits against the high-water mark block new entries; a 15% drawdown triggers a persisted halt that only `/unhalt` clears.
- Global risk: gross exposure is capped at 50% of total equity.
- Bucket risk: per-bucket max concurrent positions, max position size, daily loss limit, and pause.
- Position sizer ported from trading-bot and made relative to each bucket's equity.
- Exits are never blocked by halts, pauses or wind-down.
- Live gate: a bucket only trades live with `TRADING_MODE=live`, bucket `mode: 'live'` and `live: true`, not `paperOnly`, and a registered live adapter. Otherwise startup fails.
- Paper executor simulates a 0.05% fee and 0.10% slippage. Both buckets are `NullBucket` placeholders that always return no trade.
