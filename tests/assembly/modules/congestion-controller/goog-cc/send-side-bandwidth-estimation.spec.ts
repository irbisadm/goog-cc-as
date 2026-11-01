// Tests for the helper classes of send_side_bandwidth_estimation.cc
// (upstream only tests SendSideBandwidthEstimation itself, not yet ported).
import {DataRate, TimeDelta, Timestamp} from "../../../../../assembly/units";
import {
  RttBasedBackoff,
  RttBasedBackoffConfig,
} from "../../../../../assembly/modules/congestion-controller/goog-cc/send-side-bandwidth-estimation";
import {expectEq, expectFalse, expectGt, expectTrue} from "../../../expect";

export function test_RttBasedBackoff_NeverTriggersWithoutFeedback(): void {
  const backoff = new RttBasedBackoff();
  expectEq(backoff.rttLimit, TimeDelta.Seconds(3));
  backoff.lastPacketSent = Timestamp.Seconds(100);
  expectFalse(backoff.isRttAboveLimit());
}

export function test_RttBasedBackoff_TriggersAboveLimit(): void {
  const backoff = new RttBasedBackoff();
  backoff.updatePropagationRtt(Timestamp.Seconds(10), TimeDelta.Seconds(1));
  backoff.lastPacketSent = Timestamp.Seconds(10);
  expectFalse(backoff.isRttAboveLimit());
  // Packets keep being sent without new RTT updates: the corrected RTT grows.
  backoff.lastPacketSent = Timestamp.Millis(12001);
  expectTrue(backoff.isRttAboveLimit());
}

export function test_RttBasedBackoff_Disabled(): void {
  const config = new RttBasedBackoffConfig();
  config.disabled = true;
  const backoff = new RttBasedBackoff(config);
  expectEq(backoff.rttLimit, TimeDelta.PlusInfinity);
  backoff.updatePropagationRtt(Timestamp.Seconds(1), TimeDelta.Seconds(100));
  expectFalse(backoff.isRttAboveLimit());
  expectGt(backoff.bandwidthFloor, DataRate.Zero);
}
