import {TimeDelta} from "../../../../units";

export class RobustThroughputEstimatorSettings {
  // Set `enabled` to true to use the RobustThroughputEstimator, false to use
  // the AcknowledgedBitrateEstimator.
  public enabled: bool = true;
  // The estimator keeps the smallest window containing at least
  // `window_packets` and at least the packets received during the last
  // `min_window_duration` milliseconds.
  // (This means that it may store more than `window_packets` at high bitrates,
  // and a longer duration than `min_window_duration` at low bitrates.)
  // However, if will never store more than kMaxPackets (for performance
  // reasons), and never longer than max_window_duration (to avoid very old
  // packets influencing the estimate for example when sending is paused).
  public windowPackets: usize = 20;
  public maxWindowPackets: usize = 500;
  public minWindowDuration: TimeDelta = 1000;
  public maxWindowDuration: TimeDelta = 5000;

  // The estimator window requires at least `required_packets` packets
  // to produce an estimate.
  public requiredPackets: usize = 10;

  // If audio packets aren't included in allocation (i.e. the
  // estimated available bandwidth is divided only among the video
  // streams), then `unacked_weight` should be set to 0.
  // If audio packets are included in allocation, but not in bandwidth
  // estimation (i.e. they don't have transport-wide sequence numbers,
  // but we nevertheless divide the estimated available bandwidth among
  // both audio and video streams), then `unacked_weight` should be set to 1.
  // If all packets have transport-wide sequence numbers, then the value
  // of `unacked_weight` doesn't matter.
  public unAckedWeight: f64 = 1.0;

  constructor(enabled: bool, windowPackets: usize, maxWindowPackets: usize, minWindowDuration: TimeDelta, maxWindowDuration: TimeDelta, requiredPackets: usize = 10, unAckedWeight: f64 = 1.0) {
    this.enabled = enabled;
    this.windowPackets = (windowPackets < 10 || 1000 < windowPackets)? 20 : windowPackets;
    this.maxWindowPackets =  (maxWindowPackets < 10 || 1000 < maxWindowPackets)? 500 : maxWindowPackets;
    this.maxWindowPackets = Math.max(this.maxWindowPackets, this.windowPackets);
    this.requiredPackets = (requiredPackets < 10 || 1000 < requiredPackets)? 10 : requiredPackets;
    this.requiredPackets = Math.min(this.requiredPackets, this.windowPackets);
    this.minWindowDuration = (minWindowDuration < 100 || 3000 < minWindowDuration)? 750 : minWindowDuration;
    this.maxWindowDuration = (maxWindowDuration < 1000 || 15000 < maxWindowDuration)? 5000 : maxWindowDuration;
    this.minWindowDuration = Math.min(this.minWindowDuration, this.maxWindowDuration);
    this.unAckedWeight = (unAckedWeight < 0.0 || 1.0 < unAckedWeight)? 1.0 : unAckedWeight;
  }
}