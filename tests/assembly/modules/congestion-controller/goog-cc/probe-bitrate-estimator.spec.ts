// Port of modules/congestion_controller/goog_cc/probe_bitrate_estimator_unittest.cc @ M154.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../../../assembly/units";
import {Optional} from "../../../../../assembly/types/optional";
import {PacedPacketInfo, PacketResult} from "../../../../../assembly/api/transport/network-types";
import {ProbeBitrateEstimator} from "../../../../../assembly/modules/congestion-controller/goog-cc/probe-bitrate-estimator";
import {expectHasValue, expectNear, expectNullopt, expectTrue} from "../../../expect";

const kDefaultMinProbes: i32 = 5;
const kDefaultMinBytes: i32 = 5000;
const kTargetUtilizationFraction: f32 = 0.95;

class TestProbeBitrateEstimator {
  measuredDataRate: Optional<DataRate> | null = null;
  estimator: ProbeBitrateEstimator = new ProbeBitrateEstimator();

  // TODO(philipel): Use PacedPacketInfo when ProbeBitrateEstimator is rewritten
  //                 to use that information.
  addPacketFeedback(
    probeClusterId: i32,
    sizeBytes: i64,
    sendTimeMs: i64,
    arrivalTimeMs: i64,
    minProbes: i32 = kDefaultMinProbes,
    minBytes: i32 = kDefaultMinBytes,
  ): void {
    const kReferenceTime = Timestamp.Seconds(1000);
    const feedback = new PacketResult();
    feedback.sentPacket.sendTime = Unit.add(kReferenceTime, TimeDelta.Millis(sendTimeMs));
    feedback.sentPacket.size = DataSize.Bytes(sizeBytes);
    feedback.sentPacket.pacingInfo = new PacedPacketInfo(probeClusterId, minProbes, minBytes);
    feedback.receiveTime = Unit.add(kReferenceTime, TimeDelta.Millis(arrivalTimeMs));
    this.measuredDataRate = this.estimator.handleProbeAndEstimateBitrate(feedback);
  }
}

export function test_OneCluster(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 1000, 0, 10);
  t.addPacketFeedback(0, 1000, 10, 20);
  t.addPacketFeedback(0, 1000, 20, 30);
  t.addPacketFeedback(0, 1000, 30, 40);

  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), 800000, 10);
}

export function test_OneClusterTooFewProbes(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 2000, 0, 10);
  t.addPacketFeedback(0, 2000, 10, 20);
  t.addPacketFeedback(0, 2000, 20, 30);

  expectNullopt(t.measuredDataRate);
}

export function test_OneClusterTooFewBytes(): void {
  const t = new TestProbeBitrateEstimator();
  const kMinBytes: i32 = 6000;
  t.addPacketFeedback(0, 800, 0, 10, kDefaultMinProbes, kMinBytes);
  t.addPacketFeedback(0, 800, 10, 20, kDefaultMinProbes, kMinBytes);
  t.addPacketFeedback(0, 800, 20, 30, kDefaultMinProbes, kMinBytes);
  t.addPacketFeedback(0, 800, 30, 40, kDefaultMinProbes, kMinBytes);
  t.addPacketFeedback(0, 800, 40, 50, kDefaultMinProbes, kMinBytes);

  expectNullopt(t.measuredDataRate);
}

export function test_SmallCluster(): void {
  const t = new TestProbeBitrateEstimator();
  const kMinBytes: i32 = 1000;
  t.addPacketFeedback(0, 150, 0, 10, kDefaultMinProbes, kMinBytes);
  t.addPacketFeedback(0, 150, 10, 20, kDefaultMinProbes, kMinBytes);
  t.addPacketFeedback(0, 150, 20, 30, kDefaultMinProbes, kMinBytes);
  t.addPacketFeedback(0, 150, 30, 40, kDefaultMinProbes, kMinBytes);
  t.addPacketFeedback(0, 150, 40, 50, kDefaultMinProbes, kMinBytes);
  t.addPacketFeedback(0, 150, 50, 60, kDefaultMinProbes, kMinBytes);
  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), 120000, 10);
}

export function test_LargeCluster(): void {
  const t = new TestProbeBitrateEstimator();
  const kMinProbes: i32 = 30;
  const kMinBytes: i32 = 312500;

  let sendTime: i64 = 0;
  let receiveTime: i64 = 5;
  for (let i: i32 = 0; i < 25; ++i) {
    t.addPacketFeedback(0, 12500, sendTime, receiveTime, kMinProbes, kMinBytes);
    ++sendTime;
    ++receiveTime;
  }
  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), 100000000, 10);
}

export function test_FastReceive(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 1000, 0, 15);
  t.addPacketFeedback(0, 1000, 10, 30);
  t.addPacketFeedback(0, 1000, 20, 35);
  t.addPacketFeedback(0, 1000, 30, 40);

  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), 800000, 10);
}

