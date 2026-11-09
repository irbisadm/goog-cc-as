// Port of modules/congestion_controller/goog_cc/trendline_estimator_unittest.cc @ M154.
import {BandwidthUsage} from "../../../../../assembly/api/transport/bandwidth-usage";
import {TrendlineEstimator} from "../../../../../assembly/modules/congestion-controller/goog-cc/trendline-estimator";
import {expectEq} from "../../../expect";

const kPacketCount: i32 = 25;
const kPacketSizeBytes: usize = 1200;

// PacketTimeGenerator: initial_clock + time_between_packets * packets++.
function generate(initialClock: i64, timeBetweenPackets: f64): i64[] {
  const times = new Array<i64>(kPacketCount);
  for (let i = 0; i < kPacketCount; ++i) {
    times[i] = <i64>(<f64>initialClock + timeBetweenPackets * <f64>i);
  }
  return times;
}

class TrendlineEstimatorTest {
  sendTimes: i64[] = [];
  recvTimes: i64[] = [];
  packetSizes: usize[] = new Array<usize>(kPacketCount).fill(kPacketSizeBytes);
  estimator: TrendlineEstimator = new TrendlineEstimator(null, null);
  count: i32 = 1;

  runTestUntilStateChange(): void {
    assert(this.count >= 1 && this.count < kPacketCount);
    const initialState = this.estimator.state();
    for (; this.count < kPacketCount; this.count++) {
      const recvDelta = <f64>(this.recvTimes[this.count] - this.recvTimes[this.count - 1]);
      const sendDelta = <f64>(this.sendTimes[this.count] - this.sendTimes[this.count - 1]);
      this.estimator.update(recvDelta, sendDelta, this.sendTimes[this.count], this.recvTimes[this.count],
        this.packetSizes[this.count], true);
      if (this.estimator.state() != initialState) {
        return;
      }
    }
  }
}

export function test_Normal(): void {
  const t = new TrendlineEstimatorTest();
  t.sendTimes = generate(123456789, 20); // 20 ms between sent packets
  t.recvTimes = generate(987654321, 20); // delivered at the same pace
  expectEq(t.estimator.state(), BandwidthUsage.kBwNormal);
  t.runTestUntilStateChange();
  expectEq(t.estimator.state(), BandwidthUsage.kBwNormal);
  expectEq(t.count, kPacketCount); // All packets processed
}

export function test_Overusing(): void {
  const t = new TrendlineEstimatorTest();
  t.sendTimes = generate(123456789, 20);
  t.recvTimes = generate(987654321, 1.1 * 20); // 10% slower delivery
  expectEq(t.estimator.state(), BandwidthUsage.kBwNormal);
  t.runTestUntilStateChange();
  expectEq(t.estimator.state(), BandwidthUsage.kBwOverusing);
  t.runTestUntilStateChange();
  expectEq(t.estimator.state(), BandwidthUsage.kBwOverusing);
  expectEq(t.count, kPacketCount);
}

export function test_Underusing(): void {
  const t = new TrendlineEstimatorTest();
  t.sendTimes = generate(123456789, 20);
  t.recvTimes = generate(987654321, 0.85 * 20); // 15% faster delivery
  expectEq(t.estimator.state(), BandwidthUsage.kBwNormal);
  t.runTestUntilStateChange();
  expectEq(t.estimator.state(), BandwidthUsage.kBwUnderusing);
  t.runTestUntilStateChange();
  expectEq(t.estimator.state(), BandwidthUsage.kBwUnderusing);
  expectEq(t.count, kPacketCount);
}

export function test_IncludesSmallPacketsByDefault(): void {
  const t = new TrendlineEstimatorTest();
  t.sendTimes = generate(123456789, 20);
  t.recvTimes = generate(987654321, 1.1 * 20);
  t.packetSizes.fill(100);
  expectEq(t.estimator.state(), BandwidthUsage.kBwNormal);
  t.runTestUntilStateChange();
  expectEq(t.estimator.state(), BandwidthUsage.kBwOverusing);
  t.runTestUntilStateChange();
  expectEq(t.estimator.state(), BandwidthUsage.kBwOverusing);
  expectEq(t.count, kPacketCount);
}
