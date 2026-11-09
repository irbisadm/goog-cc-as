// Port of modules/congestion_controller/goog_cc/loss_based_bwe_v2_test.cc @ M154.
// Test bodies were translated mechanically from upstream; field trial strings
// are kept and turned into LossBasedBweV2Config by
// loss-based-bwe-v2-test-config.ts.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../../../assembly/units";
import {PacketResult} from "../../../../../assembly/api/transport/network-types";
import {
  LossBasedBweV2,
  LossBasedBweV2Config,
  LossBasedBweV2Result,
  LossBasedState,
} from "../../../../../assembly/modules/congestion-controller/goog-cc/loss-based-bwe-v2";
import {lossBasedBweV2ConfigFromFieldTrials} from "./loss-based-bwe-v2-test-config";
import {expectDoubleEq, expectEq, expectFalse, expectGe, expectGt, expectLe, expectLt, expectNe, expectNear, expectTrue} from "../../../expect";

const kObservationDurationLowerBound: TimeDelta = TimeDelta.Millis(250);
const kDelayedIncreaseWindow: TimeDelta = TimeDelta.Millis(300);
const kMaxIncreaseFactor: f64 = 1.5;
const kPacketSize: i32 = 15_000;

function makePacketResults(n: i32): PacketResult[] {
  const packets = new Array<PacketResult>(n);
  for (let i = 0; i < n; ++i) packets[i] = new PacketResult();
  return packets;
}

class LossBasedBweV2Test {
  private transportSequenceNumber: i64 = 0;

  config(enabled: bool, valid: bool): LossBasedBweV2Config {
    let configString = "WebRTC-Bwe-LossBasedBweV2/";
    configString += enabled ? "Enabled:true" : "Enabled:false";
    configString += valid ? ",BwRampupUpperBoundFactor:1.2" : ",BwRampupUpperBoundFactor:0.0";
    configString +=
      ",CandidateFactors:1.1|1.0|0.95,HigherBwBiasFactor:0.01," +
      "InherentLossLowerBound:0.001,InherentLossUpperBoundBwBalance:" +
      "14kbps," +
      "InherentLossUpperBoundOffset:0.9,InitialInherentLossEstimate:0.01," +
      "NewtonIterations:2,NewtonStepSize:0.4,ObservationWindowSize:15," +
      "SendingRateSmoothingFactor:0.01," +
      "InstantUpperBoundTemporalWeightFactor:0.97," +
      "InstantUpperBoundBwBalance:90kbps," +
      "InstantUpperBoundLossOffset:0.1,TemporalWeightFactor:0.98," +
      "MinNumObservations:1";
    configString += ",ObservationDurationLowerBound:" + TimeDelta.ms(kObservationDurationLowerBound).toString() + "ms";
    configString += ",MaxIncreaseFactor:1.500000"; // AppendFormat("%f", kMaxIncreaseFactor)
    configString += ",DelayedIncreaseWindow:" + TimeDelta.ms(kDelayedIncreaseWindow).toString() + "ms";
    configString += "/";
    return lossBasedBweV2ConfigFromFieldTrials(configString);
  }

  shortObservationConfig(customConfig: string): LossBasedBweV2Config {
    return lossBasedBweV2ConfigFromFieldTrials(
      "WebRTC-Bwe-LossBasedBweV2/MinNumObservations:1,ObservationWindowSize:2," + customConfig + "/");
  }

  createPacketResultsWithReceivedPackets(firstPacketTimestamp: Timestamp): PacketResult[] {
    const f = makePacketResults(2);
    f[0].sentPacket.sequenceNumber = this.transportSequenceNumber++;
    f[1].sentPacket.sequenceNumber = this.transportSequenceNumber++;
    f[0].sentPacket.size = DataSize.Bytes(kPacketSize);
    f[1].sentPacket.size = DataSize.Bytes(kPacketSize);
    f[0].sentPacket.sendTime = firstPacketTimestamp;
    f[1].sentPacket.sendTime = Unit.add(firstPacketTimestamp, kObservationDurationLowerBound);
    f[0].receiveTime = Unit.add(firstPacketTimestamp, kObservationDurationLowerBound);
    f[1].receiveTime = Unit.add(firstPacketTimestamp, 2 * kObservationDurationLowerBound);
    return f;
  }

  createPacketResultsWith10pPacketLossRate(
    firstPacketTimestamp: Timestamp,
    lostPacketSize: DataSize = DataSize.Bytes(kPacketSize),
  ): PacketResult[] {
    const f = makePacketResults(10);
    for (let i = 0; i < f.length; ++i) {
      f[i].sentPacket.sequenceNumber = this.transportSequenceNumber++;
      f[i].sentPacket.size = DataSize.Bytes(kPacketSize);
      f[i].sentPacket.sendTime = Unit.add(firstPacketTimestamp, <i64>i * kObservationDurationLowerBound);
      f[i].receiveTime = Unit.add(firstPacketTimestamp, <i64>(i + 1) * kObservationDurationLowerBound);
    }
    f[9].receiveTime = Timestamp.PlusInfinity;
    f[9].sentPacket.size = lostPacketSize;
    return f;
  }

