// Port of modules/congestion_controller/goog_cc/bitrate_estimator.{h,cc} @ M154.
import {DataRate, DataSize, TimeDelta, Timestamp} from "../../../units";
import {Optional} from "../../../types/optional";

const kInitialRateWindowMs: i32 = 500;
const kRateWindowMs: i32 = 150;
const kMinRateWindowMs: i32 = 150;
const kMaxRateWindowMs: i32 = 1000;

// Replaces the "WebRTC-BweThroughputWindowConfig" field trial, e.g.
// WebRTC-BweThroughputWindowConfig/initial_window_ms:350,window_ms:250/
export class BitrateEstimatorConfig {
  // FieldTrialConstrained<int>: [kMinRateWindowMs, kMaxRateWindowMs].
  initialWindowMs: i32 = kInitialRateWindowMs;
  noninitialWindowMs: i32 = kRateWindowMs;
  uncertaintyScale: f64 = 10.0;
  // Default to uncertaintyScale when not set (NaN).
  uncertaintyScaleInAlr: f64 = NaN;
  smallSampleUncertaintyScale: f64 = NaN;
  smallSampleThreshold: DataSize = DataSize.Zero;
  uncertaintySymmetryCap: DataRate = DataRate.Zero;
  estimateFloor: DataRate = DataRate.Zero;
}

function constrainedWindow(value: i32, defaultValue: i32): i32 {
  // A FieldTrialConstrained value outside of its limits is rejected and the
  // default is kept.
  return value < kMinRateWindowMs || value > kMaxRateWindowMs ? defaultValue : value;
}

// Computes a bayesian estimate of the throughput given acks containing
// the arrival time and payload size. Samples which are far from the current
// estimate or are based on few packets are given a smaller weight, as they
// are considered to be more likely to have been caused by, e.g., delay spikes
// unrelated to congestion.
export class BitrateEstimator {
  private sum: i32 = 0;
  private initialWindowMs: i32;
  private noninitialWindowMs: i32;
  private uncertaintyScale: f64;
  private uncertaintyScaleInAlr: f64;
  private smallSampleUncertaintyScale: f64;
  private smallSampleThreshold: DataSize;
  private uncertaintySymmetryCap: DataRate;
  private estimateFloor: DataRate;
  private currentWindowMs: i64 = 0;
  private prevTimeMs: i64 = -1;
  private bitrateEstimateKbps: f32 = -1.0;
  private bitrateEstimateVar: f32 = 50.0;

  constructor(configOrNull: BitrateEstimatorConfig | null = null) {
    const config = configOrNull !== null ? configOrNull : new BitrateEstimatorConfig();
    this.initialWindowMs = constrainedWindow(config.initialWindowMs, kInitialRateWindowMs);
    this.noninitialWindowMs = constrainedWindow(config.noninitialWindowMs, kRateWindowMs);
    this.uncertaintyScale = config.uncertaintyScale;
    this.uncertaintyScaleInAlr = isNaN(config.uncertaintyScaleInAlr) ? config.uncertaintyScale : config.uncertaintyScaleInAlr;
    this.smallSampleUncertaintyScale = isNaN(config.smallSampleUncertaintyScale)
      ? config.uncertaintyScale
      : config.smallSampleUncertaintyScale;
    this.smallSampleThreshold = config.smallSampleThreshold;
    this.uncertaintySymmetryCap = config.uncertaintySymmetryCap;
    this.estimateFloor = config.estimateFloor;
  }

