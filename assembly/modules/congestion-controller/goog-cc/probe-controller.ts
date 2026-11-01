// Port of modules/congestion_controller/goog_cc/probe_controller.{h,cc} @ M154.
// RtcEventLog and UMA histograms are not ported.
import {DataRate, TimeDelta, Timestamp, Unit} from "../../../units";
import {NetworkAvailability, NetworkStateEstimate, ProbeClusterConfig} from "../../../api/transport/network-types";
import {Optional} from "../../../types/optional";

// Maximum waiting time from the time of initiating probing to getting
// the measured results back.
const kMaxWaitingTimeForProbingResult: TimeDelta = TimeDelta.Seconds(1);

// Default probing bitrate limit. Applied only when the application didn't
// specify max bitrate.
const kDefaultMaxProbingBitrate: DataRate = DataRate.KilobitsPerSec(5000);

// If the bitrate drops to a factor `kBitrateDropThreshold` or lower
// and we recover within `kBitrateDropTimeoutMs`, then we'll send
// a probe at a fraction `kProbeFractionAfterDrop` of the original bitrate.
const kBitrateDropThreshold: f64 = 0.66;
const kBitrateDropTimeout: TimeDelta = TimeDelta.Seconds(5);
const kProbeFractionAfterDrop: f64 = 0.85;

// Timeout for probing after leaving ALR. If the bitrate drops significantly,
// (as determined by the delay based estimator) and we leave ALR, then we will
// send a probe if we recover within `kLeftAlrTimeoutMs` ms.
const kAlrEndedTimeout: TimeDelta = TimeDelta.Seconds(3);

// The expected uncertainty of probe result (as a fraction of the target probe
// This is a limit on how often probing can be done when there is a BW
// drop detected in ALR.
const kMinTimeBetweenAlrProbes: TimeDelta = TimeDelta.Seconds(5);

// bitrate). Used to avoid probing if the probe bitrate is close to our current
// estimate.
const kProbeUncertainty: f64 = 0.05;

// Replaces the "WebRTC-Bwe-ProbingConfiguration" field trial (and the
// specialized "WebRTC-Bwe-AllocationProbing" / "WebRTC-Bwe-ProbingBehavior"
// keys, which override subsets of it). Each field is annotated with its key.
// FieldTrialOptional parameters are `Optional<f64> | null`.
export class ProbeControllerConfig {
  // These parameters configure the initial probes. First we send one or two
  // probes of sizes p1 * start_bitrate_ and p2 * start_bitrate_.
  // Then whenever we get a bitrate estimate of at least further_probe_threshold
  // times the size of the last sent probe we'll send another one of size
  // step_size times the new estimate.
  firstExponentialProbeScale: f64 = 3.0; // "p1"
  secondExponentialProbeScale: Optional<f64> | null = new Optional<f64>(6.0); // "p2"
  furtherExponentialProbeScale: f64 = 2; // "step_size"
  furtherProbeThreshold: f64 = 0.7; // "further_probe_threshold"
  abortFurtherProbeIfMaxLowerThanCurrent: bool = false; // "abort_further"

  // Duration of time from the first initial probe where repeated initial probes
  // are sent if repeated initial probing is enabled.
  repeatedInitialProbingTimePeriod: TimeDelta = TimeDelta.Seconds(5); // "initial_probing"
  // The minimum probing duration of an individual probe during
  // the repeated_initial_probing_time_period.
  initialProbeDuration: TimeDelta = TimeDelta.Millis(100); // "initial_probe_duration"
  // Delta time between sent bursts of packets in a probe during
  // the repeated_initial_probing_time_period.
  initialMinProbeDelta: TimeDelta = TimeDelta.Millis(20); // "initial_min_probe_delta"

