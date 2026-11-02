// Port of modules/congestion_controller/goog_cc/goog_cc_network_control.{h,cc} @ M154.
// RtcEventLog is not ported.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../units";
import {Optional} from "../../../types/optional";
import {Environment} from "../../../api/environment/environment";
import {BandwidthUsage} from "../../../api/transport/bandwidth-usage";
import {NetworkStatePredictor} from "../../../api/network-state-predictor";
import {
  NetworkControllerConfig,
  NetworkControllerInterface,
  NetworkStateEstimator,
} from "../../../api/transport/network-control";
import {
  NetworkAvailability,
  NetworkControlUpdate,
  NetworkRouteChange,
  NetworkStateEstimate,
  PacedPacketInfo,
  PacerConfig,
  ProbeClusterConfig,
  ProcessInterval,
  ReceivedPacket,
  RemoteBitrateReport,
  RoundTripTimeUpdate,
  SentPacket,
  StreamsConfig,
  TargetRateConstraints,
  TargetTransferRate,
  TransportLossReport,
  TransportPacketsFeedback,
} from "../../../api/transport/network-types";
import {CongestionWindowConfig, RateControlSettings} from "../../../rtc-base/experiments/rate-control-settings";
import {kCongestionControllerMinBitrate} from "../../remote-bitrate-estimator/include/bwe-defines";
import {
  AcknowledgedBitrateEstimatorInterface,
  createAcknowledgedBitrateEstimator,
  RobustThroughputEstimatorSettings,
} from "./acknowledged-bitrate-estimator-interface";
import {AlrDetector, AlrDetectorConfig} from "./alr-detector";
import {BitrateEstimatorConfig} from "./bitrate-estimator";
import {CongestionWindowPushbackController} from "./congestion-window-pushback-controller";
import {DelayBasedBwe, DelayBasedBweConfig, DelayBasedBweResult} from "./delay-based-bwe";
import {LossBasedState} from "./loss-based-bwe-v2";
import {ProbeBitrateEstimator} from "./probe-bitrate-estimator";
import {BandwidthLimitedCause, ProbeController, ProbeControllerConfig} from "./probe-controller";
import {SendSideBandwidthEstimation, SendSideBandwidthEstimationConfig} from "./send-side-bandwidth-estimation";

// Pacing-rate relative to our target send rate.
// Multiplicative factor that is applied to the target bitrate to calculate
// the number of bytes that can be transmitted per interval.
// Increasing this factor will result in lower delays in cases of bitrate
// overshoots from the encoder.
const kDefaultPaceMultiplier: f32 = 2.5;

// If send side bandwidth estimation is used, this pacing multiplier is used per
// default.
const kDefaultPaceMultiplierWithSendSideBwe: f32 = 1.1;

// If the probe result is far below the current throughput estimate
// it's unlikely that the probe is accurate, so we don't want to drop too far.
// However, if we actually are overusing, we want to drop to something slightly
// below the current throughput estimate to drain the network queues.
const kProbeDropThroughputFraction: f64 = 0.85;

function getBandwidthLimitedCause(
  lossBasedState: LossBasedState,
  isRttAboveLimit: bool,
  bandwidthUsage: BandwidthUsage,
): BandwidthLimitedCause {
  if (bandwidthUsage == BandwidthUsage.kBwOverusing || bandwidthUsage == BandwidthUsage.kBwUnderusing) {
    return BandwidthLimitedCause.kDelayBasedLimitedDelayIncreased;
  } else if (isRttAboveLimit) {
    return BandwidthLimitedCause.kRttBasedBackOffHighRtt;
  }
  switch (lossBasedState) {
    case LossBasedState.kDecreasing:
      // Probes may not be sent in this state.
      return BandwidthLimitedCause.kLossLimitedBwe;
    case LossBasedState.kIncreaseUsingPadding:
      // Probes may not be sent in this state.
      return BandwidthLimitedCause.kLossLimitedBwe;
    case LossBasedState.kIncreasing:
      // Probes may be sent in this state.
      return BandwidthLimitedCause.kLossLimitedBweIncreasing;
    case LossBasedState.kDelayBasedEstimate:
      return BandwidthLimitedCause.kDelayBasedLimited;
  }
  unreachable();
  return BandwidthLimitedCause.kDelayBasedLimited;
}

// GoogCcConfig.
export class GoogCcConfig {
  networkStateEstimator: NetworkStateEstimator | null = null;
  networkStatePredictor: NetworkStatePredictor | null = null;
}

