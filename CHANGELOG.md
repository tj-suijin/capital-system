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
- Market data for bucket 1: Uniswap V3 WETH/USDC 0.05% pool on Base, verified on-chain against the factory at startup; 1m and 5m candles from swap logs, with backfill and gap fill after reconnects.
- Fix (from trading-bot): the outlier filter now compares against all recent prices, so a genuine move of more than 2% is accepted instead of freezing candles forever.
- Fix (from trading-bot): ADX is now Wilder-smoothed; it was a single unsmoothed DX reading.
- Fix (from trading-bot): RSI now uses Wilder smoothing; it was a simple average of the last 14 changes.
- Fix (from trading-bot): the trend-following stop uses the swing low of candle lows, not closes.
- Ported regime detector, trend following and mean reversion with unchanged scoring; the analyst also reports each strategy's exit signal whatever the regime.
- Short gaps in candles (up to 5 intervals) are forward-filled flat; longer gaps are left empty.
- LiquidDirectional bucket replaces the placeholder: entries via the analyst; no trade on stale feed, candle gaps, warm-up, or market data down (retried every 60s).
- Bucket 1 entries: the stop must be below price, its distance is clamped to 0.3%–3%, and a target must be at least 0.4% away to cover round-trip costs.
- Bucket 1 exits, checked every cycle at the live pool price: stop loss, take profit, the opening strategy's exit signal (via the position's new `tag`), and a 4-hour time limit. Exits are deferred while the feed is stale.
- Mark-to-market: equity is cash plus the market value of open positions minus opening fees, using each bucket's `markPrice()` (bucket 1: last pool swap, else newest 1m candle; no price means at cost). Marked equity drives sizing, the high-water mark, the drawdown halt (now checked every bucket cycle), gross exposure (now at market value), snapshots and status. Daily and weekly loss limits remain realized-only.
- Paper run: paper capital raised from $1,000 to $4,000; allocation is now LiquidDirectional 60%, DegenMemecoin 3%, Exerciser 2%, Reserve 35%.
- Bucket 1: `paperMinConfidence` (45%) replaces the 55% minimum entry confidence in paper mode only; shadow and live keep 55%.
- Bucket 1: before the first live swap after a start, entries and exits wait with the reason "waiting for first live swap" (was reported as "price feed stale").
- New Exerciser test bucket (paper only, not a strategy): $30 ETH/USDC long at every :00 and :30 slot on bucket 1's live price; 0.3% stop and target, 75-minute limit, max 2 open, 2% daily loss limit. After a restart it waits for the next slot.
- Fix: stops and targets are now set from the market price the bucket saw at entry, not the fill price. Paper slippage (0.10%) had moved every stop and target up, so a 0.3% stop sat about 0.2% below the market and a 0.3% target about 0.4% above it.
- Fix: the Telegram poll loop retried instantly and forever on error replies (401, 409, 429); it now backs off from 5 seconds to 5 minutes. Telegram requests now time out instead of hanging.
- Fix: two copies could run against the same database and trade the same ledgers; a lock file now refuses the second copy (exit code 3).
- Fix: an uncaught exception ended the process without a log line; it is now logged as fatal and exits with code 1 for the supervisor to restart.
