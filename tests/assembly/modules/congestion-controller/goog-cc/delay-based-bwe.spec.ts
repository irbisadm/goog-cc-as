// Port of modules/congestion_controller/goog_cc/delay_based_bwe_unittest.cc @ M154.
import {DataRate, TimeDelta, Unit} from "../../../../../assembly/units";
import {BandwidthUsage} from "../../../../../assembly/api/transport/bandwidth-usage";
import {PacedPacketInfo} from "../../../../../assembly/api/transport/network-types";
import {DelayBasedBweResult} from "../../../../../assembly/modules/congestion-controller/goog-cc/delay-based-bwe";
import {DelayBasedBweTest, RtpStream} from "./delay-based-bwe-unittest-helper";
import {expectEq, expectFalse, expectGt, expectLe, expectNear, expectTrue} from "../../../expect";

const kNumProbesCluster0: i32 = 5;
const kNumProbesCluster1: i32 = 8;
const kPacingInfo0 = new PacedPacketInfo(0, kNumProbesCluster0, 2000);
const kPacingInfo1 = new PacedPacketInfo(1, kNumProbesCluster1, 4000);
const kTargetUtilizationFraction: f32 = 0.95;

export function test_ProbeDetection(): void {
  const t = new DelayBasedBweTest();
  let nowMs = t.clock.timeInMilliseconds();

  // First burst sent at 8 * 1000 / 10 = 800 kbps.
  for (let i = 0; i < kNumProbesCluster0; ++i) {
    t.clock.advanceTimeMilliseconds(10);
    nowMs = t.clock.timeInMilliseconds();
    t.incomingFeedbackMs(nowMs, nowMs, 1000, kPacingInfo0);
  }
  expectTrue(t.bitrateObserver.updated());

  // Second burst sent at 8 * 1000 / 5 = 1600 kbps.
  for (let i = 0; i < kNumProbesCluster1; ++i) {
    t.clock.advanceTimeMilliseconds(5);
    nowMs = t.clock.timeInMilliseconds();
    t.incomingFeedbackMs(nowMs, nowMs, 1000, kPacingInfo1);
  }

  expectTrue(t.bitrateObserver.updated());
  expectGt(t.bitrateObserver.latestBitrate(), <u32>1500000);
}

export function test_ProbeDetectionNonPacedPackets(): void {
  const t = new DelayBasedBweTest();
  let nowMs = t.clock.timeInMilliseconds();
  // First burst sent at 8 * 1000 / 10 = 800 kbps, but with every other packet
  // not being paced which could mess things up.
  for (let i = 0; i < kNumProbesCluster0; ++i) {
    t.clock.advanceTimeMilliseconds(5);
    nowMs = t.clock.timeInMilliseconds();
    t.incomingFeedbackMs(nowMs, nowMs, 1000, kPacingInfo0);
    // Non-paced packet, arriving 5 ms after.
    t.clock.advanceTimeMilliseconds(5);
    t.incomingFeedbackMs(nowMs, nowMs, 100, new PacedPacketInfo());
  }

  expectTrue(t.bitrateObserver.updated());
  expectGt(t.bitrateObserver.latestBitrate(), <u32>800000);
}

export function test_ProbeDetectionFasterArrival(): void {
  const t = new DelayBasedBweTest();
  let nowMs = t.clock.timeInMilliseconds();
  // First burst sent at 8 * 1000 / 10 = 800 kbps.
  // Arriving at 8 * 1000 / 5 = 1600 kbps.
  let sendTimeMs: i64 = 0;
  for (let i = 0; i < kNumProbesCluster0; ++i) {
    t.clock.advanceTimeMilliseconds(1);
    sendTimeMs += 10;
    nowMs = t.clock.timeInMilliseconds();
    t.incomingFeedbackMs(nowMs, sendTimeMs, 1000, kPacingInfo0);
  }

  expectFalse(t.bitrateObserver.updated());
}

