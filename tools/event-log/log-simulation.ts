// Port of rtc_tools/rtc_event_log_visualizer/log_simulation.h @ M154
// (LogBasedNetworkControllerSimulation), writing the controller inputs as a
// goog-cc trace v2 (tools/replay/README.md) instead of driving a controller.
// The trace replays through this port (tools/replay) and through upstream
// C++ GoogCC (tools/cpp-replay).
//
// Deviation: upstream computes the RTT of receiver reports against
// Clock::GetRealTimeClock()'s NTP time, i.e. the NTP offset of the machine and
// moment the analysis runs, which makes its output depend on when it runs.
// Here the log time is mapped to NTP with the latest outgoing sender report
// (its NTP time and log time); without one, no RTT is reported.

import {
  type CongestionControlFeedbackLike,
  PacedPacketInfo,
  type SentPacket,
  TransportFeedbackAdapter,
  type TransportFeedbackLike,
  type TransportPacketsFeedback,
} from "./transport-feedback-adapter.ts";
import type {RtcEventLogModule} from "./rtc-event-log.ts";

// GoogCcNetworkControllerFactory::GetProcessInterval()
const kProcessIntervalUs = 25_000;
const kMinDataRateBps = 30_000;
const kStartingRateBps = 300_000;

// The duck-typed parts of the parser's objects used here.
interface ProbeClusterEvent {
  id: number;
  bitrateBps: number;
  minPackets: number;
  minBytes: number;
}
interface PacketInfo {
  logPacketTime: number;
  hasTransportSeqNo: boolean;
  transportSeqNo: number;
  mediaType: number;
  ssrc: number;
  size: number;
  overhead: number;
}
interface ReportBlockLike {
  sourceSsrc(): number;
  extendedHighSeqNum(): number;
  cumulativeLost(): number;
  lastSr(): number;
  delaySinceLastSr(): number;
}

// LoggedMediaType::kVideo
const kVideo = 2;

const pacing = (info: PacedPacketInfo) => `${info.probeClusterId} ${info.probeClusterMinProbes} ${info.probeClusterMinBytes}`;

export class LogBasedNetworkControllerSimulation {
  private readonly lines: string[] = ["# goog-cc-trace v2"];
  private initialized = false;
  private currentTime = -Infinity;
  private lastProcess = -Infinity;
  private readonly transportFeedback = new TransportFeedbackAdapter();
  private readonly pendingProbes: {event: ProbeClusterEvent; bytesSent: number; packetsSent: number}[] = [];
  private readonly lastReportBlocks = new Map<number, {extendedHighSeqNum: number; cumulativeLost: number}>();
  private lastReportBlockTime = -Infinity;
  // Outgoing sender reports as [log time us, NTP time us], for the RTT.
  private senderReportNtp: [number, number][] = [];

  private readonly lib: RtcEventLogModule;

  constructor(lib: RtcEventLogModule) {
    this.lib = lib;
  }

  trace(): string {
    return this.lines.join("\n") + "\n";
  }

  processEventsInLog(parsedLog: RtcEventLogModule): void {
    const {PacketDirection, RtcEventProcessor, TypeOrder} = this.lib;
    const IN = PacketDirection.kIncomingPacket;
    const OUT = PacketDirection.kOutgoingPacket;

    for (const sr of parsedLog.senderReports(OUT)) {
      const ntp = sr.sr.ntp();
      this.senderReportNtp.push([sr.logTime(), ntp.seconds() * 1e6 + (ntp.fractions() * 1e6) / 2 ** 32]);
    }

    const packetInfos = parsedLog.getOutgoingPacketInfos();
    const processor = new RtcEventProcessor();
    processor.addEvents(parsedLog.bweProbeClusterCreatedEvents(), (e: ProbeClusterEvent) => this.onProbeCreated(e), TypeOrder.BweProbeCreated);
    processor.addEvents(
      packetInfos,
      (p: PacketInfo) => this.onPacketSent(p),
      TypeOrder.RtpOut,
      (p: PacketInfo) => (p.hasTransportSeqNo ? p.transportSeqNo : undefined),
    );
    processor.addEvents(parsedLog.transportFeedbacks(IN), (f: {logTimeMs(): number; transportFeedback: TransportFeedbackLike}) => this.onFeedback(f), TypeOrder.RtcpIn);
    processor.addEvents(
      parsedLog.receiverReports(IN),
      (r: {logTimeMs(): number; logTimeUs(): number; rr: {reportBlocks(): readonly ReportBlockLike[]}}) => this.onReceiverReport(r),
      TypeOrder.RtcpIn,
    );
    processor.addEvents(
      parsedLog.iceCandidatePairConfigs(),
      (c: {type: number; logTimeUs(): number}) => this.onIceConfig(c),
      TypeOrder.IceCondidateConfig,
    );
    processor.processEventsInOrder();
  }

