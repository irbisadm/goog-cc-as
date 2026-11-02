// Port of modules/congestion_controller/goog_cc/loss_based_bwe_v2.{h,cc} @ M154.
//
// Unit arithmetic mirrors upstream's operator order exactly, e.g.
// `double * DataRate` is a DataRate rounded with llround (Unit.mulF) before it
// is divided by another DataRate (Unit.ratio).
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../units";
import {PacketResult} from "../../../api/transport/network-types";
import {kCongestionControllerMinBitrate} from "../../remote-bitrate-estimator/include/bwe-defines";

const kInitHoldDuration: TimeDelta = TimeDelta.Millis(300);
const kMaxHoldDuration: TimeDelta = TimeDelta.Seconds(60);

// std::numeric_limits<double>::lowest()
const kLowestDouble: f64 = -f64.MAX_VALUE;

function isValidRate(datarate: DataRate): bool {
  return Unit.isFinite(datarate);
}

function isValidTimestamp(timestamp: Timestamp): bool {
  return Unit.isFinite(timestamp);
}

function toKiloBytes(datasize: DataSize): f64 {
  return <f64>DataSize.bytes(datasize) / 1000.0;
}

function getLossProbability(inherentLoss: f64, lossLimitedBandwidth: DataRate, sendingRate: DataRate): f64 {
  if (inherentLoss < 0.0 || inherentLoss > 1.0) {
    // The inherent loss must be in [0,1].
    inherentLoss = min(max(inherentLoss, 0.0), 1.0);
  }
  let lossProbability = inherentLoss;
  if (isValidRate(sendingRate) && isValidRate(lossLimitedBandwidth) && sendingRate > lossLimitedBandwidth) {
    // (1 - inherent_loss) * (sending_rate - loss_limited_bandwidth) / sending_rate
    lossProbability += Unit.ratio(Unit.mulF(Unit.sub(sendingRate, lossLimitedBandwidth), 1 - inherentLoss), sendingRate);
  }
  return min(max(lossProbability, 1.0e-6), 1.0 - 1.0e-6);
}

// State of the loss based estimate, which can be either increasing/decreasing
// when network is loss limited, or equal to the delay based estimate.
export enum LossBasedState {
  kIncreasing = 0,
  // TODO(bugs.webrtc.org/12707): Remove one of the increasing states once we
  // have decided if padding is usefull for ramping up when BWE is loss
  // limited.
  kIncreaseUsingPadding = 1,
  kDecreasing = 2,
  kDelayBasedEstimate = 3,
}

// LossBasedBweV2::Result.
export class LossBasedBweV2Result {
  constructor(
    public bandwidthEstimate: DataRate = DataRate.Zero,
    // State is used by goog_cc, which later sends probe requests to probe
    // controller if state is kIncreasing.
    public state: LossBasedState = LossBasedState.kDelayBasedEstimate,
  ) {}

  clone(): LossBasedBweV2Result {
    return new LossBasedBweV2Result(this.bandwidthEstimate, this.state);
  }
}

// Replaces the "WebRTC-Bwe-LossBasedBweV2" field trial. The defaults are the
// upstream field trial defaults (used when the trial is not set). An invalid
// configuration disables the estimator, like upstream.
export class LossBasedBweV2Config {
  enabled: bool = true; // "Enabled"
  bandwidthRampupUpperBoundFactor: f64 = 1.5; // "BwRampupUpperBoundFactor"
  bandwidthRampupUpperBoundFactorInHold: f64 = 1.2; // "BwRampupUpperBoundInHoldFactor"
  bandwidthRampupHoldThreshold: f64 = 1.3; // "BwRampupUpperBoundHoldThreshold"
  rampupAccelerationMaxFactor: f64 = 0.0; // "BwRampupAccelMaxFactor"
  rampupAccelerationMaxoutTime: TimeDelta = TimeDelta.Seconds(60); // "BwRampupAccelMaxoutTime"
  candidateFactors: f64[] = [1.02, 1.0, 0.95]; // "CandidateFactors"
  higherBandwidthBiasFactor: f64 = 0.0002; // "HigherBwBiasFactor"
  higherLogBandwidthBiasFactor: f64 = 0.02; // "HigherLogBwBiasFactor"
  inherentLossLowerBound: f64 = 1.0e-3; // "InherentLossLowerBound"
  lossThresholdOfHighBandwidthPreference: f64 = 0.2; // "LossThresholdOfHighBandwidthPreference"
  bandwidthPreferenceSmoothingFactor: f64 = 0.002; // "BandwidthPreferenceSmoothingFactor"
  inherentLossUpperBoundBandwidthBalance: DataRate = DataRate.KilobitsPerSec<f64>(100.0); // "InherentLossUpperBoundBwBalance"
  inherentLossUpperBoundOffset: f64 = 0.05; // "InherentLossUpperBoundOffset"
  initialInherentLossEstimate: f64 = 0.01; // "InitialInherentLossEstimate"
  newtonIterations: i32 = 1; // "NewtonIterations"
  newtonStepSize: f64 = 0.75; // "NewtonStepSize"
  appendAcknowledgedRateCandidate: bool = true; // "AckedRateCandidate"
  appendDelayBasedEstimateCandidate: bool = true; // "DelayBasedCandidate"
  appendUpperBoundCandidateInAlr: bool = false; // "UpperBoundCandidateInAlr"
  observationDurationLowerBound: TimeDelta = TimeDelta.Millis(250); // "ObservationDurationLowerBound"
  observationWindowSize: i32 = 15; // "ObservationWindowSize"
  sendingRateSmoothingFactor: f64 = 0.0; // "SendingRateSmoothingFactor"
  instantUpperBoundTemporalWeightFactor: f64 = 0.9; // "InstantUpperBoundTemporalWeightFactor"
  instantUpperBoundBandwidthBalance: DataRate = DataRate.KilobitsPerSec<f64>(100.0); // "InstantUpperBoundBwBalance"
  instantUpperBoundLossOffset: f64 = 0.05; // "InstantUpperBoundLossOffset"
  temporalWeightFactor: f64 = 0.9; // "TemporalWeightFactor"
  bandwidthBackoffLowerBoundFactor: f64 = 1.0; // "BwBackoffLowerBoundFactor"
  maxIncreaseFactor: f64 = 1.3; // "MaxIncreaseFactor"
  delayedIncreaseWindow: TimeDelta = TimeDelta.Millis(300); // "DelayedIncreaseWindow"
  notIncreaseIfInherentLossLessThanAverageLoss: bool = true; // "NotIncreaseIfInherentLossLessThanAverageLoss"
  notUseAckedRateInAlr: bool = true; // "NotUseAckedRateInAlr"
  useInStartPhase: bool = true; // "UseInStartPhase"
  minNumObservations: i32 = 3; // "MinNumObservations"
  lowerBoundByAckedRateFactor: f64 = 1.0; // "LowerBoundByAckedRateFactor"
  holdDurationFactor: f64 = 2.0; // "HoldDurationFactor"
  useByteLossRate: bool = true; // "UseByteLossRate"
  paddingDuration: TimeDelta = TimeDelta.Seconds(2); // "PaddingDuration"
  boundBestCandidate: bool = true; // "BoundBestCandidate"
  medianSendingRateFactor: f64 = 2.0; // "MedianSendingRateFactor"
}