// Replaces the FieldTrialsView carried by upstream's Environment: the settings
// of every component GoogCC creates, plus its own flags. Defaults equal the
// upstream behaviour with no field trials set.
export class GoogCcFieldTrials {
  // "WebRTC-Bwe-SafeResetOnRouteChange/Enabled,ack/"
  safeResetOnRouteChange: bool = false;
  safeResetAcknowledgedRate: bool = false;
  // "WebRTC-Bwe-MinAllocAsLowerBound/Disabled/" sets this to false.
  useMinAllocatableAsLowerBound: bool = true;
  // "WebRTC-Bwe-IgnoreProbesLowerThanNetworkStateEstimate/Disabled/" sets this to false.
  ignoreProbesLowerThanNetworkEstimate: bool = true;
  // "WebRTC-Bwe-LimitProbesLowerThanThroughputEstimate/Disabled/" sets this to false.
  limitProbesLowerThanThroughputEstimate: bool = true;
  // "WebRTC-Bwe-LimitPacingFactorByUpperLinkCapacityEstimate/Enabled/"
  limitPacingFactorByUpperLinkCapacityEstimate: bool = false;
  // "WebRTC-CongestionWindow"
  congestionWindow: CongestionWindowConfig = new CongestionWindowConfig();
  // "WebRTC-AddPacingToCongestionWindowPushback/Enabled/"
  addPacingToCongestionWindowPushback: bool = false;

  probeController: ProbeControllerConfig = new ProbeControllerConfig();
  sendSideBandwidthEstimation: SendSideBandwidthEstimationConfig = new SendSideBandwidthEstimationConfig();
  alrDetector: AlrDetectorConfig = AlrDetectorConfig.defaults();
  delayBasedBwe: DelayBasedBweConfig = new DelayBasedBweConfig();
  robustThroughputEstimator: RobustThroughputEstimatorSettings = new RobustThroughputEstimatorSettings();
  bitrateEstimator: BitrateEstimatorConfig = new BitrateEstimatorConfig();
}

function cloneConstraints(c: TargetRateConstraints): TargetRateConstraints {
  const copy = new TargetRateConstraints();
  copy.atTime = c.atTime;
  copy.minDataRate = c.minDataRate !== null ? new Optional<DataRate>(c.minDataRate!.value) : null;
  copy.maxDataRate = c.maxDataRate !== null ? new Optional<DataRate>(c.maxDataRate!.value) : null;
  copy.startingRate = c.startingRate !== null ? new Optional<DataRate>(c.startingRate!.value) : null;
  return copy;
}

export class GoogCcNetworkController extends NetworkControllerInterface {
  private readonly env: Environment;
  private readonly trials: GoogCcFieldTrials;
  private readonly safeResetOnRouteChange: bool;
  private readonly safeResetAcknowledgedRate: bool;
  private readonly useMinAllocatableAsLowerBound: bool;
  private readonly ignoreProbesLowerThanNetworkEstimate: bool;
  private readonly limitProbesLowerThanThroughputEstimate: bool;
  private readonly rateControlSettings: RateControlSettings;
  private readonly limitPacingfactorByUpperLinkCapacityEstimate: bool;

  private readonly probeController: ProbeController;
  private readonly congestionWindowPushbackController: CongestionWindowPushbackController | null;

  private bandwidthEstimation: SendSideBandwidthEstimation;
  private alrDetector: AlrDetector;
  private probeBitrateEstimator: ProbeBitrateEstimator;
  private networkEstimator: NetworkStateEstimator | null;
  private networkStatePredictor: NetworkStatePredictor | null;
  private delayBasedBwe: DelayBasedBwe;
  private acknowledgedBitrateEstimator: AcknowledgedBitrateEstimatorInterface;

  private initialConfig: NetworkControllerConfig | null;

  private minTargetRate: DataRate = DataRate.Zero;
  private minDataRate: DataRate = DataRate.Zero;
  private maxDataRate: DataRate = DataRate.PlusInfinity;
  private startingRate: Optional<DataRate> | null = null;

  private firstPacketSent: bool = false;
  private firstTransportFeedbackReceived: bool = false;

  private estimate: NetworkStateEstimate | null = null;

  // std::deque<int64_t>
  private feedbackMaxRtts: i64[] = [];

  private lastLossBasedTargetRate: DataRate;
  private lastPushbackTargetRate: DataRate;
  private lastLossBaseState: LossBasedState = LossBasedState.kDelayBasedEstimate;
  // std::optional<uint8_t>, always set (initialized to 0).
  private lastEstimatedFractionLoss: u8 = 0;
  private lastEstimatedRoundTripTime: TimeDelta = TimeDelta.PlusInfinity;

