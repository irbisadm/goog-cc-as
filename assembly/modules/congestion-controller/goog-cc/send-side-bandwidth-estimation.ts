// Port of modules/congestion_controller/goog_cc/send_side_bandwidth_estimation.{h,cc} @ M154.
// RtcEventLog and UMA histograms are not ported.
import {DataRate, TimeDelta, Timestamp, Unit} from "../../../units";
import {BandwidthUsage} from "../../../api/transport/bandwidth-usage";
import {SentPacket, TransportPacketsFeedback} from "../../../api/transport/network-types";
import {Optional} from "../../../types/optional";
import {kCongestionControllerMinBitrate} from "../../remote-bitrate-estimator/include/bwe-defines";
import {LossBasedBweV2, LossBasedBweV2Config, LossBasedState} from "./loss-based-bwe-v2";

const kBweIncreaseInterval: TimeDelta = TimeDelta.Millis(1000);
const kBweDecreaseInterval: TimeDelta = TimeDelta.Millis(300);
const kStartPhase: TimeDelta = TimeDelta.Millis(2000);
const kLimitNumPackets: i32 = 20;
const kDefaultMaxBitrate: DataRate = DataRate.BitsPerSec(1000000000);
// Expecting that RTCP feedback is sent uniformly within [0.5, 1.5]s intervals.
const kMaxRtcpFeedbackInterval: TimeDelta = TimeDelta.Millis(5000);

const kDefaultLowLossThreshold: f32 = 0.02;
const kDefaultHighLossThreshold: f32 = 0.1;
const kDefaultBitrateThreshold: DataRate = DataRate.Zero;

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

// Replaces the field trials read by SendSideBandwidthEstimation:
//   "WebRTC-BweLossExperiment/Enabled-<low>,<high>,<kbps>/" -> bweLossExperiment
//   "WebRTC-Bwe-ReceiverLimitCapsOnly/Disabled/"            -> disableReceiverLimitCapsOnly
//   "WebRTC-Bwe-MaxRttLimit"                                -> rttBasedBackoff
//   "WebRTC-Bwe-LossBasedBweV2"                             -> lossBasedBweV2
export class BweLossExperimentConfig {
  enabled: bool = false;
  lowLossThreshold: f32 = kDefaultLowLossThreshold;
  highLossThreshold: f32 = kDefaultHighLossThreshold;
  bitrateThresholdKbps: u32 = 0;
}

export class SendSideBandwidthEstimationConfig {
  bweLossExperiment: BweLossExperimentConfig = new BweLossExperimentConfig();
  disableReceiverLimitCapsOnly: bool = false;
  rttBasedBackoff: RttBasedBackoffConfig = new RttBasedBackoffConfig();
  lossBasedBweV2: LossBasedBweV2Config = new LossBasedBweV2Config();
}

// std::pair<Timestamp, DataRate> of min_bitrate_history_.
class MinBitrateHistoryEntry {
  constructor(public time: Timestamp, public bitrate: DataRate) {}
}

export class SendSideBandwidthEstimation {
  private readonly config: SendSideBandwidthEstimationConfig;
  private rttBackoff: RttBasedBackoff;
  // std::deque<std::pair<Timestamp, DataRate>>
  private minBitrateHistory: MinBitrateHistoryEntry[] = [];

  // incoming filters
  private lostPacketsSinceLastLossUpdate: i32 = 0;
  private expectedPacketsSinceLastLossUpdate: i32 = 0;

  private acknowledgedRate: Optional<DataRate> | null = null;
  private currentTarget: DataRate = DataRate.Zero;
  private minBitrateConfigured: DataRate = kCongestionControllerMinBitrate;
  private maxBitrateConfigured: DataRate = kDefaultMaxBitrate;
  private hasDecreasedSinceLastFractionLoss: bool = false;
  private lastLossFeedback: Timestamp = Timestamp.MinusInfinity;
  private lastLossPacketReport: Timestamp = Timestamp.MinusInfinity;
  private lastFractionLoss: u8 = 0;
  private lastRoundTripTime: TimeDelta = TimeDelta.Zero;

