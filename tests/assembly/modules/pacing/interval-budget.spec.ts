// Port of modules/pacing/interval_budget_unittest.cc @ M154.
import {IntervalBudget} from "../../../../assembly/modules/pacing/interval-budget";
import {expectDoubleEq, expectEq} from "../../expect";

const kWindowMs: i32 = 500;
const kBitrateKbps: i32 = 100;
const kCanBuildUpUnderuse = true;
const kCanNotBuildUpUnderuse = false;

function timeToBytes(bitrateKbps: i32, timeMs: i32): i64 {
  return <i64>(bitrateKbps * timeMs / 8);
}

export function test_InitailState(): void {
  const budget = new IntervalBudget(kBitrateKbps);
  expectDoubleEq(budget.budgetRatio(), 0.0);
  expectEq(budget.bytesRemaining(), <i64>0);
}

export function test_Underuse(): void {
  const budget = new IntervalBudget(kBitrateKbps);
  const deltaTimeMs: i32 = 50;
  budget.increaseBudget(deltaTimeMs);
  expectDoubleEq(budget.budgetRatio(), <f64>kWindowMs / <f64>(100 * deltaTimeMs));
  expectEq(budget.bytesRemaining(), timeToBytes(kBitrateKbps, deltaTimeMs));
}

export function test_DontUnderuseMoreThanMaxWindow(): void {
  const budget = new IntervalBudget(kBitrateKbps);
  budget.increaseBudget(1000);
  expectDoubleEq(budget.budgetRatio(), 1.0);
  expectEq(budget.bytesRemaining(), timeToBytes(kBitrateKbps, kWindowMs));
}

export function test_DontUnderuseMoreThanMaxWindowWhenChangeBitrate(): void {
  const budget = new IntervalBudget(kBitrateKbps);
  budget.increaseBudget(kWindowMs / 2);
  budget.setTargetRateKbps(kBitrateKbps / 10);
  expectDoubleEq(budget.budgetRatio(), 1.0);
  expectEq(budget.bytesRemaining(), timeToBytes(kBitrateKbps / 10, kWindowMs));
}

export function test_BalanceChangeOnBitrateChange(): void {
  const budget = new IntervalBudget(kBitrateKbps);
  budget.increaseBudget(kWindowMs);
  budget.setTargetRateKbps(kBitrateKbps * 2);
  expectDoubleEq(budget.budgetRatio(), 0.5);
  expectEq(budget.bytesRemaining(), timeToBytes(kBitrateKbps, kWindowMs));
}

export function test_Overuse(): void {
  const budget = new IntervalBudget(kBitrateKbps);
  const overuseTimeMs: i32 = 50;
  budget.useBudget(timeToBytes(kBitrateKbps, overuseTimeMs));
  expectDoubleEq(budget.budgetRatio(), -<f64>kWindowMs / <f64>(100 * overuseTimeMs));
  expectEq(budget.bytesRemaining(), <i64>0);
}

export function test_DontOveruseMoreThanMaxWindow(): void {
  const budget = new IntervalBudget(kBitrateKbps);
  budget.useBudget(timeToBytes(kBitrateKbps, 1000));
  expectDoubleEq(budget.budgetRatio(), -1.0);
  expectEq(budget.bytesRemaining(), <i64>0);
}

export function test_CanBuildUpUnderuseWhenConfigured(): void {
  const budget = new IntervalBudget(kBitrateKbps, kCanBuildUpUnderuse);
  const deltaTimeMs: i32 = 50;
  budget.increaseBudget(deltaTimeMs);
  expectDoubleEq(budget.budgetRatio(), <f64>kWindowMs / <f64>(100 * deltaTimeMs));
  expectEq(budget.bytesRemaining(), timeToBytes(kBitrateKbps, deltaTimeMs));
  budget.increaseBudget(deltaTimeMs);
  expectDoubleEq(budget.budgetRatio(), <f64>(2 * kWindowMs) / <f64>(100 * deltaTimeMs));
  expectEq(budget.bytesRemaining(), timeToBytes(kBitrateKbps, 2 * deltaTimeMs));
}

export function test_CanNotBuildUpUnderuseWhenConfigured(): void {
  const budget = new IntervalBudget(kBitrateKbps, kCanNotBuildUpUnderuse);
  const deltaTimeMs: i32 = 50;
  budget.increaseBudget(deltaTimeMs);
  expectDoubleEq(budget.budgetRatio(), <f64>kWindowMs / <f64>(100 * deltaTimeMs));
  expectEq(budget.bytesRemaining(), timeToBytes(kBitrateKbps, deltaTimeMs));
  budget.increaseBudget(deltaTimeMs);
  expectDoubleEq(budget.budgetRatio(), <f64>kWindowMs / <f64>(100 * deltaTimeMs));
  expectEq(budget.bytesRemaining(), timeToBytes(kBitrateKbps, deltaTimeMs));
}