  private pacingFactor: Optional<f64> | null;
  private pacingTimeWindow: TimeDelta;
  private minTotalAllocatedBitrate: DataRate;
  private maxPaddingRate: DataRate;

  private previouslyInAlr: bool = false;
  private lastIsBandwidthLimited: bool = true;

  private currentDataWindow: Optional<DataSize> | null = null;

  constructor(
    config: NetworkControllerConfig,
    googCcConfig: GoogCcConfig | null = null,
    fieldTrials: GoogCcFieldTrials | null = null,
  ) {
    super();
    const trials = fieldTrials !== null ? fieldTrials : new GoogCcFieldTrials();
    const ccConfig = googCcConfig !== null ? googCcConfig : new GoogCcConfig();
    const rateControlSettings = new RateControlSettings(trials.congestionWindow);
    const startingRate = config.constraints.startingRate;
    assert(startingRate !== null, "starting_rate must be set");
    assert(Unit.isFinite(config.constraints.atTime));

    this.env = config.env;
    this.trials = trials;
    this.safeResetOnRouteChange = trials.safeResetOnRouteChange;
    this.safeResetAcknowledgedRate = trials.safeResetAcknowledgedRate;
    this.useMinAllocatableAsLowerBound = trials.useMinAllocatableAsLowerBound;
    this.ignoreProbesLowerThanNetworkEstimate = trials.ignoreProbesLowerThanNetworkEstimate;
    this.limitProbesLowerThanThroughputEstimate = trials.limitProbesLowerThanThroughputEstimate;
    this.rateControlSettings = rateControlSettings;
    this.limitPacingfactorByUpperLinkCapacityEstimate = trials.limitPacingFactorByUpperLinkCapacityEstimate;
    this.probeController = new ProbeController(trials.probeController);
    this.congestionWindowPushbackController = rateControlSettings.useCongestionWindowPushback()
      ? new CongestionWindowPushbackController(rateControlSettings, trials.addPacingToCongestionWindowPushback)
      : null;
    this.bandwidthEstimation = new SendSideBandwidthEstimation(trials.sendSideBandwidthEstimation);
    this.alrDetector = new AlrDetector(config.env, trials.alrDetector);
    this.probeBitrateEstimator = new ProbeBitrateEstimator();
    this.networkEstimator = ccConfig.networkStateEstimator;
    this.networkStatePredictor = ccConfig.networkStatePredictor;
    this.delayBasedBwe = new DelayBasedBwe(trials.delayBasedBwe, ccConfig.networkStatePredictor);
    this.acknowledgedBitrateEstimator =
      createAcknowledgedBitrateEstimator(trials.robustThroughputEstimator, trials.bitrateEstimator);
    this.initialConfig = config;
    this.lastLossBasedTargetRate = startingRate!.value;
    this.lastPushbackTargetRate = startingRate!.value;
    this.pacingFactor = config.streamBasedConfig.pacingFactor;
    this.pacingTimeWindow = config.defaultPacingTimeWindow;
    const minTotal = config.streamBasedConfig.minTotalAllocatedBitrate;
    this.minTotalAllocatedBitrate = minTotal !== null ? minTotal.value : DataRate.Zero;
    const maxPadding = config.streamBasedConfig.maxPaddingRate;
    this.maxPaddingRate = maxPadding !== null ? maxPadding.value : DataRate.Zero;

    this.delayBasedBwe.setMinBitrate(kCongestionControllerMinBitrate);
  }

  onNetworkAvailability(msg: NetworkAvailability): NetworkControlUpdate {
    const update = new NetworkControlUpdate();
    update.probeClusterConfigs = this.probeController.onNetworkAvailability(msg);
    return update;
  }

  onNetworkRouteChange(msg: NetworkRouteChange): NetworkControlUpdate {
    const constraints = cloneConstraints(msg.constraints);
    if (this.safeResetOnRouteChange) {
      let estimatedBitrate: Optional<DataRate> | null = null;
      if (this.safeResetAcknowledgedRate) {
        estimatedBitrate = this.acknowledgedBitrateEstimator.bitrate();
        if (estimatedBitrate === null) estimatedBitrate = this.acknowledgedBitrateEstimator.peekRate();
      } else {
        estimatedBitrate = new Optional<DataRate>(this.bandwidthEstimation.targetRate());
      }
      if (estimatedBitrate !== null) {
        const starting = constraints.startingRate;
        if (starting !== null) {
          constraints.startingRate = new Optional<DataRate>(min(starting.value, estimatedBitrate.value));
        } else {
          constraints.startingRate = new Optional<DataRate>(estimatedBitrate.value);
        }
      }
    }

    this.acknowledgedBitrateEstimator =
      createAcknowledgedBitrateEstimator(this.trials.robustThroughputEstimator, this.trials.bitrateEstimator);
    this.probeBitrateEstimator = new ProbeBitrateEstimator();
    const networkEstimator = this.networkEstimator;
    if (networkEstimator !== null) networkEstimator.onRouteChange(msg);
    this.delayBasedBwe = new DelayBasedBwe(this.trials.delayBasedBwe, this.networkStatePredictor);
    this.bandwidthEstimation.onRouteChange();
    this.probeController.reset(msg.atTime);
    const update = new NetworkControlUpdate();
    update.probeClusterConfigs = this.resetConstraints(constraints);
    this.maybeTriggerOnNetworkChanged(update, msg.atTime);
    return update;
  }