class ChannelParameters {
  inherentLoss: f64 = 0.0;
  lossLimitedBandwidth: DataRate = DataRate.MinusInfinity;

  clone(): ChannelParameters {
    const c = new ChannelParameters();
    c.inherentLoss = this.inherentLoss;
    c.lossLimitedBandwidth = this.lossLimitedBandwidth;
    return c;
  }
}

class Derivatives {
  first: f64 = 0.0;
  second: f64 = 0.0;
}

class Observation {
  numPackets: i32 = 0;
  numLostPackets: i32 = 0;
  numReceivedPackets: i32 = 0;
  sendingRate: DataRate = DataRate.MinusInfinity;
  size: DataSize = DataSize.Zero;
  lostSize: DataSize = DataSize.Zero;
  id: i32 = -1;

  isInitialized(): bool {
    return this.id != -1;
  }
}

class PartialObservation {
  numPackets: i32 = 0;
  // std::unordered_map<int64_t, DataSize>
  lostPackets: Map<i64, DataSize> = new Map<i64, DataSize>();
  size: DataSize = DataSize.Zero;
}

class PaddingInfo {
  paddingRate: DataRate = DataRate.MinusInfinity;
  paddingTimestamp: Timestamp = Timestamp.MinusInfinity;
}

class HoldInfo {
  constructor(
    public timestamp: Timestamp = Timestamp.MinusInfinity,
    public duration: TimeDelta = TimeDelta.Zero,
    public rate: DataRate = DataRate.PlusInfinity,
  ) {}
}

function isConfigValid(config: LossBasedBweV2Config): bool {
  let valid = true;

  if (config.bandwidthRampupUpperBoundFactor <= 1.0) valid = false;
  if (config.bandwidthRampupUpperBoundFactorInHold <= 1.0) valid = false;
  if (config.bandwidthRampupHoldThreshold < 0.0) valid = false;
  if (config.rampupAccelerationMaxFactor < 0.0) valid = false;
  if (config.rampupAccelerationMaxoutTime <= TimeDelta.Zero) valid = false;
  let anyFactorOtherThanOne = false;
  for (let i = 0; i < config.candidateFactors.length; ++i) {
    const candidateFactor = config.candidateFactors[i];
    if (candidateFactor <= 0.0) valid = false;
    if (candidateFactor != 1.0) anyFactorOtherThanOne = true;
  }

  // Ensure that the configuration allows generation of at least one candidate
  // other than the current estimate.
  if (!config.appendAcknowledgedRateCandidate && !config.appendDelayBasedEstimateCandidate && !anyFactorOtherThanOne) {
    valid = false;
  }

  if (config.higherBandwidthBiasFactor < 0.0) valid = false;
  if (config.inherentLossLowerBound < 0.0 || config.inherentLossLowerBound >= 1.0) valid = false;
  if (config.lossThresholdOfHighBandwidthPreference < 0.0 || config.lossThresholdOfHighBandwidthPreference >= 1.0) {
    valid = false;
  }
  if (config.bandwidthPreferenceSmoothingFactor <= 0.0 || config.bandwidthPreferenceSmoothingFactor > 1.0) {
    valid = false;
  }
  if (config.inherentLossUpperBoundBandwidthBalance <= DataRate.Zero) valid = false;
  if (config.inherentLossUpperBoundOffset < config.inherentLossLowerBound ||
      config.inherentLossUpperBoundOffset >= 1.0) {
    valid = false;
  }
  if (config.initialInherentLossEstimate < 0.0 || config.initialInherentLossEstimate >= 1.0) valid = false;
  if (config.newtonIterations <= 0) valid = false;
  if (config.newtonStepSize <= 0.0) valid = false;
  if (config.observationDurationLowerBound <= TimeDelta.Zero) valid = false;
  if (config.observationWindowSize < 2) valid = false;
  if (config.sendingRateSmoothingFactor < 0.0 || config.sendingRateSmoothingFactor >= 1.0) valid = false;
  if (config.instantUpperBoundTemporalWeightFactor <= 0.0 || config.instantUpperBoundTemporalWeightFactor > 1.0) {
    valid = false;
  }
  if (config.instantUpperBoundBandwidthBalance <= DataRate.Zero) valid = false;
  if (config.instantUpperBoundLossOffset < 0.0 || config.instantUpperBoundLossOffset >= 1.0) valid = false;
  if (config.temporalWeightFactor <= 0.0 || config.temporalWeightFactor > 1.0) valid = false;
  if (config.bandwidthBackoffLowerBoundFactor > 1.0) valid = false;
  if (config.maxIncreaseFactor <= 0.0) valid = false;
  if (config.delayedIncreaseWindow <= TimeDelta.Zero) valid = false;
  if (config.minNumObservations <= 0) valid = false;
  if (config.lowerBoundByAckedRateFactor < 0.0) valid = false;
  return valid;
}

