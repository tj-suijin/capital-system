# Majors Trader: thesis and kill criteria

**Status: NOT WRITTEN.** Everything in square brackets is the user's to fill in. The agent does not fill it in or present suggested wording as the user's belief. It may ask questions or offer labeled candidates if asked.

**Applies to Majors Trader only.** Other buckets get nothing from this file unless the user decides so.

Where this comes from: `docs/VISION.md` section 17.3. Write it before reading any backtest, so a loss cannot move it.

---

## Thesis (three sentences)

1. **What do I believe about ETH/USDC on Base?** (For example, how trends and chop behave.)

   [YOUR ANSWER]

2. **Why would trend-following, mean reversion and the regime switch capture that?**

   [YOUR ANSWER]

3. **Why would what they capture be worth more than the costs?**

   For reference, the paper round trip costs about 0.3% (a 0.05% fee and 0.10% slippage each way, before volatility slippage). These are unvalidated paper numbers.

   [YOUR ANSWER]

---

## Kill criteria

Make them slightly pessimistic. They are a commitment, so that a losing strategy cannot later be said to "just need more time".

1. If after **N** trades the expectancy per trade is below **X**, stop.
   - N = [YOUR NUMBER]
   - X = [YOUR NUMBER]
2. If max drawdown exceeds **Y** before N trades, stop.
   - Y = [YOUR NUMBER]
3. If paper or live results differ from the backtest by more than **Z**, stop and investigate.
   - Z = [YOUR NUMBER]

Reference: `VISION.md` 17.6 says fewer than about 30 trades is not meaningful, whatever the P&L.

---

**Written on:** [DATE]

**Written before reading any backtest:** [YES / NO]