export function test_TooFastReceive(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 1000, 0, 19);
  t.addPacketFeedback(0, 1000, 10, 22);
  t.addPacketFeedback(0, 1000, 20, 25);
  t.addPacketFeedback(0, 1000, 40, 27);

  expectNullopt(t.measuredDataRate);
}

export function test_SlowReceive(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 1000, 0, 10);
  t.addPacketFeedback(0, 1000, 10, 40);
  t.addPacketFeedback(0, 1000, 20, 70);
  t.addPacketFeedback(0, 1000, 30, 85);
  // Expected send rate = 800 kbps, expected receive rate = 320 kbps.

  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), <f64>kTargetUtilizationFraction * 320000,
              10);
}

export function test_BurstReceive(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 1000, 0, 50);
  t.addPacketFeedback(0, 1000, 10, 50);
  t.addPacketFeedback(0, 1000, 20, 50);
  t.addPacketFeedback(0, 1000, 40, 50);

  expectNullopt(t.measuredDataRate);
}

export function test_MultipleClusters(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 1000, 0, 10);
  t.addPacketFeedback(0, 1000, 10, 20);
  t.addPacketFeedback(0, 1000, 20, 30);
  t.addPacketFeedback(0, 1000, 40, 60);
  // Expected send rate = 600 kbps, expected receive rate = 480 kbps.
  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), <f64>kTargetUtilizationFraction * 480000,
              10);

  t.addPacketFeedback(0, 1000, 50, 60);
  // Expected send rate = 640 kbps, expected receive rate = 640 kbps.
  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), 640000, 10);

  t.addPacketFeedback(1, 1000, 60, 70);
  t.addPacketFeedback(1, 1000, 65, 77);
  t.addPacketFeedback(1, 1000, 70, 84);
  t.addPacketFeedback(1, 1000, 75, 90);
  // Expected send rate = 1600 kbps, expected receive rate = 1200 kbps.

  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), <f64>kTargetUtilizationFraction * 1200000,
              10);
}

export function test_IgnoreOldClusters(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 1000, 0, 10);
  t.addPacketFeedback(0, 1000, 10, 20);
  t.addPacketFeedback(0, 1000, 20, 30);

  t.addPacketFeedback(1, 1000, 60, 70);
  t.addPacketFeedback(1, 1000, 65, 77);
  t.addPacketFeedback(1, 1000, 70, 84);
  t.addPacketFeedback(1, 1000, 75, 90);
  // Expected send rate = 1600 kbps, expected receive rate = 1200 kbps.

  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), <f64>kTargetUtilizationFraction * 1200000,
              10);

  // Coming in 6s later
  t.addPacketFeedback(0, 1000, 40 + 6000, 60 + 6000);

  expectNullopt(t.measuredDataRate);
}

export function test_IgnoreSizeLastSendPacket(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 1000, 0, 10);
  t.addPacketFeedback(0, 1000, 10, 20);
  t.addPacketFeedback(0, 1000, 20, 30);
  t.addPacketFeedback(0, 1000, 30, 40);
  t.addPacketFeedback(0, 1500, 40, 50);
  // Expected send rate = 800 kbps, expected receive rate = 900 kbps.

  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), 800000, 10);
}

export function test_IgnoreSizeFirstReceivePacket(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 1500, 0, 10);
  t.addPacketFeedback(0, 1000, 10, 20);
  t.addPacketFeedback(0, 1000, 20, 30);
  t.addPacketFeedback(0, 1000, 30, 40);
  // Expected send rate = 933 kbps, expected receive rate = 800 kbps.

  expectNear(<f64>DataRate.bps(expectHasValue(t.measuredDataRate)), <f64>kTargetUtilizationFraction * 800000,
              10);
}

export function test_NoLastEstimatedBitrateBps(): void {
  const t = new TestProbeBitrateEstimator();
  expectNullopt(t.estimator.fetchAndResetLastEstimatedBitrate());
}

export function test_FetchLastEstimatedBitrateBps(): void {
  const t = new TestProbeBitrateEstimator();
  t.addPacketFeedback(0, 1000, 0, 10);
  t.addPacketFeedback(0, 1000, 10, 20);
  t.addPacketFeedback(0, 1000, 20, 30);
  t.addPacketFeedback(0, 1000, 30, 40);

  const estimatedBitrate =
      t.estimator.fetchAndResetLastEstimatedBitrate();
  expectTrue(estimatedBitrate !== null);
  expectNear(<f64>DataRate.bps(expectHasValue(estimatedBitrate)), 800000, 10);
  expectNullopt(t.estimator.fetchAndResetLastEstimatedBitrate());
}

