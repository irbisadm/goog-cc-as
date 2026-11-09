// Port of modules/remote_bitrate_estimator/aimd_rate_control.{h,cc} @ M154.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../units";
import {BandwidthUsage} from "../../api/transport/bandwidth-usage";
import {NetworkStateEstimate} from "../../api/transport/network-types";
import {LinkCapacityEstimator} from "../congestion-controller/goog-cc/link-capacity-estimator";
import {kBitrateWindow, kCongestionControllerMinBitrate, RateControlInput} from "./include/bwe-defines";

const kDefaultRtt: TimeDelta = TimeDelta.Millis(200);
const kDefaultBackoffFactor: f64 = 0.85;

// Replaces the field trials read by AimdRateControl:
//   "WebRTC-BweBackOffFactor/Enabled-<f>/"            -> backoffFactor
//   "WebRTC-DontIncreaseDelayBasedBweInAlr/Enabled/"  -> noBitrateIncreaseInAlr
//   "WebRTC-Bwe-EstimateBoundedIncrease/Disabled,c_upper:<bool>/"
//        -> disableEstimateBoundedIncrease, useCurrentEstimateAsMinUpperBound
export class AimdRateControlConfig {
  // Must be in (0, 1); other values fall back to the default, like upstream.
  backoffFactor: f64 = kDefaultBackoffFactor;
  noBitrateIncreaseInAlr: bool = false;
  disableEstimateBoundedIncrease: bool = false;
  useCurrentEstimateAsMinUpperBound: bool = true;
}

enum RateControlState { kRcHold, kRcIncrease, kRcDecrease }

// A rate control implementation based on additive increases of
// bitrate when no over-use is detected and multiplicative decreases when
// over-uses are detected. When we think the available bandwidth has changes or
// is unknown, we will switch to a "slow-start mode" where we increase
// multiplicatively.
export class AimdRateControl {
  private minConfiguredBitrate: DataRate = kCongestionControllerMinBitrate;
  private maxConfiguredBitrate: DataRate = DataRate.KilobitsPerSec(30000);
  private currentBitrate: DataRate;
  private latestEstimatedThroughput: DataRate;
  private linkCapacity: LinkCapacityEstimator = new LinkCapacityEstimator();
  private networkEstimate: NetworkStateEstimate | null = null;
  private rateControlState: RateControlState = RateControlState.kRcHold;
  private timeLastBitrateChange: Timestamp = Timestamp.MinusInfinity;
  private timeLastBitrateDecrease: Timestamp = Timestamp.MinusInfinity;
  private timeFirstThroughputEstimate: Timestamp = Timestamp.MinusInfinity;
  private bitrateIsInitialized: bool = false;
  private beta: f64;
  private inAlr: bool = false;
  private rtt: TimeDelta = kDefaultRtt;
  private readonly sendSide: bool;
  // Allow the delay based estimate to only increase as long as application
  // limited region (alr) is not detected.
  private readonly noBitrateIncreaseInAlr: bool;
  // If "Disabled",  estimated link capacity is not used as upper bound.
  private readonly disableEstimateBoundedIncrease: bool;
  private readonly useCurrentEstimateAsMinUpperBound: bool;
  // std::optional<DataRate>; MinusInfinity = nullopt.
  private lastDecrease: DataRate = DataRate.MinusInfinity;

  constructor(configOrNull: AimdRateControlConfig | null = null, sendSide: bool = false) {
    const config = configOrNull !== null ? configOrNull : new AimdRateControlConfig();
    this.currentBitrate = this.maxConfiguredBitrate;
    this.latestEstimatedThroughput = this.currentBitrate;
    const backoff = config.backoffFactor;
    // ReadBackoffFactor(): must be in (0, 1).
    this.beta = backoff > 0.0 && backoff < 1.0 ? backoff : kDefaultBackoffFactor;
    this.sendSide = sendSide;
    this.noBitrateIncreaseInAlr = config.noBitrateIncreaseInAlr;
    this.disableEstimateBoundedIncrease = config.disableEstimateBoundedIncrease;
    this.useCurrentEstimateAsMinUpperBound = config.useCurrentEstimateAsMinUpperBound;
  }