  createPacketResultsWith50pPacketLossRate(firstPacketTimestamp: Timestamp): PacketResult[] {
    const f = makePacketResults(2);
    f[0].sentPacket.sequenceNumber = this.transportSequenceNumber++;
    f[1].sentPacket.sequenceNumber = this.transportSequenceNumber++;
    f[0].sentPacket.size = DataSize.Bytes(kPacketSize);
    f[1].sentPacket.size = DataSize.Bytes(kPacketSize);
    f[0].sentPacket.sendTime = firstPacketTimestamp;
    f[1].sentPacket.sendTime = Unit.add(firstPacketTimestamp, kObservationDurationLowerBound);
    f[0].receiveTime = Unit.add(firstPacketTimestamp, kObservationDurationLowerBound);
    f[1].receiveTime = Timestamp.PlusInfinity;
    return f;
  }

  createPacketResultsWith100pLossRate(firstPacketTimestamp: Timestamp, numPackets: u32 = 2): PacketResult[] {
    const f = makePacketResults(<i32>numPackets);
    for (let i: u32 = 0; i < numPackets - 1; ++i) {
      f[i].sentPacket.sequenceNumber = this.transportSequenceNumber++;
      f[i].sentPacket.size = DataSize.Bytes(kPacketSize);
      f[i].sentPacket.sendTime = Unit.add(firstPacketTimestamp, TimeDelta.Millis(<i64>i * 10));
      f[i].receiveTime = Timestamp.PlusInfinity;
    }
    const last = numPackets - 1;
    f[last].sentPacket.sequenceNumber = this.transportSequenceNumber++;
    f[last].sentPacket.size = DataSize.Bytes(kPacketSize);
    f[last].sentPacket.sendTime = Unit.add(firstPacketTimestamp, kObservationDurationLowerBound);
    f[last].receiveTime = Timestamp.PlusInfinity;
    return f;
  }
}

export function test_EnabledWhenGivenValidConfigurationValues(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  expectTrue(loss_based_bandwidth_estimator.isEnabled());
}

export function test_DisabledWhenGivenDisabledConfiguration(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.config(/*enabled=*/false, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  expectFalse(loss_based_bandwidth_estimator.isEnabled());
}

export function test_DisabledWhenGivenNonValidConfigurationValues(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/false);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  expectFalse(loss_based_bandwidth_estimator.isEnabled());
}

export function test_DisabledWhenGivenNonPositiveCandidateFactor(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config_negative_candidate_factor = lossBasedBweV2ConfigFromFieldTrials(
          "WebRTC-Bwe-LossBasedBweV2/CandidateFactors:-1.3|1.1/");
  const loss_based_bandwidth_estimator_1 = new LossBasedBweV2(key_value_config_negative_candidate_factor);
  expectFalse(loss_based_bandwidth_estimator_1.isEnabled());

  const key_value_config_zero_candidate_factor = lossBasedBweV2ConfigFromFieldTrials(
      "WebRTC-Bwe-LossBasedBweV2/CandidateFactors:0.0|1.1/");
  const loss_based_bandwidth_estimator_2 = new LossBasedBweV2(key_value_config_zero_candidate_factor);
  expectFalse(loss_based_bandwidth_estimator_2.isEnabled());
}

export function test_DisabledWhenGivenConfigurationThatDoesNotAllowGeneratingCandidates(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = lossBasedBweV2ConfigFromFieldTrials(
      "WebRTC-Bwe-LossBasedBweV2/" +
      "CandidateFactors:1.0,AckedRateCandidate:false," +
      "DelayBasedCandidate:false/");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  expectFalse(loss_based_bandwidth_estimator.isEnabled());
}

export function test_ReturnsDelayBasedEstimateWhenDisabled(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.config(/*enabled=*/false, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      /*packet_results=*/[],
      /*delay_based_estimate=*/DataRate.KilobitsPerSec(100),

      /*in_alr=*/false);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(100));
}

export function test_ReturnsDelayBasedEstimateWhenWhenGivenNonValidConfigurationValues(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/false);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      /*packet_results=*/[],
      /*delay_based_estimate=*/DataRate.KilobitsPerSec(100),
      /*in_alr=*/false);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(100));
}

export function test_BandwidthEstimateGivenInitializationAndThenFeedback(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);

  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback, /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);

  expectTrue(loss_based_bandwidth_estimator.isReady());
  expectTrue(Unit.isFinite(loss_based_bandwidth_estimator.getLossBasedResult()
                  .bandwidthEstimate));
}

export function test_NoBandwidthEstimateGivenNoInitialization(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);

  expectFalse(loss_based_bandwidth_estimator.isReady());
  expectTrue(Unit.isPlusInfinity(loss_based_bandwidth_estimator.getLossBasedResult()
                  .bandwidthEstimate));
}

export function test_NoBandwidthEstimateGivenNotEnoughFeedback(): void {
  const t = new LossBasedBweV2Test();
  // Create packet results where the observation duration is less than the lower
  // bound.
  let not_enough_feedback: PacketResult[] = makePacketResults(2);
  not_enough_feedback[0].sentPacket.size = DataSize.Bytes(15_000);
  not_enough_feedback[1].sentPacket.size = DataSize.Bytes(15_000);
  not_enough_feedback[0].sentPacket.sendTime = Timestamp.Zero;
  not_enough_feedback[1].sentPacket.sendTime =
      Timestamp.Zero + kObservationDurationLowerBound / 2;
  not_enough_feedback[0].receiveTime =
      Timestamp.Zero + kObservationDurationLowerBound / 2;
  not_enough_feedback[1].receiveTime =
      Timestamp.Zero + kObservationDurationLowerBound;

  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));

  expectFalse(loss_based_bandwidth_estimator.isReady());
  expectTrue(Unit.isPlusInfinity(loss_based_bandwidth_estimator.getLossBasedResult()
                  .bandwidthEstimate));

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      not_enough_feedback, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);

  expectFalse(loss_based_bandwidth_estimator.isReady());
  expectTrue(Unit.isPlusInfinity(loss_based_bandwidth_estimator.getLossBasedResult()
                  .bandwidthEstimate));
}

