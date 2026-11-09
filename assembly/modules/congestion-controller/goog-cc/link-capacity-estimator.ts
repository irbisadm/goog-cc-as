// Port of modules/congestion_controller/goog_cc/link_capacity_estimator.{h,cc} @ M154.
import {DataRate} from "../../../units";

export class LinkCapacityEstimator {
  // std::optional<double> estimate_kbps_.
  private hasEstimateKbps: bool = false;
  private estimateKbps: f64 = 0;
  private deviationKbps: f64 = 0.4;

  upperBound(): DataRate {
    if (this.hasEstimateKbps) {
      return DataRate.KilobitsPerSec<f64>(this.estimateKbps + 3 * this.deviationEstimateKbps());
    }
    return DataRate.Infinity;
  }

  lowerBound(): DataRate {
    if (this.hasEstimateKbps) {
      return DataRate.KilobitsPerSec<f64>(max(0.0, this.estimateKbps - 3 * this.deviationEstimateKbps()));
    }
    return DataRate.Zero;
  }

  reset(): void {
    this.hasEstimateKbps = false;
  }

  onOveruseDetected(acknowledgedRate: DataRate): void {
    this.update(acknowledgedRate, 0.05);
  }

  onProbeRate(probeRate: DataRate): void {
    this.update(probeRate, 0.5);
  }

  hasEstimate(): bool {
    return this.hasEstimateKbps;
  }

  estimate(): DataRate {
    assert(this.hasEstimateKbps);
    return DataRate.KilobitsPerSec<f64>(this.estimateKbps);
  }

  private update(capacitySample: DataRate, alpha: f64): void {
    const sampleKbps = <f64>DataRate.kbps(capacitySample);
    if (!this.hasEstimateKbps) {
      this.estimateKbps = sampleKbps;
      this.hasEstimateKbps = true;
    } else {
      this.estimateKbps = (1 - alpha) * this.estimateKbps + alpha * sampleKbps;
    }
    // Estimate the variance of the link capacity estimate and normalize the
    // variance with the link capacity estimate.
    const norm = max(this.estimateKbps, 1.0);
    const errorKbps = this.estimateKbps - sampleKbps;
    this.deviationKbps = (1 - alpha) * this.deviationKbps + alpha * errorKbps * errorKbps / norm;
    // 0.4 ~= 14 kbit/s at 500 kbit/s
    // 2.5f ~= 35 kbit/s at 500 kbit/s
    this.deviationKbps = min(max(this.deviationKbps, <f64><f32>0.4), <f64><f32>2.5);
  }

  private deviationEstimateKbps(): f64 {
    // Calculate the max bit rate std dev given the normalized
    // variance and the current throughput bitrate. The standard deviation will
    // only be used if estimate_kbps_ has a value.
    return Math.sqrt(this.deviationKbps * this.estimateKbps);
  }
}