export function test_ProbeDetectionSlowerArrival(): void {
  const t = new DelayBasedBweTest();
  let nowMs = t.clock.timeInMilliseconds();
  // First burst sent at 8 * 1000 / 5 = 1600 kbps.
  // Arriving at 8 * 1000 / 7 = 1142 kbps.
  // Since the receive rate is significantly below the send rate, we expect to
  // use 95% of the estimated capacity.
  let sendTimeMs: i64 = 0;
  for (let i = 0; i < kNumProbesCluster1; ++i) {
    t.clock.advanceTimeMilliseconds(7);
    sendTimeMs += 5;
    nowMs = t.clock.timeInMilliseconds();
    t.incomingFeedbackMs(nowMs, sendTimeMs, 1000, kPacingInfo1);
  }

  expectTrue(t.bitrateObserver.updated());
  expectNear(<f64>t.bitrateObserver.latestBitrate(), <f64>kTargetUtilizationFraction * 1140000, 10000);
}

export function test_ProbeDetectionSlowerArrivalHighBitrate(): void {
  const t = new DelayBasedBweTest();
  let nowMs = t.clock.timeInMilliseconds();
  // Burst sent at 8 * 1000 / 1 = 8000 kbps.
  // Arriving at 8 * 1000 / 2 = 4000 kbps.
  // Since the receive rate is significantly below the send rate, we expect to
  // use 95% of the estimated capacity.
  let sendTimeMs: i64 = 0;
  for (let i = 0; i < kNumProbesCluster1; ++i) {
    t.clock.advanceTimeMilliseconds(2);
    sendTimeMs += 1;
    nowMs = t.clock.timeInMilliseconds();
    t.incomingFeedbackMs(nowMs, sendTimeMs, 1000, kPacingInfo1);
  }

  expectTrue(t.bitrateObserver.updated());
  expectNear(<f64>t.bitrateObserver.latestBitrate(), <f64>kTargetUtilizationFraction * 4000000, 10000);
}

export function test_InitialBehavior(): void {
  new DelayBasedBweTest().initialBehaviorTestHelper(730000);
}

export function test_InitializeResult(): void {
  const result = new DelayBasedBweResult();
  expectEq(result.delayDetectorState, BandwidthUsage.kBwNormal);
}

export function test_RateIncreaseReordering(): void {
  new DelayBasedBweTest().rateIncreaseReorderingTestHelper(730000);
}

export function test_RateIncreaseRtpTimestamps(): void {
  new DelayBasedBweTest().rateIncreaseRtpTimestampsTestHelper(617);
}

export function test_CapacityDropOneStream(): void {
  new DelayBasedBweTest().capacityDropTestHelper(1, false, 500, 0);
}

export function test_CapacityDropPosOffsetChange(): void {
  new DelayBasedBweTest().capacityDropTestHelper(1, false, 867, 30000);
}

export function test_CapacityDropNegOffsetChange(): void {
  new DelayBasedBweTest().capacityDropTestHelper(1, false, 933, -30000);
}

export function test_CapacityDropOneStreamWrap(): void {
  new DelayBasedBweTest().capacityDropTestHelper(1, true, 533, 0);
}

export function test_TestTimestampGrouping(): void {
  new DelayBasedBweTest().testTimestampGroupingTestHelper();
}

export function test_TestShortTimeoutAndWrap(): void {
  // Simulate a client leaving and rejoining the call after 35 seconds. This
  // will make abs send time wrap, so if streams aren't timed out properly
  // the next 30 seconds of packets will be out of order.
  new DelayBasedBweTest().testWrappingHelper(35);
}

export function test_TestLongTimeoutAndWrap(): void {
  // Simulate a client leaving and rejoining the call after some multiple of
  // 64 seconds later. This will cause a zero difference in abs send times due
  // to the wrap, but a big difference in arrival time, if streams aren't
  // properly timed out.
  new DelayBasedBweTest().testWrappingHelper(10 * 64);
}