export function test_SetValueIsTheEstimateUntilAdditionalFeedbackHasBeenReceived(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          2 * kObservationDurationLowerBound);

  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_1, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);

  expectNe(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(600));

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));

  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(600));

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_2, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);

  expectNe(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(600));
}

export function test_SetAcknowledgedBitrateOnlyAffectsTheBweWhenAdditionalFeedbackIsGiven(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          2 * kObservationDurationLowerBound);

  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator_1 = new LossBasedBweV2(key_value_config);
  const loss_based_bandwidth_estimator_2 = new LossBasedBweV2(key_value_config);

  loss_based_bandwidth_estimator_1.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator_2.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator_1.updateBandwidthEstimate(
      enough_feedback_1, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);
  loss_based_bandwidth_estimator_2.updateBandwidthEstimate(
      enough_feedback_1, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);

  expectEq(
      loss_based_bandwidth_estimator_1.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(660));

  loss_based_bandwidth_estimator_1.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(900));

  expectEq(
      loss_based_bandwidth_estimator_1.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(660));

  loss_based_bandwidth_estimator_1.updateBandwidthEstimate(
      enough_feedback_2, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);
  loss_based_bandwidth_estimator_2.updateBandwidthEstimate(
      enough_feedback_2, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);

  expectNe(
      loss_based_bandwidth_estimator_1.getLossBasedResult().bandwidthEstimate,
      loss_based_bandwidth_estimator_2.getLossBasedResult().bandwidthEstimate);
}

export function test_BandwidthEstimateIsCappedToBeTcpFairGivenTooHighLossRate(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback_no_received_packets: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);

  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_no_received_packets,
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);

  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(100));
}

// When network is normal, estimate can increase but never be higher than
// the delay based estimate.
export function test_BandwidthEstimateCappedByDelayBasedEstimateWhenNetworkNormal(): void {
  const t = new LossBasedBweV2Test();
  // Create two packet results, network is in normal state, 100% packets are
  // received, and no delay increase.
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          2 * kObservationDurationLowerBound);
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_1, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);
  // If the delay based estimate is infinity, then loss based estimate increases
  // and not bounded by delay based estimate.
  expectGt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_2, /*delay_based_estimate=*/DataRate.KilobitsPerSec(500),

      /*in_alr=*/false);
  // If the delay based estimate is not infinity, then loss based estimate is
  // bounded by delay based estimate.
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(500));
}

// When loss based bwe receives a strong signal of overusing and an increase in
// loss rate, it should acked bitrate for emegency backoff.
export function test_UseAckedBitrateForEmegencyBackOff(): void {
  const t = new LossBasedBweV2Test();
  // Create two packet results, first packet has 50% loss rate, second packet
  // has 100% loss rate.
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          2 * kObservationDurationLowerBound);

  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  let acked_bitrate: DataRate = DataRate.KilobitsPerSec(300);
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(acked_bitrate);
  // Update estimate when network is overusing, and 50% loss rate.
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_1, /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  // Update estimate again when network is continuously overusing, and 100%
  // loss rate.
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_2, /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  // The estimate bitrate now is backed off based on acked bitrate.
  expectLe(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      acked_bitrate);
}

// When receiving the same packet feedback, loss based bwe ignores the feedback
// and returns the current estimate.
export function test_NoBweChangeIfObservationDurationUnchanged(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(300));

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_1, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);
  let estimate_1: DataRate =
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate;

  // Use the same feedback and check if the estimate is unchanged.
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_1, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);
  let estimate_2: DataRate =
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate;
  expectEq(estimate_2, estimate_1);
}

// When receiving feedback of packets that were sent within an observation
// duration, and network is in the normal state, loss based bwe returns the
// current estimate.
export function test_NoBweChangeIfObservationDurationIsSmallAndNetworkNormal(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound - TimeDelta.Millis(1));
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_1, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);
  let estimate_1: DataRate =
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate;

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_2, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);
  let estimate_2: DataRate =
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate;
  expectEq(estimate_2, estimate_1);
}

// When receiving feedback of packets that were sent within an observation
// duration, and network is in the underusing state, loss based bwe returns the
// current estimate.
export function test_NoBweIncreaseIfObservationDurationIsSmallAndNetworkUnderusing(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound - TimeDelta.Millis(1));
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_1, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);
  let estimate_1: DataRate =
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate;

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_2, /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  let estimate_2: DataRate =
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate;
  expectLe(estimate_2, estimate_1);
}

export function test_IncreaseToDelayBasedEstimateIfNoLossOrDelayIncrease(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          2 * kObservationDurationLowerBound);
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(5000);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));

  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_1,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      delay_based_estimate);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_2,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      delay_based_estimate);
}

export function test_IncreaseByHoldFactorAfterLossBasedBweBacksOff(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("");

  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(5000);
  let acked_rate: DataRate = DataRate.KilobitsPerSec(100);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(acked_rate);

  // Create some loss to create the loss limited scenario.
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_1,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  let result_at_loss: LossBasedBweV2Result =
      loss_based_bandwidth_estimator.getLossBasedResult();

  // Network recovers after loss.
  let feedback_count: i32 = 2;
  while (loss_based_bandwidth_estimator.getLossBasedResult().state !=
         LossBasedState.kIncreaseUsingPadding) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            kObservationDurationLowerBound * feedback_count),
            delay_based_estimate,
        /*in_alr=*/false);
    feedback_count++;
  }

  let result_after_recovery: LossBasedBweV2Result =
      loss_based_bandwidth_estimator.getLossBasedResult();
  // BwRampupUpperBoundInHoldFactor is 1.2.
  expectEq(result_after_recovery.bandwidthEstimate,
            Unit.mulF(result_at_loss.bandwidthEstimate, 1.2));
}