  // Configures how often we send ALR probes and how big they are.
  alrProbingInterval: TimeDelta = TimeDelta.Seconds(5); // "alr_interval"
  alrProbeScale: f64 = 2; // "alr_scale"
  // Configures how often we send probes if NetworkStateEstimate is available.
  networkStateEstimateProbingInterval: TimeDelta = TimeDelta.PlusInfinity; // "network_state_interval"
  // Periodically probe as long as the ratio between current estimate and
  // NetworkStateEstimate is lower then this.
  probeIfEstimateLowerThanNetworkStateEstimateRatio: f64 = 0; // "est_lower_than_network_ratio"
  estimateLowerThanNetworkStateEstimateProbingInterval: TimeDelta = TimeDelta.Seconds(3); // "est_lower_than_network_interval"
  networkStateProbeScale: f64 = 1.0; // "network_state_scale"
  // Overrides min_probe_duration if network_state_estimate_probing_interval
  // is set and a network state estimate is known and equal or higher than the
  // probe target.
  networkStateProbeDuration: TimeDelta = TimeDelta.Millis(15); // "network_state_probe_duration"
  // Overrides min_probe_delta if network_state_estimate_probing_interval
  // is set and a network state estimate is known and equal or higher than the
  // probe target.
  networkStateMinProbeDelta: TimeDelta = TimeDelta.Millis(20); // "network_state_min_probe_delta"

  // Configures the probes emitted by changed to the allocated bitrate.
  probeOnMaxAllocatedBitrateChange: bool = true; // "probe_max_allocation"
  probeOnMaxAllocatedBitrateChangeWithoutAlr: bool = true; // "probe_max_allocation_without_alr"
  firstAllocationProbeScale: Optional<f64> | null = new Optional<f64>(1); // "alloc_p1"
  secondAllocationProbeScale: Optional<f64> | null = new Optional<f64>(2); // "alloc_p2"
  allocationProbeLimitByCurrentScale: f64 = 2; // "alloc_current_bwe_limit"

  // The minimum number probing packets used.
  minProbePacketsSent: i32 = 5; // "min_probe_packets_sent"
  // The minimum probing duration.
  minProbeDuration: TimeDelta = TimeDelta.Millis(15); // "min_probe_duration"
  // Delta time between sent bursts of packets in a probe.
  minProbeDelta: TimeDelta = TimeDelta.Millis(2); // "min_probe_delta"
  lossLimitedProbeScale: f64 = 1.5; // "loss_limited_scale"
  // Don't send a probe if min(estimate, network state estimate) is larger than
  // this fraction of the set max or max allocated bitrate.
  skipIfEstimateLargerThanFractionOfMax: f64 = 0.0; // "skip_if_est_larger_than_fraction_of_max"
  // Scale factor of the max allocated bitrate. Used when deciding if a probe
  // can be skiped due to that the estimate is already high enough.
  skipProbeMaxAllocatedScale: f64 = 1.0; // "skip_max_allocated_scale"

  // Not part of upstream's ProbeControllerConfig: replaces
  // "WebRTC-BweRapidRecoveryExperiment/Enabled/".
  inRapidRecoveryExperiment: bool = false;
}

// Reason that bandwidth estimate is limited. Bandwidth estimate can be limited
// by either delay based bwe, or loss based bwe when it increases/decreases the
// estimate.
export enum BandwidthLimitedCause {
  kLossLimitedBweIncreasing = 0,
  kLossLimitedBwe = 1,
  kDelayBasedLimited = 2,
  kDelayBasedLimitedDelayIncreased = 3,
  kRttBasedBackOffHighRtt = 4,
}

enum State {
  // Initial state where no probing has been triggered yet.
  kInit,
  // Waiting for probing results to continue further probing.
  kWaitingForProbingResult,
  // Probing is complete.
  kProbingComplete,
}