  // Returns true if the target bitrate has been initialized. This happens
  // either if it has been explicitly set via SetStartBitrate/SetEstimate, or if
  // we have measured a throughput.
  validEstimate(): bool {
    return this.bitrateIsInitialized;
  }

  setStartBitrate(startBitrate: DataRate): void {
    this.currentBitrate = startBitrate;
    this.latestEstimatedThroughput = this.currentBitrate;
    this.bitrateIsInitialized = true;
  }

  setMinBitrate(minBitrate: DataRate): void {
    this.minConfiguredBitrate = minBitrate;
    this.currentBitrate = max(minBitrate, this.currentBitrate);
  }

  getFeedbackInterval(): TimeDelta {
    // Estimate how often we can send RTCP if we allocate up to 5% of bandwidth
    // to feedback.
    const kRtcpSize = DataSize.Bytes(80);
    const rtcpBitrate = Unit.mulF(this.currentBitrate, 0.05);
    const interval = DataRate.timeToSend(kRtcpSize, rtcpBitrate);
    const kMinFeedbackInterval = TimeDelta.Millis(200);
    const kMaxFeedbackInterval = TimeDelta.Millis(1000);
    return Unit.clamp(interval, kMinFeedbackInterval, kMaxFeedbackInterval);
  }

  // Returns true if the bitrate estimate hasn't been changed for more than
  // an RTT, or if the estimated_throughput is less than half of the current
  // estimate. Should be used to decide if we should reduce the rate further
  // when over-using.
  timeToReduceFurther(atTime: Timestamp, estimatedThroughput: DataRate): bool {
    const bitrateReductionInterval = Unit.clamp(this.rtt, TimeDelta.Millis(10), TimeDelta.Millis(200));
    if (Unit.sub(atTime, this.timeLastBitrateChange) >= bitrateReductionInterval) {
      return true;
    }
    if (this.validEstimate()) {
      // TODO(terelius/holmer): Investigate consequences of increasing
      // the threshold to 0.95 * LatestEstimate().
      const threshold = Unit.mulF(this.latestEstimate(), 0.5);
      return estimatedThroughput < threshold;
    }
    return false;
  }

  // As above. To be used if overusing before we have measured a throughput.
  initialTimeToReduceFurther(atTime: Timestamp): bool {
    return this.validEstimate() &&
      this.timeToReduceFurther(atTime, Unit.sub(this.latestEstimate() / 2, DataRate.BitsPerSec(1)));
  }

  latestEstimate(): DataRate {
    return this.currentBitrate;
  }

  setRtt(rtt: TimeDelta): void {
    this.rtt = rtt;
  }

  update(input: RateControlInput, atTime: Timestamp): DataRate {
    // Set the initial bit rate value to what we're receiving the first half
    // second.
    // TODO(bugs.webrtc.org/9379): The comment above doesn't match to the code.
    if (!this.bitrateIsInitialized) {
      const kInitializationTime = TimeDelta.Seconds(5);
      assert(kBitrateWindow <= kInitializationTime);
      const throughput = input.estimatedThroughput;
      if (Unit.isInfinite(this.timeFirstThroughputEstimate)) {
        if (throughput !== null) this.timeFirstThroughputEstimate = atTime;
      } else if (Unit.sub(atTime, this.timeFirstThroughputEstimate) > kInitializationTime && throughput !== null) {
        this.currentBitrate = throughput.value;
        this.bitrateIsInitialized = true;
      }
    }

    this.changeBitrate(input, atTime);
    return this.currentBitrate;
  }

  setInApplicationLimitedRegion(inAlr: bool): void {
    this.inAlr = inAlr;
  }

  setEstimate(bitrate: DataRate, atTime: Timestamp): void {
    this.bitrateIsInitialized = true;
    const prevBitrate = this.currentBitrate;
    this.currentBitrate = this.clampBitrate(bitrate);
    this.timeLastBitrateChange = atTime;
    if (this.currentBitrate < prevBitrate) {
      this.timeLastBitrateDecrease = atTime;
    }
  }

  setNetworkStateEstimate(estimate: NetworkStateEstimate | null): void {
    this.networkEstimate = estimate;
  }