export function test_LossBasedStateIsDelayBasedEstimateAfterNetworkRecovering(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "CandidateFactors:100|1|0.5," +
      "InstantUpperBoundBwBalance:10000kbps," +
      "MaxIncreaseFactor:100," +
      "NotIncreaseIfInherentLossLessThanAverageLoss:false");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(600);
  let acked_rate: DataRate = DataRate.KilobitsPerSec(300);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(acked_rate);

  // Create some loss to create the loss limited scenario.
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_1,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);

  // Network recovers after loss.
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound);
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_2,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDelayBasedEstimate);

  // Network recovers continuing.
  let enough_feedback_3: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound * 2);
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_3,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDelayBasedEstimate);
}

export function test_LossBasedStateIsNotDelayBasedEstimateIfDelayBasedEstimateInfinite(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "CandidateFactors:100|1|0.5," +
      "InstantUpperBoundBwBalance:10000kbps," +
      "MaxIncreaseFactor:100");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));

  // Create some loss to create the loss limited scenario.
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_1,
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);

  // Network recovers after loss.
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound);
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_2,
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  expectNe(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDelayBasedEstimate);
}

// After loss based bwe backs off, the next estimate is capped by
// a factor of acked bitrate.
export function test_IncreaseByFactorOfAckedBitrateAfterLossBasedBweBacksOff(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "LossThresholdOfHighBandwidthPreference:0.99," +
      "BwRampupUpperBoundFactor:1.2," +
      // Set InstantUpperBoundBwBalance high to disable InstantUpperBound cap.
      "InstantUpperBoundBwBalance:10000kbps,");
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(5000);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(300));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_1,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  let result: LossBasedBweV2Result =
      loss_based_bandwidth_estimator.getLossBasedResult();
  let estimate_1: DataRate = result.bandwidthEstimate;
  expectLt(<f64>DataRate.kbps(estimate_1), 600);

  loss_based_bandwidth_estimator.setAcknowledgedBitrate(Unit.mulF(estimate_1, 0.9));

  let feedback_count: i32 = 1;
  while (result.state != LossBasedState.kIncreaseUsingPadding) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            feedback_count++ * kObservationDurationLowerBound),
        delay_based_estimate,
        /*in_alr=*/false);
    result = loss_based_bandwidth_estimator.getLossBasedResult();
  }
  expectEq(result.state, LossBasedState.kIncreaseUsingPadding);

  // The estimate is capped by acked_bitrate * BwRampupUpperBoundFactor.
  expectEq(result.bandwidthEstimate, Unit.mulF(Unit.mulF(estimate_1, 0.9), 1.2));

  // But if acked bitrate decreases, BWE does not decrease when there is no
  // loss.
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(Unit.mulF(estimate_1, 0.9));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          feedback_count++ * kObservationDurationLowerBound),
      delay_based_estimate,
      /*in_alr=*/false);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      result.bandwidthEstimate);
}

// Ensure that the state can switch to kIncrease even when the bandwidth is
// bounded by acked bitrate.
export function test_EnsureIncreaseEvenIfAckedBitrateBound(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "LossThresholdOfHighBandwidthPreference:0.99," +
      "BwRampupUpperBoundFactor:1.2," +
      // Set InstantUpperBoundBwBalance high to disable InstantUpperBound cap.
      "InstantUpperBoundBwBalance:10000kbps,");
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(5000);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(300));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_1,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  let result: LossBasedBweV2Result =
      loss_based_bandwidth_estimator.getLossBasedResult();
  let estimate_1: DataRate = result.bandwidthEstimate;
  expectLt(<f64>DataRate.kbps(estimate_1), 600);

  // Set a low acked bitrate.
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(estimate_1 / 2);

  let feedback_count: i32 = 1;
  while (result.state != LossBasedState.kIncreaseUsingPadding) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            feedback_count++ * kObservationDurationLowerBound),
        delay_based_estimate,
        /*in_alr=*/false);
    result = loss_based_bandwidth_estimator.getLossBasedResult();
  }

  expectEq(result.state, LossBasedState.kIncreaseUsingPadding);
  // The estimate increases by 1kbps.
  expectEq(result.bandwidthEstimate, estimate_1 + DataRate.BitsPerSec(1));
}

// After loss based bwe backs off, the estimate is bounded during the delayed
// window.
export function test_EstimateBitrateIsBoundedDuringDelayedWindowAfterLossBasedBweBacksOff(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kDelayedIncreaseWindow - TimeDelta.Millis(2));
  let enough_feedback_3: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kDelayedIncreaseWindow - TimeDelta.Millis(1));
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(5000);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(300));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_1,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  // Increase the acknowledged bitrate to make sure that the estimate is not
  // capped too low.
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(5000));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_2,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);

  // The estimate is capped by current_estimate * kMaxIncreaseFactor because
  // it recently backed off.
  let estimate_2: DataRate =
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate;

  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_3,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  // The latest estimate is the same as the previous estimate since the sent
  // packets were sent within the DelayedIncreaseWindow.
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      estimate_2);
}