  update(atTime: Timestamp, amount: DataSize, inAlr: bool): void {
    let rateWindowMs = this.noninitialWindowMs;
    // We use a larger window at the beginning to get a more stable sample that
    // we can use to initialize the estimate.
    if (this.bitrateEstimateKbps < 0.0) rateWindowMs = this.initialWindowMs;
    const bitrateSampleKbps = this.updateWindow(Timestamp.ms(atTime), <i32>DataSize.bytes(amount), rateWindowMs);
    const isSmallSample = this.lastSampleIsSmall;
    if (bitrateSampleKbps < 0.0) return;
    if (this.bitrateEstimateKbps < 0.0) {
      // This is the very first sample we get. Use it to initialize the estimate.
      this.bitrateEstimateKbps = bitrateSampleKbps;
      return;
    }
    // Optionally use higher uncertainty for very small samples to avoid dropping
    // estimate and for samples obtained in ALR.
    let scale = <f32>this.uncertaintyScale;
    if (isSmallSample && bitrateSampleKbps < this.bitrateEstimateKbps) {
      scale = <f32>this.smallSampleUncertaintyScale;
    } else if (inAlr && bitrateSampleKbps < this.bitrateEstimateKbps) {
      // Optionally use higher uncertainty for samples obtained during ALR.
      scale = <f32>this.uncertaintyScaleInAlr;
    }
    // Define the sample uncertainty as a function of how far away it is from the
    // current estimate. With low values of uncertainty_symmetry_cap_ we add more
    // uncertainty to increases than to decreases. For higher values we approach
    // symmetry.
    const sampleUncertainty: f32 =
      scale * Mathf.abs(this.bitrateEstimateKbps - bitrateSampleKbps) /
      (this.bitrateEstimateKbps + min(bitrateSampleKbps, DataRate.kbps<f32>(this.uncertaintySymmetryCap)));

    const sampleVar: f32 = sampleUncertainty * sampleUncertainty;
    // Update a bayesian estimate of the rate, weighting it lower if the sample
    // uncertainty is large.
    // The bitrate estimate uncertainty is increased with each update to model
    // that the bitrate changes over time.
    const predBitrateEstimateVar: f32 = this.bitrateEstimateVar + 5.0;
    this.bitrateEstimateKbps = (sampleVar * this.bitrateEstimateKbps + predBitrateEstimateVar * bitrateSampleKbps) /
      (sampleVar + predBitrateEstimateVar);
    this.bitrateEstimateKbps = max(this.bitrateEstimateKbps, DataRate.kbps<f32>(this.estimateFloor));
    this.bitrateEstimateVar = sampleVar * predBitrateEstimateVar / (sampleVar + predBitrateEstimateVar);
  }

  bitrate(): Optional<DataRate> | null {
    if (this.bitrateEstimateKbps < 0.0) return null;
    return new Optional<DataRate>(DataRate.KilobitsPerSec<f32>(this.bitrateEstimateKbps));
  }

  peekRate(): Optional<DataRate> | null {
    if (this.currentWindowMs > 0) {
      return new Optional<DataRate>(
        DataRate.fromSizeAndDuration(DataSize.Bytes<i32>(this.sum), TimeDelta.Millis<i64>(this.currentWindowMs)));
    }
    return null;
  }

  expectFastRateChange(): void {
    // By setting the bitrate-estimate variance to a higher value we allow the
    // bitrate to change fast for the next few samples.
    this.bitrateEstimateVar += 200;
  }

  // Out-parameter `is_small_sample` of UpdateWindow().
  private lastSampleIsSmall: bool = false;

  private updateWindow(nowMs: i64, bytes: i32, rateWindowMs: i32): f32 {
    this.lastSampleIsSmall = false;
    // Reset if time moves backwards.
    if (nowMs < this.prevTimeMs) {
      this.prevTimeMs = -1;
      this.sum = 0;
      this.currentWindowMs = 0;
    }
    if (this.prevTimeMs >= 0) {
      this.currentWindowMs += nowMs - this.prevTimeMs;
      // Reset if nothing has been received for more than a full window.
      if (nowMs - this.prevTimeMs > rateWindowMs) {
        this.sum = 0;
        this.currentWindowMs %= rateWindowMs;
      }
    }
    this.prevTimeMs = nowMs;
    let bitrateSample: f32 = -1.0;
    if (this.currentWindowMs >= rateWindowMs) {
      this.lastSampleIsSmall = <i64>this.sum < DataSize.bytes(this.smallSampleThreshold);
      bitrateSample = 8.0 * <f32>this.sum / <f32>rateWindowMs;
      this.currentWindowMs -= rateWindowMs;
      this.sum = 0;
    }
    this.sum += bytes;
    return bitrateSample;
  }
}
