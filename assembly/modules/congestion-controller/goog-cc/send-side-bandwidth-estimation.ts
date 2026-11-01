// Port of modules/congestion_controller/goog_cc/send_side_bandwidth_estimation.{h,cc} @ M154.
// Status: RttBasedBackoff is ported; SendSideBandwidthEstimation itself is not
// yet (needs LossBasedBweV2).
import {DataRate, TimeDelta, Timestamp, Unit} from "../../../units";


// Replaces the "WebRTC-Bwe-MaxRttLimit" field trial.
export class RttBasedBackoffConfig {
  disabled: bool = false;
  configuredLimit: TimeDelta = TimeDelta.Seconds(3);
  dropFraction: f64 = 0.8;
  dropInterval: TimeDelta = TimeDelta.Seconds(1);
  bandwidthFloor: DataRate = DataRate.KilobitsPerSec(5);
}

export class RttBasedBackoff {
  readonly disabled: bool;
  readonly configuredLimit: TimeDelta;
  readonly dropFraction: f64;
  readonly dropInterval: TimeDelta;
  readonly bandwidthFloor: DataRate;

  rttLimit: TimeDelta = TimeDelta.PlusInfinity;
  // By initializing this to plus infinity, we make sure that we never
  // trigger rtt backoff unless packet feedback is enabled.
  lastPropagationRttUpdate: Timestamp = Timestamp.PlusInfinity;
  lastPropagationRtt: TimeDelta = TimeDelta.Zero;
  lastPacketSent: Timestamp = Timestamp.MinusInfinity;

  constructor(configOrNull: RttBasedBackoffConfig | null = null) {
    const config = configOrNull !== null ? configOrNull : new RttBasedBackoffConfig();
    this.disabled = config.disabled;
    this.configuredLimit = config.configuredLimit;
    this.dropFraction = config.dropFraction;
    this.dropInterval = config.dropInterval;
    this.bandwidthFloor = config.bandwidthFloor;
    if (!this.disabled) {
      this.rttLimit = this.configuredLimit;
    }
  }

  updatePropagationRtt(atTime: Timestamp, propagationRtt: TimeDelta): void {
    this.lastPropagationRttUpdate = atTime;
    this.lastPropagationRtt = propagationRtt;
  }

  isRttAboveLimit(): bool {
    return this.correctedRtt() > this.rttLimit;
  }

  private correctedRtt(): TimeDelta {
    // Avoid timeout when no packets are being sent.
    const timeoutCorrection = max(Unit.sub(this.lastPacketSent, this.lastPropagationRttUpdate), TimeDelta.Zero);
    return Unit.add(timeoutCorrection, this.lastPropagationRtt);
  }
}