  onProcessInterval(msg: ProcessInterval): NetworkControlUpdate {
    const update = new NetworkControlUpdate();
    const initialConfig = this.initialConfig;
    if (initialConfig !== null) {
      update.probeClusterConfigs = this.resetConstraints(initialConfig.constraints);
      update.pacerConfig = this.getPacingRates(msg.atTime);

      const requestsAlrProbing = initialConfig.streamBasedConfig.requestsAlrProbing;
      if (requestsAlrProbing !== null) {
        this.probeController.enablePeriodicAlrProbing(requestsAlrProbing.value);
      }
      this.probeController.enableRepeatedInitialProbing(initialConfig.streamBasedConfig.enableRepeatedInitialProbing);
      const totalBitrate = initialConfig.streamBasedConfig.maxTotalAllocatedBitrate;
      if (totalBitrate !== null) {
        const probes = this.probeController.onMaxTotalAllocatedBitrate(totalBitrate.value, msg.atTime);
        appendAll(update.probeClusterConfigs, probes);
      }
      this.initialConfig = null;
    }
    const pushback = this.congestionWindowPushbackController;
    const pacerQueue = msg.pacerQueue;
    if (pushback !== null && pacerQueue !== null) {
      pushback.updatePacingQueue(DataSize.bytes(pacerQueue.value));
    }
    this.bandwidthEstimation.updateEstimate(msg.atTime);
    // Avoid ALR probing before the first transport feedback is received in
    // order to avoid ALR probing if receive side BWE is used.
    this.probeController.setAlrStartTime(
      this.firstTransportFeedbackReceived ? this.alrDetector.getApplicationLimitedRegionStartTime() : null);

    const probes = this.probeController.process(msg.atTime);
    appendAll(update.probeClusterConfigs, probes);

    if (this.rateControlSettings.useCongestionWindow() && this.feedbackMaxRtts.length > 0) {
      this.updateCongestionWindowSize();
    }
    const dataWindow = this.currentDataWindow;
    if (pushback !== null && dataWindow !== null) {
      pushback.setDataWindow(dataWindow.value);
    } else {
      update.congestionWindow = dataWindow;
    }
    this.maybeTriggerOnNetworkChanged(update, msg.atTime);
    return update;
  }

  onRemoteBitrateReport(msg: RemoteBitrateReport): NetworkControlUpdate {
    this.bandwidthEstimation.updateReceiverEstimate(msg.receiveTime, msg.bandwidth);
    return new NetworkControlUpdate();
  }

  onRoundTripTimeUpdate(msg: RoundTripTimeUpdate): NetworkControlUpdate {
    if (msg.smoothed) {
      return new NetworkControlUpdate();
    }
    assert(!Unit.isZero(msg.roundTripTime));
    this.delayBasedBwe.onRttUpdate(msg.roundTripTime);
    this.bandwidthEstimation.updateRtt(msg.roundTripTime, msg.receiveTime);
    return new NetworkControlUpdate();
  }

  onSentPacket(sentPacket: SentPacket): NetworkControlUpdate {
    this.alrDetector.onBytesSent(sentPacket.size, sentPacket.sendTime);
    this.acknowledgedBitrateEstimator.setAlr(this.alrDetector.getApplicationLimitedRegionStartTime() !== null);

    if (!this.firstPacketSent) {
      this.firstPacketSent = true;
      // Initialize feedback time to send time to allow estimation of RTT until
      // first feedback is received.
      this.bandwidthEstimation.updatePropagationRtt(sentPacket.sendTime, TimeDelta.Zero);
    }
    this.bandwidthEstimation.onSentPacket(sentPacket);

    const pushback = this.congestionWindowPushbackController;
    if (pushback !== null) {
      pushback.updateOutstandingData(DataSize.bytes(sentPacket.dataInFlight));
      const update = new NetworkControlUpdate();
      this.maybeTriggerOnNetworkChanged(update, sentPacket.sendTime);
      return update;
    } else {
      return new NetworkControlUpdate();
    }
  }