// This class controls initiation of probing to estimate initial channel
// capacity. There is also support for probing during a session when max
// bitrate is adjusted by an application.
export class ProbeController {
  private networkAvailable: bool = false;
  private repeatedInitialProbingEnabled: bool = false;
  private lastAllowedRepeatedInitialProbe: Timestamp = Timestamp.MinusInfinity;
  private bandwidthLimitedCause: BandwidthLimitedCause = BandwidthLimitedCause.kDelayBasedLimited;
  private state: State = State.kInit;
  private minBitrateToProbeFurther: DataRate = DataRate.PlusInfinity;
  private timeLastProbingInitiated: Timestamp = Timestamp.MinusInfinity;
  private estimatedBitrate: DataRate = DataRate.Zero;
  private networkEstimate: NetworkStateEstimate | null = null;
  private startBitrate: DataRate = DataRate.Zero;
  private maxBitrate: DataRate = DataRate.PlusInfinity;
  private lastBweDropProbingTime: Timestamp = Timestamp.Zero;
  private alrStartTime: Optional<Timestamp> | null = null;
  private alrEndTime: Optional<Timestamp> | null = null;
  private enablePeriodicAlrProbing_: bool = false;
  private timeOfLastLargeDrop: Timestamp = Timestamp.MinusInfinity;
  private bitrateBeforeLastLargeDrop: DataRate = DataRate.Zero;
  private maxTotalAllocatedBitrate: DataRate = DataRate.Zero;
  private readonly inRapidRecoveryExperiment: bool;
  private nextProbeClusterId: i32 = 1;
  private readonly config: ProbeControllerConfig;

  constructor(config: ProbeControllerConfig | null = null) {
    const conf = config !== null ? config : new ProbeControllerConfig();
    this.config = conf;
    this.inRapidRecoveryExperiment = conf.inRapidRecoveryExperiment;
    this.reset(Timestamp.Zero);
  }

  setBitrates(minBitrate: DataRate, startBitrate: DataRate, maxBitrate: DataRate, atTime: Timestamp): ProbeClusterConfig[] {
    if (startBitrate > DataRate.Zero) {
      this.startBitrate = startBitrate;
      this.estimatedBitrate = startBitrate;
    } else if (Unit.isZero(this.startBitrate)) {
      this.startBitrate = minBitrate;
    }

    // The reason we use the variable `old_max_bitrate_pbs` is because we
    // need to set `max_bitrate_` before we call InitiateProbing.
    const oldMaxBitrate = this.maxBitrate;
    this.maxBitrate = Unit.isFinite(maxBitrate) ? maxBitrate : kDefaultMaxProbingBitrate;

    switch (this.state) {
      case State.kInit:
        if (this.networkAvailable) return this.initiateExponentialProbing(atTime);
        break;

      case State.kWaitingForProbingResult:
        break;

      case State.kProbingComplete:
        // If the new max bitrate is higher than both the old max bitrate and the
        // estimate then initiate probing.
        if (!Unit.isZero(this.estimatedBitrate) && oldMaxBitrate < this.maxBitrate &&
            this.estimatedBitrate < this.maxBitrate) {
          return this.initiateProbing(atTime, [this.maxBitrate], false);
        }
        break;
    }
    return [];
  }

  // The total bitrate, as opposed to the max bitrate, is the sum of the
  // configured bitrates for all active streams.
  onMaxTotalAllocatedBitrate(maxTotalAllocatedBitrate: DataRate, atTime: Timestamp): ProbeClusterConfig[] {
    const config = this.config;
    const inAlr = this.alrStartTime !== null;
    const allowAllocationProbe = inAlr || config.probeOnMaxAllocatedBitrateChangeWithoutAlr;

    if (config.probeOnMaxAllocatedBitrateChange &&
        this.state == State.kProbingComplete &&
        maxTotalAllocatedBitrate > this.maxTotalAllocatedBitrate &&
        this.estimatedBitrate < this.maxBitrate &&
        this.estimatedBitrate < maxTotalAllocatedBitrate &&
        allowAllocationProbe) {
      this.maxTotalAllocatedBitrate = maxTotalAllocatedBitrate;

      const firstScale = config.firstAllocationProbeScale;
      if (firstScale === null) return [];

      let firstProbeRate = Unit.mulF(maxTotalAllocatedBitrate, firstScale.value);
      const currentBweLimit = Unit.mulF(this.estimatedBitrate, config.allocationProbeLimitByCurrentScale);
      let limitedByCurrentBwe = currentBweLimit < firstProbeRate;
      if (limitedByCurrentBwe) {
        firstProbeRate = currentBweLimit;
      }

      const probes: DataRate[] = [firstProbeRate];
      const secondScale = config.secondAllocationProbeScale;
      if (!limitedByCurrentBwe && secondScale !== null) {
        let secondProbeRate = Unit.mulF(maxTotalAllocatedBitrate, secondScale.value);
        limitedByCurrentBwe = currentBweLimit < secondProbeRate;
        if (limitedByCurrentBwe) {
          secondProbeRate = currentBweLimit;
        }
        if (secondProbeRate > firstProbeRate) probes.push(secondProbeRate);
      }
      const allowFurtherProbing = limitedByCurrentBwe;

      return this.initiateProbing(atTime, probes, allowFurtherProbing);
    }
    if (!Unit.isZero(maxTotalAllocatedBitrate)) {
      this.lastAllowedRepeatedInitialProbe = atTime;
    }

    this.maxTotalAllocatedBitrate = maxTotalAllocatedBitrate;
    return [];
  }

