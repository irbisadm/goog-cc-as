// Port of modules/congestion_controller/goog_cc/acknowledged_bitrate_estimator_unittest.cc @ M154.
// The gmock MockBitrateEstimator is replaced by a recording subclass.
import {DataRate, DataSize, Timestamp} from "../../../../../assembly/units";
import {PacketResult} from "../../../../../assembly/api/transport/network-types";
import {Optional} from "../../../../../assembly/types/optional";
import {BitrateEstimator} from "../../../../../assembly/modules/congestion-controller/goog-cc/bitrate-estimator";
import {AcknowledgedBitrateEstimator} from "../../../../../assembly/modules/congestion-controller/goog-cc/acknowledged-bitrate-estimator";
import {expectEq, expectOptionalEq} from "../../../expect";

const kFirstArrivalTimeMs: i64 = 10;
const kFirstSendTimeMs: i64 = 10;
const kSequenceNumber: u16 = 1;
const kPayloadSize: i64 = 10;

class MockBitrateEstimator extends BitrateEstimator {
  calls: string[] = [];
  bitrateReturn: Optional<DataRate> | null = null;

  update(atTime: Timestamp, amount: DataSize, inAlr: bool): void {
    this.calls.push("Update(" + atTime.toString() + "," + amount.toString() + "," + inAlr.toString() + ")");
  }

  bitrate(): Optional<DataRate> | null {
    this.calls.push("bitrate()");
    return this.bitrateReturn;
  }

  expectFastRateChange(): void {
    this.calls.push("ExpectFastRateChange()");
  }
}

function updateCall(packet: PacketResult, inAlr: bool): string {
  return "Update(" + packet.receiveTime.toString() + "," + packet.sentPacket.size.toString() + "," + inAlr.toString() + ")";
}

function createFeedbackVector(): PacketResult[] {
  const packets: PacketResult[] = [new PacketResult(), new PacketResult()];
  packets[0].receiveTime = Timestamp.Millis(kFirstArrivalTimeMs);
  packets[0].sentPacket.sendTime = Timestamp.Millis(kFirstSendTimeMs);
  packets[0].sentPacket.sequenceNumber = kSequenceNumber;
  packets[0].sentPacket.size = DataSize.Bytes(kPayloadSize);
  packets[1].receiveTime = Timestamp.Millis(kFirstArrivalTimeMs + 10);
  packets[1].sentPacket.sendTime = Timestamp.Millis(kFirstSendTimeMs + 10);
  packets[1].sentPacket.sequenceNumber = kSequenceNumber;
  packets[1].sentPacket.size = DataSize.Bytes(kPayloadSize + 10);
  return packets;
}

function expectCalls(actual: string[], expected: string[]): void {
  expectEq(actual.join(";"), expected.join(";"));
}

export function test_UpdateBandwidth(): void {
  const mock = new MockBitrateEstimator();
  const estimator = new AcknowledgedBitrateEstimator(mock);
  const feedback = createFeedbackVector();
  estimator.incomingPacketFeedbackVector(feedback);
  expectCalls(mock.calls, [updateCall(feedback[0], false), updateCall(feedback[1], false)]);
}

export function test_ExpectFastRateChangeWhenLeftAlr(): void {
  const mock = new MockBitrateEstimator();
  const estimator = new AcknowledgedBitrateEstimator(mock);
  const feedback = createFeedbackVector();
  estimator.setAlrEndedTime(Timestamp.Millis(kFirstArrivalTimeMs + 1));
  estimator.incomingPacketFeedbackVector(feedback);
  expectCalls(mock.calls, [updateCall(feedback[0], false), "ExpectFastRateChange()", updateCall(feedback[1], false)]);
}

export function test_ReturnBitrate(): void {
  const mock = new MockBitrateEstimator();
  const estimator = new AcknowledgedBitrateEstimator(mock);
  mock.bitrateReturn = new Optional<DataRate>(DataRate.KilobitsPerSec(42));
  expectOptionalEq(estimator.bitrate(), DataRate.KilobitsPerSec(42));
  expectCalls(mock.calls, ["bitrate()"]);
}
