// Port of modules/congestion_controller/goog_cc/send_side_bandwidth_estimation_unittest.cc @ M154,
// plus own checks for RttBasedBackoff. RtcEventLog is not ported, so the
// event-log expectations of DoesntReapplyBitrateDecreaseWithoutFollowingRemb
// are dropped; its bitrate/loss/RTT expectations are kept.
import {DataRate, TimeDelta, Timestamp} from "../../../../../assembly/units";
import {
  RttBasedBackoff,
  RttBasedBackoffConfig,
  SendSideBandwidthEstimation,
} from "../../../../../assembly/modules/congestion-controller/goog-cc/send-side-bandwidth-estimation";
import {expectEq, expectFalse, expectGe, expectGt, expectLe, expectLt, expectTrue} from "../../../expect";
import {Unit} from "../../../../../assembly/units";

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

function testProbing(useDelayBased: bool): void {
  const bwe = new SendSideBandwidthEstimation();
  let nowMs: i64 = 0;
  bwe.setMinMaxBitrate(DataRate.BitsPerSec(100000), DataRate.BitsPerSec(1500000));
  bwe.setSendBitrate(DataRate.BitsPerSec(200000), Timestamp.Millis(nowMs));

  const kRembBps: i64 = 1000000;
  const kSecondRembBps: i64 = kRembBps + 500000;

  bwe.updatePacketsLost(/*packetsLost=*/0, /*numberOfPackets=*/1, Timestamp.Millis(nowMs));
  bwe.updateRtt(TimeDelta.Millis(50), Timestamp.Millis(nowMs));

  // Initial REMB applies immediately.
  if (useDelayBased) {
    bwe.updateDelayBasedEstimate(Timestamp.Millis(nowMs), DataRate.BitsPerSec(kRembBps));
  } else {
    bwe.updateReceiverEstimate(Timestamp.Millis(nowMs), DataRate.BitsPerSec(kRembBps));
  }
  bwe.updateEstimate(Timestamp.Millis(nowMs));
  expectEq(kRembBps, DataRate.bps(bwe.targetRate()));

  // Second REMB doesn't apply immediately.
  nowMs += 2001;
  if (useDelayBased) {
    bwe.updateDelayBasedEstimate(Timestamp.Millis(nowMs), DataRate.BitsPerSec(kSecondRembBps));
  } else {
    bwe.updateReceiverEstimate(Timestamp.Millis(nowMs), DataRate.BitsPerSec(kSecondRembBps));
  }
  bwe.updateEstimate(Timestamp.Millis(nowMs));
  expectEq(kRembBps, DataRate.bps(bwe.targetRate()));
}

export function test_SendSideBweTest_InitialRembWithProbing(): void {
  testProbing(false);
}

export function test_SendSideBweTest_InitialDelayBasedBweWithProbing(): void {
  testProbing(true);
}

export function test_SendSideBweTest_DoesntReapplyBitrateDecreaseWithoutFollowingRemb(): void {
  const bwe = new SendSideBandwidthEstimation();
  const kMinBitrateBps: i64 = 100000;
  const kInitialBitrateBps: i64 = 1000000;
  let nowMs: i64 = 1000;
  bwe.setMinMaxBitrate(DataRate.BitsPerSec(kMinBitrateBps), DataRate.BitsPerSec(1500000));
  bwe.setSendBitrate(DataRate.BitsPerSec(kInitialBitrateBps), Timestamp.Millis(nowMs));

  const kFractionLoss: u8 = 128;
  const kRttMs: i64 = 50;
  nowMs += 10000;

  expectEq(kInitialBitrateBps, DataRate.bps(bwe.targetRate()));
  expectEq(<u8>0, bwe.fractionLoss());
  expectEq(<i64>0, TimeDelta.ms(bwe.roundTripTime()));

  // Signal heavy loss to go down in bitrate.
  bwe.updatePacketsLost(/*packetsLost=*/50, /*numberOfPackets=*/100, Timestamp.Millis(nowMs));
  bwe.updateRtt(TimeDelta.Millis(kRttMs), Timestamp.Millis(nowMs));

  // Trigger an update 2 seconds later to not be rate limited.
  nowMs += 1000;
  bwe.updateEstimate(Timestamp.Millis(nowMs));
  expectLt(DataRate.bps(bwe.targetRate()), kInitialBitrateBps);
  // Verify that the obtained bitrate isn't hitting the min bitrate, or this
  // test doesn't make sense. If this ever happens, update the thresholds or
  // loss rates so that it doesn't hit min bitrate after one bitrate update.
  expectGt(DataRate.bps(bwe.targetRate()), kMinBitrateBps);
  expectEq(kFractionLoss, bwe.fractionLoss());
  expectEq(kRttMs, TimeDelta.ms(bwe.roundTripTime()));

  // Triggering an update shouldn't apply further downgrade nor upgrade since
  // there's no intermediate receiver block received indicating whether this is
  // currently good or not.
  const lastBitrateBps = DataRate.bps(bwe.targetRate());
  // Trigger an update 2 seconds later to not be rate limited (but it still
  // shouldn't update).
  nowMs += 1000;
  bwe.updateEstimate(Timestamp.Millis(nowMs));

  expectEq(lastBitrateBps, DataRate.bps(bwe.targetRate()));
  // The old loss rate should still be applied though.
  expectEq(kFractionLoss, bwe.fractionLoss());
  expectEq(kRttMs, TimeDelta.ms(bwe.roundTripTime()));
}

