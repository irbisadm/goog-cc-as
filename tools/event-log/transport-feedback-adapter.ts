// Port of modules/congestion_controller/rtp/transport_feedback_adapter.h @ M154.
//
// Plain TypeScript for the tools (run by Node's type stripping), not part of
// the AssemblyScript library. Times and sizes are numbers in upstream units
// (microseconds, bytes); ±Infinity are the infinities. The network route is
// never changed by the log simulation, so in-flight bytes are tracked for the
// single default route (upstream keys them by NetworkRoute).

export const kNotAProbe = -1;

export class PacedPacketInfo {
  sendBitrateBps = 0;
  probeClusterId = kNotAProbe;
  probeClusterMinProbes = -1;
  probeClusterMinBytes = -1;
  probeClusterBytesSent = 0;

  clone(): PacedPacketInfo {
    return Object.assign(new PacedPacketInfo(), this);
  }
}

export class SentPacket {
  sendTime = -Infinity;
  size = 0;
  priorUnackedData = 0;
  pacingInfo = new PacedPacketInfo();
  audio = false;
  sequenceNumber = 0;
  dataInFlight = 0;

  clone(): SentPacket {
    const copy = Object.assign(new SentPacket(), this);
    copy.pacingInfo = this.pacingInfo.clone();
    return copy;
  }
}

export interface RtpPacketInfo {
  ssrc: number;
  rtpSequenceNumber: number;
  isRetransmission: boolean;
}

export class PacketResult {
  sentPacket = new SentPacket();
  receiveTime = Infinity;
  rtpPacketInfo: RtpPacketInfo | undefined = undefined;
  // RFC 8888 only.
  ecn = 0;
  arrivalTimeOffset = -Infinity;
  sentWithEct1 = false;
  reportedLostForTheFirstTime = false;
  reportedRecoveredForTheFirstTime = false;

  isReceived(): boolean {
    return Number.isFinite(this.receiveTime);
  }
}

export class TransportPacketsFeedback {
  feedbackTime = Infinity;
  dataInFlight = 0;
  transportSupportsEcn = false;
  packetFeedbacks: PacketResult[] = [];
}

// SentPacketInfo (rtc_base/network/sent_packet.h), the fields used here.
export interface SentPacketInfo {
  packetId: number; // -1 = none
  sendTimeMs: number;
  includedInFeedback: boolean;
  includedInAllocation: boolean;
  packetSizeBytes: number;
}

// The packet fields TransportFeedbackAdapter::AddPacket reads from an
// RtpPacketToSend.
export interface PacketToSend {
  transportSequenceNumber: number | undefined;
  size: number;
  audio: boolean;
  ssrc: number;
  sequenceNumber: number;
  retransmission: boolean;
  sendAsEct1: boolean;
}

class PacketFeedback {
  creationTime = -Infinity;
  sent = new SentPacket();
  ssrc = 0;
  rtpSequenceNumber = 0;
  isRetransmission = false;
  sentWithEct1 = false;
  previouslyReportedLost = false;

  clone(): PacketFeedback {
    const copy = Object.assign(new PacketFeedback(), this);
    copy.sent = this.sent.clone();
    return copy;
  }
}

// The duck-typed parts of rtc-event-log's rtcp::TransportFeedback and
// rtcp::CongestionControlFeedback used here.
export interface TransportFeedbackLike {
  getPacketStatusCount(): number;
  getBaseDelta(prevTimestamp: number): number;
  baseTime(): number;
  forAllPackets(handler: (sequenceNumber: number, deltaSinceBase: number) => void): void;
}

export interface CongestionControlFeedbackLike {
  packets(): readonly {ssrc: number; sequenceNumber: number; arrivalTimeOffset: number; ecn: number; received(): boolean}[];
  reportTimestampCompactNtp(): number;
}

// rtc_base/numerics/sequence_number_unwrapper.h, uint16_t.
export class RtpSequenceNumberUnwrapper {
  private lastUnwrapped = 0;
  private lastValue: number | undefined = undefined;

  unwrap(value: number): number {
    if (this.lastValue === undefined) {
      this.lastUnwrapped = value;
    } else {
      const forward = (value - this.lastValue) & 0xffff;
      // AheadOrAt<uint16_t>(value, last): `value - last` is computed in int.
      const aheadOrAt = value - this.lastValue === 0x8000 ? this.lastValue < value : forward < 0x8000;
      this.lastUnwrapped += aheadOrAt ? forward : forward - 0x10000;
    }
    this.lastValue = value;
    return this.lastUnwrapped;
  }
}

// std::map<int64_t, T> with the operations used: insertion order is mostly
// increasing, so a sorted key array is enough.
class SortedMap<T> {
  private keys: number[] = [];
  private values = new Map<number, T>();