export class LossBasedBweV2 {
  // std::optional<DataRate>; MinusInfinity = nullopt (a valid acked rate is
  // always finite).
  private acknowledgedBitrate: DataRate = DataRate.MinusInfinity;
  private config: LossBasedBweV2Config | null;
  private currentBestEstimate: ChannelParameters = new ChannelParameters();
  private numObservations: i32 = 0;
  private observations: Observation[] = [];
  private partialObservation: PartialObservation = new PartialObservation();
  private lastSendTimeMostRecentObservation: Timestamp = Timestamp.PlusInfinity;
  private lastTimeEstimateReduced: Timestamp = Timestamp.MinusInfinity;
  // std::optional<DataRate>; MinusInfinity = nullopt.
  private cachedInstantUpperBound: DataRate = DataRate.MinusInfinity;
  private cachedInstantLowerBound: DataRate = DataRate.MinusInfinity;
  private instantUpperBoundTemporalWeights: f64[] = [];
  private temporalWeights: f64[] = [];
  private recoveringAfterLossTimestamp: Timestamp = Timestamp.MinusInfinity;
  private bandwidthLimitInCurrentWindow: DataRate = DataRate.PlusInfinity;
  private minBitrate: DataRate = DataRate.KilobitsPerSec(1);
  private maxBitrate: DataRate = DataRate.PlusInfinity;
  private delayBasedEstimate: DataRate = DataRate.PlusInfinity;
  private lossBasedResult: LossBasedBweV2Result = new LossBasedBweV2Result();
  private lastHoldInfo: HoldInfo = new HoldInfo();
  private lastPaddingInfo: PaddingInfo = new PaddingInfo();
  private averageReportedLossRatio: f64 = 0.0;

  // Creates a disabled `LossBasedBweV2` if the config is not valid or not
  // enabled.
  constructor(config: LossBasedBweV2Config | null = null) {
    const conf = config !== null ? config : new LossBasedBweV2Config();
    // A configuration that is not enabled, or not valid, disables the
    // estimator.
    this.config = conf.enabled && isConfigValid(conf) ? conf : null;
    if (this.config !== null) this.initialize(conf);
  }

  private initialize(conf: LossBasedBweV2Config): void {
    this.currentBestEstimate.inherentLoss = conf.initialInherentLossEstimate;
    const size = conf.observationWindowSize;
    this.observations = new Array<Observation>(size);
    for (let i = 0; i < size; ++i) this.observations[i] = new Observation();
    this.temporalWeights = new Array<f64>(size);
    this.instantUpperBoundTemporalWeights = new Array<f64>(size);
    this.calculateTemporalWeights();
    this.lastHoldInfo.duration = kInitHoldDuration;
  }

  isEnabled(): bool {
    return this.config !== null;
  }

  // Returns true iff a BWE can be calculated, i.e., the estimator has been
  // initialized with a BWE and then has received enough `PacketResult`s.
  isReady(): bool {
    return this.isEnabled() &&
      isValidRate(this.currentBestEstimate.lossLimitedBandwidth) &&
      this.numObservations >= this.conf().minNumObservations;
  }

  // Returns true if loss based BWE is ready to be used in the start phase.
  readyToUseInStartPhase(): bool {
    return this.isReady() && this.conf().useInStartPhase;
  }

  // Returns true if loss based BWE can be used in the start phase.
  useInStartPhase(): bool {
    return this.conf().useInStartPhase;
  }

  // Returns `DataRate::PlusInfinity` if no BWE can be calculated.
  getLossBasedResult(): LossBasedBweV2Result {
    if (!this.isReady()) {
      return new LossBasedBweV2Result(
        isValidRate(this.delayBasedEstimate) ? this.delayBasedEstimate : DataRate.PlusInfinity,
        LossBasedState.kDelayBasedEstimate,
      );
    }
    return this.lossBasedResult.clone();
  }

  setAcknowledgedBitrate(acknowledgedBitrate: DataRate): void {
    if (isValidRate(acknowledgedBitrate)) {
      this.acknowledgedBitrate = acknowledgedBitrate;
      this.calculateInstantLowerBound();
    }
    // else: the acknowledged bitrate must be finite.
  }

  setMinMaxBitrate(minBitrate: DataRate, maxBitrate: DataRate): void {
    if (isValidRate(minBitrate)) {
      this.minBitrate = minBitrate;
      this.calculateInstantLowerBound();
    }
    if (isValidRate(maxBitrate)) {
      this.maxBitrate = maxBitrate;
    }
  }

  // For unit testing only.
  setBandwidthEstimate(bandwidthEstimate: DataRate): void {
    if (isValidRate(bandwidthEstimate)) {
      this.currentBestEstimate.lossLimitedBandwidth = bandwidthEstimate;
      this.lossBasedResult = new LossBasedBweV2Result(bandwidthEstimate, LossBasedState.kDelayBasedEstimate);
    }
  }