// The estimate is not bounded after the delayed increase window.
export function test_KeepIncreasingEstimateAfterDelayedIncreaseWindow(): void {
  const t = new LossBasedBweV2Test();
  let enough_feedback_1: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  let enough_feedback_2: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kDelayedIncreaseWindow - TimeDelta.Millis(1));
  let enough_feedback_3: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kDelayedIncreaseWindow + TimeDelta.Millis(1));
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(5000);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(300));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_1,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  // Increase the acknowledged bitrate to make sure that the estimate is not
  // capped too low.
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(5000));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_2,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);

  // The estimate is capped by current_estimate * kMaxIncreaseFactor because it
  // recently backed off.
  let estimate_2: DataRate =
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate;

  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_3,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);
  // The estimate can continue increasing after the DelayedIncreaseWindow.
  expectGe(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      estimate_2);
}

export function test_NotIncreaseIfInherentLossLessThanAverageLoss(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "CandidateFactors:1.2," +
      "NotIncreaseIfInherentLossLessThanAverageLoss:true");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));

  let enough_feedback_10p_loss_1: PacketResult[] =
      t.createPacketResultsWith10pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_10p_loss_1,
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);

  let enough_feedback_10p_loss_2: PacketResult[] =
      t.createPacketResultsWith10pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_10p_loss_2,
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);

  // Do not increase the bitrate because inherent loss is less than average loss
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(600));
}

export function test_SelectHighBandwidthCandidateIfLossRateIsLessThanThreshold(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "LossThresholdOfHighBandwidthPreference:0.20," +
      "NotIncreaseIfInherentLossLessThanAverageLoss:false");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(5000);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));

  let enough_feedback_10p_loss_1: PacketResult[] =
      t.createPacketResultsWith10pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_10p_loss_1, delay_based_estimate,

      /*in_alr=*/false);

  let enough_feedback_10p_loss_2: PacketResult[] =
      t.createPacketResultsWith10pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_10p_loss_2, delay_based_estimate,

      /*in_alr=*/false);

  // Because LossThresholdOfHighBandwidthPreference is 20%, the average loss is
  // 10%, bandwidth estimate should increase.
  expectGt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(600));
}

export function test_SelectLowBandwidthCandidateIfLossRateIsIsHigherThanThreshold(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("LossThresholdOfHighBandwidthPreference:0.05");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(5000);

  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));

  let enough_feedback_10p_loss_1: PacketResult[] =
      t.createPacketResultsWith10pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_10p_loss_1, delay_based_estimate,

      /*in_alr=*/false);

  let enough_feedback_10p_loss_2: PacketResult[] =
      t.createPacketResultsWith10pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_10p_loss_2, delay_based_estimate,

      /*in_alr=*/false);

  // Because LossThresholdOfHighBandwidthPreference is 5%, the average loss is
  // 10%, bandwidth estimate should decrease.
  expectLt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(600));
}

export function test_EstimateIsNotHigherThanMaxBitrate(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.config(/*enabled=*/true, /*valid=*/true);
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setMinMaxBitrate(
      /*min_bitrate=*/DataRate.KilobitsPerSec(10),
      /*max_bitrate=*/DataRate.KilobitsPerSec(1000));
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(1000));
  let enough_feedback: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback, /*delay_based_estimate=*/DataRate.PlusInfinity,

      /*in_alr=*/false);

  expectLe(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(1000));
}

export function test_NotBackOffToAckedRateInAlr(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("InstantUpperBoundBwBalance:100kbps");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setMinMaxBitrate(
      /*min_bitrate=*/DataRate.KilobitsPerSec(10),
      /*max_bitrate=*/DataRate.KilobitsPerSec(1000000));
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(5000);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));

  let acked_rate: DataRate = DataRate.KilobitsPerSec(100);
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(acked_rate);
  let enough_feedback_100p_loss_1: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_100p_loss_1, delay_based_estimate,
      /*in_alr=*/true);

  // Make sure that the estimate decreases but higher than acked rate.
  expectGt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      acked_rate);

  expectLt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(600));
}

export function test_BackOffToAckedRateIfNotInAlr(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("InstantUpperBoundBwBalance:100kbps");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setMinMaxBitrate(
      /*min_bitrate=*/DataRate.KilobitsPerSec(10),
      /*max_bitrate=*/DataRate.KilobitsPerSec(1000000));
  let delay_based_estimate: DataRate = DataRate.KilobitsPerSec(5000);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));

  let acked_rate: DataRate = DataRate.KilobitsPerSec(100);
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(acked_rate);
  let enough_feedback_100p_loss_1: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_100p_loss_1, delay_based_estimate,

      /*in_alr=*/false);

  // Make sure that the estimate decreases but higher than acked rate.
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      acked_rate);
}

export function test_NotReadyToUseInStartPhase(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("UseInStartPhase:true");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  // Make sure that the estimator is not ready to use in start phase because of
  // lacking TWCC feedback.
  expectFalse(loss_based_bandwidth_estimator.readyToUseInStartPhase());
}

export function test_ReadyToUseInStartPhase(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("UseInStartPhase:true");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  let enough_feedback: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback, /*delay_based_estimate=*/DataRate.KilobitsPerSec(600),
      /*in_alr=*/false);
  expectTrue(loss_based_bandwidth_estimator.readyToUseInStartPhase());
}

export function test_BoundEstimateByAckedRate(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("LowerBoundByAckedRateFactor:1.0");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setMinMaxBitrate(
      /*min_bitrate=*/DataRate.KilobitsPerSec(10),
      /*max_bitrate=*/DataRate.KilobitsPerSec(1000000));
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(500));

  let enough_feedback_100p_loss_1: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_100p_loss_1,
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);

  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(500));
}