  onReceivedPacket(receivedPacket: ReceivedPacket): NetworkControlUpdate {
    return new NetworkControlUpdate();
  }

  onStreamsConfig(msg: StreamsConfig): NetworkControlUpdate {
    const update = new NetworkControlUpdate();
    const requestsAlrProbing = msg.requestsAlrProbing;
    if (requestsAlrProbing !== null) {
      this.probeController.enablePeriodicAlrProbing(requestsAlrProbing.value);
    }
    const maxTotal = msg.maxTotalAllocatedBitrate;
    if (maxTotal !== null) {
      update.probeClusterConfigs = this.probeController.onMaxTotalAllocatedBitrate(maxTotal.value, msg.atTime);
    }

    let pacingChanged = false;
    const pacingFactor = msg.pacingFactor;
    const currentPacingFactor = this.pacingFactor;
    if (pacingFactor !== null && (currentPacingFactor === null || pacingFactor.value != currentPacingFactor.value)) {
      this.pacingFactor = new Optional<f64>(pacingFactor.value);
      pacingChanged = true;
    }
    const minTotal = msg.minTotalAllocatedBitrate;
    if (minTotal !== null && minTotal.value != this.minTotalAllocatedBitrate) {
      this.minTotalAllocatedBitrate = minTotal.value;
      pacingChanged = true;

      if (this.useMinAllocatableAsLowerBound) {
        this.clampConstraints();
        this.delayBasedBwe.setMinBitrate(this.minDataRate);
        this.bandwidthEstimation.setMinMaxBitrate(this.minDataRate, this.maxDataRate);
      }
    }
    const maxPadding = msg.maxPaddingRate;
    if (maxPadding !== null && maxPadding.value != this.maxPaddingRate) {
      this.maxPaddingRate = maxPadding.value;
      pacingChanged = true;
    }

    if (pacingChanged) update.pacerConfig = this.getPacingRates(msg.atTime);
    return update;
  }

  onTargetRateConstraints(constraints: TargetRateConstraints): NetworkControlUpdate {
    const update = new NetworkControlUpdate();
    update.probeClusterConfigs = this.resetConstraints(constraints);
    this.maybeTriggerOnNetworkChanged(update, constraints.atTime);
    return update;
  }

  onTransportLossReport(msg: TransportLossReport): NetworkControlUpdate {
    const totalPacketsDelta = <i64>(msg.packetsReceivedDelta + msg.packetsLostDelta);
    this.bandwidthEstimation.updatePacketsLost(<i64>msg.packetsLostDelta, totalPacketsDelta, msg.receiveTime);
    return new NetworkControlUpdate();
  }