  onNetworkAvailability(msg: NetworkAvailability): ProbeClusterConfig[] {
    this.networkAvailable = msg.networkAvailable;

    if (!this.networkAvailable && this.state == State.kWaitingForProbingResult) {
      this.state = State.kProbingComplete;
      this.minBitrateToProbeFurther = DataRate.PlusInfinity;
    }

    if (this.networkAvailable && this.state == State.kInit && !Unit.isZero(this.startBitrate)) {
      return this.initiateExponentialProbing(msg.atTime);
    }
    return [];
  }

  setEstimatedBitrate(bitrate: DataRate, bandwidthLimitedCause: BandwidthLimitedCause, atTime: Timestamp): ProbeClusterConfig[] {
    const config = this.config;
    this.bandwidthLimitedCause = bandwidthLimitedCause;
    if (bitrate < Unit.mulF(this.estimatedBitrate, kBitrateDropThreshold)) {
      this.timeOfLastLargeDrop = atTime;
      this.bitrateBeforeLastLargeDrop = this.estimatedBitrate;
    }
    this.estimatedBitrate = bitrate;

    if (this.state == State.kWaitingForProbingResult) {
      // Continue probing if probing results indicate channel has greater
      // capacity unless we already reached the needed bitrate.
      if (config.abortFurtherProbeIfMaxLowerThanCurrent &&
          (bitrate > this.maxBitrate ||
           (!Unit.isZero(this.maxTotalAllocatedBitrate) && bitrate > 2 * this.maxTotalAllocatedBitrate))) {
        // No need to continue probing.
        this.minBitrateToProbeFurther = DataRate.PlusInfinity;
      }
      const estimate = this.networkEstimate;
      const networkStateEstimateProbeFurtherLimit =
        Unit.isFinite(config.networkStateEstimateProbingInterval) && estimate !== null &&
          Unit.isFinite(estimate.linkCapacityUpper)
          ? Unit.mulF(estimate.linkCapacityUpper, config.furtherProbeThreshold)
          : DataRate.PlusInfinity;
      if (bitrate > this.minBitrateToProbeFurther && bitrate <= networkStateEstimateProbeFurtherLimit) {
        return this.initiateProbing(atTime, [Unit.mulF(bitrate, config.furtherExponentialProbeScale)], true);
      }
    }
    return [];
  }

  enablePeriodicAlrProbing(enable: bool): void {
    this.enablePeriodicAlrProbing_ = enable;
  }

  // Probes are sent periodically every 1s during the first 5s after the network
  // becomes available or until OnMaxTotalAllocatedBitrate is invoked with a
  // none zero max_total_allocated_bitrate (there are active streams being
  // sent.) Probe rate is up to max configured bitrate configured via
  // SetBitrates.
  enableRepeatedInitialProbing(enable: bool): void {
    this.repeatedInitialProbingEnabled = enable;
  }