export function test_TestInitialOveruse(): void {
  const t = new DelayBasedBweTest();
  const kStartBitrate = DataRate.KilobitsPerSec(300);
  const kInitialCapacity = DataRate.KilobitsPerSec(200);
  const kDummySsrc: u32 = 0;
  // High FPS to ensure that we send a lot of packets in a short time.
  const kFps: i32 = 90;

  t.streamGenerator.addStream(new RtpStream(kFps, <i32>DataRate.bps(kStartBitrate)));
  t.streamGenerator.setCapacityBps(<i32>DataRate.bps(kInitialCapacity));

  // Needed to initialize the AimdRateControl.
  t.bitrateEstimator.setStartBitrate(kStartBitrate);

  // Produce 40 frames (in 1/3 second) and give them to the estimator.
  let bitrateBps: i64 = DataRate.bps(kStartBitrate);
  let seenOveruse = false;
  for (let i = 0; i < 40; ++i) {
    const overuse = t.generateAndProcessFrame(kDummySsrc, <u32>bitrateBps);
    if (overuse) {
      expectTrue(t.bitrateObserver.updated());
      expectLe(<i64>t.bitrateObserver.latestBitrate(), DataRate.bps(kInitialCapacity));
      expectGt(<f64>t.bitrateObserver.latestBitrate(), 0.8 * <f64>DataRate.bps(kInitialCapacity));
      bitrateBps = t.bitrateObserver.latestBitrate();
      seenOveruse = true;
      break;
    } else if (t.bitrateObserver.updated()) {
      bitrateBps = t.bitrateObserver.latestBitrate();
      t.bitrateObserver.reset();
    }
  }
  expectTrue(seenOveruse);
  expectLe(<i64>t.bitrateObserver.latestBitrate(), DataRate.bps(kInitialCapacity));
  expectGt(<f64>t.bitrateObserver.latestBitrate(), 0.8 * <f64>DataRate.bps(kInitialCapacity));
}

export function test_TestTimestampPrecisionHandling(): void {
  // This test does some basic checks to make sure that timestamps with higher
  // than millisecond precision are handled properly and do not cause any
  // problems in the estimator. Specifically, previously reported in
  // webrtc:14023 and described in more details there, the rounding to the
  // nearest milliseconds caused discrepancy in the accumulated delay. This lead
  // to false-positive overuse detection.
  // Technical details of the test:
  // Send times(ms): 0.000,  9.725, 20.000, 29.725, 40.000, 49.725, ...
  // Recv times(ms): 0.500, 10.000, 20.500, 30.000, 40.500, 50.000, ...
  // Send deltas(ms):   9.750,  10.250,  9.750, 10.250,  9.750, ...
  // Recv deltas(ms):   9.500,  10.500,  9.500, 10.500,  9.500, ...
  // There is no delay building up between the send times and the receive times,
  // therefore this case should never lead to an overuse detection. However, if
  // the time deltas were accidentally rounded to the nearest milliseconds, then
  // all the send deltas would be equal to 10ms while some recv deltas would
  // round up to 11ms which would lead in a false illusion of delay build up.
  const t = new DelayBasedBweTest();
  let lastBitrate = t.bitrateObserver.latestBitrate();
  for (let i = 0; i < 1000; ++i) {
    t.clock.advanceTimeMicroseconds(500);
    t.incomingFeedback(t.clock.currentTime(), Unit.sub(t.clock.currentTime(), TimeDelta.Micros(500)), 1000,
      new PacedPacketInfo());
    t.clock.advanceTimeMicroseconds(9500);
    t.incomingFeedback(t.clock.currentTime(), Unit.sub(t.clock.currentTime(), TimeDelta.Micros(250)), 1000,
      new PacedPacketInfo());
    t.clock.advanceTimeMicroseconds(10000);

    // The bitrate should never decrease in this test.
    expectLe(lastBitrate, t.bitrateObserver.latestBitrate());
    lastBitrate = t.bitrateObserver.latestBitrate();
  }
}