  // Returns the increase rate when used bandwidth is near the link capacity.
  getNearMaxIncreaseRateBpsPerSecond(): f64 {
    assert(!Unit.isZero(this.currentBitrate));
    const kFrameInterval = TimeDelta.Seconds(1) / 30;
    const frameSize = DataRate.mulTime(this.currentBitrate, kFrameInterval);
    const kPacketSize = DataSize.Bytes(1200);
    const packetsPerFrame = Math.ceil(Unit.ratio(frameSize, kPacketSize));
    const avgPacketSize = Unit.divF(frameSize, packetsPerFrame);

    // Approximate the over-use estimator delay to 100 ms.
    let responseTime = Unit.add(this.rtt, TimeDelta.Millis(100));

    responseTime = responseTime * 2;
    const increaseRateBpsPerSecond = DataRate.bps<f64>(DataRate.fromSizeAndDuration(avgPacketSize, responseTime));
    const kMinIncreaseRateBpsPerSecond: f64 = 4000;
    return max(kMinIncreaseRateBpsPerSecond, increaseRateBpsPerSecond);
  }

  // Update the target bitrate based on, among other things, the current rate
  // control state, the current target bitrate and the estimated throughput.
  // When in the "increase" state the bitrate will be increased either
  // additively or multiplicatively depending on the rate control region. When
  // in the "decrease" state the bitrate will be decreased to slightly below the
  // current throughput. When in the "hold" state the bitrate will be kept
  // constant to allow built up queues to drain.
  private changeBitrate(input: RateControlInput, atTime: Timestamp): void {
    // std::optional<DataRate> new_bitrate; MinusInfinity = nullopt.
    let newBitrate = DataRate.MinusInfinity;
    const throughput = input.estimatedThroughput;
    const estimatedThroughput = throughput !== null ? throughput.value : this.latestEstimatedThroughput;
    if (throughput !== null) this.latestEstimatedThroughput = throughput.value;

    // An over-use should always trigger us to reduce the bitrate, even though
    // we have not yet established our first estimate. By acting on the over-use,
    // we will end up with a valid estimate.
    if (!this.bitrateIsInitialized && input.bwState != BandwidthUsage.kBwOverusing) return;

    this.changeState(input, atTime);

    switch (this.rateControlState) {
      case RateControlState.kRcHold:
        break;

      case RateControlState.kRcIncrease: {
        if (estimatedThroughput > this.linkCapacity.upperBound()) this.linkCapacity.reset();

        // We limit the new bitrate based on the troughput to avoid unlimited
        // bitrate increases. We allow a bit more lag at very low rates to not too
        // easily get stuck if the encoder produces uneven outputs.
        let increaseLimit = Unit.add(Unit.mulF(estimatedThroughput, 1.5), DataRate.KilobitsPerSec(10));
        if (this.sendSide && this.inAlr && this.noBitrateIncreaseInAlr) {
          // Do not increase the delay based estimate in alr since the estimator
          // will not be able to get transport feedback necessary to detect if
          // the new estimate is correct.
          // If we have previously increased above the limit (for instance due to
          // probing), we don't allow further changes.
          increaseLimit = this.currentBitrate;
        }

        if (this.currentBitrate < increaseLimit) {
          let increasedBitrate = DataRate.MinusInfinity;
          if (this.linkCapacity.hasEstimate()) {
            // The link_capacity estimate is reset if the measured throughput
            // is too far from the estimate. We can therefore assume that our
            // target rate is reasonably close to link capacity and use additive
            // increase.
            const additiveIncrease = this.additiveRateIncrease(atTime, this.timeLastBitrateChange);
            increasedBitrate = Unit.add(this.currentBitrate, additiveIncrease);
          } else {
            // If we don't have an estimate of the link capacity, use faster ramp
            // up to discover the capacity.
            const multiplicativeIncrease =
              this.multiplicativeRateIncrease(atTime, this.timeLastBitrateChange, this.currentBitrate);
            increasedBitrate = Unit.add(this.currentBitrate, multiplicativeIncrease);
          }
          newBitrate = min(increasedBitrate, increaseLimit);
        }
        this.timeLastBitrateChange = atTime;
        break;
      }

      case RateControlState.kRcDecrease: {
        // Set bit rate to something slightly lower than the measured throughput
        // to get rid of any self-induced delay.
        let decreasedBitrate = Unit.mulF(estimatedThroughput, this.beta);
        if (decreasedBitrate > DataRate.KilobitsPerSec(5)) {
          decreasedBitrate = Unit.sub(decreasedBitrate, DataRate.KilobitsPerSec(5));
        }

        if (decreasedBitrate > this.currentBitrate) {
          // TODO(terelius): The link_capacity estimate may be based on old
          // throughput measurements. Relying on them may lead to unnecessary
          // BWE drops.
          if (this.linkCapacity.hasEstimate()) {
            decreasedBitrate = Unit.mulF(this.linkCapacity.estimate(), this.beta);
          }
        }
        // Avoid increasing the rate when over-using.
        if (decreasedBitrate < this.currentBitrate) {
          newBitrate = decreasedBitrate;
        }

        if (this.bitrateIsInitialized && estimatedThroughput < this.currentBitrate) {
          if (Unit.isMinusInfinity(newBitrate)) {
            this.lastDecrease = DataRate.Zero;
          } else {
            this.lastDecrease = Unit.sub(this.currentBitrate, newBitrate);
          }
        }
        if (estimatedThroughput < this.linkCapacity.lowerBound()) {
          // The current throughput is far from the estimated link capacity. Clear
          // the estimate to allow an immediate update in OnOveruseDetected.
          this.linkCapacity.reset();
        }

        this.bitrateIsInitialized = true;
        this.linkCapacity.onOveruseDetected(estimatedThroughput);
        // Stay on hold until the pipes are cleared.
        this.rateControlState = RateControlState.kRcHold;
        this.timeLastBitrateChange = atTime;
        this.timeLastBitrateDecrease = atTime;
        break;
      }
      default:
        unreachable();
    }
    this.currentBitrate = this.clampBitrate(Unit.isMinusInfinity(newBitrate) ? this.currentBitrate : newBitrate);
  }