  setAlrStartTime(alrStartTime: Optional<Timestamp> | null): void {
    this.alrStartTime = alrStartTime;
  }

  setAlrEndedTime(alrEndTime: Timestamp): void {
    this.alrEndTime = new Optional<Timestamp>(alrEndTime);
  }

  requestProbe(atTime: Timestamp): ProbeClusterConfig[] {
    // Called once we have returned to normal state after a large drop in
    // estimated bandwidth. The current response is to initiate a single probe
    // session (if not already probing) at the previous bitrate.
    //
    // If the probe session fails, the assumption is that this drop was a
    // real one from a competing flow or a network change.
    const inAlr = this.alrStartTime !== null;
    const alrEndTime = this.alrEndTime;
    const alrEndedRecently = alrEndTime !== null && Unit.sub(atTime, alrEndTime.value) < kAlrEndedTimeout;
    if (inAlr || alrEndedRecently || this.inRapidRecoveryExperiment) {
      if (this.state == State.kProbingComplete) {
        const suggestedProbe = Unit.mulF(this.bitrateBeforeLastLargeDrop, kProbeFractionAfterDrop);
        const minExpectedProbeResult = Unit.mulF(suggestedProbe, 1 - kProbeUncertainty);
        const timeSinceDrop = Unit.sub(atTime, this.timeOfLastLargeDrop);
        const timeSinceProbe = Unit.sub(atTime, this.lastBweDropProbingTime);
        if (minExpectedProbeResult > this.estimatedBitrate &&
            timeSinceDrop < kBitrateDropTimeout &&
            timeSinceProbe > kMinTimeBetweenAlrProbes) {
          // Detected big bandwidth drop, start probing.
          this.lastBweDropProbingTime = atTime;
          return this.initiateProbing(atTime, [suggestedProbe], false);
        }
      }
    }
    return [];
  }

  setNetworkStateEstimate(estimate: NetworkStateEstimate): void {
    this.networkEstimate = estimate;
  }

  // Resets the ProbeController to a state equivalent to as if it was just
  // created EXCEPT for configuration settings like
  // `enable_periodic_alr_probing_` `network_available_` and
  // `max_total_allocated_bitrate_`.
  reset(atTime: Timestamp): void {
    this.bandwidthLimitedCause = BandwidthLimitedCause.kDelayBasedLimited;
    this.state = State.kInit;
    this.minBitrateToProbeFurther = DataRate.PlusInfinity;
    this.timeLastProbingInitiated = Timestamp.Zero;
    this.estimatedBitrate = DataRate.Zero;
    this.networkEstimate = null;
    this.startBitrate = DataRate.Zero;
    this.maxBitrate = kDefaultMaxProbingBitrate;
    const now = atTime;
    this.lastBweDropProbingTime = now;
    this.alrEndTime = null;
    this.timeOfLastLargeDrop = now;
    this.bitrateBeforeLastLargeDrop = DataRate.Zero;
  }

  process(atTime: Timestamp): ProbeClusterConfig[] {
    if (Unit.sub(atTime, this.timeLastProbingInitiated) > kMaxWaitingTimeForProbingResult) {
      if (this.state == State.kWaitingForProbingResult) {
        // kWaitingForProbingResult: timeout
        this.updateState(State.kProbingComplete);
      }
    }
    if (Unit.isZero(this.estimatedBitrate) || this.state != State.kProbingComplete) {
      return [];
    }
    if (this.timeForNextRepeatedInitialProbe(atTime)) {
      return this.initiateProbing(atTime, [Unit.mulF(this.estimatedBitrate, this.config.firstExponentialProbeScale)], true);
    }
    if (this.timeForAlrProbe(atTime) || this.timeForNetworkStateProbe(atTime)) {
      return this.initiateProbing(atTime, [Unit.mulF(this.estimatedBitrate, this.config.alrProbeScale)], true);
    }
    return [];
  }