export function test_NotBoundEstimateByAckedRate(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("LowerBoundByAckedRateFactor:0.0");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setMinMaxBitrate(
      /*min_bitrate=*/DataRate.KilobitsPerSec(10),
      /*max_bitrate=*/DataRate.KilobitsPerSec(1000000));
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(600));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(500));

  let enough_feedback_100p_loss_1: PacketResult[] =
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_100p_loss_1,
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);

  expectLt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(500));
}

export function test_HasDecreaseStateBecauseOfUpperBound(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "CandidateFactors:1.0,InstantUpperBoundBwBalance:10kbps");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setMinMaxBitrate(
      /*min_bitrate=*/DataRate.KilobitsPerSec(10),
      /*max_bitrate=*/DataRate.KilobitsPerSec(1000000));
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(500));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(100));

  let enough_feedback_10p_loss_1: PacketResult[] =
      t.createPacketResultsWith10pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_10p_loss_1,
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);

  // Verify that the instant upper bound decreases the estimate, and state is
  // updated to kDecreasing.
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(200));
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
}

export function test_HasIncreaseStateBecauseOfLowerBound(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "CandidateFactors:1.0,LowerBoundByAckedRateFactor:10.0");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setMinMaxBitrate(
      /*min_bitrate=*/DataRate.KilobitsPerSec(10),
      /*max_bitrate=*/DataRate.KilobitsPerSec(1000000));
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(500));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(1));

  // Network has a high loss to create a loss scenario.
  let enough_feedback_50p_loss_1: PacketResult[] =
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_50p_loss_1,
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);

  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);

  // Network still has a high loss, but better acked rate.
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(200));
  let enough_feedback_50p_loss_2: PacketResult[] =
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound * 2);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      enough_feedback_50p_loss_2,
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);

  // Verify that the instant lower bound increases the estimate, and state is
  // updated to kIncreaseUsingPadding.
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(200) * 10);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kIncreaseUsingPadding);
}

export function test_EstimateIncreaseSlowlyFromInstantUpperBoundInAlrIfFieldTrial(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("UpperBoundCandidateInAlr:true");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(1000));
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(150));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/true);
  let result_after_loss: LossBasedBweV2Result =
      loss_based_bandwidth_estimator.getLossBasedResult();
  expectEq(result_after_loss.state, LossBasedState.kDecreasing);

  for (let feedback_count: i32 = 1; feedback_count <= 3; ++feedback_count) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            feedback_count * kObservationDurationLowerBound),
        /*delay_based_estimate=*/DataRate.PlusInfinity,
        /*in_alr=*/true);
  }
  // Expect less than 100% increase.
  expectLt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      2 * result_after_loss.bandwidthEstimate);
}

export function test_HasDelayBasedStateIfLossBasedBweIsMax(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setMinMaxBitrate(
      /*min_bitrate=*/DataRate.KilobitsPerSec(10),
      /*max_bitrate=*/DataRate.KilobitsPerSec(1000));

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      /*feedback = */ t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero),
      /*delay_based_estimate=*/DataRate.KilobitsPerSec(2000),
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDelayBasedEstimate);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(1000));

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      /*feedback=*/t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound),
      /*delay_based_estimate=*/DataRate.KilobitsPerSec(2000),
      /*in_alr=*/false);
  let result: LossBasedBweV2Result =
      loss_based_bandwidth_estimator.getLossBasedResult();
  expectEq(result.state, LossBasedState.kDecreasing);
  expectLt(result.bandwidthEstimate, DataRate.KilobitsPerSec(1000));

  // Eventually  the estimator recovers to delay based state.
  let feedback_count: i32 = 2;
  while (result.state != LossBasedState.kDelayBasedEstimate) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        /*feedback = */ t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            feedback_count++ * kObservationDurationLowerBound),
        /*delay_based_estimate=*/DataRate.KilobitsPerSec(2000),
        /*in_alr=*/false);
    result = loss_based_bandwidth_estimator.getLossBasedResult();
  }
  expectEq(result.state, LossBasedState.kDelayBasedEstimate);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(1000));
}

export function test_IncreaseUsingPaddingStateIfFieldTrial(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("PaddingDuration:1000ms");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(2500));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  let feedback_count: i32 = 1;
  while (loss_based_bandwidth_estimator.getLossBasedResult().state !=
         LossBasedState.kIncreaseUsingPadding) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            kObservationDurationLowerBound * feedback_count),
        /*delay_based_estimate=*/DataRate.PlusInfinity,
        /*in_alr=*/false);
    feedback_count++;
  }
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kIncreaseUsingPadding);
}

export function test_BestCandidateResetsToUpperBoundInFieldTrial(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("PaddingDuration:1000ms,BoundBestCandidate:true");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(2500));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/true);
  let result_after_loss: LossBasedBweV2Result =
      loss_based_bandwidth_estimator.getLossBasedResult();
  expectEq(result_after_loss.state, LossBasedState.kDecreasing);

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/true);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          2 * kObservationDurationLowerBound),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/true);
  // After a BWE decrease due to large loss, BWE is expected to ramp up slowly
  // and follow the acked bitrate.
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kIncreaseUsingPadding);
  expectNear(<f64>DataRate.kbps(loss_based_bandwidth_estimator.getLossBasedResult()
                  .bandwidthEstimate),
              <f64>DataRate.kbps(result_after_loss.bandwidthEstimate), 100);
}

