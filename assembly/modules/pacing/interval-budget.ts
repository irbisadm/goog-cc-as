const kWindowMs: i64 = 500;

export class IntervalBudget {
  private readonly canBuildUpUnderuse: bool;
  private _targetRateKbps: i32 = 0;
  private maxBytesInBudget: i64 = 0;
  private _bytesRemaining: i64 = 0;

  constructor(initialTargetRateKbps: i32, canBuildUpUnderuse: bool = true) {
    this.canBuildUpUnderuse = canBuildUpUnderuse;
    this.setTargetRateKbps(initialTargetRateKbps);
  }

  private setTargetRateKbps(targetRateKbps: i32): void {
    this._targetRateKbps = targetRateKbps;
    this.maxBytesInBudget = (kWindowMs * targetRateKbps) / 8;
    this._bytesRemaining = Math.min(Math.max(-this.maxBytesInBudget, this._bytesRemaining), this.maxBytesInBudget);
  }

  increaseBudget(deltaMs: i64): void {
    const bytes: i64 = (deltaMs * this._targetRateKbps) / 8;
    if (this._bytesRemaining < 0 || this.canBuildUpUnderuse) {
      // We overused last interval, compensate this interval.
      this._bytesRemaining = Math.min(this._bytesRemaining + bytes, this.maxBytesInBudget);
      return
    }
    // If we underused last interval we can't use it this interval.
    this._bytesRemaining = Math.min(bytes, this.maxBytesInBudget);
  }

  useBudget(bytes: i64): void {
    this._bytesRemaining = Math.max(this._bytesRemaining - bytes, -this.maxBytesInBudget);
  }

  bytesRemaining<T>(): T {
    return <T>this._bytesRemaining;
  }

  budgetRatio(): f64 {
    if (this.maxBytesInBudget == 0) return 0.0;
    return <f64>this._bytesRemaining / <f64>this.maxBytesInBudget;
  }

  targetRateKbps(): i64 {
    return this._targetRateKbps;
  }
}
