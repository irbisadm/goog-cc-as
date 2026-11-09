// No upstream unittest for network_types; these checks pin the ported helpers.
import {DataRate, DataSize, TimeDelta, Timestamp} from "../../../../assembly/units";
import {Optional} from "../../../../assembly/types/optional";
import {EcnMarking} from "../../../../assembly/api/transport/ecn-marking";
import {
  PacerConfig,
  PacketResult,
  RtpPacketInfo,
  TransportPacketsFeedback,
} from "../../../../assembly/api/transport/network-types";
import {expectEq, expectFalse, expectTrue} from "../../expect";

export function test_PacerConfigCreate(): void {
  const config = PacerConfig.create(Timestamp.Seconds(1), DataRate.KilobitsPerSec(800), DataRate.KilobitsPerSec(80));
  expectEq(config.timeWindow, TimeDelta.Millis(40));
  expectEq(config.dataWindow, DataSize.Bytes(4000));
  expectEq(config.padWindow, DataSize.Bytes(400));
  expectEq(config.dataRate(), DataRate.KilobitsPerSec(800));
  expectEq(config.padRate(), DataRate.KilobitsPerSec(80));
}

export function test_PacerConfigZeroTimeWindowUsesOneSecond(): void {
  const config = PacerConfig.create(Timestamp.Seconds(1), DataRate.KilobitsPerSec(800), DataRate.Zero, TimeDelta.Zero);
  expectEq(config.rateWindow(), TimeDelta.Seconds(1));
  expectEq(config.dataWindow, DataSize.Bytes(100000));
  expectEq(config.dataRate(), DataRate.KilobitsPerSec(800));
}

export function test_HasPacketWithEcnCe(): void {
  const feedback = new TransportPacketsFeedback();
  feedback.packetFeedbacks.push(new PacketResult());
  expectFalse(feedback.hasPacketWithEcnCe());
  const ce = new PacketResult();
  ce.ecn = EcnMarking.kCe;
  feedback.packetFeedbacks.push(ce);
  expectTrue(feedback.hasPacketWithEcnCe());
}

export function test_SortedByReceiveTimeSkipsLost(): void {
  const feedback = new TransportPacketsFeedback();
  const a = new PacketResult();
  a.receiveTime = Timestamp.Millis(20);
  const lost = new PacketResult();
  const b = new PacketResult();
  b.receiveTime = Timestamp.Millis(10);
  feedback.packetFeedbacks = [a, lost, b];
  const sorted = feedback.sortedByReceiveTime();
  expectEq(sorted.length, 2);
  expectEq(sorted[0].receiveTime, Timestamp.Millis(10));
  expectEq(feedback.lostWithSendInfo().length, 1);
}

export function test_PacketResultCloneIsDeep(): void {
  const original = new PacketResult();
  original.sentPacket.size = DataSize.Bytes(100);
  original.arrivalTimeOffset = new Optional<TimeDelta>(TimeDelta.Millis(5));
  const info = new RtpPacketInfo();
  info.ssrc = 42;
  original.rtpPacketInfo = info;
  const copy = original.clone();
  copy.sentPacket.size = DataSize.Bytes(1);
  copy.arrivalTimeOffset!.value = TimeDelta.Zero;
  copy.rtpPacketInfo!.ssrc = 1;
  expectEq(original.sentPacket.size, DataSize.Bytes(100));
  expectEq(original.arrivalTimeOffset!.value, TimeDelta.Millis(5));
  expectEq(original.rtpPacketInfo!.ssrc, <u32>42);
}
