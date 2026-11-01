// Port of modules/congestion_controller/goog_cc/delay_based_bwe.{h,cc} @ M154.
// RtcEventLog and UMA histograms are not ported.
import {DataRate, TimeDelta, Timestamp, Unit} from "../../../units";
import {BandwidthUsage} from "../../../api/transport/bandwidth-usage";
import {NetworkStatePredictor} from "../../../api/network-state-predictor";
import {NetworkStateEstimate, PacketResult, TransportPacketsFeedback} from "../../../api/transport/network-types";
import {Optional} from "../../../types/optional";
import {RateControlInput} from "../../remote-bitrate-estimator/include/bwe-defines";
import {AimdRateControl, AimdRateControlConfig} from "../../remote-bitrate-estimator/aimd-rate-control";
import {DelayIncreaseDetectorInterface} from "./delay-increase-detector-interface";
import {InterArrivalDelta, InterArrivalDeltaOutput} from "./inter-arrival-delta";
import {TrendlineEstimator, TrendlineEstimatorSettings} from "./trendline-estimator";

const kStreamTimeOut: TimeDelta = TimeDelta.Seconds(2);
const kSendTimeGroupLength: TimeDelta = TimeDelta.Millis(5);

// This ssrc is used to fulfill the current API but will be removed
// after the API has been changed.
const kFixedSsrc: u32 = 0;

// Replaces the "WebRTC-Bwe-SeparateAudioPackets" field trial.
export class BweSeparateAudioPacketsSettings {
  enabled: bool = false;
  packetThreshold: i32 = 10;
  timeThreshold: TimeDelta = TimeDelta.Seconds(1);
}

// Upstream passes one FieldTrialsView to DelayBasedBwe, which forwards it to
// its TrendlineEstimators and AimdRateControl; here the settings of each part
// are grouped explicitly.
export class DelayBasedBweConfig {
  separateAudio: BweSeparateAudioPacketsSettings = new BweSeparateAudioPacketsSettings();
  trendline: TrendlineEstimatorSettings = new TrendlineEstimatorSettings();
  aimdRateControl: AimdRateControlConfig = new AimdRateControlConfig();
}

// DelayBasedBwe::Result.
export class DelayBasedBweResult {
  updated: bool = false;
  probe: bool = false;
  targetBitrate: DataRate = DataRate.Zero;
  recoveredFromOveruse: bool = false;
  delayDetectorState: BandwidthUsage = BandwidthUsage.kBwNormal;
}

export class DelayBasedBwe {
  private readonly config: DelayBasedBweConfig;
  // Alternatively, run two separate overuse detectors for audio and video,
  // and fall back to the audio one if we haven't seen a video packet in a
  // while.
  private readonly separateAudio: BweSeparateAudioPacketsSettings;
  private audioPacketsSinceLastVideo: i64 = 0;
  private lastVideoPacketRecvTime: Timestamp = Timestamp.MinusInfinity;

  private readonly networkStatePredictor: NetworkStatePredictor | null;
  // Upstream creates these lazily on the first packet; they are always reset
  // there before use, so initial instances are equivalent.
  private videoInterArrivalDelta: InterArrivalDelta = new InterArrivalDelta(kSendTimeGroupLength);
  private videoDelayDetector: DelayIncreaseDetectorInterface;
  private audioInterArrivalDelta: InterArrivalDelta = new InterArrivalDelta(kSendTimeGroupLength);
  private audioDelayDetector: DelayIncreaseDetectorInterface;
  private activeDelayDetector: DelayIncreaseDetectorInterface;

  private lastSeenPacket: Timestamp = Timestamp.MinusInfinity;
  private rateControl: AimdRateControl;
  private prevBitrate: DataRate = DataRate.Zero;
  private prevState: BandwidthUsage = BandwidthUsage.kBwNormal;

  private readonly deltas: InterArrivalDeltaOutput = new InterArrivalDeltaOutput();

  constructor(config: DelayBasedBweConfig | null = null, networkStatePredictor: NetworkStatePredictor | null = null) {
    const conf = config !== null ? config : new DelayBasedBweConfig();
    const video = new TrendlineEstimator(conf.trendline, networkStatePredictor);
    this.config = conf;
    this.separateAudio = conf.separateAudio;
    this.networkStatePredictor = networkStatePredictor;
    this.videoDelayDetector = video;
    this.audioDelayDetector = new TrendlineEstimator(conf.trendline, networkStatePredictor);
    this.activeDelayDetector = video;
    this.rateControl = new AimdRateControl(conf.aimdRateControl, /*sendSide=*/true);
  }