export function test_DecreaseToAckedCandidateIfPaddingInAlr(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "PaddingDuration:1000ms," +
      // Set InstantUpperBoundBwBalance high to disable InstantUpperBound cap.
      "InstantUpperBoundBwBalance:10000kbps");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(1000));
  let feedback_id: i32 = 0;
  while (loss_based_bandwidth_estimator.getLossBasedResult().state !=
         LossBasedState.kDecreasing) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWith100pLossRate(
            /*first_packet_timestamp=*/Timestamp.Zero +
            kObservationDurationLowerBound * feedback_id),
        /*delay_based_estimate=*/DataRate.PlusInfinity,
        /*in_alr=*/true);
    feedback_id++;
  }

  while (loss_based_bandwidth_estimator.getLossBasedResult().state !=
         LossBasedState.kIncreaseUsingPadding) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            kObservationDurationLowerBound * feedback_id),
        /*delay_based_estimate=*/DataRate.PlusInfinity,
        /*in_alr=*/true);
    feedback_id++;
  }
  expectGt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(900));

  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(100));
  // Padding is sent now, create some lost packets.
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound * feedback_id),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/true);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(100));
}

export function test_DecreaseAfterPadding(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "PaddingDuration:1000ms,BwRampupUpperBoundFactor:2.0");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(2500));
  let acknowledged_bitrate: DataRate = DataRate.KilobitsPerSec(51);
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(acknowledged_bitrate);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      acknowledged_bitrate);

  acknowledged_bitrate = DataRate.KilobitsPerSec(26);
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(acknowledged_bitrate);
  let feedback_id: i32 = 1;
  while (loss_based_bandwidth_estimator.getLossBasedResult().state !=
         LossBasedState.kIncreaseUsingPadding) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            kObservationDurationLowerBound * feedback_id),
        /*delay_based_estimate=*/DataRate.PlusInfinity,
        /*in_alr=*/false);
    feedback_id++;
  }

  const estimate_increased: Timestamp =
      Timestamp.Zero + kObservationDurationLowerBound * feedback_id;
  // The state is kIncreaseUsingPadding for a while without changing the
  // estimate, which is limited by 2 * acked rate.
  while (loss_based_bandwidth_estimator.getLossBasedResult().state ==
         LossBasedState.kIncreaseUsingPadding) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            kObservationDurationLowerBound * feedback_id),
        /*delay_based_estimate=*/DataRate.PlusInfinity,
        /*in_alr=*/false);
    feedback_id++;
  }

  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  const start_decreasing: Timestamp =
      Timestamp.Zero + kObservationDurationLowerBound * (feedback_id - 1);
  expectEq(start_decreasing - estimate_increased, TimeDelta.Seconds(1));
}


export function test_HoldRateNotLowerThanAckedRate(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig(
      "HoldDurationFactor:10,LowerBoundByAckedRateFactor:1.0");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(2500));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);

  // During the hold duration, hold rate is not lower than the acked rate.
  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(1000));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(1000));
}

export function test_EstimateNotLowerThanAckedRate(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("LowerBoundByAckedRateFactor:1.0");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(2500));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  expectLt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(1000));

  loss_based_bandwidth_estimator.setAcknowledgedBitrate(
      DataRate.KilobitsPerSec(1000));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(1000));

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound * 2),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound * 3),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);

  // Verify that the estimate recovers from the acked rate.
  expectGt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(1000));
}

export function test_EndHoldDurationIfDelayBasedEstimateWorks(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(2500));
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith50pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  let estimate: DataRate =
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate;

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound),
      /*delay_based_estimate=*/estimate + DataRate.KilobitsPerSec(10),
      /*in_alr=*/false);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound * 2),
      /*delay_based_estimate=*/estimate + DataRate.KilobitsPerSec(10),
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDelayBasedEstimate);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      estimate + DataRate.KilobitsPerSec(10));
}

export function test_UseByteLossRate(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("UseByteLossRate:true");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  loss_based_bandwidth_estimator.setBandwidthEstimate(
      DataRate.KilobitsPerSec(500));
  // Create packet feedback having 10% packet loss but more than 50% byte loss.
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith10pPacketLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero,
          /*lost_packet_size=*/DataSize.Bytes(kPacketSize * 20)),
      /*delay_based_estimate=*/DataRate.PlusInfinity,
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  // The estimate is bounded by the instant upper bound due to high loss.
  expectLt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      DataRate.KilobitsPerSec(160));
}

export function test_UseByteLossRateIgnoreLossSpike(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = lossBasedBweV2ConfigFromFieldTrials(
      "WebRTC-Bwe-LossBasedBweV2/" +
      "UseByteLossRate:true,ObservationWindowSize:5/");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  const kDelayBasedEstimate: DataRate = DataRate.KilobitsPerSec(500);
  loss_based_bandwidth_estimator.setBandwidthEstimate(kDelayBasedEstimate);

  // Fill the observation window.
  for (let i: i32 = 0; i < 5; ++i) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            i * kObservationDurationLowerBound),
        kDelayBasedEstimate,
        /*in_alr=*/false);
  }
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          5 * kObservationDurationLowerBound),
      kDelayBasedEstimate,
      /*in_alr=*/false);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          6 * kObservationDurationLowerBound),
      kDelayBasedEstimate,
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDelayBasedEstimate);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      kDelayBasedEstimate);

  // But if more loss happen in a new observation, BWE back down.
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
          7 * kObservationDurationLowerBound),
      kDelayBasedEstimate,
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  expectLt(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      kDelayBasedEstimate);
}

