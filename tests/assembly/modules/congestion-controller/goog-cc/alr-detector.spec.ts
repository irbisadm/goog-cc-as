// Port of modules/congestion_controller/goog_cc/alr_detector_unittest.cc @ M154.
// Field trial parsing tests are replaced by explicit configs.
import {DataRate, TimeDelta, Timestamp, Unit} from "../../../../../assembly/units";
import {SimulatedClock} from "../../../../../assembly/system-wrappers/clock";
import {createEnvironment} from "../../../../../assembly/api/environment/environment";
import {AlrDetector, AlrDetectorConfig} from "../../../../../assembly/modules/congestion-controller/goog-cc/alr-detector";
import {expectFalse, expectTrue} from "../../../expect";

const kEstimatedBitrate: DataRate = DataRate.BitsPerSec(300_000);

class SimulateOutgoingTrafficIn {
  private interval: TimeDelta = TimeDelta.MinusInfinity; // nullopt
  private usagePercentage: i32 = -1; // nullopt

  constructor(private alrDetector: AlrDetector, private clock: SimulatedClock) {}

  forTime(time: TimeDelta): SimulateOutgoingTrafficIn {
    this.interval = time;
    this.produceTraffic();
    return this;
  }

  atPercentOfEstimatedBitrate(usagePercentage: i32): SimulateOutgoingTrafficIn {
    this.usagePercentage = usagePercentage;
    this.produceTraffic();
    return this;
  }

  private produceTraffic(): void {
    if (Unit.isMinusInfinity(this.interval) || this.usagePercentage < 0) return;
    const kTimeStep = TimeDelta.Millis(10);
    for (let t = TimeDelta.Zero; t < this.interval; t = Unit.add(t, kTimeStep)) {
      this.clock.advanceTime(kTimeStep);
      // kEstimatedBitrate * usage_percentage * kTimeStep / 100
      const bytes = DataRate.mulTime(kEstimatedBitrate * this.usagePercentage, kTimeStep) / 100;
      this.alrDetector.onBytesSent(bytes, this.clock.currentTime());
    }
    // As of now all tests use interval that is a multiple of 10ms.
    assert(TimeDelta.ms(this.interval) % TimeDelta.ms(kTimeStep) == 0);
  }
}

function inAlr(detector: AlrDetector): bool {
  return detector.getApplicationLimitedRegionStartTime() !== null;
}

function newDetector(clock: SimulatedClock, config: AlrDetectorConfig | null = null): AlrDetector {
  return new AlrDetector(createEnvironment(clock), config);
}

export function test_AlrDetection(): void {
  const clock = new SimulatedClock(Timestamp.Seconds(1));
  const detector = newDetector(clock);
  detector.setEstimatedBitrate(kEstimatedBitrate);

  // Start in non-ALR state.
  expectFalse(inAlr(detector));

  // Stay in non-ALR state when usage is close to 100%.
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Seconds(1)).atPercentOfEstimatedBitrate(90);
  expectFalse(inAlr(detector));

  // Verify that we ALR starts when bitrate drops below 20%.
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Millis(1_500)).atPercentOfEstimatedBitrate(20);
  expectTrue(inAlr(detector));

  // Verify that ALR ends when usage is above 65%.
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Seconds(4)).atPercentOfEstimatedBitrate(100);
  expectFalse(inAlr(detector));
}

export function test_ShortSpike(): void {
  const clock = new SimulatedClock(Timestamp.Seconds(1));
  const detector = newDetector(clock);
  detector.setEstimatedBitrate(kEstimatedBitrate);
  expectFalse(inAlr(detector));

  // Verify that we ALR starts when bitrate drops below 20%.
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Seconds(1)).atPercentOfEstimatedBitrate(20);
  expectTrue(inAlr(detector));

  // Verify that we stay in ALR region even after a short bitrate spike.
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Millis(100)).atPercentOfEstimatedBitrate(150);
  expectTrue(inAlr(detector));

  // ALR ends when usage is above 65%.
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Seconds(3)).atPercentOfEstimatedBitrate(100);
  expectFalse(inAlr(detector));
}

export function test_BandwidthEstimateChanges(): void {
  const clock = new SimulatedClock(Timestamp.Seconds(1));
  const detector = newDetector(clock);
  detector.setEstimatedBitrate(kEstimatedBitrate);
  expectFalse(inAlr(detector));

  // ALR starts when bitrate drops below 20%.
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Seconds(1)).atPercentOfEstimatedBitrate(20);
  expectTrue(inAlr(detector));

  // When bandwidth estimate drops the detector should stay in ALR mode and quit
  // it shortly afterwards as the sender continues sending the same amount of
  // traffic. This is necessary to ensure that ProbeController can still react
  // to the BWE drop by initiating a new probe.
  detector.setEstimatedBitrate(kEstimatedBitrate / 5);
  expectTrue(inAlr(detector));
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Seconds(1)).atPercentOfEstimatedBitrate(50);
  expectFalse(inAlr(detector));
}

// Upstream: ParseAlrSpecificFieldTrial with
// "WebRTC-AlrDetectorParameters/bw_usage:90%,start:0%,stop:-10%/".
export function test_AlrSpecificConfig(): void {
  const clock = new SimulatedClock(Timestamp.Seconds(1));
  const config = new AlrDetectorConfig();
  config.bandwidthUsageRatio = 0.9;
  config.startBudgetLevelRatio = 0.0;
  config.stopBudgetLevelRatio = -0.1;
  const detector = newDetector(clock, config);
  detector.setEstimatedBitrate(kEstimatedBitrate);
  expectFalse(inAlr(detector));

  // ALR does not start at 100% utilization.
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Seconds(1)).atPercentOfEstimatedBitrate(100);
  expectFalse(inAlr(detector));

  // ALR does start at 85% utilization.
  // Overused 10% above so it should take about 2s to reach a budget level of
  // 0%.
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Millis(2_100)).atPercentOfEstimatedBitrate(85);
  expectTrue(inAlr(detector));
}

// Not upstream: the ALR start time comes from the environment clock.
export function test_StartTimeFromEnvironmentClock(): void {
  const clock = new SimulatedClock(Timestamp.Seconds(1));
  const detector = newDetector(clock);
  detector.setEstimatedBitrate(kEstimatedBitrate);
  new SimulateOutgoingTrafficIn(detector, clock).forTime(TimeDelta.Seconds(1)).atPercentOfEstimatedBitrate(20);
  const start = detector.getApplicationLimitedRegionStartTime();
  expectTrue(start !== null);
  expectTrue(start!.value > Timestamp.Seconds(1) && start!.value <= clock.currentTime());
}