  // RFC 8888 feedback is not processed by upstream's simulation either; this
  // is here for completeness of the adapter API.
  onCongestionControlFeedback(feedback: CongestionControlFeedbackLike, feedbackTime: number): void {
    this.processUntil(feedbackTime);
    const msg = this.transportFeedback.processCongestionControlFeedback(feedback, feedbackTime);
    if (msg) this.writeFeedback(msg);
  }

  private processUntil(toTime: number): void {
    if (!this.initialized) {
      // NetworkControllerConfig: min 30 kbps, start 300 kbps, the rest unset.
      this.lines.push(`init ${toTime} ${kMinDataRateBps} -1 ${kStartingRateBps} -1 -1 -1 -1`);
      this.initialized = true;
    }
    if (!Number.isFinite(this.lastProcess) || toTime - this.lastProcess > 1_000_000) {
      this.lastProcess = toTime;
      this.currentTime = toTime;
      this.lines.push(`process ${toTime} -1`);
    } else {
      while (this.lastProcess + kProcessIntervalUs <= toTime) {
        this.lastProcess += kProcessIntervalUs;
        this.currentTime = this.lastProcess;
        this.lines.push(`process ${this.currentTime} -1`);
      }
      this.currentTime = toTime;
    }
  }

  private onProbeCreated(probeCluster: ProbeClusterEvent): void {
    this.pendingProbes.push({event: probeCluster, bytesSent: 0, packetsSent: 0});
  }

  private onPacketSent(packet: PacketInfo): void {
    this.processUntil(packet.logPacketTime);
    if (packet.hasTransportSeqNo) {
      const probeInfo = new PacedPacketInfo();
      if (this.pendingProbes.length !== 0 && packet.mediaType === kVideo) {
        const probe = this.pendingProbes[0];
        probeInfo.probeClusterId = probe.event.id;
        probeInfo.sendBitrateBps = probe.event.bitrateBps;
        probeInfo.probeClusterMinBytes = probe.event.minBytes;
        probeInfo.probeClusterMinProbes = probe.event.minPackets;
        probe.packetsSent++;
        probe.bytesSent += packet.size + packet.overhead;
        if (probe.bytesSent >= probe.event.minBytes && probe.packetsSent >= probe.event.minPackets) {
          this.pendingProbes.shift();
        }
      }
      // RtpPacketToSend with the transport sequence number as both transport
      // and RTP sequence number, sized to the logged packet.
      this.transportFeedback.addPacket(
        {
          transportSequenceNumber: packet.transportSeqNo,
          size: packet.size,
          audio: false,
          ssrc: packet.ssrc,
          sequenceNumber: packet.transportSeqNo,
          retransmission: false,
          sendAsEct1: false,
        },
        probeInfo,
        packet.overhead,
        packet.logPacketTime,
      );
    }
    const msg = this.transportFeedback.processSentPacket({
      packetId: packet.hasTransportSeqNo ? packet.transportSeqNo : -1,
      sendTimeMs: Math.round(packet.logPacketTime / 1000), // Timestamp::ms()
      includedInFeedback: packet.hasTransportSeqNo,
      includedInAllocation: true,
      packetSizeBytes: packet.size + packet.overhead,
    });
    if (msg) this.writeSent(msg);
  }

  private onFeedback(feedback: {logTimeMs(): number; transportFeedback: TransportFeedbackLike}): void {
    const feedbackTime = feedback.logTimeMs() * 1000;
    this.processUntil(feedbackTime);
    const msg = this.transportFeedback.processTransportFeedback(feedback.transportFeedback, feedbackTime);
    if (msg) this.writeFeedback(msg);
  }