  incomingPacketFeedbackVector(
    msg: TransportPacketsFeedback,
    ackedBitrate: Optional<DataRate> | null,
    probeBitrate: Optional<DataRate> | null,
    networkEstimate: NetworkStateEstimate | null,
    inAlr: bool,
  ): DelayBasedBweResult {
    const packetFeedbackVector = msg.sortedByReceiveTime();
    // TODO(holmer): An empty feedback vector here likely means that
    // all acks were too late and that the send time history had
    // timed out. We should reduce the rate when this occurs.
    if (packetFeedbackVector.length == 0) {
      // Very late feedback received.
      return new DelayBasedBweResult();
    }

    let delayedFeedback = true;
    let recoveredFromOveruse = false;
    let prevDetectorState = this.activeDelayDetector.state();
    for (let i = 0; i < packetFeedbackVector.length; ++i) {
      delayedFeedback = false;
      this.incomingPacketFeedback(packetFeedbackVector[i], msg.feedbackTime);
      if (prevDetectorState == BandwidthUsage.kBwUnderusing &&
          this.activeDelayDetector.state() == BandwidthUsage.kBwNormal) {
        recoveredFromOveruse = true;
      }
      prevDetectorState = this.activeDelayDetector.state();
    }

    if (delayedFeedback) {
      // TODO(bugs.webrtc.org/10125): Design a better mechanism to safe-guard
      // against building very large network queues.
      return new DelayBasedBweResult();
    }
    this.rateControl.setInApplicationLimitedRegion(inAlr);
    this.rateControl.setNetworkStateEstimate(networkEstimate);
    return this.maybeUpdateEstimate(ackedBitrate, probeBitrate, recoveredFromOveruse, msg.feedbackTime);
  }

  onRttUpdate(avgRtt: TimeDelta): void {
    this.rateControl.setRtt(avgRtt);
  }

  // Returns the estimate, or null if there is no valid estimate. `ssrcs` is
  // filled like upstream's out-parameter.
  latestEstimate(ssrcs: u32[]): Optional<DataRate> | null {
    if (!this.rateControl.validEstimate()) return null;
    ssrcs.length = 0;
    ssrcs.push(kFixedSsrc);
    return new Optional<DataRate>(this.rateControl.latestEstimate());
  }

  setStartBitrate(startBitrate: DataRate): void {
    this.rateControl.setStartBitrate(startBitrate);
  }

  setMinBitrate(minBitrate: DataRate): void {
    // Called from both the configuration thread and the network thread. Shouldn't
    // be called from the network thread in the future.
    this.rateControl.setMinBitrate(minBitrate);
  }

  triggerOveruse(atTime: Timestamp, linkCapacity: Optional<DataRate> | null): DataRate {
    const input = new RateControlInput(BandwidthUsage.kBwOverusing, linkCapacity);
    return this.rateControl.update(input, atTime);
  }

  lastEstimate(): DataRate {
    return this.prevBitrate;
  }

  lastState(): BandwidthUsage {
    return this.prevState;
  }

  private newDelayDetector(): DelayIncreaseDetectorInterface {
    return new TrendlineEstimator(this.config.trendline, this.networkStatePredictor);
  }

