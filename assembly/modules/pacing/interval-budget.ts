// Port of modules/pacing/interval_budget.{h,cc} @ M154.
const kWindowMs: i64 = 500;

export class IntervalBudget {
  private _targetRateKbps: i32 = 0;
  private maxBytesInBudget: i64 = 0;
  private _bytesRemaining: i64 = 0;
  private readonly canBuildUpUnderuse: bool;

  constructor(initialTargetRateKbps: i32, canBuildUpUnderuse: bool = false) {
    this.canBuildUpUnderuse = canBuildUpUnderuse;
    this.setTargetRateKbps(initialTargetRateKbps);
  }

  setTargetRateKbps(targetRateKbps: i32): void {
    this._targetRateKbps = targetRateKbps;
    this.maxBytesInBudget = (kWindowMs * <i64>targetRateKbps) / 8;
    this._bytesRemaining = min(max(-this.maxBytesInBudget, this._bytesRemaining), this.maxBytesInBudget);
  }

  // TODO(tschumim): Unify IncreaseBudget and UseBudget to one function.
  increaseBudget(deltaTimeMs: i64): void {
    const bytes: i64 = (<i64>this._targetRateKbps * deltaTimeMs) / 8;
    if (this._bytesRemaining < 0 || this.canBuildUpUnderuse) {
      // We overused last interval, compensate this interval.
      this._bytesRemaining = min(this._bytesRemaining + bytes, this.maxBytesInBudget);
    } else {
      // If we underused last interval we can't use it this interval.
      this._bytesRemaining = min(bytes, this.maxBytesInBudget);
    }
  }

  useBudget(bytes: i64): void {
    this._bytesRemaining = max(this._bytesRemaining - bytes, -this.maxBytesInBudget);
  }

  bytesRemaining(): i64 {
    return max<i64>(0, this._bytesRemaining);
  }

  budgetRatio(): f64 {
    if (this.maxBytesInBudget == 0) return 0.0;
    return <f64>this._bytesRemaining / <f64>this.maxBytesInBudget;
  }

  targetRateKbps(): i32 {
    return this._targetRateKbps;
  }
}