  updateBandwidthEstimate(packetResults: PacketResult[], delayBasedEstimate: DataRate, inAlr: bool): void {
    this.delayBasedEstimate = delayBasedEstimate;
    if (!this.isEnabled()) {
      // The estimator must be enabled before it can be used.
      return;
    }
    const config = this.conf();

    if (packetResults.length == 0) {
      // The estimate cannot be updated without any loss statistics.
      return;
    }

    if (!this.pushBackObservation(packetResults)) {
      return;
    }

    if (!isValidRate(this.currentBestEstimate.lossLimitedBandwidth)) {
      if (!isValidRate(delayBasedEstimate)) {
        // The delay based estimate must be finite.
        return;
      }
      this.currentBestEstimate.lossLimitedBandwidth = delayBasedEstimate;
      this.lossBasedResult = new LossBasedBweV2Result(delayBasedEstimate, LossBasedState.kDelayBasedEstimate);
    }

    let bestCandidate = this.currentBestEstimate.clone();
    let objectiveMax = kLowestDouble;
    const candidates = this.getCandidates(inAlr);
    for (let i = 0; i < candidates.length; ++i) {
      const candidate = candidates[i];
      this.newtonsMethodUpdate(candidate);

      const candidateObjective = this.getObjective(candidate);
      if (candidateObjective > objectiveMax ||
          (candidateObjective == objectiveMax && candidate.lossLimitedBandwidth > bestCandidate.lossLimitedBandwidth)) {
        // Select the candidate with the highest objective or the one with the
        // same objective but higher bandwidth if they are tied.
        objectiveMax = candidateObjective;
        bestCandidate = candidate;
      }
    }
    if (bestCandidate.lossLimitedBandwidth < this.currentBestEstimate.lossLimitedBandwidth) {
      this.lastTimeEstimateReduced = this.lastSendTimeMostRecentObservation;
    }

    // Do not increase the estimate if the average loss is greater than current
    // inherent loss.
    if (this.averageReportedLossRatio > bestCandidate.inherentLoss &&
        config.notIncreaseIfInherentLossLessThanAverageLoss &&
        this.currentBestEstimate.lossLimitedBandwidth < bestCandidate.lossLimitedBandwidth) {
      bestCandidate.lossLimitedBandwidth = this.currentBestEstimate.lossLimitedBandwidth;
    }

    if (this.isInLossLimitedState()) {
      // Bound the estimate increase if:
      // 1. The estimate has been increased for less than
      // `delayed_increase_window` ago, and
      // 2. The best candidate is greater than bandwidth_limit_in_current_window.
      if (Unit.isFinite(this.recoveringAfterLossTimestamp) &&
          Unit.add(this.recoveringAfterLossTimestamp, config.delayedIncreaseWindow) >
            this.lastSendTimeMostRecentObservation &&
          bestCandidate.lossLimitedBandwidth > this.bandwidthLimitInCurrentWindow) {
        bestCandidate.lossLimitedBandwidth = this.bandwidthLimitInCurrentWindow;
      }

      const increasingWhenLossLimited = this.isEstimateIncreasingWhenLossLimited(
        /*oldEstimate=*/this.currentBestEstimate.lossLimitedBandwidth,
        /*newEstimate=*/bestCandidate.lossLimitedBandwidth);
      // Bound the best candidate by the acked bitrate.
      if (increasingWhenLossLimited && isValidRate(this.acknowledgedBitrate)) {
        let rampupFactor = config.bandwidthRampupUpperBoundFactor;
        if (isValidRate(this.lastHoldInfo.rate) &&
            this.acknowledgedBitrate < Unit.mulF(this.lastHoldInfo.rate, config.bandwidthRampupHoldThreshold)) {
          rampupFactor = config.bandwidthRampupUpperBoundFactorInHold;
        }

        bestCandidate.lossLimitedBandwidth = max(
          this.currentBestEstimate.lossLimitedBandwidth,
          min(bestCandidate.lossLimitedBandwidth, Unit.mulF(this.acknowledgedBitrate, rampupFactor)));
        // Increase current estimate by at least 1kbps to make sure that the state
        // will be switched to kIncreasing, thus padding is triggered.
        if (this.lossBasedResult.state == LossBasedState.kDecreasing &&
            bestCandidate.lossLimitedBandwidth == this.currentBestEstimate.lossLimitedBandwidth) {
          bestCandidate.lossLimitedBandwidth =
            Unit.add(this.currentBestEstimate.lossLimitedBandwidth, DataRate.BitsPerSec(1));
        }
      }
    }

    let boundedBandwidthEstimate = DataRate.PlusInfinity;
    if (isValidRate(this.delayBasedEstimate)) {
      boundedBandwidthEstimate = max(
        this.getInstantLowerBound(),
        min(min(bestCandidate.lossLimitedBandwidth, this.getInstantUpperBound()), this.delayBasedEstimate));
    } else {
      boundedBandwidthEstimate = max(
        this.getInstantLowerBound(), min(bestCandidate.lossLimitedBandwidth, this.getInstantUpperBound()));
    }
    if (config.boundBestCandidate && boundedBandwidthEstimate < bestCandidate.lossLimitedBandwidth) {
      // If network is lossy, cap the best estimate by the instant upper bound,
      // e.g. 450kbps if loss rate is 50%.
      // Otherwise, cap the estimate by the delay-based estimate or max_bitrate.
      this.currentBestEstimate.lossLimitedBandwidth = boundedBandwidthEstimate;
      this.currentBestEstimate.inherentLoss = 0;
    } else {
      this.currentBestEstimate = bestCandidate;
      if (config.lowerBoundByAckedRateFactor > 0.0) {
        this.currentBestEstimate.lossLimitedBandwidth =
          max(this.currentBestEstimate.lossLimitedBandwidth, this.getInstantLowerBound());
      }
    }

    if (this.lossBasedResult.state == LossBasedState.kDecreasing &&
        this.lastHoldInfo.timestamp > this.lastSendTimeMostRecentObservation &&
        boundedBandwidthEstimate < this.delayBasedEstimate) {
      // Ensure that acked rate is the lower bound of HOLD rate.
      if (config.lowerBoundByAckedRateFactor > 0.0) {
        this.lastHoldInfo.rate = max(this.getInstantLowerBound(), this.lastHoldInfo.rate);
      }
      // BWE is not allowed to increase above the HOLD rate. The purpose of
      // HOLD is to not immediately ramp up BWE to a rate that may cause loss.
      this.lossBasedResult.bandwidthEstimate = min(this.lastHoldInfo.rate, boundedBandwidthEstimate);
      return;
    }

    if (this.isEstimateIncreasingWhenLossLimited(
          /*oldEstimate=*/this.lossBasedResult.bandwidthEstimate,
          /*newEstimate=*/boundedBandwidthEstimate) &&
        this.canKeepIncreasingState(boundedBandwidthEstimate) &&
        boundedBandwidthEstimate < this.delayBasedEstimate &&
        boundedBandwidthEstimate < this.maxBitrate) {
      if (config.paddingDuration > TimeDelta.Zero &&
          boundedBandwidthEstimate > this.lastPaddingInfo.paddingRate) {
        // Start a new padding duration.
        this.lastPaddingInfo.paddingRate = boundedBandwidthEstimate;
        this.lastPaddingInfo.paddingTimestamp = this.lastSendTimeMostRecentObservation;
      }
      this.lossBasedResult.state = config.paddingDuration > TimeDelta.Zero
        ? LossBasedState.kIncreaseUsingPadding
        : LossBasedState.kIncreasing;
    } else if (boundedBandwidthEstimate < this.delayBasedEstimate && boundedBandwidthEstimate < this.maxBitrate) {
      if (this.lossBasedResult.state != LossBasedState.kDecreasing && config.holdDurationFactor > 0) {
        // Switch to HOLD.
        this.lastHoldInfo = new HoldInfo(
          Unit.add(this.lastSendTimeMostRecentObservation, this.lastHoldInfo.duration),
          min(kMaxHoldDuration, Unit.mulF(this.lastHoldInfo.duration, config.holdDurationFactor)),
          boundedBandwidthEstimate,
        );
      }
      this.lastPaddingInfo = new PaddingInfo();
      this.lossBasedResult.state = LossBasedState.kDecreasing;
    } else {
      // Reset the HOLD info if delay based estimate works to avoid getting
      // stuck in low bitrate.
      this.lastHoldInfo = new HoldInfo(Timestamp.MinusInfinity, kInitHoldDuration, DataRate.PlusInfinity);
      this.lastPaddingInfo = new PaddingInfo();
      this.lossBasedResult.state = LossBasedState.kDelayBasedEstimate;
    }
    this.lossBasedResult.bandwidthEstimate = boundedBandwidthEstimate;

    if (this.isInLossLimitedState() &&
        (Unit.isInfinite(this.recoveringAfterLossTimestamp) ||
         Unit.add(this.recoveringAfterLossTimestamp, config.delayedIncreaseWindow) <
           this.lastSendTimeMostRecentObservation)) {
      this.bandwidthLimitInCurrentWindow = max(
        kCongestionControllerMinBitrate,
        Unit.mulF(this.currentBestEstimate.lossLimitedBandwidth, config.maxIncreaseFactor));
      this.recoveringAfterLossTimestamp = this.lastSendTimeMostRecentObservation;
    }
  }

