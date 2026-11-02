// Port of modules/congestion_controller/goog_cc/acknowledged_bitrate_estimator_interface.{h,cc} @ M154.
import {DataRate, TimeDelta, Timestamp} from "../../../units";
import {PacketResult} from "../../../api/transport/network-types";
import {Optional} from "../../../types/optional";
import {BitrateEstimator, BitrateEstimatorConfig} from "./bitrate-estimator";
import {AcknowledgedBitrateEstimator} from "./acknowledged-bitrate-estimator";
import {RobustThroughputEstimator} from "./robust-throughput-estimator";

// Replaces the "WebRTC-Bwe-RobustThroughputEstimatorSettings" field trial.
// Out-of-range values are replaced in validate(), as the upstream constructor
// does after parsing.
export class RobustThroughputEstimatorSettings {
  // Set `enabled` to true to use the RobustThroughputEstimator, false to use
  // the AcknowledgedBitrateEstimator.
  enabled: bool = true;

  // The estimator keeps the smallest window containing at least
  // `window_packets` and at least the packets received during the last
  // `min_window_duration` milliseconds.
  // (This means that it may store more than `window_packets` at high bitrates,
  // and a longer duration than `min_window_duration` at low bitrates.)
  // However, if will never store more than kMaxPackets (for performance
  // reasons), and never longer than max_window_duration (to avoid very old
  // packets influencing the estimate for example when sending is paused).
  windowPackets: u32 = 20;
  maxWindowPackets: u32 = 500;
  minWindowDuration: TimeDelta = TimeDelta.Seconds(1);
  maxWindowDuration: TimeDelta = TimeDelta.Seconds(5);

  // The estimator window requires at least `required_packets` packets
  // to produce an estimate.
  requiredPackets: u32 = 10;

  // If audio packets aren't included in allocation (i.e. the
  // estimated available bandwidth is divided only among the video
  // streams), then `unacked_weight` should be set to 0.
  // If audio packets are included in allocation, but not in bandwidth
  // estimation (i.e. they don't have transport-wide sequence numbers,
  // but we nevertheless divide the estimated available bandwidth among
  // both audio and video streams), then `unacked_weight` should be set to 1.
  // If all packets have transport-wide sequence numbers, then the value
  // of `unacked_weight` doesn't matter.
  unackedWeight: f64 = 1.0;

  validate(): RobustThroughputEstimatorSettings {
    if (this.windowPackets < 10 || this.windowPackets > 1000) {
      // Window size must be between 10 and 1000 packets.
      this.windowPackets = 20;
    }
    if (this.maxWindowPackets < 10 || this.maxWindowPackets > 1000) {
      // Max window size must be between 10 and 1000 packets.
      this.maxWindowPackets = 500;
    }
    this.maxWindowPackets = max(this.maxWindowPackets, this.windowPackets);

    if (this.requiredPackets < 10 || this.requiredPackets > 1000) {
      // Required number of initial packets must be between 10 and 1000 packets.
      this.requiredPackets = 10;
    }
    this.requiredPackets = min(this.requiredPackets, this.windowPackets);

    if (this.minWindowDuration < TimeDelta.Millis(100) || TimeDelta.Millis(3000) < this.minWindowDuration) {
      // Window duration must be between 100 and 3000 ms.
      this.minWindowDuration = TimeDelta.Millis(750);
    }
    if (this.maxWindowDuration < TimeDelta.Seconds(1) || TimeDelta.Seconds(15) < this.maxWindowDuration) {
      // Max window duration must be between 1 and 15 s.
      this.maxWindowDuration = TimeDelta.Seconds(5);
    }
    this.minWindowDuration = min(this.minWindowDuration, this.maxWindowDuration);

    if (this.unackedWeight < 0.0 || 1.0 < this.unackedWeight) {
      // Weight for prior unacked size must be between 0 and 1.
      this.unackedWeight = 1.0;
    }
    return this;
  }
}

export abstract class AcknowledgedBitrateEstimatorInterface {
  abstract incomingPacketFeedbackVector(packetFeedbackVector: PacketResult[]): void;
  abstract bitrate(): Optional<DataRate> | null;
  abstract peekRate(): Optional<DataRate> | null;
  abstract setAlr(inAlr: bool): void;
  abstract setAlrEndedTime(alrEndedTime: Timestamp): void;
}

// AcknowledgedBitrateEstimatorInterface::Create.
export function createAcknowledgedBitrateEstimator(
  settingsOrNull: RobustThroughputEstimatorSettings | null = null,
  bitrateEstimatorConfig: BitrateEstimatorConfig | null = null,
): AcknowledgedBitrateEstimatorInterface {
  const settings = settingsOrNull !== null ? settingsOrNull : new RobustThroughputEstimatorSettings();
  settings.validate();
  if (settings.enabled) {
    return new RobustThroughputEstimator(settings);
  }
  return new AcknowledgedBitrateEstimator(new BitrateEstimator(bitrateEstimatorConfig));
}