export function test_SendSideBweTest_SettingSendBitrateOverridesDelayBasedEstimate(): void {
  const bwe = new SendSideBandwidthEstimation();
  const kMinBitrateBps: i64 = 10000;
  const kMaxBitrateBps: i64 = 10000000;
  const kInitialBitrateBps: i64 = 300000;
  const kDelayBasedBitrateBps: i64 = 350000;
  const kForcedHighBitrate: i64 = 2500000;

  const nowMs: i64 = 0;

  bwe.setMinMaxBitrate(DataRate.BitsPerSec(kMinBitrateBps), DataRate.BitsPerSec(kMaxBitrateBps));
  bwe.setSendBitrate(DataRate.BitsPerSec(kInitialBitrateBps), Timestamp.Millis(nowMs));

  bwe.updateDelayBasedEstimate(Timestamp.Millis(nowMs), DataRate.BitsPerSec(kDelayBasedBitrateBps));
  bwe.updateEstimate(Timestamp.Millis(nowMs));
  expectGe(DataRate.bps(bwe.targetRate()), kInitialBitrateBps);
  expectLe(DataRate.bps(bwe.targetRate()), kDelayBasedBitrateBps);

  bwe.setSendBitrate(DataRate.BitsPerSec(kForcedHighBitrate), Timestamp.Millis(nowMs));
  expectEq(DataRate.bps(bwe.targetRate()), kForcedHighBitrate);
}

export function test_RttBasedBackoff_DefaultEnabled(): void {
  const rttBackoff = new RttBasedBackoff();
  expectTrue(Unit.isFinite(rttBackoff.rttLimit));
}

export function test_RttBasedBackoff_CanBeDisabled(): void {
  // "WebRTC-Bwe-MaxRttLimit/Disabled/"
  const config = new RttBasedBackoffConfig();
  config.disabled = true;
  const rttBackoff = new RttBasedBackoff(config);
  expectTrue(Unit.isPlusInfinity(rttBackoff.rttLimit));
}

export function test_SendSideBweTest_FractionLossIsNotOverflowed(): void {
  const bwe = new SendSideBandwidthEstimation();
  const kMinBitrateBps: i64 = 100000;
  const kInitialBitrateBps: i64 = 1000000;
  let nowMs: i64 = 1000;
  bwe.setMinMaxBitrate(DataRate.BitsPerSec(kMinBitrateBps), DataRate.BitsPerSec(1500000));
  bwe.setSendBitrate(DataRate.BitsPerSec(kInitialBitrateBps), Timestamp.Millis(nowMs));

  nowMs += 10000;

  expectEq(kInitialBitrateBps, DataRate.bps(bwe.targetRate()));
  expectEq(<u8>0, bwe.fractionLoss());

  // Signal negative loss.
  bwe.updatePacketsLost(/*packetsLost=*/-1, /*numberOfPackets=*/100, Timestamp.Millis(nowMs));
  expectEq(<u8>0, bwe.fractionLoss());
}

export function test_SendSideBweTest_RttIsAboveLimitIfRttGreaterThanLimit(): void {
  const bwe = new SendSideBandwidthEstimation();
  const nowMs: i64 = 0;
  bwe.setMinMaxBitrate(DataRate.BitsPerSec(10000), DataRate.BitsPerSec(10000000));
  bwe.setSendBitrate(DataRate.BitsPerSec(300000), Timestamp.Millis(nowMs));
  bwe.updatePropagationRtt(/*atTime=*/Timestamp.Millis(nowMs), /*propagationRtt=*/TimeDelta.Millis(5000));
  expectTrue(bwe.isRttAboveLimit());
}

export function test_SendSideBweTest_RttIsBelowLimitIfRttLessThanLimit(): void {
  const bwe = new SendSideBandwidthEstimation();
  const nowMs: i64 = 0;
  bwe.setMinMaxBitrate(DataRate.BitsPerSec(10000), DataRate.BitsPerSec(10000000));
  bwe.setSendBitrate(DataRate.BitsPerSec(300000), Timestamp.Millis(nowMs));
  bwe.updatePropagationRtt(/*atTime=*/Timestamp.Millis(nowMs), /*propagationRtt=*/TimeDelta.Millis(1000));
  expectFalse(bwe.isRttAboveLimit());
}

// Not upstream: pins the classic loss controller arithmetic.
//  - loss 128/256 > 10%: rate * (512 - 128) / 512
//  - loss 0 after the start phase: min(history over 1 s) * 1.08 + 0.5, + 1 kbps
export function test_SendSideBweTest_LossControllerExactValues(): void {
  const bwe = new SendSideBandwidthEstimation();
  bwe.setMinMaxBitrate(DataRate.BitsPerSec(100000), DataRate.BitsPerSec(1500000));
  bwe.setSendBitrate(DataRate.BitsPerSec(1000000), Timestamp.Millis(1000));

  bwe.updatePacketsLost(/*packetsLost=*/50, /*numberOfPackets=*/100, Timestamp.Millis(11000));
  expectEq(DataRate.bps(bwe.targetRate()), <i64>750000);

  // Within the same loss report: no second decrease.
  bwe.updateEstimate(Timestamp.Millis(12000));
  expectEq(DataRate.bps(bwe.targetRate()), <i64>750000);

  // Start phase (2 s after the first report) is over; no loss -> increase.
  bwe.updatePacketsLost(/*packetsLost=*/0, /*numberOfPackets=*/100, Timestamp.Millis(13000));
  expectEq(DataRate.bps(bwe.targetRate()), <i64>811000);
}
