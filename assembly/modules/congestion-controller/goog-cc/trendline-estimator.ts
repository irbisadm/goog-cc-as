// Port of modules/congestion_controller/goog_cc/trendline_estimator.{h,cc} @ M154.
import {BandwidthUsage} from "../../../api/transport/bandwidth-usage";
import {NetworkStatePredictor} from "../../../api/network-state-predictor";
import {DelayIncreaseDetectorInterface} from "./delay-increase-detector-interface";

// Parameters for linear least squares fit of regression line to noisy data.
const kDefaultTrendlineSmoothingCoeff: f64 = 0.9;
const kDefaultTrendlineThresholdGain: f64 = 4.0;

const kMaxAdaptOffsetMs: f64 = 15.0;
const kOverUsingTimeThreshold: f64 = 10;
const kMinNumDeltas: i32 = 60;
const kDeltaCounterMax: i32 = 1000;

// Replaces the "WebRTC-Bwe-TrendlineEstimatorSettings" field trial (and
// "WebRTC-BweWindowSizeInPackets/Enabled-<n>/", which sets `windowSize`).
// Call validate() to apply the upstream range checks.
export class TrendlineEstimatorSettings {
  static readonly kDefaultTrendlineWindowSize: u32 = 20;

  // Sort the packets in the window. Should be redundant,
  // but then almost no cost.
  enableSort: bool = false;

  // Cap the trendline slope based on the minimum delay seen
  // in the beginning_packets and end_packets respectively.
  enableCap: bool = false;
  beginningPackets: u32 = 7;
  endPackets: u32 = 7;
  capUncertainty: f64 = 0.0;

  // Size (in packets) of the window.
  windowSize: u32 = TrendlineEstimatorSettings.kDefaultTrendlineWindowSize;

  validate(): TrendlineEstimatorSettings {
    if (this.windowSize < 10 || this.windowSize > 200) {
      // Window size must be between 10 and 200 packets.
      this.windowSize = TrendlineEstimatorSettings.kDefaultTrendlineWindowSize;
    }
    if (this.enableCap) {
      if (this.beginningPackets < 1 || this.endPackets < 1 ||
          this.beginningPackets > this.windowSize || this.endPackets > this.windowSize) {
        // Size of beginning and end must be between 1 and window_size.
        this.enableCap = false;
        this.beginningPackets = this.endPackets = 0;
        this.capUncertainty = 0.0;
      }
      if (this.beginningPackets + this.endPackets > this.windowSize) {
        // Size of beginning plus end can't exceed the window size.
        this.enableCap = false;
        this.beginningPackets = this.endPackets = 0;
        this.capUncertainty = 0.0;
      }
      if (this.capUncertainty < 0.0 || 0.025 < this.capUncertainty) {
        // Cap uncertainty must be between 0 and 0.025.
        this.capUncertainty = 0.0;
      }
    }
    return this;
  }
}

// TrendlineEstimator::PacketTiming.
export class PacketTiming {
  constructor(
    public arrivalTimeMs: f64,
    public smoothedDelayMs: f64,
    public rawDelayMs: f64,
  ) {}
}

// Returns NaN for std::nullopt.
function linearFitSlope(packets: PacketTiming[]): f64 {
  assert(packets.length >= 2);
  // Compute the "center of mass".
  let sumX: f64 = 0;
  let sumY: f64 = 0;
  for (let i = 0; i < packets.length; ++i) {
    sumX += packets[i].arrivalTimeMs;
    sumY += packets[i].smoothedDelayMs;
  }
  const xAvg = sumX / <f64>packets.length;
  const yAvg = sumY / <f64>packets.length;
  // Compute the slope k = \sum (x_i-x_avg)(y_i-y_avg) / \sum (x_i-x_avg)^2
  let numerator: f64 = 0;
  let denominator: f64 = 0;
  for (let i = 0; i < packets.length; ++i) {
    const x = packets[i].arrivalTimeMs;
    const y = packets[i].smoothedDelayMs;
    numerator += (x - xAvg) * (y - yAvg);
    denominator += (x - xAvg) * (x - xAvg);
  }
  if (denominator == 0) return NaN;
  return numerator / denominator;
}

