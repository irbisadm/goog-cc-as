// Port of part of modules/congestion_controller/rtp/transport_feedback_adapter_unittest.cc @ M154
// (both feedback formats, as the upstream test parameter). Feedback packets
// are built with the rtc-event-log RTCP classes; skipped without the parser.

import assert from "node:assert/strict";
import {describe, test} from "node:test";

import {loadRtcEventLog} from "./rtc-event-log.ts";
import {PacedPacketInfo, type PacketResult, TransportFeedbackAdapter} from "./transport-feedback-adapter.ts";

const lib = await loadRtcEventLog();
const skip = lib === null ? "rtc-event-log not available" : false;

const ms = (v: number) => v * 1000;
const kPacingInfo0 = Object.assign(new PacedPacketInfo(), {probeClusterId: 0, probeClusterMinProbes: 5, probeClusterMinBytes: 2000});
const TimeNow = () => ms(1234);

interface PacketTemplate {
  ssrc: number;
  transportSequenceNumber: number;
  rtpSequenceNumber: number;
  packetSize: number;
  sendTimestamp: number;
  pacingInfo: PacedPacketInfo;
  receiveTimestamp: number;
}

const template = (p: Partial<PacketTemplate>): PacketTemplate => ({
  ssrc: 1,
  transportSequenceNumber: 0,
  rtpSequenceNumber: 2,
  packetSize: 100,
  sendTimestamp: 0,
  pacingInfo: new PacedPacketInfo(),
  receiveTimestamp: -Infinity,
  ...p,
});

function createPacketTemplates(numberOfSsrcs: number, packetsPerSsrc: number, firstTransportSequenceNumber = 99): PacketTemplate[] {
  let transportSequenceNumber = firstTransportSequenceNumber;
  let sendTime = ms(200);
  let receiveTime = ms(100);
  const packets: PacketTemplate[] = [];
  for (let ssrc = 3; ssrc < 3 + numberOfSsrcs; ++ssrc) {
    for (let rtpSequenceNumber = ssrc * 10; rtpSequenceNumber < ssrc * 10 + packetsPerSsrc; ++rtpSequenceNumber) {
      packets.push(
        template({
          ssrc,
          transportSequenceNumber: transportSequenceNumber++,
          rtpSequenceNumber,
          sendTimestamp: sendTime,
          pacingInfo: kPacingInfo0,
          receiveTimestamp: receiveTime,
        }),
      );
      sendTime += ms(10);
      receiveTime += ms(13);
    }
  }
  return packets;
}

function comparePacketFeedbackVectors(truth: PacketTemplate[], input: PacketResult[]): void {
  assert.equal(input.length, truth.length);
  const arrivalTimeDelta = truth[0].receiveTimestamp - input[0].receiveTime;
  truth.forEach((t, i) => {
    assert.equal(input[i].isReceived(), Number.isFinite(t.receiveTimestamp));
    if (input[i].isReceived()) {
      assert.equal(t.receiveTimestamp - input[i].receiveTime, arrivalTimeDelta);
    }
    assert.equal(input[i].sentPacket.sendTime, t.sendTimestamp);
    assert.equal(input[i].sentPacket.sequenceNumber, t.transportSequenceNumber);
    assert.equal(input[i].sentPacket.size, t.packetSize);
    assert.deepEqual(input[i].sentPacket.pacingInfo, t.pacingInfo);
    assert.equal(input[i].rtpPacketInfo?.rtpSequenceNumber, t.rtpSequenceNumber);
    assert.equal(input[i].rtpPacketInfo?.ssrc, t.ssrc);
    assert.equal(input[i].rtpPacketInfo?.isRetransmission, false);
  });
}

function addAndSend(adapter: TransportFeedbackAdapter, p: PacketTemplate) {
  adapter.addPacket(
    {
      transportSequenceNumber: p.transportSequenceNumber & 0xffff,
      size: p.packetSize,
      audio: false,
      ssrc: p.ssrc,
      sequenceNumber: p.rtpSequenceNumber,
      retransmission: false,
      sendAsEct1: true,
    },
    p.pacingInfo,
    /*overhead=*/ 0,
    TimeNow(),
  );
  return adapter.processSentPacket({
    packetId: p.transportSequenceNumber & 0xffff,
    sendTimeMs: p.sendTimestamp / 1000,
    includedInFeedback: false,
    includedInAllocation: false,
    packetSizeBytes: 0,
  });
}