  onTransportPacketsFeedback(report: TransportPacketsFeedback): NetworkControlUpdate {
    if (report.packetFeedbacks.length == 0) {
      // TODO(bugs.webrtc.org/10125): Design a better mechanism to safe-guard
      // against building very large network queues.
      return new NetworkControlUpdate();
    }

    if (!this.firstTransportFeedbackReceived) {
      // Send side BWE is used.
      this.firstTransportFeedbackReceived = true;
    }

    const pushback = this.congestionWindowPushbackController;
    if (pushback !== null) {
      pushback.updateOutstandingData(DataSize.bytes(report.dataInFlight));
    }
    let maxFeedbackRtt = TimeDelta.MinusInfinity;
    let minPropagationRtt = TimeDelta.PlusInfinity;
    let maxRecvTime = Timestamp.MinusInfinity;

    const feedbacks = report.receivedWithSendInfo();
    for (let i = 0; i < feedbacks.length; ++i) maxRecvTime = max(maxRecvTime, feedbacks[i].receiveTime);

    for (let i = 0; i < feedbacks.length; ++i) {
      const feedback = feedbacks[i];
      const feedbackRtt = Unit.sub(report.feedbackTime, feedback.sentPacket.sendTime);
      const minPendingTime = Unit.sub(maxRecvTime, feedback.receiveTime);
      const propagationRtt = Unit.sub(feedbackRtt, minPendingTime);
      maxFeedbackRtt = max(maxFeedbackRtt, feedbackRtt);
      minPropagationRtt = min(minPropagationRtt, propagationRtt);
    }

    if (Unit.isFinite(maxFeedbackRtt)) {
      this.feedbackMaxRtts.push(TimeDelta.ms(maxFeedbackRtt));
      const kMaxFeedbackRttWindow = 32;
      if (this.feedbackMaxRtts.length > kMaxFeedbackRttWindow) this.feedbackMaxRtts.shift();
      // TODO(srte): Use time since last unacknowledged packet.
      this.bandwidthEstimation.updatePropagationRtt(report.feedbackTime, minPropagationRtt);
    }

    const alrStartTime = this.alrDetector.getApplicationLimitedRegionStartTime();

    if (this.previouslyInAlr && alrStartTime === null) {
      this.acknowledgedBitrateEstimator.setAlrEndedTime(report.feedbackTime);
      this.probeController.setAlrEndedTime(report.feedbackTime);
    }
    this.previouslyInAlr = alrStartTime !== null;
    const sortedByReceiveTime = report.sortedByReceiveTime();
    this.acknowledgedBitrateEstimator.incomingPacketFeedbackVector(sortedByReceiveTime);
    const acknowledgedBitrate = this.acknowledgedBitrateEstimator.bitrate();
    this.bandwidthEstimation.setAcknowledgedRate(acknowledgedBitrate, report.feedbackTime);
    for (let i = 0; i < sortedByReceiveTime.length; ++i) {
      const feedback = sortedByReceiveTime[i];
      if (feedback.sentPacket.pacingInfo.probeClusterId != PacedPacketInfo.kNotAProbe) {
        this.probeBitrateEstimator.handleProbeAndEstimateBitrate(feedback);
      }
    }

    const networkEstimator = this.networkEstimator;
    if (networkEstimator !== null) {
      networkEstimator.onTransportPacketsFeedback(report);
      this.setNetworkStateEstimate(networkEstimator.getCurrentEstimate());
    }
    let probeBitrate = this.probeBitrateEstimator.fetchAndResetLastEstimatedBitrate();
    const estimate = this.estimate;
    if (this.ignoreProbesLowerThanNetworkEstimate && probeBitrate !== null && estimate !== null &&
        probeBitrate.value < this.delayBasedBwe.lastEstimate() &&
        probeBitrate.value < estimate.linkCapacityLower) {
      probeBitrate = null;
    }
    if (this.limitProbesLowerThanThroughputEstimate && probeBitrate !== null && acknowledgedBitrate !== null) {
      // Limit the backoff to something slightly below the acknowledged
      // bitrate. ("Slightly below" because we want to drain the queues
      // if we are actually overusing.)
      // The acknowledged bitrate shouldn't normally be higher than the delay
      // based estimate, but it could happen e.g. due to packet bursts or
      // encoder overshoot. We use std::min to ensure that a probe result
      // below the current BWE never causes an increase.
      const limit = min(this.delayBasedBwe.lastEstimate(),
        Unit.mulF(acknowledgedBitrate.value, kProbeDropThroughputFraction));
      probeBitrate = new Optional<DataRate>(max(probeBitrate.value, limit));
    }

    const update = new NetworkControlUpdate();
    let recoveredFromOveruse = false;

    const result: DelayBasedBweResult = this.delayBasedBwe.incomingPacketFeedbackVector(
      report, acknowledgedBitrate, probeBitrate, this.estimate, alrStartTime !== null);

    if (result.updated) {
      if (result.probe) {
        this.bandwidthEstimation.setSendBitrate(result.targetBitrate, report.feedbackTime);
      }
      // Since SetSendBitrate now resets the delay-based estimate, we have to
      // call UpdateDelayBasedEstimate after SetSendBitrate.
      this.bandwidthEstimation.updateDelayBasedEstimate(report.feedbackTime, result.targetBitrate);
    }
    this.bandwidthEstimation.updateLossBasedEstimator(
      report, result.delayDetectorState, probeBitrate, alrStartTime !== null);
    if (result.updated) {
      // Update the estimate in the ProbeController, in case we want to probe.
      this.maybeTriggerOnNetworkChanged(update, report.feedbackTime);
    }

    recoveredFromOveruse = result.recoveredFromOveruse;

    if (recoveredFromOveruse) {
      this.probeController.setAlrStartTime(alrStartTime);
      const probes = this.probeController.requestProbe(report.feedbackTime);
      appendAll(update.probeClusterConfigs, probes);
    }

    // No valid RTT could be because send-side BWE isn't used, in which case
    // we don't try to limit the outstanding packets.
    if (this.rateControlSettings.useCongestionWindow() && Unit.isFinite(maxFeedbackRtt)) {
      this.updateCongestionWindowSize();
    }
    const dataWindow = this.currentDataWindow;
    if (pushback !== null && dataWindow !== null) {
      pushback.setDataWindow(dataWindow.value);
    } else {
      update.congestionWindow = dataWindow;
    }

    return update;
  }

  onNetworkStateEstimate(msg: NetworkStateEstimate): NetworkControlUpdate {
    if (this.networkEstimator === null) {
      this.setNetworkStateEstimate(msg);
    }
    return new NetworkControlUpdate();
  }