  private clampBitrate(newBitrate: DataRate): DataRate {
    const estimate = this.networkEstimate;
    if (!this.disableEstimateBoundedIncrease && estimate !== null && Unit.isFinite(estimate.linkCapacityUpper)) {
      const upperBound = this.useCurrentEstimateAsMinUpperBound
        ? max(estimate.linkCapacityUpper, this.currentBitrate)
        : estimate.linkCapacityUpper;
      newBitrate = min(upperBound, newBitrate);
    }
    if (estimate !== null && Unit.isFinite(estimate.linkCapacityLower) && newBitrate < this.currentBitrate) {
      newBitrate = min(this.currentBitrate, max(newBitrate, Unit.mulF(estimate.linkCapacityLower, this.beta)));
    }
    newBitrate = max(newBitrate, this.minConfiguredBitrate);
    return newBitrate;
  }

  private multiplicativeRateIncrease(atTime: Timestamp, lastTime: Timestamp, currentBitrate: DataRate): DataRate {
    let alpha: f64 = 1.08;
    if (Unit.isFinite(lastTime)) {
      const timeSinceLastUpdate = Unit.sub(atTime, lastTime);
      alpha = Math.pow(alpha, min(TimeDelta.seconds<f64>(timeSinceLastUpdate), 1.0));
    }
    return max(Unit.mulF(currentBitrate, alpha - 1.0), DataRate.BitsPerSec(1000));
  }

  private additiveRateIncrease(atTime: Timestamp, lastTime: Timestamp): DataRate {
    const timePeriodSeconds = TimeDelta.seconds<f64>(Unit.sub(atTime, lastTime));
    const dataRateIncreaseBps = this.getNearMaxIncreaseRateBpsPerSecond() * timePeriodSeconds;
    return DataRate.BitsPerSec<f64>(dataRateIncreaseBps);
  }

  private changeState(input: RateControlInput, atTime: Timestamp): void {
    switch (input.bwState) {
      case BandwidthUsage.kBwNormal:
        if (this.rateControlState == RateControlState.kRcHold) {
          this.timeLastBitrateChange = atTime;
          this.rateControlState = RateControlState.kRcIncrease;
        }
        break;
      case BandwidthUsage.kBwOverusing:
        if (this.rateControlState != RateControlState.kRcDecrease) {
          this.rateControlState = RateControlState.kRcDecrease;
        }
        break;
      case BandwidthUsage.kBwUnderusing:
        this.rateControlState = RateControlState.kRcHold;
        break;
      default:
        unreachable();
    }
  }
}
