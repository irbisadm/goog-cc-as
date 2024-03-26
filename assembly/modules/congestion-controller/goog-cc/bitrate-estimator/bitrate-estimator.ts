import {DataRate, DataSize, Timestamp} from "../../../../units";
import {FieldTrialConstrained} from "../../../../rtc-base/experiments";
import {kInitialRateWindowMs, kMaxRateWindowMs, kMinRateWindowMs, kRateWindowMs} from "./settings";

export class BitrateEstimator {
  private sum: i64 = 0;
  private initialWindowMs: FieldTrialConstrained<i64> = new FieldTrialConstrained<i64>(kInitialRateWindowMs, kMinRateWindowMs, kMaxRateWindowMs);
  private nonInitialWindowMs: FieldTrialConstrained<i64> = new FieldTrialConstrained<i64>(kRateWindowMs, kMinRateWindowMs, kMaxRateWindowMs);
  private uncertaintyScale: f64 = 10.0;
  private uncertaintyScaleInAlr: f64 = this.uncertaintyScale;
  private smallSampleUncertaintyScale: f64 = this.uncertaintyScale;
  private smallSampleThreshold: DataSize = 0;
  private uncertaintySymmetryCap: DataRate = 0;
  private estimateFloor: DataRate = 0;
  private currentWindowMs: i64 = 0;
  private prevTimeMs: i64 = -1;
  private bitrateEstimateKbps: f64 = -1.0;
  private bitrateEstimateVar: f64 = 50.0;

  constructor() {}

  update(atTime: Timestamp, amount: DataSize, inAlr: bool): void {
    let rateWindowMs:i32 = this.nonInitialWindowMs.value;
    // We use a larger window at the beginning to get a more stable sample that
    // we can use to initialize the estimate.
    if (this.bitrateEstimateKbps < 0.0){
      rateWindowMs = this.initialWindowMs.value;
    }
    let isSmallSample:bool = false;
    const updateWindowResult: { bitrateSample: f64, isSmallSample: bool } = this.updateWindow(atTime, amount, rateWindowMs, isSmallSample);
    let bitrateSample: f64 = updateWindowResult.bitrateSample;
    isSmallSample = updateWindowResult.isSmallSample;
    if (bitrateSample < 0.0) {
      return;
    }
    if(this.bitrateEstimateKbps < 0.0){
      this.bitrateEstimateKbps = bitrateSample;
      return;
    }
    // Optionally use higher uncertainty for very small samples to avoid dropping
    // estimate and for samples obtained in ALR.
    let scale:f64 = this.uncertaintyScale;
    if(isSmallSample && bitrateSample < this.bitrateEstimateKbps){
      scale = this.smallSampleUncertaintyScale;
    } else if(inAlr && bitrateSample < this.bitrateEstimateKbps){
      // Optionally use higher uncertainty for samples obtained during ALR.
      scale = this.uncertaintyScaleInAlr;
    }
    // Define the sample uncertainty as a function of how far away it is from the
    // current estimate. With low values of uncertainty_symmetry_cap_ we add more
    // uncertainty to increases than to decreases. For higher values we approach
    // symmetry.
    let sampleUncertainty:f64 =
      scale * Math.abs(this.bitrateEstimateKbps - bitrateSample) /
      (this.bitrateEstimateKbps + Math.min(bitrateSample, <f64>this.uncertaintySymmetryCap));

    let sampleVar:f64 = sampleUncertainty * sampleUncertainty;
    // Update a bayesian estimate of the rate, weighting it lower if the sample
    // uncertainty is large.
    // The bitrate estimate uncertainty is increased with each update to model
    // that the bitrate changes over time.
    let predBitrateEstimateVar:f64 = this.bitrateEstimateVar + 5.0;
    this.bitrateEstimateKbps = (sampleVar * this.bitrateEstimateKbps + predBitrateEstimateVar * bitrateSample) / (sampleVar + predBitrateEstimateVar);
    this.bitrateEstimateKbps = Math.max(this.bitrateEstimateKbps, <f64>this.estimateFloor);
    this.bitrateEstimateVar = sampleVar * predBitrateEstimateVar / (sampleVar + predBitrateEstimateVar);
  }

  private updateWindow(nowMs: i64, bytes: i64, rateWindowMs: i64, isSmallSample: bool): {
    bitrateSample: f64,
    isSmallSample: bool
  } {
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
    let bitrateSample: f64 = -1.0;
    if (this.currentWindowMs >= rateWindowMs) {
      isSmallSample = this.sum < this.smallSampleThreshold;
      bitrateSample = 8.0 * <f64>this.sum / <f64>rateWindowMs;
      this.currentWindowMs -= rateWindowMs;
      this.sum = 0;
    }
    this.sum += bytes;
    return {bitrateSample, isSmallSample};
  }

  bitrate(): DataRate {
    if (this.bitrateEstimateKbps < 0) {
      return 0;
    }
    return this.bitrateEstimateKbps;
  }

  peekRate(): DataRate {
    if (this.currentWindowMs <= 0) {
      return 0;
    }
    return this.sum / this.currentWindowMs;
  }

  expectFastRayeChange(): void {
    this.bitrateEstimateVar += 200;
  }

}