  // The max bitrate as set by the receiver in the call. This is typically
  // signalled using the REMB RTCP message and is used when we don't have any
  // send side delay based estimate.
  private receiverLimit: DataRate = DataRate.PlusInfinity;
  private delayBasedLimit: DataRate = DataRate.PlusInfinity;
  private timeLastDecrease: Timestamp = Timestamp.MinusInfinity;
  private firstReportTime: Timestamp = Timestamp.MinusInfinity;
  private lowLossThreshold: f32 = kDefaultLowLossThreshold;
  private highLossThreshold: f32 = kDefaultHighLossThreshold;
  private bitrateThreshold: DataRate = kDefaultBitrateThreshold;
  private lossBasedBandwidthEstimatorV2: LossBasedBweV2;
  private _lossBasedState: LossBasedState = LossBasedState.kDelayBasedEstimate;
  private readonly disableReceiverLimitCapsOnly: bool;

  constructor(configOrNull: SendSideBandwidthEstimationConfig | null = null) {
    const config = configOrNull !== null ? configOrNull : new SendSideBandwidthEstimationConfig();
    this.config = config;
    this.rttBackoff = new RttBasedBackoff(config.rttBasedBackoff);
    this.lossBasedBandwidthEstimatorV2 = new LossBasedBweV2(config.lossBasedBweV2);
    this.disableReceiverLimitCapsOnly = config.disableReceiverLimitCapsOnly;
    const experiment = config.bweLossExperiment;
    if (experiment.enabled) {
      // ReadBweLossExperimentParameters() RTC_CHECKs these.
      assert(experiment.lowLossThreshold > 0.0, "Loss threshold must be greater than 0.");
      assert(experiment.lowLossThreshold <= 1.0, "Loss threshold must be less than or equal to 1.");
      assert(experiment.highLossThreshold > 0.0, "Loss threshold must be greater than 0.");
      assert(experiment.highLossThreshold <= 1.0, "Loss threshold must be less than or equal to 1.");
      assert(experiment.lowLossThreshold <= experiment.highLossThreshold,
        "The low loss threshold must be less than or equal to the high loss threshold.");
      assert(experiment.bitrateThresholdKbps < <u32>(i32.MAX_VALUE / 1000),
        "Bitrate must be smaller enough to avoid overflows.");
      this.lowLossThreshold = experiment.lowLossThreshold;
      this.highLossThreshold = experiment.highLossThreshold;
      this.bitrateThreshold = DataRate.KilobitsPerSec<u32>(experiment.bitrateThresholdKbps);
    }
    if (this.lossBasedBandwidthEstimatorV2Enabled()) {
      this.lossBasedBandwidthEstimatorV2.setMinMaxBitrate(this.minBitrateConfigured, this.maxBitrateConfigured);
    }
  }

  onRouteChange(): void {
    this.lostPacketsSinceLastLossUpdate = 0;
    this.expectedPacketsSinceLastLossUpdate = 0;
    this.currentTarget = DataRate.Zero;
    this.minBitrateConfigured = kCongestionControllerMinBitrate;
    this.maxBitrateConfigured = kDefaultMaxBitrate;
    this.hasDecreasedSinceLastFractionLoss = false;
    this.lastLossFeedback = Timestamp.MinusInfinity;
    this.lastLossPacketReport = Timestamp.MinusInfinity;
    this.lastFractionLoss = 0;
    this.lastRoundTripTime = TimeDelta.Zero;
    this.receiverLimit = DataRate.PlusInfinity;
    this.delayBasedLimit = DataRate.PlusInfinity;
    this.timeLastDecrease = Timestamp.MinusInfinity;
    this.firstReportTime = Timestamp.MinusInfinity;
    if (this.lossBasedBandwidthEstimatorV2Enabled() && this.lossBasedBandwidthEstimatorV2.useInStartPhase()) {
      this.lossBasedBandwidthEstimatorV2 = new LossBasedBweV2(this.config.lossBasedBweV2);
    }
  }

  targetRate(): DataRate {
    let target = this.currentTarget;
    if (!this.disableReceiverLimitCapsOnly) target = min(target, this.receiverLimit);
    return max(this.minBitrateConfigured, target);
  }

  lossBasedState(): LossBasedState {
    return this._lossBasedState;
  }

  // Return whether the current rtt is higher than the rtt limited configured in
  // RttBasedBackoff.
  isRttAboveLimit(): bool {
    return this.rttBackoff.isRttAboveLimit();
  }

  fractionLoss(): u8 {
    return this.lastFractionLoss;
  }

  roundTripTime(): TimeDelta {
    return this.lastRoundTripTime;
  }