  private incomingPacketFeedback(packetFeedback: PacketResult, atTime: Timestamp): void {
    // Reset if the stream has timed out.
    if (Unit.isInfinite(this.lastSeenPacket) || Unit.sub(atTime, this.lastSeenPacket) > kStreamTimeOut) {
      this.videoInterArrivalDelta = new InterArrivalDelta(kSendTimeGroupLength);
      this.audioInterArrivalDelta = new InterArrivalDelta(kSendTimeGroupLength);
      this.videoDelayDetector = this.newDelayDetector();
      this.audioDelayDetector = this.newDelayDetector();
      this.activeDelayDetector = this.videoDelayDetector;
    }
    this.lastSeenPacket = atTime;

    // As an alternative to ignoring small packets, we can separate audio and
    // video packets for overuse detection.
    let delayDetectorForPacket = this.videoDelayDetector;
    if (this.separateAudio.enabled) {
      if (packetFeedback.sentPacket.audio) {
        delayDetectorForPacket = this.audioDelayDetector;
        this.audioPacketsSinceLastVideo++;
        if (this.audioPacketsSinceLastVideo > <i64>this.separateAudio.packetThreshold &&
            Unit.sub(packetFeedback.receiveTime, this.lastVideoPacketRecvTime) > this.separateAudio.timeThreshold) {
          this.activeDelayDetector = this.audioDelayDetector;
        }
      } else {
        this.audioPacketsSinceLastVideo = 0;
        this.lastVideoPacketRecvTime = max(this.lastVideoPacketRecvTime, packetFeedback.receiveTime);
        this.activeDelayDetector = this.videoDelayDetector;
      }
    }
    const packetSize = packetFeedback.sentPacket.size;
    const deltas = this.deltas;
    deltas.sendTimeDelta = TimeDelta.Zero;
    deltas.arrivalTimeDelta = TimeDelta.Zero;
    deltas.packetSizeDelta = 0;
    const interArrivalForPacket = this.separateAudio.enabled && packetFeedback.sentPacket.audio
      ? this.audioInterArrivalDelta
      : this.videoInterArrivalDelta;
    const calculatedDeltas = interArrivalForPacket.computeDeltas(
      packetFeedback.sentPacket.sendTime, packetFeedback.receiveTime, atTime, <usize>packetSize, deltas);

    delayDetectorForPacket.update(
      TimeDelta.ms<f64>(deltas.arrivalTimeDelta),
      TimeDelta.ms<f64>(deltas.sendTimeDelta),
      Timestamp.ms(packetFeedback.sentPacket.sendTime),
      Timestamp.ms(packetFeedback.receiveTime),
      <usize>packetSize,
      calculatedDeltas,
    );
  }

  private maybeUpdateEstimate(
    ackedBitrate: Optional<DataRate> | null,
    probeBitrate: Optional<DataRate> | null,
    recoveredFromOveruse: bool,
    atTime: Timestamp,
  ): DelayBasedBweResult {
    const result = new DelayBasedBweResult();

    // Currently overusing the bandwidth.
    if (this.activeDelayDetector.state() == BandwidthUsage.kBwOverusing) {
      if (ackedBitrate !== null && this.rateControl.timeToReduceFurther(atTime, ackedBitrate.value)) {
        result.updated = this.updateEstimate(atTime, ackedBitrate, result);
      } else if (ackedBitrate === null && this.rateControl.validEstimate() &&
                 this.rateControl.initialTimeToReduceFurther(atTime)) {
        // Overusing before we have a measured acknowledged bitrate. Reduce send
        // rate by 50% every 200 ms.
        // TODO(tschumim): Improve this and/or the acknowledged bitrate estimator
        // so that we (almost) always have a bitrate estimate.
        this.rateControl.setEstimate(this.rateControl.latestEstimate() / 2, atTime);
        result.updated = true;
        result.probe = false;
        result.targetBitrate = this.rateControl.latestEstimate();
      }
    } else {
      if (probeBitrate !== null) {
        result.probe = true;
        result.updated = true;
        this.rateControl.setEstimate(probeBitrate.value, atTime);
        result.targetBitrate = this.rateControl.latestEstimate();
      } else {
        result.updated = this.updateEstimate(atTime, ackedBitrate, result);
        result.recoveredFromOveruse = recoveredFromOveruse;
      }
    }
    const detectorState = this.activeDelayDetector.state();
    if ((result.updated && this.prevBitrate != result.targetBitrate) || detectorState != this.prevState) {
      const bitrate = result.updated ? result.targetBitrate : this.prevBitrate;
      this.prevBitrate = bitrate;
      this.prevState = detectorState;
    }
    result.delayDetectorState = detectorState;
    return result;
  }

  // Updates the current remote rate estimate and returns true if a valid
  // estimate exists. Writes the rate to `result.targetBitrate`
  // (upstream: `DataRate* target_rate`).
  private updateEstimate(atTime: Timestamp, ackedBitrate: Optional<DataRate> | null, result: DelayBasedBweResult): bool {
    const input = new RateControlInput(this.activeDelayDetector.state(), ackedBitrate);
    result.targetBitrate = this.rateControl.update(input, atTime);
    return this.rateControl.validEstimate();
  }
}