  private conf(): LossBasedBweV2Config {
    return this.config!;
  }

  private isEstimateIncreasingWhenLossLimited(oldEstimate: DataRate, newEstimate: DataRate): bool {
    return (oldEstimate < newEstimate ||
            (oldEstimate == newEstimate &&
             (this.lossBasedResult.state == LossBasedState.kIncreasing ||
              this.lossBasedResult.state == LossBasedState.kIncreaseUsingPadding))) &&
      this.isInLossLimitedState();
  }

  // Returns `0.0` if not enough loss statistics have been received.
  private updateAverageReportedLossRatio(): void {
    this.averageReportedLossRatio = this.conf().useByteLossRate
      ? this.calculateAverageReportedByteLossRatio()
      : this.calculateAverageReportedPacketLossRatio();
  }

  private calculateAverageReportedPacketLossRatio(): f64 {
    if (this.numObservations <= 0) return 0.0;

    let numPackets: f64 = 0;
    let numLostPackets: f64 = 0;
    for (let i = 0; i < this.observations.length; ++i) {
      const observation = this.observations[i];
      if (!observation.isInitialized()) continue;

      const instantTemporalWeight = this.instantUpperBoundTemporalWeights[(this.numObservations - 1) - observation.id];
      numPackets += instantTemporalWeight * <f64>observation.numPackets;
      numLostPackets += instantTemporalWeight * <f64>observation.numLostPackets;
    }

    return numLostPackets / numPackets;
  }