  // Call periodically to update estimate.
  updateEstimate(atTime: Timestamp): void {
    const backoff = this.rttBackoff;
    if (backoff.isRttAboveLimit()) {
      if (Unit.sub(atTime, this.timeLastDecrease) >= backoff.dropInterval && this.currentTarget > backoff.bandwidthFloor) {
        this.timeLastDecrease = atTime;
        const newBitrate = max(Unit.mulF(this.currentTarget, backoff.dropFraction), backoff.bandwidthFloor);
        this.updateTargetBitrate(newBitrate, atTime);
        return;
      }
      // TODO(srte): This is likely redundant in most cases.
      this.applyTargetLimits(atTime);
      return;
    }

    // We trust the REMB and/or delay-based estimate during the first 2 seconds if
    // we haven't had any packet loss reported, to allow startup bitrate probing.
    if (this.lastFractionLoss == 0 && this.isInStartPhase(atTime) &&
        !this.lossBasedBandwidthEstimatorV2.readyToUseInStartPhase()) {
      let newBitrate = this.currentTarget;
      // TODO(srte): We should not allow the new_bitrate to be larger than the
      // receiver limit here.
      if (Unit.isFinite(this.receiverLimit)) newBitrate = max(this.receiverLimit, newBitrate);
      if (Unit.isFinite(this.delayBasedLimit)) {
        newBitrate = max(this.delayBasedLimit, newBitrate);
      }
      if (newBitrate != this.currentTarget) {
        this.minBitrateHistory.length = 0;
        this.minBitrateHistory.push(new MinBitrateHistoryEntry(atTime, this.currentTarget));
        this.updateTargetBitrate(newBitrate, atTime);
        return;
      }
    }
    this.updateMinHistory(atTime);

    if (this.lossBasedBandwidthEstimatorV2ReadyForUse()) {
      const result = this.lossBasedBandwidthEstimatorV2.getLossBasedResult();
      this._lossBasedState = result.state;
      this.updateTargetBitrate(result.bandwidthEstimate, atTime);
      return;
    }

    if (Unit.isInfinite(this.lastLossPacketReport)) {
      // No feedback received.
      // TODO(srte): This is likely redundant in most cases.
      this.applyTargetLimits(atTime);
      return;
    }

    const timeSinceLossPacketReport = Unit.sub(atTime, this.lastLossPacketReport);
    if (timeSinceLossPacketReport < Unit.mulF(kMaxRtcpFeedbackInterval, 1.2)) {
      // We only care about loss above a given bitrate threshold.
      const loss: f32 = <f32>this.lastFractionLoss / <f32>256.0;
      // We only make decisions based on loss when the bitrate is above a
      // threshold. This is a crude way of handling loss which is uncorrelated
      // to congestion.
      if (this.currentTarget < this.bitrateThreshold || loss <= this.lowLossThreshold) {
        // Loss < 2%: Increase rate by 8% of the min bitrate in the last
        // kBweIncreaseInterval.
        // Note that by remembering the bitrate over the last second one can
        // rampup up one second faster than if only allowed to start ramping
        // at 8% per second rate now. E.g.:
        //   If sending a constant 100kbps it can rampup immediately to 108kbps
        //   whenever a receiver report is received with lower packet loss.
        //   If instead one would do: current_bitrate_ *= 1.08^(delta time),
        //   it would take over one second since the lower packet loss to achieve
        //   108kbps.
        let newBitrate = DataRate.BitsPerSec<f64>(<f64>DataRate.bps(this.minBitrateHistory[0].bitrate) * 1.08 + 0.5);

        // Add 1 kbps extra, just to make sure that we do not get stuck
        // (gives a little extra increase at low rates, negligible at higher
        // rates).
        newBitrate = Unit.add(newBitrate, DataRate.BitsPerSec(1000));
        this.updateTargetBitrate(newBitrate, atTime);
        return;
      } else if (this.currentTarget > this.bitrateThreshold) {
        if (loss <= this.highLossThreshold) {
          // Loss between 2% - 10%: Do nothing.
        } else {
          // Loss > 10%: Limit the rate decreases to once a kBweDecreaseInterval
          // + rtt.
          if (!this.hasDecreasedSinceLastFractionLoss &&
              Unit.sub(atTime, this.timeLastDecrease) >= Unit.add(kBweDecreaseInterval, this.lastRoundTripTime)) {
            this.timeLastDecrease = atTime;

            // Reduce rate:
            //   newRate = rate * (1 - 0.5*lossRate);
            //   where packetLoss = 256*lossRate;
            const newBitrate = DataRate.BitsPerSec<f64>(
              (<f64>DataRate.bps(this.currentTarget) * <f64>(512 - <i32>this.lastFractionLoss)) / 512.0);
            this.hasDecreasedSinceLastFractionLoss = true;
            this.updateTargetBitrate(newBitrate, atTime);
            return;
          }
        }
      }
    }
    // TODO(srte): This is likely redundant in most cases.
    this.applyTargetLimits(atTime);
  }