export function test_UseByteLossRateDoesNotIgnoreLossSpikeOnSendBurst(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = lossBasedBweV2ConfigFromFieldTrials(
      "WebRTC-Bwe-LossBasedBweV2/" +
      "UseByteLossRate:true,ObservationWindowSize:5/");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  const kDelayBasedEstimate: DataRate = DataRate.KilobitsPerSec(500);
  loss_based_bandwidth_estimator.setBandwidthEstimate(kDelayBasedEstimate);

  // Fill the observation window.
  for (let i: i32 = 0; i < 5; ++i) {
    loss_based_bandwidth_estimator.updateBandwidthEstimate(
        t.createPacketResultsWithReceivedPackets(
            /*first_packet_timestamp=*/Timestamp.Zero +
            i * kObservationDurationLowerBound),
        kDelayBasedEstimate,
        /*in_alr=*/false);
  }

  // If the loss happens when increasing sending rate, then
  // the BWE should back down.
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      t.createPacketResultsWith100pLossRate(
          /*first_packet_timestamp=*/Timestamp.Zero +
              5 * kObservationDurationLowerBound,
          /*num_packets=*/5),
      kDelayBasedEstimate,
      /*in_alr=*/false);
  expectEq(loss_based_bandwidth_estimator.getLossBasedResult().state,
            LossBasedState.kDecreasing);
  expectLe(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      kDelayBasedEstimate);
}

export function test_EstimateDoesNotBackOffDueToPacketReorderingBetweenFeedback(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  const kStartBitrate: DataRate = DataRate.KilobitsPerSec(2500);
  loss_based_bandwidth_estimator.setBandwidthEstimate(kStartBitrate);

  let feedback_1: PacketResult[] = makePacketResults(3);
  feedback_1[0].sentPacket.sequenceNumber = 1;
  feedback_1[0].sentPacket.size = DataSize.Bytes(kPacketSize);
  feedback_1[0].sentPacket.sendTime = Timestamp.Zero;
  feedback_1[0].receiveTime =
      feedback_1[0].sentPacket.sendTime + TimeDelta.Millis(10);
  feedback_1[1].sentPacket.sequenceNumber = 2;
  feedback_1[1].sentPacket.size = DataSize.Bytes(kPacketSize);
  feedback_1[1].sentPacket.sendTime = Timestamp.Zero;
  // Lost or reordered
  feedback_1[1].receiveTime = Timestamp.PlusInfinity;

  feedback_1[2].sentPacket.sequenceNumber = 3;
  feedback_1[2].sentPacket.size = DataSize.Bytes(kPacketSize);
  feedback_1[2].sentPacket.sendTime = Timestamp.Zero;
  feedback_1[2].receiveTime =
      feedback_1[2].sentPacket.sendTime + TimeDelta.Millis(10);

  let feedback_2: PacketResult[] = makePacketResults(3);
  feedback_2[0].sentPacket.sequenceNumber = 2;
  feedback_2[0].sentPacket.size = DataSize.Bytes(kPacketSize);
  feedback_2[0].sentPacket.sendTime = Timestamp.Zero;
  feedback_2[0].receiveTime =
      feedback_1[0].sentPacket.sendTime + TimeDelta.Millis(10);
  feedback_2[1].sentPacket.sequenceNumber = 4;
  feedback_2[1].sentPacket.size = DataSize.Bytes(kPacketSize);
  feedback_2[1].sentPacket.sendTime =
      Timestamp.Zero + kObservationDurationLowerBound;
  feedback_2[1].receiveTime =
      feedback_2[1].sentPacket.sendTime + TimeDelta.Millis(10);
  feedback_2[2].sentPacket.sequenceNumber = 5;
  feedback_2[2].sentPacket.size = DataSize.Bytes(kPacketSize);
  feedback_2[2].sentPacket.sendTime = Timestamp.Zero;
  feedback_2[2].receiveTime =
      feedback_2[2].sentPacket.sendTime + TimeDelta.Millis(10);

  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      feedback_1,
      /*delay_based_estimate=*/kStartBitrate,
      /*in_alr=*/false);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(
      feedback_2,
      /*delay_based_estimate=*/kStartBitrate,
      /*in_alr=*/false);
  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      kStartBitrate);
}

export function test_SelectHigherCandidateIfHavingSameObjective(): void {
  const t = new LossBasedBweV2Test();
  const key_value_config = t.shortObservationConfig("");
  const loss_based_bandwidth_estimator = new LossBasedBweV2(key_value_config);
  const kStartBitrate: DataRate = DataRate.KilobitsPerSec(1000);
  loss_based_bandwidth_estimator.setBandwidthEstimate(kStartBitrate);
  let enough_feedback_01: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero);
  let enough_feedback_02: PacketResult[] =
      t.createPacketResultsWithReceivedPackets(
          /*first_packet_timestamp=*/Timestamp.Zero +
          kObservationDurationLowerBound);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_01,
                                                         kStartBitrate,
                                                         /*in_alr=*/false);
  let delay_based_estimate: DataRate =
      // kStartBitrate.bytes_per_sec() * 1.02 + 1 is double arithmetic upstream.
      DataRate.BytesPerSec<f64>(<f64>DataRate.bytesPerSec(kStartBitrate) * 1.02 + 1);
  loss_based_bandwidth_estimator.updateBandwidthEstimate(enough_feedback_02,
                                                         delay_based_estimate,
                                                         /*in_alr=*/false);

  expectEq(
      loss_based_bandwidth_estimator.getLossBasedResult().bandwidthEstimate,
      delay_based_estimate);
}

