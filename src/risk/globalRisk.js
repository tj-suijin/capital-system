// GlobalRiskEngine — portfolio-wide limits that apply no matter which bucket asks.
//
//   Daily / weekly loss:  rolling-window realized loss vs high-water mark.
//                         Blocks new entries; clears itself as the window rolls.
//   Max drawdown:         equity below HWM by maxDrawdownPct → persisted HALT.
//                         Only a human unhalt clears it.
//   Gross exposure:       open notional / total equity must stay under the cap.
//   Kill switch:          manual halt / unhalt.
//
// Closing positions is never blocked here — exits always reduce risk.
import { E } from '../shared/errors.js';
import { createLogger } from '../shared/logger.js';

const DAY  = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const STATE_KEY = 'global';

export class GlobalRiskEngine {
  constructor({ store, config, getEquity, getGrossExposure, clock = Date.now, onHalt = () => {} }) {
    this.store            = store;
    this.limits           = config.globalRisk;
    this.getEquity        = getEquity;
    this.getGrossExposure = getGrossExposure;
    this.clock            = clock;
    this.onHalt           = onHalt;
    this.log              = createLogger('GLOBAL_RISK');
    this.state            = store.getRiskState(STATE_KEY) ?? { halted: false, haltReason: null, haltCode: null, hwm: 0 };
  }

  // Updates the high-water mark and trips the drawdown halt if needed.
  refresh() {
    const equity = this.getEquity();
    if (equity > this.state.hwm) {
      this.state.hwm = equity;
      this._save();
    }
    const dd = this.drawdownPct(equity);
    if (!this.state.halted && dd >= this.limits.maxDrawdownPct) {
      this.halt(`${E.RISK_DRAWDOWN.msg} (${(dd * 100).toFixed(2)}%)`, E.RISK_DRAWDOWN.code);
    }
    return { equity, hwm: this.state.hwm, drawdownPct: dd };
  }

  // Check a proposed new entry of notionalUsd. Returns { ok, code?, reason? }.
  checkEntry(notionalUsd) {
    const { equity, hwm } = this.refresh();
    if (this.state.halted) return { ok: false, code: this.state.haltCode ?? E.PM_HALTED.code, reason: `Halted: ${this.state.haltReason}` };

    const now = this.clock();
    const daily = this.store.realizedPnlSince(now - DAY);
    if (daily < 0 && -daily >= hwm * this.limits.dailyLossLimitPct) {
      return this._block(E.RISK_DAILY_LOSS, `24h P&L $${daily.toFixed(2)}, limit $${(hwm * this.limits.dailyLossLimitPct).toFixed(2)}`);
    }
    const weekly = this.store.realizedPnlSince(now - WEEK);
    if (weekly < 0 && -weekly >= hwm * this.limits.weeklyLossLimitPct) {
      return this._block(E.RISK_WEEKLY_LOSS, `7d P&L $${weekly.toFixed(2)}, limit $${(hwm * this.limits.weeklyLossLimitPct).toFixed(2)}`);
    }

    const exposure = equity > 0 ? (this.getGrossExposure() + notionalUsd) / equity : Infinity;
    if (exposure > this.limits.maxGrossExposurePct) {
      return this._block(E.RISK_EXPOSURE, `would be ${(exposure * 100).toFixed(1)}%, cap ${(this.limits.maxGrossExposurePct * 100).toFixed(0)}%`);
    }
    return { ok: true };
  }

  halt(reason, code = E.PM_HALTED.code) {
    if (this.state.halted) return;
    this.state.halted     = true;
    this.state.haltReason = reason;
    this.state.haltCode   = code;
    this._save();
    this.log.error({ code, reason }, 'PORTFOLIO HALTED');
    this.onHalt({ reason, code });
  }

  unhalt() {
    if (!this.state.halted) return;
    // Reset the HWM to current equity so a drawdown halt does not immediately re-trip.
    this.state.hwm        = this.getEquity();
    this.state.halted     = false;
    this.state.haltReason = null;
    this.state.haltCode   = null;
    this._save();
    this.log.warn({ hwm: this.state.hwm }, 'Portfolio unhalted by operator — HWM reset to current equity');
  }

  isHalted() {
    return this.state.halted;
  }

  drawdownPct(equity = this.getEquity()) {
    return this.state.hwm > 0 ? Math.max(0, (this.state.hwm - equity) / this.state.hwm) : 0;
  }

  status() {
    const equity   = this.getEquity();
    const exposure = this.getGrossExposure();
    const now      = this.clock();
    return {
      halted:           this.state.halted,
      haltReason:       this.state.haltReason,
      hwmUsd:           this.state.hwm,
      equityUsd:        equity,
      drawdownPct:      this.drawdownPct(equity),
      grossExposurePct: equity > 0 ? exposure / equity : 0,
      pnl24hUsd:        this.store.realizedPnlSince(now - DAY),
      pnl7dUsd:         this.store.realizedPnlSince(now - WEEK),
      limits:           { ...this.limits },
    };
  }

  _block(def, detail) {
    return { ok: false, code: def.code, reason: `${def.msg}: ${detail}` };
  }

  _save() {
    this.store.setRiskState(STATE_KEY, this.state, this.clock());
  }
}

export default GlobalRiskEngine;