  getNetworkState(atTime: Timestamp): NetworkControlUpdate {
    const update = new NetworkControlUpdate();
    const targetRate = new TargetTransferRate();
    targetRate.networkEstimate.atTime = atTime;
    targetRate.networkEstimate.lossRateRatio = <f32>(<f64>this.lastEstimatedFractionLoss / 255.0);
    targetRate.networkEstimate.roundTripTime = this.lastEstimatedRoundTripTime;
    targetRate.atTime = atTime;
    targetRate.targetRate = this.lastPushbackTargetRate;
    targetRate.isBandwidthLimited = this.alrDetector.getApplicationLimitedRegionStartTime() === null;
    update.targetRate = targetRate;
    update.pacerConfig = this.getPacingRates(atTime);
    update.congestionWindow = this.currentDataWindow;
    return update;
  }

  private resetConstraints(newConstraints: TargetRateConstraints): ProbeClusterConfig[] {
    const minRate = newConstraints.minDataRate;
    this.minTargetRate = minRate !== null ? minRate.value : DataRate.Zero;
    const maxRate = newConstraints.maxDataRate;
    this.maxDataRate = maxRate !== null ? maxRate.value : DataRate.PlusInfinity;
    const starting = newConstraints.startingRate;
    this.startingRate = starting !== null ? new Optional<DataRate>(starting.value) : null;
    this.clampConstraints();

    this.bandwidthEstimation.setBitrates(this.startingRate, this.minDataRate, this.maxDataRate, newConstraints.atTime);

    const startingRate = this.startingRate;
    if (startingRate !== null) this.delayBasedBwe.setStartBitrate(startingRate.value);
    this.delayBasedBwe.setMinBitrate(this.minDataRate);

    return this.probeController.setBitrates(
      this.minDataRate, startingRate !== null ? startingRate.value : DataRate.Zero, this.maxDataRate,
      newConstraints.atTime);
  }

  private clampConstraints(): void {
    // TODO(holmer): We should make sure the default bitrates are set to 10 kbps,
    // and that we don't try to set the min bitrate to 0 from any applications.
    // The congestion controller should allow a min bitrate of 0.
    this.minDataRate = max(this.minTargetRate, kCongestionControllerMinBitrate);
    if (this.useMinAllocatableAsLowerBound) {
      this.minDataRate = max(this.minDataRate, this.minTotalAllocatedBitrate);
    }
    if (this.maxDataRate < this.minDataRate) {
      // max bitrate smaller than min bitrate
      this.maxDataRate = this.minDataRate;
    }
    const startingRate = this.startingRate;
    if (startingRate !== null && startingRate.value < this.minDataRate) {
      // start bitrate smaller than min bitrate
      this.startingRate = new Optional<DataRate>(this.minDataRate);
    }
  }

  private maybeTriggerOnNetworkChanged(update: NetworkControlUpdate, atTime: Timestamp): void {
    const fractionLoss = this.bandwidthEstimation.fractionLoss();
    const roundTripTime = this.bandwidthEstimation.roundTripTime();
    const lossBasedTargetRate = this.bandwidthEstimation.targetRate();
    const lossBasedState = this.bandwidthEstimation.lossBasedState();
    let pushbackTargetRate = lossBasedTargetRate;

    let cwndReduceRatio: f64 = 0.0;
    const pushback = this.congestionWindowPushbackController;
    if (pushback !== null) {
      let pushbackRate: i64 = <i64>pushback.updateTargetBitrate(<u32>DataRate.bps(lossBasedTargetRate));
      pushbackRate = max<i64>(<i64>this.bandwidthEstimation.getMinBitrate(), pushbackRate);
      pushbackTargetRate = DataRate.BitsPerSec<i64>(pushbackRate);
      if (this.rateControlSettings.useCongestionWindowDropFrameOnly()) {
        cwndReduceRatio = <f64>(DataRate.bps(lossBasedTargetRate) - DataRate.bps(pushbackTargetRate)) /
          <f64>DataRate.bps(lossBasedTargetRate);
      }
    }
    const isBandwidthLimited = this.alrDetector.getApplicationLimitedRegionStartTime() === null;
    if (lossBasedTargetRate != this.lastLossBasedTargetRate ||
        lossBasedState != this.lastLossBaseState ||
        fractionLoss != this.lastEstimatedFractionLoss ||
        roundTripTime != this.lastEstimatedRoundTripTime ||
        pushbackTargetRate != this.lastPushbackTargetRate ||
        isBandwidthLimited != this.lastIsBandwidthLimited) {
      this.lastLossBasedTargetRate = lossBasedTargetRate;
      this.lastPushbackTargetRate = pushbackTargetRate;
      this.lastEstimatedFractionLoss = fractionLoss;
      this.lastEstimatedRoundTripTime = roundTripTime;
      this.lastLossBaseState = lossBasedState;
      this.lastIsBandwidthLimited = isBandwidthLimited;

      this.alrDetector.setEstimatedBitrate(lossBasedTargetRate);

      const targetRateMsg = new TargetTransferRate();
      targetRateMsg.atTime = atTime;
      if (this.rateControlSettings.useCongestionWindowDropFrameOnly()) {
        targetRateMsg.targetRate = lossBasedTargetRate;
        targetRateMsg.cwndReduceRatio = cwndReduceRatio;
      } else {
        targetRateMsg.targetRate = pushbackTargetRate;
      }
      targetRateMsg.networkEstimate.atTime = atTime;
      targetRateMsg.networkEstimate.roundTripTime = roundTripTime;
      targetRateMsg.networkEstimate.lossRateRatio = <f32>fractionLoss / <f32>255.0;
      targetRateMsg.isBandwidthLimited = isBandwidthLimited;

      update.targetRate = targetRateMsg;

      const probes = this.probeController.setEstimatedBitrate(
        lossBasedTargetRate,
        getBandwidthLimitedCause(
          this.bandwidthEstimation.lossBasedState(), this.bandwidthEstimation.isRttAboveLimit(),
          this.delayBasedBwe.lastState()),
        atTime);
      appendAll(update.probeClusterConfigs, probes);
      update.pacerConfig = this.getPacingRates(atTime);
    }
  }

