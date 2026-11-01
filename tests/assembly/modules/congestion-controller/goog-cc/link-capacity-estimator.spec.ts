// No upstream unittest exists; these checks pin the ported behaviour.
import {DataRate} from "../../../../../assembly/units";
import {LinkCapacityEstimator} from "../../../../../assembly/modules/congestion-controller/goog-cc/link-capacity-estimator";
import {expectEq, expectFalse, expectGt, expectLt, expectTrue} from "../../../expect";

export function test_BoundsWithoutEstimate(): void {
  const estimator = new LinkCapacityEstimator();
  expectFalse(estimator.hasEstimate());
  expectEq(estimator.upperBound(), DataRate.Infinity);
  expectEq(estimator.lowerBound(), DataRate.Zero);
}

export function test_FirstSampleBecomesEstimate(): void {
  const estimator = new LinkCapacityEstimator();
  estimator.onOveruseDetected(DataRate.KilobitsPerSec(500));
  expectTrue(estimator.hasEstimate());
  expectEq(estimator.estimate(), DataRate.KilobitsPerSec(500));
  // deviation is clamped to at least 0.4 => sqrt(0.4 * 500) ~= 14 kbps.
  expectEq(estimator.upperBound(), DataRate.KilobitsPerSec<f64>(500 + 3 * Math.sqrt(<f64><f32>0.4 * 500)));
  expectLt(estimator.lowerBound(), estimator.estimate());
}

export function test_ProbeMovesEstimateFasterThanOveruse(): void {
  const overuse = new LinkCapacityEstimator();
  const probe = new LinkCapacityEstimator();
  overuse.onOveruseDetected(DataRate.KilobitsPerSec(500));
  probe.onProbeRate(DataRate.KilobitsPerSec(500));
  overuse.onOveruseDetected(DataRate.KilobitsPerSec(1000));
  probe.onProbeRate(DataRate.KilobitsPerSec(1000));
  expectEq(overuse.estimate(), DataRate.KilobitsPerSec(525));
  expectEq(probe.estimate(), DataRate.KilobitsPerSec(750));
  expectGt(probe.upperBound(), overuse.upperBound());
}

export function test_Reset(): void {
  const estimator = new LinkCapacityEstimator();
  estimator.onProbeRate(DataRate.KilobitsPerSec(500));
  estimator.reset();
  expectFalse(estimator.hasEstimate());
  expectEq(estimator.upperBound(), DataRate.Infinity);
}