  private updateState(newState: State): void {
    switch (newState) {
      case State.kInit:
        this.state = State.kInit;
        break;
      case State.kWaitingForProbingResult:
        this.state = State.kWaitingForProbingResult;
        break;
      case State.kProbingComplete:
        this.state = State.kProbingComplete;
        this.minBitrateToProbeFurther = DataRate.PlusInfinity;
        break;
    }
  }

  private initiateExponentialProbing(atTime: Timestamp): ProbeClusterConfig[] {
    assert(this.networkAvailable);
    assert(this.state == State.kInit);
    assert(this.startBitrate > DataRate.Zero);

    // When probing at 1.8 Mbps ( 6x 300), this represents a threshold of
    // 1.2 Mbps to continue probing.
    const probes: DataRate[] = [Unit.mulF(this.startBitrate, this.config.firstExponentialProbeScale)];
    const secondScale = this.config.secondExponentialProbeScale;
    if (secondScale !== null && secondScale.value > 0) {
      probes.push(Unit.mulF(this.startBitrate, secondScale.value));
    }

    if (this.repeatedInitialProbingEnabled && Unit.isZero(this.maxTotalAllocatedBitrate)) {
      this.lastAllowedRepeatedInitialProbe = Unit.add(atTime, this.config.repeatedInitialProbingTimePeriod);
    }

    return this.initiateProbing(atTime, probes, true);
  }

  private timeForAlrProbe(atTime: Timestamp): bool {
    const alrStartTime = this.alrStartTime;
    if (this.enablePeriodicAlrProbing_ && alrStartTime !== null) {
      const nextProbeTime = Unit.add(max(alrStartTime.value, this.timeLastProbingInitiated), this.config.alrProbingInterval);
      return atTime >= nextProbeTime;
    }
    return false;
  }

  private timeForNetworkStateProbe(atTime: Timestamp): bool {
    const estimate = this.networkEstimate;
    if (estimate === null || Unit.isInfinite(estimate.linkCapacityUpper)) {
      return false;
    }

    const config = this.config;
    const probeDueToLowEstimate =
      this.bandwidthLimitedCause == BandwidthLimitedCause.kDelayBasedLimited &&
      this.estimatedBitrate <
        Unit.mulF(estimate.linkCapacityUpper, config.probeIfEstimateLowerThanNetworkStateEstimateRatio);
    if (probeDueToLowEstimate && Unit.isFinite(config.estimateLowerThanNetworkStateEstimateProbingInterval)) {
      const nextProbeTime = Unit.add(
        this.timeLastProbingInitiated, config.estimateLowerThanNetworkStateEstimateProbingInterval);
      return atTime >= nextProbeTime;
    }

    const periodicProbe = this.estimatedBitrate < estimate.linkCapacityUpper;
    if (periodicProbe && Unit.isFinite(config.networkStateEstimateProbingInterval)) {
      const nextProbeTime = Unit.add(this.timeLastProbingInitiated, config.networkStateEstimateProbingInterval);
      return atTime >= nextProbeTime;
    }

    return false;
  }

  private timeForNextRepeatedInitialProbe(atTime: Timestamp): bool {
    if (this.state != State.kWaitingForProbingResult && this.lastAllowedRepeatedInitialProbe > atTime) {
      const nextProbeTime = Unit.add(this.timeLastProbingInitiated, kMaxWaitingTimeForProbingResult);
      if (atTime >= nextProbeTime) {
        return true;
      }
    }
    return false;
  }

  private createProbeClusterConfig(atTime: Timestamp, bitrate: DataRate): ProbeClusterConfig {
    const config = this.config;
    const probe = new ProbeClusterConfig();
    probe.atTime = atTime;
    probe.targetDataRate = bitrate;
    const estimate = this.networkEstimate;
    if (estimate !== null && Unit.isFinite(config.networkStateEstimateProbingInterval) &&
        Unit.isFinite(estimate.linkCapacityUpper) && estimate.linkCapacityUpper >= bitrate) {
      probe.targetDuration = config.networkStateProbeDuration;
      probe.minProbeDelta = config.networkStateMinProbeDelta;
    } else if (atTime < this.lastAllowedRepeatedInitialProbe) {
      probe.targetDuration = config.initialProbeDuration;
      probe.minProbeDelta = config.initialMinProbeDelta;
    } else {
      probe.targetDuration = config.minProbeDuration;
      probe.minProbeDelta = config.minProbeDelta;
    }
    probe.targetProbeCount = config.minProbePacketsSent;
    probe.id = this.nextProbeClusterId;
    this.nextProbeClusterId++;
    return probe;
  }