  private updateCongestionWindowSize(): void {
    let minRttMs = this.feedbackMaxRtts[0];
    for (let i = 1; i < this.feedbackMaxRtts.length; ++i) minRttMs = min(minRttMs, this.feedbackMaxRtts[i]);
    const minFeedbackMaxRtt = TimeDelta.Millis<i64>(minRttMs);

    const kMinCwnd = DataSize.Bytes(2 * 1500);
    const timeWindow = Unit.add(minFeedbackMaxRtt,
      TimeDelta.Millis<i64>(this.rateControlSettings.getCongestionWindowAdditionalTimeMs()));

    let dataWindow = DataRate.mulTime(this.lastLossBasedTargetRate, timeWindow);
    const current = this.currentDataWindow;
    if (current !== null) {
      dataWindow = max(kMinCwnd, Unit.add(dataWindow, current.value) / 2);
    } else {
      dataWindow = max(kMinCwnd, dataWindow);
    }
    this.currentDataWindow = new Optional<DataSize>(dataWindow);
  }

  private getPacingRates(atTime: Timestamp): PacerConfig {
    // Pacing rate is based on target rate before congestion window pushback,
    // because we don't want to build queues in the pacer when pushback occurs.
    const factor = this.pacingFactor;
    const pacingFactor: f64 = factor !== null
      ? factor.value
      : <f64>(this.firstTransportFeedbackReceived ? kDefaultPaceMultiplierWithSendSideBwe : kDefaultPaceMultiplier);
    let pacingRate = Unit.mulF(max(this.minTotalAllocatedBitrate, this.lastLossBasedTargetRate), pacingFactor);
    const estimate = this.estimate;
    if (this.limitPacingfactorByUpperLinkCapacityEstimate && estimate !== null &&
        Unit.isFinite(estimate.linkCapacityUpper) && pacingRate > estimate.linkCapacityUpper) {
      pacingRate = max(max(estimate.linkCapacityUpper, this.minTotalAllocatedBitrate), this.lastLossBasedTargetRate);
    }
    let paddingRate = this.lastLossBaseState == LossBasedState.kIncreaseUsingPadding
      ? max(this.maxPaddingRate, this.lastLossBasedTargetRate)
      : this.maxPaddingRate;
    paddingRate = min(paddingRate, this.lastPushbackTargetRate);
    return PacerConfig.create(atTime, pacingRate, paddingRate, this.pacingTimeWindow);
  }

  private setNetworkStateEstimate(estimate: NetworkStateEstimate | null): void {
    const prevEstimate = this.estimate;
    this.estimate = estimate;
    if (estimate !== null && (prevEstimate === null || estimate.updateTime != prevEstimate.updateTime)) {
      this.probeController.setNetworkStateEstimate(estimate);
    }
  }
}

function appendAll(target: ProbeClusterConfig[], source: ProbeClusterConfig[]): void {
  for (let i = 0; i < source.length; ++i) target.push(source[i]);
}