  onSentPacket(sentPacket: SentPacket): void {
    // Only feedback-triggering packets will be reported here.
    this.rttBackoff.lastPacketSent = sentPacket.sendTime;
  }

  updatePropagationRtt(atTime: Timestamp, propagationRtt: TimeDelta): void {
    this.rttBackoff.updatePropagationRtt(atTime, propagationRtt);
  }

  // Call when we receive a RTCP message with TMMBR or REMB.
  updateReceiverEstimate(atTime: Timestamp, bandwidth: DataRate): void {
    // TODO(srte): Ensure caller passes PlusInfinity, not zero, to represent no
    // limitation.
    this.receiverLimit = Unit.isZero(bandwidth) ? DataRate.PlusInfinity : bandwidth;
    this.applyTargetLimits(atTime);
  }

  // Call when a new delay-based estimate is available.
  updateDelayBasedEstimate(atTime: Timestamp, bitrate: DataRate): void {
    // TODO(srte): Ensure caller passes PlusInfinity, not zero, to represent no
    // limitation.
    this.delayBasedLimit = Unit.isZero(bitrate) ? DataRate.PlusInfinity : bitrate;
    this.applyTargetLimits(atTime);
  }

  // Call when we receive a RTCP message with a ReceiveBlock.
  updatePacketsLost(packetsLost: i64, numberOfPackets: i64, atTime: Timestamp): void {
    this.lastLossFeedback = atTime;
    if (Unit.isInfinite(this.firstReportTime)) this.firstReportTime = atTime;

    // Check sequence number diff and weight loss report
    if (numberOfPackets > 0) {
      const expected: i64 = <i64>this.expectedPacketsSinceLastLossUpdate + numberOfPackets;

      // Don't generate a loss rate until it can be based on enough packets.
      if (expected < kLimitNumPackets) {
        // Accumulate reports.
        this.expectedPacketsSinceLastLossUpdate = <i32>expected;
        this.lostPacketsSinceLastLossUpdate += <i32>packetsLost;
        return;
      }

      this.hasDecreasedSinceLastFractionLoss = false;
      const lostQ8: i64 = max<i64>(<i64>this.lostPacketsSinceLastLossUpdate + packetsLost, 0) << 8;
      this.lastFractionLoss = <u8>min<i32>(<i32>(lostQ8 / expected), 255);

      // Reset accumulators.
      this.lostPacketsSinceLastLossUpdate = 0;
      this.expectedPacketsSinceLastLossUpdate = 0;
      this.lastLossPacketReport = atTime;
      this.updateEstimate(atTime);
    }
    // UpdateUmaStatsPacketsLost() only records histograms; not ported.
  }

  // Call when we receive a RTCP message with a ReceiveBlock.
  updateRtt(rtt: TimeDelta, atTime: Timestamp): void {
    // Update RTT if we were able to compute an RTT based on this RTCP.
    // FlexFEC doesn't send RTCP SR, which means we won't be able to compute RTT.
    if (rtt > TimeDelta.Zero) this.lastRoundTripTime = rtt;
    // The rest of UpdateRtt() only records a histogram; not ported.
  }

  setBitrates(sendBitrate: Optional<DataRate> | null, minBitrate: DataRate, maxBitrate: DataRate, atTime: Timestamp): void {
    this.setMinMaxBitrate(minBitrate, maxBitrate);
    if (sendBitrate !== null) {
      this.setSendBitrate(sendBitrate.value, atTime);
    }
  }

  setSendBitrate(bitrate: DataRate, atTime: Timestamp): void {
    assert(bitrate > DataRate.Zero);
    // Reset to avoid being capped by the estimate.
    this.delayBasedLimit = DataRate.PlusInfinity;
    this.updateTargetBitrate(bitrate, atTime);
    // Clear last sent bitrate history so the new value can be used directly
    // and not capped.
    this.minBitrateHistory.length = 0;
  }