for (const rfc8888 of [false, true]) {
  const name = rfc8888 ? "CongestionControlFeedback" : "TransportFeedback";

  function createAndProcessFeedback(packets: PacketTemplate[], adapter: TransportFeedbackAdapter, receiveTime = TimeNow()) {
    if (rfc8888) {
      let feedbackSentTime = -Infinity;
      for (let i = packets.length - 1; i >= 0; --i) {
        if (Number.isFinite(packets[i].receiveTimestamp)) {
          feedbackSentTime = packets[i].receiveTimestamp;
          break;
        }
      }
      const infos = packets.map(
        (p) =>
          new lib.CongestionControlPacketInfo(
            p.ssrc,
            p.rtpSequenceNumber,
            Number.isFinite(p.receiveTimestamp) ? feedbackSentTime - p.receiveTimestamp : -Infinity,
          ),
      );
      const compactNtp = Math.floor((feedbackSentTime * 65536) / 1e6) >>> 0;
      return adapter.processCongestionControlFeedback(new lib.CongestionControlFeedback(infos, compactNtp), receiveTime);
    }
    const feedback = new lib.TransportFeedback();
    feedback.setBase(packets[0].transportSequenceNumber & 0xffff, packets[0].receiveTimestamp);
    for (const p of packets) {
      if (Number.isFinite(p.receiveTimestamp)) {
        assert.ok(feedback.addReceivedPacket(p.transportSequenceNumber & 0xffff, p.receiveTimestamp));
      }
    }
    return adapter.processTransportFeedback(feedback, receiveTime);
  }

  describe(`TransportFeedbackAdapterTest/${name}`, {skip}, () => {
    test("AdaptsFeedbackAndPopulatesSendTimes", () => {
      const adapter = new TransportFeedbackAdapter();
      const packets = createPacketTemplates(2, 3);
      for (const p of packets) addAndSend(adapter, p);
      const adapted = createAndProcessFeedback(packets, adapter);
      comparePacketFeedbackVectors(packets, adapted!.packetFeedbacks);
    });

    test("FeedbackVectorReportsUnreceived", () => {
      const adapter = new TransportFeedbackAdapter();
      const sentPackets = createPacketTemplates(2, 3);
      for (const p of sentPackets) addAndSend(adapter, p);
      // Note: Important to include the last packet, as only unreceived packets
      // in between received packets can be inferred.
      sentPackets[1].receiveTimestamp = Infinity;
      sentPackets[4].receiveTimestamp = Infinity;
      const adapted = createAndProcessFeedback(sentPackets, adapter);
      comparePacketFeedbackVectors(sentPackets, adapted!.packetFeedbacks);
    });

    test("HandlesDroppedPackets", () => {
      const adapter = new TransportFeedbackAdapter();
      const packets = createPacketTemplates(2, 2, /*first_transport_sequence_number=*/ 0);
      const kSendSideDropBefore = 1;
      const kReceiveSideDropAfter = 3;
      const sentPackets = packets.filter((p) => p.transportSequenceNumber >= kSendSideDropBefore);
      for (const p of sentPackets) addAndSend(adapter, p);
      const receivedPackets = packets.filter((p) => p.transportSequenceNumber <= kReceiveSideDropAfter);
      const adapted = createAndProcessFeedback(receivedPackets, adapter);
      comparePacketFeedbackVectors(packets.slice(kSendSideDropBefore, kReceiveSideDropAfter + 1), adapted!.packetFeedbacks);
    });

    test("ProcessSentPacketIncreaseOutstandingData", () => {
      const adapter = new TransportFeedbackAdapter();
      const packet1 = template({transportSequenceNumber: 1, packetSize: 200});
      const packet2 = template({transportSequenceNumber: 2, packetSize: 300});
      const sent1 = addAndSend(adapter, packet1);
      assert.ok(sent1);
      assert.equal(sent1.sequenceNumber, packet1.transportSequenceNumber);
      assert.equal(sent1.dataInFlight, packet1.packetSize);
      assert.equal(adapter.getOutstandingData(), packet1.packetSize);
      const sent2 = addAndSend(adapter, packet2);
      assert.ok(sent2);
      assert.equal(sent2.dataInFlight, packet1.packetSize + packet2.packetSize);
      assert.equal(adapter.getOutstandingData(), packet1.packetSize + packet2.packetSize);
    });

    test("TransportPacketFeedbackHasDataInFlight", () => {
      const adapter = new TransportFeedbackAdapter();
      const packets = [
        template({transportSequenceNumber: 1, rtpSequenceNumber: 101, packetSize: 200, sendTimestamp: ms(100), pacingInfo: kPacingInfo0, receiveTimestamp: ms(200)}),
        template({transportSequenceNumber: 2, rtpSequenceNumber: 102, packetSize: 300, sendTimestamp: ms(110), pacingInfo: kPacingInfo0, receiveTimestamp: ms(210)}),
      ];
      for (const p of packets) addAndSend(adapter, p);
      const adapted1 = createAndProcessFeedback([packets[0]], adapter);
      const adapted2 = createAndProcessFeedback([packets[1]], adapter);
      assert.equal(adapted1!.dataInFlight, packets[1].packetSize);
      assert.equal(adapted2!.dataInFlight, 0);
    });
  });
}