  // Calculates the average loss ratio over the last `observation_window_size`
  // observations but skips the observation with min and max loss ratio in order
  // to filter out loss spikes.
  private calculateAverageReportedByteLossRatio(): f64 {
    if (this.numObservations <= 0) return 0.0;

    let totalBytes = DataSize.Zero;
    let lostBytes = DataSize.Zero;
    let minLossRate: f64 = 1.0;
    let maxLossRate: f64 = 0.0;
    let minLostBytes = DataSize.Zero;
    let maxLostBytes = DataSize.Zero;
    let minBytesReceived = DataSize.Zero;
    let maxBytesReceived = DataSize.Zero;
    let sendRateOfMaxLossObservation = DataRate.Zero;
    for (let i = 0; i < this.observations.length; ++i) {
      const observation = this.observations[i];
      if (!observation.isInitialized()) continue;

      const instantTemporalWeight = this.instantUpperBoundTemporalWeights[(this.numObservations - 1) - observation.id];
      totalBytes = Unit.add(totalBytes, Unit.mulF(observation.size, instantTemporalWeight));
      lostBytes = Unit.add(lostBytes, Unit.mulF(observation.lostSize, instantTemporalWeight));
      const lossRate = !Unit.isZero(observation.size) ? Unit.ratio(observation.lostSize, observation.size) : 0.0;
      if (this.numObservations > 3) {
        if (lossRate > maxLossRate) {
          maxLossRate = lossRate;
          maxLostBytes = Unit.mulF(observation.lostSize, instantTemporalWeight);
          maxBytesReceived = Unit.mulF(observation.size, instantTemporalWeight);
          sendRateOfMaxLossObservation = observation.sendingRate;
        }
        if (lossRate < minLossRate) {
          minLossRate = lossRate;
          minLostBytes = Unit.mulF(observation.lostSize, instantTemporalWeight);
          minBytesReceived = Unit.mulF(observation.size, instantTemporalWeight);
        }
      }
    }
    if (Unit.mulF(this.getMedianSendingRate(), this.conf().medianSendingRateFactor) <= sendRateOfMaxLossObservation) {
      // If the median sending rate is less than half of the sending rate of the
      // observation with max loss rate, i.e. we suddenly send a lot of data, then
      // the loss rate might not be due to a spike.
      return Unit.ratio(lostBytes, totalBytes);
    }
    if (totalBytes == Unit.add(maxBytesReceived, minBytesReceived)) {
      // It could happen if the observation window was 2.
      return Unit.ratio(lostBytes, totalBytes);
    }
    return Unit.ratio(
      Unit.sub(Unit.sub(lostBytes, minLostBytes), maxLostBytes),
      Unit.sub(Unit.sub(totalBytes, maxBytesReceived), minBytesReceived),
    );
  }

  private getCandidates(inAlr: bool): ChannelParameters[] {
    const config = this.conf();
    const bestEstimate = this.currentBestEstimate.clone();
    const bandwidths: DataRate[] = [];
    for (let i = 0; i < config.candidateFactors.length; ++i) {
      bandwidths.push(Unit.mulF(bestEstimate.lossLimitedBandwidth, config.candidateFactors[i]));
    }

    if (!Unit.isMinusInfinity(this.acknowledgedBitrate) && config.appendAcknowledgedRateCandidate) {
      if (!(config.notUseAckedRateInAlr && inAlr) ||
          (config.paddingDuration > TimeDelta.Zero &&
           Unit.add(this.lastPaddingInfo.paddingTimestamp, config.paddingDuration) >=
             this.lastSendTimeMostRecentObservation)) {
        bandwidths.push(Unit.mulF(this.acknowledgedBitrate, config.bandwidthBackoffLowerBoundFactor));
      }
    }

    if (isValidRate(this.delayBasedEstimate) && config.appendDelayBasedEstimateCandidate) {
      if (this.delayBasedEstimate > bestEstimate.lossLimitedBandwidth) {
        bandwidths.push(this.delayBasedEstimate);
      }
    }

    if (inAlr && config.appendUpperBoundCandidateInAlr &&
        bestEstimate.lossLimitedBandwidth > this.getInstantUpperBound()) {
      bandwidths.push(this.getInstantUpperBound());
    }

    const candidateBandwidthUpperBound = this.getCandidateBandwidthUpperBound();

    const candidates = new Array<ChannelParameters>(bandwidths.length);
    for (let i = 0; i < bandwidths.length; ++i) {
      const candidate = bestEstimate.clone();
      candidate.lossLimitedBandwidth =
        min(bandwidths[i], max(bestEstimate.lossLimitedBandwidth, candidateBandwidthUpperBound));
      candidate.inherentLoss = this.getFeasibleInherentLoss(candidate);
      candidates[i] = candidate;
    }
    return candidates;
  }

  private getCandidateBandwidthUpperBound(): DataRate {
    const config = this.conf();
    let candidateBandwidthUpperBound = this.maxBitrate;
    if (this.isInLossLimitedState() && isValidRate(this.bandwidthLimitInCurrentWindow)) {
      candidateBandwidthUpperBound = this.bandwidthLimitInCurrentWindow;
    }

    if (Unit.isMinusInfinity(this.acknowledgedBitrate)) return candidateBandwidthUpperBound;

    if (config.rampupAccelerationMaxFactor > 0.0) {
      const timeSinceBandwidthReduced = min(
        config.rampupAccelerationMaxoutTime,
        max(TimeDelta.Zero, Unit.sub(this.lastSendTimeMostRecentObservation, this.lastTimeEstimateReduced)));
      // rampup_acceleration_max_factor * time_since_bandwidth_reduced /
      // rampup_acceleration_maxout_time
      const rampupAcceleration = Unit.ratio(
        Unit.mulF(timeSinceBandwidthReduced, config.rampupAccelerationMaxFactor),
        config.rampupAccelerationMaxoutTime);

      candidateBandwidthUpperBound =
        Unit.add(candidateBandwidthUpperBound, Unit.mulF(this.acknowledgedBitrate, rampupAcceleration));
    }
    return candidateBandwidthUpperBound;
  }