  private initiateProbing(now: Timestamp, bitratesToProbe: DataRate[], probeFurther: bool): ProbeClusterConfig[] {
    const config = this.config;
    const estimate = this.networkEstimate;
    if (config.skipIfEstimateLargerThanFractionOfMax > 0) {
      const networkEstimate = estimate !== null ? estimate.linkCapacityUpper : DataRate.PlusInfinity;
      const maxProbeRate = Unit.isZero(this.maxTotalAllocatedBitrate)
        ? this.maxBitrate
        : min(Unit.mulF(this.maxTotalAllocatedBitrate, config.skipProbeMaxAllocatedScale), this.maxBitrate);
      if (min(networkEstimate, this.estimatedBitrate) >
          Unit.mulF(maxProbeRate, config.skipIfEstimateLargerThanFractionOfMax)) {
        this.updateState(State.kProbingComplete);
        return [];
      }
    }

    let maxProbeBitrate = this.maxBitrate;
    if (this.maxTotalAllocatedBitrate > DataRate.Zero) {
      // If a max allocated bitrate has been configured, allow probing up to 2x
      // that rate. This allows some overhead to account for bursty streams,
      // which otherwise would have to ramp up when the overshoot is already in
      // progress.
      // It also avoids minor quality reduction caused by probes often being
      // received at slightly less than the target probe bitrate.
      maxProbeBitrate = min(maxProbeBitrate, this.maxTotalAllocatedBitrate * 2);
    }

    switch (this.bandwidthLimitedCause) {
      case BandwidthLimitedCause.kRttBasedBackOffHighRtt:
      case BandwidthLimitedCause.kDelayBasedLimitedDelayIncreased:
      case BandwidthLimitedCause.kLossLimitedBwe:
        // Not sending probe in bandwidth limited state.
        return [];
      case BandwidthLimitedCause.kLossLimitedBweIncreasing:
        maxProbeBitrate = min(maxProbeBitrate, Unit.mulF(this.estimatedBitrate, config.lossLimitedProbeScale));
        break;
      case BandwidthLimitedCause.kDelayBasedLimited:
        break;
      default:
        break;
    }

    if (Unit.isFinite(config.networkStateEstimateProbingInterval) && estimate !== null &&
        Unit.isFinite(estimate.linkCapacityUpper)) {
      if (Unit.isZero(estimate.linkCapacityUpper)) {
        // Not sending probe, Network state estimate is zero.
        return [];
      }
      maxProbeBitrate = min(
        maxProbeBitrate,
        max(this.estimatedBitrate, Unit.mulF(estimate.linkCapacityUpper, config.networkStateProbeScale)));
    }

    const pendingProbes: ProbeClusterConfig[] = [];
    for (let i = 0; i < bitratesToProbe.length; ++i) {
      let bitrate = bitratesToProbe[i];
      assert(!Unit.isZero(bitrate));
      if (bitrate >= maxProbeBitrate) {
        bitrate = maxProbeBitrate;
        probeFurther = false;
      }
      pendingProbes.push(this.createProbeClusterConfig(now, bitrate));
    }
    this.timeLastProbingInitiated = now;
    if (probeFurther) {
      this.updateState(State.kWaitingForProbingResult);
      // Dont expect probe results to be larger than a fraction of the actual
      // probe rate.
      this.minBitrateToProbeFurther =
        Unit.mulF(pendingProbes[pendingProbes.length - 1].targetDataRate, config.furtherProbeThreshold);
    } else {
      this.updateState(State.kProbingComplete);
    }
    return pendingProbes;
  }
}