// Returns NaN for std::nullopt.
function computeSlopeCap(packets: PacketTiming[], settings: TrendlineEstimatorSettings): f64 {
  const size = <u32>packets.length;
  assert(1 <= settings.beginningPackets && settings.beginningPackets < size);
  assert(1 <= settings.endPackets && settings.endPackets < size);
  assert(settings.beginningPackets + settings.endPackets <= size);
  let early = packets[0];
  for (let i: u32 = 1; i < settings.beginningPackets; ++i) {
    if (packets[i].rawDelayMs < early.rawDelayMs) early = packets[i];
  }
  const lateStart = size - settings.endPackets;
  let late = packets[lateStart];
  for (let i = lateStart + 1; i < size; ++i) {
    if (packets[i].rawDelayMs < late.rawDelayMs) late = packets[i];
  }
  if (late.arrivalTimeMs - early.arrivalTimeMs < 1) {
    return NaN;
  }
  return (late.rawDelayMs - early.rawDelayMs) / (late.arrivalTimeMs - early.arrivalTimeMs) + settings.capUncertainty;
}

export class TrendlineEstimator extends DelayIncreaseDetectorInterface {
  // Parameters.
  private readonly settings: TrendlineEstimatorSettings;
  private readonly smoothingCoef: f64 = kDefaultTrendlineSmoothingCoeff;
  private readonly thresholdGain: f64 = kDefaultTrendlineThresholdGain;
  // Used by the existing threshold.
  private numOfDeltas: i32 = 0;
  // Keep the arrival times small by using the change from the first packet.
  private firstArrivalTimeMs: i64 = -1;
  // Exponential backoff filtering.
  private accumulatedDelay: f64 = 0;
  private smoothedDelay: f64 = 0;
  // Linear least squares regression (std::deque).
  private delayHist: PacketTiming[] = [];

  private readonly kUp: f64 = 0.0087;
  private readonly kDown: f64 = 0.039;
  private overusingTimeThreshold: f64 = kOverUsingTimeThreshold;
  private threshold: f64 = 12.5;
  private prevModifiedTrend: f64 = NaN;
  private lastUpdateMs: i64 = -1;
  private prevTrend: f64 = 0.0;
  private timeOverUsing: f64 = -1;
  private overuseCounter: i32 = 0;
  private hypothesis: BandwidthUsage = BandwidthUsage.kBwNormal;
  private hypothesisPredicted: BandwidthUsage = BandwidthUsage.kBwNormal;
  private readonly networkStatePredictor: NetworkStatePredictor | null;

  constructor(
    settings: TrendlineEstimatorSettings | null = null,
    networkStatePredictor: NetworkStatePredictor | null = null,
  ) {
    super();
    this.settings = (settings !== null ? settings : new TrendlineEstimatorSettings()).validate();
    this.networkStatePredictor = networkStatePredictor;
  }

  // Update the estimator with a new sample. The deltas should represent deltas
  // between timestamp groups as defined by the InterArrival class.
  update(
    recvDeltaMs: f64,
    sendDeltaMs: f64,
    sendTimeMs: i64,
    arrivalTimeMs: i64,
    packetSize: usize,
    calculatedDeltas: bool,
  ): void {
    if (calculatedDeltas) {
      this.updateTrendline(recvDeltaMs, sendDeltaMs, sendTimeMs, arrivalTimeMs, packetSize);
    }
    const predictor = this.networkStatePredictor;
    if (predictor !== null) {
      this.hypothesisPredicted = predictor.update(sendTimeMs, arrivalTimeMs, this.hypothesis);
    }
  }