  get size(): number {
    return this.keys.length;
  }
  get(key: number): T | undefined {
    return this.values.get(key);
  }
  // std::map::emplace: an existing key is kept.
  emplace(key: number, value: T): void {
    if (this.values.has(key)) return;
    const i = this.upperBound(key);
    this.keys.splice(i, 0, key);
    this.values.set(key, value);
  }
  delete(key: number): void {
    if (!this.values.delete(key)) return;
    this.keys.splice(this.lowerBound(key), 1);
  }
  firstKey(): number | undefined {
    return this.keys[0];
  }
  // Index of the first key > `key`.
  upperBound(key: number): number {
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.keys[mid] <= key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  // Index of the first key >= `key`.
  lowerBound(key: number): number {
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.keys[mid] < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  keyAt(index: number): number {
    return this.keys[index];
  }
}

const kSendTimeHistoryWindowUs = 60_000_000;

// TimeDelta::RoundDownTo(1 ms): C++ integer division truncates toward zero.
const roundDownToMs = (us: number) => Math.trunc(us / 1000) * 1000;

// modules/rtp_rtcp/source/ntp_time_util.cc
export function compactNtpIntervalToTimeDelta(compactNtpInterval: number): number {
  let value = compactNtpInterval >>> 0;
  if (value > 0x80000000) value -= 2 ** 32;
  // DivideRoundToNearest(value * 1'000'000, 1 << 16)
  const dividend = value * 1_000_000;
  const divisor = 1 << 16;
  if (dividend < 0) {
    const q = Math.trunc(dividend / divisor);
    const r = dividend - q * divisor;
    return -r > divisor / 2 ? q - 1 : q;
  }
  const q = Math.trunc(dividend / divisor);
  const r = dividend - q * divisor;
  return r > (divisor - 1) >> 1 ? q + 1 : q;
}

export class TransportFeedbackAdapter {
  private pendingUntrackedSize = 0;
  private lastSendTime = -Infinity;
  private lastUntrackedSendTime = -Infinity;
  private seqNumUnwrapper = new RtpSequenceNumberUnwrapper();
  private lastAckSeqNum = -1;
  private inFlight = 0;
  private currentOffset = -Infinity;
  private lastTransportFeedbackBaseTime = -Infinity;
  private lastFeedbackCompactNtpTime: number | undefined = undefined;
  // "ssrc:rtp_sequence_number" -> transport sequence number
  private rtpToTransportSequenceNumber = new Map<string, number>();
  private history = new SortedMap<PacketFeedback>();

  addPacket(packetToSend: PacketToSend, pacingInfo: PacedPacketInfo, overheadBytes: number, creationTime: number): void {
    const feedback = new PacketFeedback();
    feedback.creationTime = creationTime;
    feedback.sent.sequenceNumber = this.seqNumUnwrapper.unwrap(packetToSend.transportSequenceNumber ?? 0);
    feedback.sent.size = packetToSend.size + overheadBytes;
    feedback.sent.audio = packetToSend.audio;
    feedback.sent.pacingInfo = pacingInfo.clone();
    feedback.ssrc = packetToSend.ssrc;
    feedback.rtpSequenceNumber = packetToSend.sequenceNumber;
    feedback.isRetransmission = packetToSend.retransmission;
    feedback.sentWithEct1 = packetToSend.sendAsEct1;

    while (this.history.size !== 0) {
      const firstKey = this.history.firstKey() as number;
      const first = this.history.get(firstKey) as PacketFeedback;
      if (!(creationTime - first.creationTime > kSendTimeHistoryWindowUs)) break;
      // TODO(sprang): Warn if erasing (too many) old items?
      if (first.sent.sequenceNumber > this.lastAckSeqNum) this.removeInFlightPacketBytes(first);
      this.rtpToTransportSequenceNumber.delete(`${first.ssrc}:${first.rtpSequenceNumber}`);
      this.history.delete(firstKey);
    }
    const key = `${feedback.ssrc}:${feedback.rtpSequenceNumber}`;
    if (!this.rtpToTransportSequenceNumber.has(key)) {
      this.rtpToTransportSequenceNumber.set(key, feedback.sent.sequenceNumber);
    }
    this.history.emplace(feedback.sent.sequenceNumber, feedback);
  }

  processSentPacket(sentPacket: SentPacketInfo): SentPacket | undefined {
    const sendTime = sentPacket.sendTimeMs * 1000;
    // TODO(srte): Only use one way to indicate that packet feedback is used.
    if (sentPacket.includedInFeedback || sentPacket.packetId !== -1) {
      const unwrappedSeqNum = this.seqNumUnwrapper.unwrap(sentPacket.packetId);
      const packet = this.history.get(unwrappedSeqNum);
      if (packet !== undefined) {
        const packetRetransmit = Number.isFinite(packet.sent.sendTime);
        packet.sent.sendTime = sendTime;
        this.lastSendTime = Math.max(this.lastSendTime, sendTime);
        // TODO(srte): Don't do this on retransmit.
        if (this.pendingUntrackedSize !== 0) {
          packet.sent.priorUnackedData += this.pendingUntrackedSize;
          this.pendingUntrackedSize = 0;
        }
        if (!packetRetransmit) {
          if (packet.sent.sequenceNumber > this.lastAckSeqNum) this.inFlight += packet.sent.size;
          packet.sent.dataInFlight = this.getOutstandingData();
          return packet.sent.clone();
        }
      }
    } else if (sentPacket.includedInAllocation) {
      this.pendingUntrackedSize += sentPacket.packetSizeBytes;
      this.lastUntrackedSendTime = Math.max(this.lastUntrackedSendTime, sendTime);
    }
    return undefined;
  }

  processTransportFeedback(feedback: TransportFeedbackLike, feedbackReceiveTime: number): TransportPacketsFeedback | undefined {
    if (feedback.getPacketStatusCount() === 0) {
      return undefined;
    }

    if (!Number.isFinite(this.lastTransportFeedbackBaseTime)) {
      this.currentOffset = feedbackReceiveTime;
    } else {
      // TODO(srte): We shouldn't need to do rounding here.
      const delta = roundDownToMs(feedback.getBaseDelta(this.lastTransportFeedbackBaseTime));
      // Protect against assigning current_offset_ negative value.
      if (delta < 0 - this.currentOffset) {
        this.currentOffset = feedbackReceiveTime;
      } else {
        this.currentOffset += delta;
      }
    }
    this.lastTransportFeedbackBaseTime = feedback.baseTime();

    const packetResultVector: PacketResult[] = [];
    feedback.forAllPackets((sequenceNumber, deltaSinceBase) => {
      const seqNum = this.seqNumUnwrapper.unwrap(sequenceNumber);
      const packetFeedback = this.retrievePacketFeedback(seqNum, /*received=*/ Number.isFinite(deltaSinceBase));
      if (packetFeedback === undefined) {
        return;
      }
      // (Single network route: the route check always passes.)
      const result = new PacketResult();
      result.sentPacket = packetFeedback.sent;
      if (Number.isFinite(deltaSinceBase)) {
        result.receiveTime = this.currentOffset + roundDownToMs(deltaSinceBase);
      }
      result.rtpPacketInfo = {
        ssrc: packetFeedback.ssrc,
        rtpSequenceNumber: packetFeedback.rtpSequenceNumber,
        isRetransmission: packetFeedback.isRetransmission,
      };
      packetResultVector.push(result);
    });

    return this.toTransportFeedback(packetResultVector, feedbackReceiveTime, /*supports_ecn=*/ false);
  }

  processCongestionControlFeedback(
    feedback: CongestionControlFeedbackLike,
    feedbackReceiveTime: number,
  ): TransportPacketsFeedback | undefined {
    if (feedback.packets().length === 0) {
      return undefined;
    }
    if (!Number.isFinite(this.currentOffset)) {
      this.currentOffset = feedbackReceiveTime;
    }
    const feedbackDelta =
      this.lastFeedbackCompactNtpTime !== undefined
        ? compactNtpIntervalToTimeDelta((feedback.reportTimestampCompactNtp() - this.lastFeedbackCompactNtpTime) >>> 0)
        : 0;
    this.lastFeedbackCompactNtpTime = feedback.reportTimestampCompactNtp();
    if (feedbackDelta < -5_000_000) {
      this.currentOffset = feedbackReceiveTime;
    } else {
      this.currentOffset += feedbackDelta;
    }

    let supportsEcn = true;
    const packetResultVector: PacketResult[] = [];
    let minSeq: number | undefined;
    let maxSeq: number | undefined;
    for (const packetInfo of feedback.packets()) {
      const packetFeedback = this.retrievePacketFeedbackByRtp(
        packetInfo.ssrc,
        packetInfo.sequenceNumber,
        /*received=*/ Number.isFinite(packetInfo.arrivalTimeOffset),
      );
      if (packetFeedback === undefined) {
        continue;
      }
      const seq = packetFeedback.sent.sequenceNumber;
      minSeq = minSeq === undefined ? seq : Math.min(minSeq, seq);
      maxSeq = maxSeq === undefined ? seq : Math.max(maxSeq, seq);
      const result = new PacketResult();
      result.sentPacket = packetFeedback.sent;
      if (Number.isFinite(packetInfo.arrivalTimeOffset)) {
        result.receiveTime = this.currentOffset - packetInfo.arrivalTimeOffset;
        supportsEcn &&= packetInfo.ecn !== 0;
        result.arrivalTimeOffset = packetInfo.arrivalTimeOffset;
      }
      result.ecn = packetInfo.ecn;
      result.sentWithEct1 = packetFeedback.sentWithEct1;
      result.reportedRecoveredForTheFirstTime = packetInfo.received() && packetFeedback.previouslyReportedLost;
      result.reportedLostForTheFirstTime = !packetInfo.received() && !packetFeedback.previouslyReportedLost;
      result.rtpPacketInfo = {
        ssrc: packetFeedback.ssrc,
        rtpSequenceNumber: packetFeedback.rtpSequenceNumber,
        isRetransmission: packetFeedback.isRetransmission,
      };
      packetResultVector.push(result);
    }

    if (minSeq !== undefined && maxSeq !== undefined) {
      // Packets in history between the first and last reported packet that
      // were not reported are lost.
      const begin = this.history.lowerBound(minSeq);
      const end = this.history.upperBound(maxSeq);
      for (let i = begin; i < end; ++i) {
        const packetFeedback = this.history.get(this.history.keyAt(i)) as PacketFeedback;
        if (packetFeedback.previouslyReportedLost) {
          continue;
        }
        packetFeedback.previouslyReportedLost = true;
        const result = new PacketResult();
        result.sentPacket = packetFeedback.sent.clone();
        result.sentWithEct1 = packetFeedback.sentWithEct1;
        result.reportedLostForTheFirstTime = true;
        result.rtpPacketInfo = {
          ssrc: packetFeedback.ssrc,
          rtpSequenceNumber: packetFeedback.rtpSequenceNumber,
          isRetransmission: packetFeedback.isRetransmission,
        };
        packetResultVector.push(result);
      }
    }

    // absl::c_sort (not stable; sequence numbers are unique here).
    packetResultVector.sort((lhs, rhs) => lhs.sentPacket.sequenceNumber - rhs.sentPacket.sequenceNumber);
    return this.toTransportFeedback(packetResultVector, feedbackReceiveTime, supportsEcn);
  }

  getOutstandingData(): number {
    return this.inFlight;
  }

  private removeInFlightPacketBytes(packet: PacketFeedback): void {
    if (!Number.isFinite(packet.sent.sendTime)) return;
    this.inFlight -= packet.sent.size;
  }

  private toTransportFeedback(
    packetResults: PacketResult[],
    feedbackReceiveTime: number,
    supportsEcn: boolean,
  ): TransportPacketsFeedback | undefined {
    const msg = new TransportPacketsFeedback();
    msg.feedbackTime = feedbackReceiveTime;
    if (packetResults.length === 0) {
      return undefined;
    }
    msg.packetFeedbacks = packetResults;
    msg.dataInFlight = this.inFlight;
    msg.transportSupportsEcn = supportsEcn;
    return msg;
  }

  private retrievePacketFeedbackByRtp(ssrc: number, rtpSequenceNumber: number, received: boolean): PacketFeedback | undefined {
    const transportSeqNum = this.rtpToTransportSequenceNumber.get(`${ssrc}:${rtpSequenceNumber}`);
    if (transportSeqNum === undefined) {
      return undefined;
    }
    return this.retrievePacketFeedback(transportSeqNum, received);
  }

  private retrievePacketFeedback(transportSeqNum: number, received: boolean): PacketFeedback | undefined {
    if (transportSeqNum > this.lastAckSeqNum) {
      // Starts at history_.begin() if last_ack_seq_num_ < 0, since any
      // valid sequence number is >= 0.
      const begin = this.history.upperBound(this.lastAckSeqNum);
      const end = this.history.upperBound(transportSeqNum);
      for (let i = begin; i < end; ++i) {
        this.removeInFlightPacketBytes(this.history.get(this.history.keyAt(i)) as PacketFeedback);
      }
      this.lastAckSeqNum = transportSeqNum;
    }

    const packet = this.history.get(transportSeqNum);
    if (packet === undefined) {
      // No sent time for this sequence number, or it was already received.
      return undefined;
    }

    if (!Number.isFinite(packet.sent.sendTime)) {
      // TODO(srte): Fix the tests that makes this happen and make this a
      // DCHECK.
      return undefined;
    }

    const packetFeedback = packet.clone();
    if (received) {
      // Note: Lost packets are not removed from history because they might
      // be reported as received by a later feedback.
      this.rtpToTransportSequenceNumber.delete(`${packetFeedback.ssrc}:${packetFeedback.rtpSequenceNumber}`);
      this.history.delete(transportSeqNum);
    } else {
      packet.previouslyReportedLost = true;
    }
    return packetFeedback;
  }
}