  private getDerivatives(channelParameters: ChannelParameters): Derivatives {
    const config = this.conf();
    const derivatives = new Derivatives();

    for (let i = 0; i < this.observations.length; ++i) {
      const observation = this.observations[i];
      if (!observation.isInitialized()) continue;

      const lossProbability = getLossProbability(
        channelParameters.inherentLoss, channelParameters.lossLimitedBandwidth, observation.sendingRate);

      const temporalWeight = this.temporalWeights[(this.numObservations - 1) - observation.id];
      if (config.useByteLossRate) {
        const lost = toKiloBytes(observation.lostSize);
        const received = toKiloBytes(Unit.sub(observation.size, observation.lostSize));
        derivatives.first += temporalWeight * ((lost / lossProbability) - (received / (1.0 - lossProbability)));
        derivatives.second -= temporalWeight *
          ((lost / Math.pow(lossProbability, 2)) + (received / Math.pow(1.0 - lossProbability, 2)));
      } else {
        const lost = <f64>observation.numLostPackets;
        const received = <f64>observation.numReceivedPackets;
        derivatives.first += temporalWeight * ((lost / lossProbability) - (received / (1.0 - lossProbability)));
        derivatives.second -= temporalWeight *
          ((lost / Math.pow(lossProbability, 2)) + (received / Math.pow(1.0 - lossProbability, 2)));
      }
    }

    if (derivatives.second >= 0.0) {
      // The second derivative is mathematically guaranteed to be negative.
      derivatives.second = -1.0e-6;
    }

    return derivatives;
  }

  private getFeasibleInherentLoss(channelParameters: ChannelParameters): f64 {
    return min(
      max(channelParameters.inherentLoss, this.conf().inherentLossLowerBound),
      this.getInherentLossUpperBound(channelParameters.lossLimitedBandwidth));
  }

  private getInherentLossUpperBound(bandwidth: DataRate): f64 {
    if (Unit.isZero(bandwidth)) return 1.0;

    const config = this.conf();
    const inherentLossUpperBound =
      config.inherentLossUpperBoundOffset + Unit.ratio(config.inherentLossUpperBoundBandwidthBalance, bandwidth);
    return min(inherentLossUpperBound, 1.0);
  }

  private adjustBiasFactor(lossRate: f64, biasFactor: f64): f64 {
    const config = this.conf();
    return biasFactor * (config.lossThresholdOfHighBandwidthPreference - lossRate) /
      (config.bandwidthPreferenceSmoothingFactor + Math.abs(config.lossThresholdOfHighBandwidthPreference - lossRate));
  }

  private getHighBandwidthBias(bandwidth: DataRate): f64 {
    if (isValidRate(bandwidth)) {
      const config = this.conf();
      // bandwidth.kbps() is an integer (rounded to nearest) upstream.
      const kbps = <f64>DataRate.kbps(bandwidth);
      return this.adjustBiasFactor(this.averageReportedLossRatio, config.higherBandwidthBiasFactor) * kbps +
        this.adjustBiasFactor(this.averageReportedLossRatio, config.higherLogBandwidthBiasFactor) * Math.log(1.0 + kbps);
    }
    return 0.0;
  }

  private getObjective(channelParameters: ChannelParameters): f64 {
    const config = this.conf();
    let objective: f64 = 0.0;

    const highBandwidthBias = this.getHighBandwidthBias(channelParameters.lossLimitedBandwidth);

    for (let i = 0; i < this.observations.length; ++i) {
      const observation = this.observations[i];
      if (!observation.isInitialized()) continue;

      const lossProbability = getLossProbability(
        channelParameters.inherentLoss, channelParameters.lossLimitedBandwidth, observation.sendingRate);

      const temporalWeight = this.temporalWeights[(this.numObservations - 1) - observation.id];

      if (config.useByteLossRate) {
        objective += temporalWeight *
          ((toKiloBytes(observation.lostSize) * Math.log(lossProbability)) +
           (toKiloBytes(Unit.sub(observation.size, observation.lostSize)) * Math.log(1.0 - lossProbability)));
        objective += temporalWeight * highBandwidthBias * toKiloBytes(observation.size);
      } else {
        objective += temporalWeight *
          ((<f64>observation.numLostPackets * Math.log(lossProbability)) +
           (<f64>observation.numReceivedPackets * Math.log(1.0 - lossProbability)));
        objective += temporalWeight * highBandwidthBias * <f64>observation.numPackets;
      }
    }

    return objective;
  }

  private getSendingRate(instantaneousSendingRate: DataRate): DataRate {
    if (this.numObservations <= 0) return instantaneousSendingRate;

    const config = this.conf();
    const mostRecentObservationIdx = (this.numObservations - 1) % config.observationWindowSize;
    const mostRecentObservation = this.observations[mostRecentObservationIdx];
    const sendingRatePreviousObservation = mostRecentObservation.sendingRate;

    return Unit.add(
      Unit.mulF(sendingRatePreviousObservation, config.sendingRateSmoothingFactor),
      Unit.mulF(instantaneousSendingRate, 1.0 - config.sendingRateSmoothingFactor));
  }

  private getInstantUpperBound(): DataRate {
    return Unit.isMinusInfinity(this.cachedInstantUpperBound) ? this.maxBitrate : this.cachedInstantUpperBound;
  }

  private calculateInstantUpperBound(): void {
    const config = this.conf();
    let instantLimit = this.maxBitrate;
    if (this.averageReportedLossRatio > config.instantUpperBoundLossOffset) {
      instantLimit = Unit.divF(
        config.instantUpperBoundBandwidthBalance, this.averageReportedLossRatio - config.instantUpperBoundLossOffset);
    }
    this.cachedInstantUpperBound = instantLimit;
  }

  private getInstantLowerBound(): DataRate {
    return Unit.isMinusInfinity(this.cachedInstantLowerBound) ? DataRate.Zero : this.cachedInstantLowerBound;
  }