  updateTrendline(recvDeltaMs: f64, sendDeltaMs: f64, sendTimeMs: i64, arrivalTimeMs: i64, packetSize: usize): void {
    const deltaMs = recvDeltaMs - sendDeltaMs;
    ++this.numOfDeltas;
    this.numOfDeltas = min(this.numOfDeltas, kDeltaCounterMax);
    if (this.firstArrivalTimeMs == -1) this.firstArrivalTimeMs = arrivalTimeMs;

    // Exponential backoff filter.
    this.accumulatedDelay += deltaMs;
    this.smoothedDelay = this.smoothingCoef * this.smoothedDelay + (1 - this.smoothingCoef) * this.accumulatedDelay;

    // Maintain packet window
    const hist = this.delayHist;
    hist.push(new PacketTiming(<f64>(arrivalTimeMs - this.firstArrivalTimeMs), this.smoothedDelay, this.accumulatedDelay));
    if (this.settings.enableSort) {
      for (let i = hist.length - 1; i > 0 && hist[i].arrivalTimeMs < hist[i - 1].arrivalTimeMs; --i) {
        const tmp = hist[i];
        hist[i] = hist[i - 1];
        hist[i - 1] = tmp;
      }
    }
    if (<u32>hist.length > this.settings.windowSize) hist.shift();

    // Simple linear regression.
    let trend = this.prevTrend;
    if (<u32>hist.length == this.settings.windowSize) {
      // Update trend_ if it is possible to fit a line to the data. The delay
      // trend can be seen as an estimate of (send_rate - capacity)/capacity.
      // 0 < trend < 1   ->  the delay increases, queues are filling up
      //   trend == 0    ->  the delay does not change
      //   trend < 0     ->  the delay decreases, queues are being emptied
      const slope = linearFitSlope(hist);
      if (!isNaN(slope)) trend = slope;
      if (this.settings.enableCap) {
        const cap = computeSlopeCap(hist, this.settings);
        // We only use the cap to filter out overuse detections, not
        // to detect additional underuses.
        if (trend >= 0 && !isNaN(cap) && trend > cap) {
          trend = cap;
        }
      }
    }
    this.detect(trend, sendDeltaMs, arrivalTimeMs);
  }

  state(): BandwidthUsage {
    return this.networkStatePredictor !== null ? this.hypothesisPredicted : this.hypothesis;
  }

  private detect(trend: f64, tsDelta: f64, nowMs: i64): void {
    if (this.numOfDeltas < 2) {
      this.hypothesis = BandwidthUsage.kBwNormal;
      return;
    }
    const modifiedTrend = <f64>min(this.numOfDeltas, kMinNumDeltas) * trend * this.thresholdGain;
    this.prevModifiedTrend = modifiedTrend;
    if (modifiedTrend > this.threshold) {
      if (this.timeOverUsing == -1) {
        // Initialize the timer. Assume that we've been
        // over-using half of the time since the previous
        // sample.
        this.timeOverUsing = tsDelta / 2;
      } else {
        // Increment timer
        this.timeOverUsing += tsDelta;
      }
      this.overuseCounter++;
      if (this.timeOverUsing > this.overusingTimeThreshold && this.overuseCounter > 1) {
        if (trend >= this.prevTrend) {
          this.timeOverUsing = 0;
          this.overuseCounter = 0;
          this.hypothesis = BandwidthUsage.kBwOverusing;
        }
      }
    } else if (modifiedTrend < -this.threshold) {
      this.timeOverUsing = -1;
      this.overuseCounter = 0;
      this.hypothesis = BandwidthUsage.kBwUnderusing;
    } else {
      this.timeOverUsing = -1;
      this.overuseCounter = 0;
      this.hypothesis = BandwidthUsage.kBwNormal;
    }
    this.prevTrend = trend;
    this.updateThreshold(modifiedTrend, nowMs);
  }

  private updateThreshold(modifiedTrend: f64, nowMs: i64): void {
    if (this.lastUpdateMs == -1) this.lastUpdateMs = nowMs;

    if (Math.abs(modifiedTrend) > this.threshold + kMaxAdaptOffsetMs) {
      // Avoid adapting the threshold to big latency spikes, caused e.g.,
      // by a sudden capacity drop.
      this.lastUpdateMs = nowMs;
      return;
    }

    const k = Math.abs(modifiedTrend) < this.threshold ? this.kDown : this.kUp;
    const kMaxTimeDeltaMs: i64 = 100;
    const timeDeltaMs = min(nowMs - this.lastUpdateMs, kMaxTimeDeltaMs);
    this.threshold += k * (Math.abs(modifiedTrend) - this.threshold) * <f64>timeDeltaMs;
    // SafeClamp(threshold_, 6.f, 600.f)
    this.threshold = min(max(this.threshold, 6.0), 600.0);
    this.lastUpdateMs = nowMs;
  }
}