  private onReceiverReport(report: {logTimeMs(): number; logTimeUs(): number; rr: {reportBlocks(): readonly ReportBlockLike[]}}): void {
    const blocks = report.rr.reportBlocks();
    if (blocks.length === 0) return;
    const reportTime = report.logTimeMs() * 1000;
    this.processUntil(reportTime);

    // int arithmetic on uint32_t/int32_t fields, as upstream.
    let packetsDelta = 0;
    let lostDelta = 0;
    for (const block of blocks) {
      const last = this.lastReportBlocks.get(block.sourceSsrc());
      if (last !== undefined) {
        packetsDelta = (packetsDelta + ((block.extendedHighSeqNum() - last.extendedHighSeqNum) | 0)) | 0;
        lostDelta = (lostDelta + ((block.cumulativeLost() - last.cumulativeLost) | 0)) | 0;
      }
      this.lastReportBlocks.set(block.sourceSsrc(), {
        extendedHighSeqNum: block.extendedHighSeqNum(),
        cumulativeLost: block.cumulativeLost(),
      });
    }
    if (packetsDelta > lostDelta) {
      this.lastReportBlockTime = reportTime;
      // TransportLossReport packets_lost_delta / packets_received_delta are
      // uint64_t (a negative int lost delta wraps).
      const lost = BigInt.asUintN(64, BigInt(lostDelta));
      this.lines.push(`loss ${reportTime} ${lost} ${packetsDelta - lostDelta}`);
    }
    void this.lastReportBlockTime;

    let rtt = Infinity;
    for (const rb of blocks) {
      if (rb.lastSr()) {
        const receiveTimeNtp = this.compactNtpAt(report.logTimeUs());
        if (receiveTimeNtp === undefined) continue;
        const rttNtp = (receiveTimeNtp - rb.delaySinceLastSr() - rb.lastSr()) >>> 0;
        rtt = Math.min(rtt, compactNtpRttToTimeDelta(rttNtp));
      }
    }
    if (Number.isFinite(rtt)) {
      this.lines.push(`rtt ${reportTime} ${rtt}`);
    }
  }

  private onIceConfig(candidate: {type: number; logTimeUs(): number}): void {
    const {IceCandidatePairConfigType} = this.lib;
    if (candidate.type === IceCandidatePairConfigType.kSelected) {
      const logTime = candidate.logTimeUs();
      this.processUntil(logTime);
      this.lines.push(`route ${logTime} ${kMinDataRateBps} -1 ${kStartingRateBps}`);
    }
  }

  // Compact NTP (middle 32 bits) of a log time, via the latest outgoing SR.
  private compactNtpAt(logTimeUs: number): number | undefined {
    let reference: [number, number] | undefined;
    for (const sr of this.senderReportNtp) {
      if (sr[0] > logTimeUs && reference !== undefined) break;
      reference = sr;
    }
    if (reference === undefined) return undefined;
    const ntpUs = reference[1] + (logTimeUs - reference[0]);
    const seconds = Math.floor(ntpUs / 1e6);
    const fraction = Math.floor(((ntpUs - seconds * 1e6) * 2 ** 32) / 1e6);
    return (((seconds & 0xffff) << 16) | (fraction >>> 16)) >>> 0;
  }

  private writeSent(msg: SentPacket): void {
    this.lines.push(
      `sent ${msg.sendTime} ${msg.sequenceNumber} ${msg.size} ${msg.dataInFlight} ${pacing(msg.pacingInfo)} ${msg.priorUnackedData}`,
    );
  }

  private writeFeedback(msg: TransportPacketsFeedback): void {
    const parts = [`feedback ${msg.feedbackTime} ${msg.dataInFlight} ${msg.packetFeedbacks.length}`];
    for (const p of msg.packetFeedbacks) {
      const s = p.sentPacket;
      parts.push(
        `${s.sequenceNumber} ${s.sendTime} ${s.size} ${p.isReceived() ? p.receiveTime : -1} ${pacing(s.pacingInfo)} ${s.priorUnackedData}`,
      );
    }
    this.lines.push(parts.join(" "));
  }
}

// modules/rtp_rtcp/source/ntp_time_util.cc: CompactNtpRttToTimeDelta clamps
// to at least 1 ms.
function compactNtpRttToTimeDelta(compactNtpInterval: number): number {
  let value = compactNtpInterval >>> 0;
  if (value > 0x80000000) value -= 2 ** 32;
  const dividend = value * 1_000_000;
  const divisor = 1 << 16;
  let q = Math.trunc(dividend / divisor);
  const r = dividend - q * divisor;
  if (dividend < 0) {
    if (-r > divisor / 2) q -= 1;
  } else if (r > (divisor - 1) >> 1) {
    q += 1;
  }
  return Math.max(q, 1000);
}