  setMinMaxBitrate(minBitrate: DataRate, maxBitrate: DataRate): void {
    this.minBitrateConfigured = max(minBitrate, kCongestionControllerMinBitrate);
    if (maxBitrate > DataRate.Zero && Unit.isFinite(maxBitrate)) {
      this.maxBitrateConfigured = max(this.minBitrateConfigured, maxBitrate);
    } else {
      this.maxBitrateConfigured = kDefaultMaxBitrate;
    }
    this.lossBasedBandwidthEstimatorV2.setMinMaxBitrate(this.minBitrateConfigured, this.maxBitrateConfigured);
  }

  getMinBitrate(): i32 {
    return <i32>DataRate.bps(this.minBitrateConfigured);
  }

  setAcknowledgedRate(acknowledgedRate: Optional<DataRate> | null, atTime: Timestamp): void {
    this.acknowledgedRate = acknowledgedRate;
    if (acknowledgedRate === null) {
      return;
    }
    if (this.lossBasedBandwidthEstimatorV2Enabled()) {
      this.lossBasedBandwidthEstimatorV2.setAcknowledgedBitrate(acknowledgedRate.value);
    }
  }

  updateLossBasedEstimator(
    report: TransportPacketsFeedback,
    delayDetectorState: BandwidthUsage,
    probeBitrate: Optional<DataRate> | null,
    inAlr: bool,
  ): void {
    if (this.lossBasedBandwidthEstimatorV2Enabled()) {
      this.lossBasedBandwidthEstimatorV2.updateBandwidthEstimate(report.packetFeedbacks, this.delayBasedLimit, inAlr);
      this.updateEstimate(report.feedbackTime);
    }
  }

  private isInStartPhase(atTime: Timestamp): bool {
    return Unit.isInfinite(this.firstReportTime) || Unit.sub(atTime, this.firstReportTime) < kStartPhase;
  }

  // Updates history of min bitrates.
  // After this method returns min_bitrate_history_.front().second contains the
  // min bitrate used during last kBweIncreaseIntervalMs.
  private updateMinHistory(atTime: Timestamp): void {
    const history = this.minBitrateHistory;
    // Remove old data points from history.
    // Since history precision is in ms, add one so it is able to increase
    // bitrate if it is off by as little as 0.5ms.
    while (history.length > 0 &&
           Unit.add(Unit.sub(atTime, history[0].time), TimeDelta.Millis(1)) > kBweIncreaseInterval) {
      history.shift();
    }

    // Typical minimum sliding-window algorithm: Pop values higher than current
    // bitrate before pushing it.
    while (history.length > 0 && this.currentTarget <= history[history.length - 1].bitrate) {
      history.pop();
    }

    history.push(new MinBitrateHistoryEntry(atTime, this.currentTarget));
  }

  // Gets the upper limit for the target bitrate. This is the minimum of the
  // delay based limit, the receiver limit and the loss based controller limit.
  private getUpperLimit(): DataRate {
    let upperLimit = this.delayBasedLimit;
    if (this.disableReceiverLimitCapsOnly) upperLimit = min(upperLimit, this.receiverLimit);
    return min(upperLimit, this.maxBitrateConfigured);
  }

  // Cap `bitrate` to [min_bitrate_configured_, max_bitrate_configured_] and
  // set `current_bitrate_` to the capped value.
  private updateTargetBitrate(newBitrate: DataRate, atTime: Timestamp): void {
    newBitrate = min(newBitrate, this.getUpperLimit());
    if (newBitrate < this.minBitrateConfigured) {
      // MaybeLogLowBitrateWarning(): logging only.
      newBitrate = this.minBitrateConfigured;
    }
    this.currentTarget = newBitrate;
  }

  // Applies lower and upper bounds to the current target rate.
  // TODO(srte): This seems to be called even when limits haven't changed, that
  // should be cleaned up.
  private applyTargetLimits(atTime: Timestamp): void {
    this.updateTargetBitrate(this.currentTarget, atTime);
  }

  private lossBasedBandwidthEstimatorV2Enabled(): bool {
    return this.lossBasedBandwidthEstimatorV2.isEnabled();
  }

  private lossBasedBandwidthEstimatorV2ReadyForUse(): bool {
    return this.lossBasedBandwidthEstimatorV2.isReady();
  }
}