  private calculateInstantLowerBound(): void {
    let instanceLowerBound = DataRate.Zero;
    // Note: upstream does not check IsEnabled() here; a disabled estimator is
    // only reachable through SetAcknowledgedBitrate/SetMinMaxBitrate.
    const config = this.config;
    if (isValidRate(this.acknowledgedBitrate) && config !== null && config.lowerBoundByAckedRateFactor > 0.0) {
      instanceLowerBound = Unit.mulF(this.acknowledgedBitrate, config.lowerBoundByAckedRateFactor);
    }

    if (isValidRate(this.minBitrate)) {
      instanceLowerBound = max(instanceLowerBound, this.minBitrate);
    }
    this.cachedInstantLowerBound = instanceLowerBound;
  }

  private calculateTemporalWeights(): void {
    const config = this.conf();
    for (let i = 0; i < config.observationWindowSize; ++i) {
      this.temporalWeights[i] = Math.pow(config.temporalWeightFactor, i);
      this.instantUpperBoundTemporalWeights[i] = Math.pow(config.instantUpperBoundTemporalWeightFactor, i);
    }
  }

  private newtonsMethodUpdate(channelParameters: ChannelParameters): void {
    if (this.numObservations <= 0) return;

    const config = this.conf();
    for (let i = 0; i < config.newtonIterations; ++i) {
      const derivatives = this.getDerivatives(channelParameters);
      channelParameters.inherentLoss -= config.newtonStepSize * derivatives.first / derivatives.second;
      channelParameters.inherentLoss = this.getFeasibleInherentLoss(channelParameters);
    }
  }

  // Returns false if no observation was created.
  private pushBackObservation(packetResults: PacketResult[]): bool {
    if (packetResults.length == 0) return false;

    const config = this.conf();
    const partial = this.partialObservation;
    partial.numPackets += packetResults.length;
    let lastSendTime = Timestamp.MinusInfinity;
    let firstSendTime = Timestamp.PlusInfinity;
    for (let i = 0; i < packetResults.length; ++i) {
      const packet = packetResults[i];
      if (packet.isReceived()) {
        partial.lostPackets.delete(packet.sentPacket.sequenceNumber);
      } else if (!partial.lostPackets.has(packet.sentPacket.sequenceNumber)) {
        // unordered_map::emplace does not overwrite an existing entry.
        partial.lostPackets.set(packet.sentPacket.sequenceNumber, packet.sentPacket.size);
      }
      partial.size = Unit.add(partial.size, packet.sentPacket.size);
      lastSendTime = max(lastSendTime, packet.sentPacket.sendTime);
      firstSendTime = min(firstSendTime, packet.sentPacket.sendTime);
    }

    // This is the first packet report we have received.
    if (!isValidTimestamp(this.lastSendTimeMostRecentObservation)) {
      this.lastSendTimeMostRecentObservation = firstSendTime;
    }

    const observationDuration = Unit.sub(lastSendTime, this.lastSendTimeMostRecentObservation);
    // Too small to be meaningful.
    // To consider: what if it is too long?, i.e. we did not receive any packets
    // for a long time, then all the packets we received are too old.
    if (observationDuration <= TimeDelta.Zero || observationDuration < config.observationDurationLowerBound) {
      return false;
    }

    this.lastSendTimeMostRecentObservation = lastSendTime;

    const observation = new Observation();
    observation.numPackets = partial.numPackets;
    observation.numLostPackets = partial.lostPackets.size;
    observation.numReceivedPackets = observation.numPackets - observation.numLostPackets;
    observation.sendingRate = this.getSendingRate(DataRate.fromSizeAndDuration(partial.size, observationDuration));
    const lostSizes = partial.lostPackets.values();
    for (let i = 0; i < lostSizes.length; ++i) {
      observation.lostSize = Unit.add(observation.lostSize, lostSizes[i]);
    }
    observation.size = partial.size;
    observation.id = this.numObservations++;
    this.observations[observation.id % config.observationWindowSize] = observation;

    this.partialObservation = new PartialObservation();

    this.updateAverageReportedLossRatio();
    this.calculateInstantUpperBound();
    return true;
  }

  private isInLossLimitedState(): bool {
    return this.lossBasedResult.state != LossBasedState.kDelayBasedEstimate;
  }

  private canKeepIncreasingState(estimate: DataRate): bool {
    const config = this.conf();
    if (config.paddingDuration == TimeDelta.Zero ||
        this.lossBasedResult.state != LossBasedState.kIncreaseUsingPadding) {
      return true;
    }

    // Keep using the kIncreaseUsingPadding if either the state has been
    // kIncreaseUsingPadding for less than kPaddingDuration or the estimate
    // increases.
    return Unit.add(this.lastPaddingInfo.paddingTimestamp, config.paddingDuration) >=
        this.lastSendTimeMostRecentObservation ||
      this.lastPaddingInfo.paddingRate < estimate;
  }

  private getMedianSendingRate(): DataRate {
    const sendingRates: DataRate[] = [];
    for (let i = 0; i < this.observations.length; ++i) {
      const observation = this.observations[i];
      if (!observation.isInitialized() || !isValidRate(observation.sendingRate) ||
          Unit.isZero(observation.sendingRate)) {
        continue;
      }
      sendingRates.push(observation.sendingRate);
    }
    if (sendingRates.length == 0) {
      return DataRate.Zero;
    }
    sendingRates.sort((a: i64, b: i64): i32 => (a < b ? -1 : a > b ? 1 : 0));
    const n = sendingRates.length;
    if (n % 2 == 0) {
      return Unit.add(sendingRates[n / 2 - 1], sendingRates[n / 2]) / 2;
    }
    return sendingRates[n / 2];
  }
}
