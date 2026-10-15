// Error / rejection code registry. Codes are stable so they can be queried
// in the decisions table and shown in Telegram / GUI.

export const E = {
  // Portfolio
  PM_HALTED:          { code: 'PM_001', msg: 'Portfolio halted' },
  PM_WINDING_DOWN:    { code: 'PM_002', msg: 'Wind-down active — no new entries' },
  PM_LIVE_GATE:       { code: 'PM_003', msg: 'Live trading gate not satisfied' },
  PM_UNKNOWN_BUCKET:  { code: 'PM_004', msg: 'Unknown bucket' },

  // Global risk
  RISK_DAILY_LOSS:    { code: 'GR_001', msg: 'Global daily loss limit reached' },
  RISK_WEEKLY_LOSS:   { code: 'GR_002', msg: 'Global weekly loss limit reached' },
  RISK_DRAWDOWN:      { code: 'GR_003', msg: 'Max drawdown from high-water mark — halted' },
  RISK_EXPOSURE:      { code: 'GR_004', msg: 'Gross exposure cap would be exceeded' },

  // Bucket risk
  BUCKET_PAUSED:      { code: 'BR_001', msg: 'Bucket paused' },
  BUCKET_MAX_POS:     { code: 'BR_002', msg: 'Bucket max concurrent positions reached' },
  BUCKET_MAX_SIZE:    { code: 'BR_003', msg: 'Position exceeds bucket max size' },
  BUCKET_DAILY_LOSS:  { code: 'BR_004', msg: 'Bucket daily loss limit reached' },
  BUCKET_COOLDOWN:    { code: 'BR_005', msg: 'Bucket cooling down after a stop-out' },
  BUCKET_SPACING:     { code: 'BR_006', msg: 'Too soon after the last entry in this direction' },
  BUCKET_LOSING:      { code: 'BR_007', msg: 'An open position is losing' },

  // Sizing / capital / execution
  SIZE_ZERO:          { code: 'SZ_001', msg: 'Position size is zero' },
  CAPITAL_SHORT:      { code: 'CA_001', msg: 'Insufficient bucket capital' },
  CAPITAL_RESERVE:    { code: 'CA_002', msg: 'Reserve capital cannot be allocated' },
  EXEC_FAILED:        { code: 'EX_001', msg: 'Execution failed' },
  EXEC_NOT_IMPL:      { code: 'EX_002', msg: 'Execution adapter not implemented' },

  // Valuation
  MARK_FAILED:        { code: 'MK_001', msg: 'Mark price lookup failed — position valued at cost' },

  // Market data
  DATA_NO_RPC:        { code: 'DA_001', msg: 'No RPC URL configured (set ALCHEMY_API_KEY or BASE_RPC_URL)' },
  DATA_POOL_MISMATCH: { code: 'DA_002', msg: 'On-chain pool does not match its definition' },
  DATA_UNKNOWN_POOL:  { code: 'DA_003', msg: 'Unknown pool' },
  DATA_BACKFILL:      { code: 'DA_004', msg: 'Backfill failed' },
  DATA_STREAM:        { code: 'DA_005', msg: 'Price stream error' },
};

export class TradingError extends Error {
  constructor(def, detail) {
    super(detail ? `${def.msg}: ${detail}` : def.msg);
    this.code = def.code;
  }
}

export default E;
