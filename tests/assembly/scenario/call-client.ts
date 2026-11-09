// Sending client of the scenario simulator: a simplified stand-in for upstream
// test/scenario CallClient + RtpTransportControllerSend + PacingController +
// a fake video encoder, with the receiving side (transport-wide feedback and
// RTCP receiver reports) built in.
//
// Mechanisms follow upstream where they influence the congestion controller:
//  - GoogCC process interval 25 ms (GoogCcNetworkControllerFactory).
//  - Pacer: media/padding debt drained at the pacing/padding rate, bursts up
//    to `pacerBurstInterval` (40 ms), debt capped at 500 ms, queue time limit
//    2 s, probe clusters sent in bursts every min_probe_delta at the probe
//    rate using media or padding packets.
//  - Transport-wide feedback every 50 ms (5% of a 300 kbps receiver estimate
//    hits the 50 ms floor of TransportSequenceNumberFeedbackGenenerator); a
//    late packet moves the feedback window back so it is reported again, and
//    arrival times are kept for 500 ms (kBackWindow).
//  - Feedback adapter as TransportFeedbackAdapter: packets sent on a previous
//    route are ignored, lost packets stay in the history until reported
//    received, in-flight bytes are tracked for the current route only and
//    released when a later sequence number is acknowledged.
//  - RTCP: SR every second on the forward path, RR every second on the return
//    path with LSR/DLSR, giving RTT and loss. A detected RTP sequence gap
//    triggers a NACK, i.e. a compound RTCP packet that carries a report block
//    (RTCPSender adds the report to every compound packet); NACKs are sent at
//    most every 20 ms here.
//  - Without transport feedback the receiver runs a delay-based estimator and
//    sends REMB through a RembThrottler (200 ms / 103%). Upstream uses
//    RemoteBitrateEstimatorSingleStream (OveruseDetector + AimdRateControl);
//    here DelayBasedBwe (TrendlineEstimator + AimdRateControl) stands in.
//  - Video: 30 fps, frame size = encoder rate / fps, max 10 Mbps
//    (scenario default encoder max), min 30 kbps (enforced min bitrate).
// Packet and frame sizes are simplified; results are statistically, not
// bit-exactly, comparable with upstream scenarios.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../assembly/units";
import {Optional} from "../../../assembly/types/optional";
import {createEnvironment} from "../../../assembly/api/environment/environment";
import {
  NetworkAvailability,
  NetworkControlUpdate,
  NetworkRouteChange,
  PacedPacketInfo,
  PacketResult,
  ProbeClusterConfig,
  ProcessInterval,
  RemoteBitrateReport,
  RoundTripTimeUpdate,
  SentPacket,
  StreamsConfig,
  TargetRateConstraints,
  TransportLossReport,
  TransportPacketsFeedback,
} from "../../../assembly/api/transport/network-types";
import {NetworkControllerConfig, NetworkControllerInterface} from "../../../assembly/api/transport/network-control";
import {GoogCcNetworkControllerFactory} from "../../../assembly/api/transport/goog-cc-factory";
import {GoogCcFieldTrials} from "../../../assembly/modules/congestion-controller/goog-cc/goog-cc-network-control";
import {DelayBasedBwe} from "../../../assembly/modules/congestion-controller/goog-cc/delay-based-bwe";
import {BitrateEstimator} from "../../../assembly/modules/congestion-controller/goog-cc/bitrate-estimator";
import {SimEvent} from "./event-loop";
import {NetworkNode, PacketKind, PacketSink, SimPacket, sendOnRoute} from "./network-node";
import {Simulation} from "./simulation";
import {TraceRecorder} from "./trace-recorder";

const kProcessInterval: TimeDelta = TimeDelta.Millis(25);
const kPacerTick: TimeDelta = TimeDelta.Millis(1);
const kFeedbackInterval: TimeDelta = TimeDelta.Millis(50);
const kRtcpInterval: TimeDelta = TimeDelta.Seconds(1);
const kMaxPacketSize: i64 = 1200;
const kPaddingPacketSize: i64 = 250;
const kFeedbackPacketSize: i64 = 68;
const kRtcpPacketSize: i64 = 80;
const kMaxDebtInTime: TimeDelta = TimeDelta.Millis(500);
const kQueueTimeLimit: TimeDelta = TimeDelta.Seconds(2);
const kSendTimeHistoryWindow: TimeDelta = TimeDelta.Seconds(60);
const kBackWindow: TimeDelta = TimeDelta.Millis(500);
const kRemoteEstimatorInterval: TimeDelta = TimeDelta.Millis(25);
const kRembSendInterval: TimeDelta = TimeDelta.Millis(200);
const kRembPacketSize: i64 = 60;
const kMinNackInterval: TimeDelta = TimeDelta.Millis(20);
// kStrictPacingMultiplier (video/video_send_stream_impl.cc), a float upstream.
const kStrictPacingMultiplier: f32 = 1.1;

// TransportControllerConfig::Rates + CallClientConfig.
export class CallClientConfig {
  minRate: DataRate = DataRate.KilobitsPerSec(30);
  maxRate: DataRate = DataRate.KilobitsPerSec(3000);
  startRate: DataRate = DataRate.KilobitsPerSec(300);
  pacerBurstInterval: TimeDelta = TimeDelta.Millis(40);
  fieldTrials: GoogCcFieldTrials = new GoogCcFieldTrials();
  // "WebRTC-Bwe-ResetOnAdapterIdChange/Enabled/" (RtpTransportControllerSend).
  resetOnAdapterIdChange: bool = false;
  // "WebRTC-Video-Pacing/factor:<f>/" (VideoSendStreamImpl PacingConfig).
  videoPacingFactor: Optional<f64> | null = null;
  // Records every controller input as a goog-cc trace when set.
  traceRecorder: TraceRecorder | null = null;
}

// The parts of VideoStreamConfig the simulator uses.
export class VideoStreamConfig {
  framerate: i32 = 30;
  packetFeedback: bool = true;
  padToRate: DataRate = DataRate.Zero;
  maxDataRate: DataRate = DataRate.KilobitsPerSec(10000);
  minDataRate: DataRate = DataRate.KilobitsPerSec(30);
}

class SentRecord {
  constructor(public sent: SentPacket, public time: Timestamp, public routeId: i32) {}
}

class InFlightEntry {
  constructor(public seq: i64, public bytes: i64, public routeId: i32) {}
}

class RembMessage {
  constructor(public bitrate: DataRate) {}
}

class FeedbackReport {
  seqs: i64[] = [];
  arrivals: Timestamp[] = [];
}

class SenderReport {
  constructor(public sendTime: Timestamp) {}
}

// Report block: LSR (send time of the last SR) and DLSR (delay since it was
// received), plus loss counters since the previous report.
class ReceiverReport {
  constructor(public lastSrSendTime: Timestamp, public delaySinceLastSr: TimeDelta, public lost: i64, public received: i64) {}
}

class ActiveProbeCluster {
  sentBytes: i64 = 0;
  sentProbes: i32 = 0;
  start: Timestamp = Timestamp.MinusInfinity;
  constructor(public config: ProbeClusterConfig) {}

  minBytes(): i64 {
    return DataSize.bytes(DataRate.mulTime(this.config.targetDataRate, this.config.targetDuration));
  }
  done(): bool {
    return this.sentBytes >= this.minBytes() && this.sentProbes >= this.config.targetProbeCount;
  }
  pacingInfo(): PacedPacketInfo {
    return new PacedPacketInfo(this.config.id, this.config.targetProbeCount, <i32>this.minBytes());
  }
}

class QueuedPacket {
  constructor(public packet: SimPacket, public enqueueTime: Timestamp) {}
}

class ProcessEvent extends SimEvent {
  constructor(private client: CallClient) { super(); }
  fire(now: Timestamp): void { this.client.onProcess(now); }
}

class PacerEvent extends SimEvent {
  constructor(private client: CallClient) { super(); }
  fire(now: Timestamp): void { this.client.onPacerTick(now); }
}

class FrameEvent extends SimEvent {
  constructor(private client: CallClient) { super(); }
  fire(now: Timestamp): void { this.client.onFrame(now); }
}

class FeedbackEvent extends SimEvent {
  constructor(private client: CallClient) { super(); }
  fire(now: Timestamp): void { this.client.onFeedbackTimer(now); }
}

class RtcpEvent extends SimEvent {
  constructor(private client: CallClient) { super(); }
  fire(now: Timestamp): void { this.client.onRtcpTimer(now); }
}

class ReceiverReportEvent extends SimEvent {
  constructor(private client: CallClient) { super(); }
  fire(now: Timestamp): void { this.client.onReceiverReportTimer(now); }
}

class RemoteEstimatorEvent extends SimEvent {
  constructor(private client: CallClient) { super(); }
  fire(now: Timestamp): void { this.client.onRemoteEstimatorTimer(now); }
}

// Receives media at the remote end.
class ReceiverSink extends PacketSink {
  constructor(private client: CallClient) { super(); }
  onPacketReceived(packet: SimPacket, at: Timestamp): void { this.client.onRemotePacket(packet, at); }
}

// Receives feedback/RTCP back at the sender.
class SenderSink extends PacketSink {
  constructor(private client: CallClient) { super(); }
  onPacketReceived(packet: SimPacket, at: Timestamp): void { this.client.onLocalPacket(packet, at); }
}

export class CallClient {
  private readonly sim: Simulation;
  private readonly config: CallClientConfig;
  private readonly video: VideoStreamConfig;
  private controller: NetworkControllerInterface;
  private sendRoute: NetworkNode[];
  private returnRoute: NetworkNode[];
  private receiverSink: ReceiverSink | null = null;
  private senderSink: SenderSink | null = null;

  // Latest values of the controller outputs (CallClient update_state_).
  private lastTargetRate: DataRate;
  private lastPacingRate: DataRate = DataRate.Zero;
  private lastPaddingRate: DataRate = DataRate.Zero;
  private congestionWindow: Optional<DataSize> | null = null;

  // Encoder.
  private videoActive: bool = true;

  // Pacer.
  private queue: QueuedPacket[] = [];
  private queuedBytes: i64 = 0;
  private mediaDebt: f64 = 0;
  private paddingDebt: f64 = 0;
  private lastPacerUpdate: Timestamp;
  private probeClusters: ActiveProbeCluster[] = [];

  // Transport feedback adapter.
  private nextTransportSeq: i64 = 1;
  private nextRtpSeq: i64 = 1;
  private history: Map<i64, SentRecord> = new Map<i64, SentRecord>();
  private historyOrder: i64[] = [];
  private outstanding: i64 = 0;
  private inFlight: InFlightEntry[] = [];
  private lastAckSeq: i64 = 0;
  private routeId: i32 = 0;

  // Receiver side.
  private arrivals: Map<i64, Timestamp> = new Map<i64, Timestamp>();
  private arrivalOrder: i64[] = [];
  private maxReceivedTransportSeq: i64 = 0;
  private feedbackWindowStart: i64 = 1;
  private lastSrSendTime: Timestamp = Timestamp.MinusInfinity;
  private lastSrArrival: Timestamp = Timestamp.MinusInfinity;
  private remoteEstimator: DelayBasedBwe | null = null;
  private remoteRate: BitrateEstimator | null = null;
  private remotePending: PacketResult[] = [];
  private lastRembTime: Timestamp = Timestamp.MinusInfinity;
  private lastRembBitrate: DataRate = DataRate.PlusInfinity;
  private lastReceiverReport: Timestamp = Timestamp.MinusInfinity;
  private rtpHighest: i64 = 0;
  private rtpReceived: i64 = 0;
  private rtpLastReportHighest: i64 = 0;
  private rtpLastReportReceived: i64 = 0;

  // Route / adapter.
  private adapterId: i32 = 0;
  private adapterIdAtLastRoute: i32 = 0;

  constructor(
    sim: Simulation,
    config: CallClientConfig,
    sendRoute: NetworkNode[],
    returnRoute: NetworkNode[],
    video: VideoStreamConfig,
  ) {
    const now = sim.now();
    this.sim = sim;
    this.config = config;
    this.video = video;
    this.sendRoute = sendRoute;
    this.returnRoute = returnRoute;
    this.lastTargetRate = config.startRate;
    this.lastPacerUpdate = now;

    const controllerConfig = new NetworkControllerConfig(createEnvironment(sim.clock));
    controllerConfig.constraints = makeConstraints(config, now);
    controllerConfig.streamBasedConfig = makeStreamsConfig(config, video, now);
    this.controller = new GoogCcNetworkControllerFactory(null, config.fieldTrials).create(controllerConfig);
    const recorder = config.traceRecorder;
    if (recorder !== null) {
      recorder.init(now, controllerConfig.constraints, controllerConfig.streamBasedConfig);
      recorder.availability(now, true);
    }
    this.receiverSink = new ReceiverSink(this);
    this.senderSink = new SenderSink(this);

    const availability = new NetworkAvailability();
    availability.atTime = now;
    availability.networkAvailable = true;
    this.applyUpdate(this.controller.onNetworkAvailability(availability));

    sim.schedule(new ProcessEvent(this), now);
    sim.schedule(new PacerEvent(this), now);
    sim.schedule(new FrameEvent(this), now);
    sim.schedule(new FeedbackEvent(this), Unit.add(now, kFeedbackInterval));
    sim.schedule(new RtcpEvent(this), Unit.add(now, kRtcpInterval));
    sim.schedule(new ReceiverReportEvent(this), Unit.add(now, kRtcpInterval));
    if (!video.packetFeedback) {
      this.remoteEstimator = new DelayBasedBwe();
      this.remoteRate = new BitrateEstimator();
      sim.schedule(new RemoteEstimatorEvent(this), Unit.add(now, kRemoteEstimatorInterval));
    }
  }

  // --- Public API used by the scenario tests ---

  targetRate(): DataRate {
    return this.lastTargetRate;
  }

  // Call::Stats::send_bandwidth_bps: the last target rate.
  sendBandwidth(): DataRate {
    return this.lastTargetRate;
  }

  paddingRate(): DataRate {
    return this.lastPaddingRate;
  }

  // Call::Stats::pacer_delay_ms: queuing time of the oldest packet.
  pacerDelayMs(): i64 {
    if (this.queue.length == 0) return 0;
    return TimeDelta.ms(Unit.sub(this.sim.now(), this.queue[0].enqueueTime));
  }

  setRemoteBitrate(bitrate: DataRate): void {
    const msg = new RemoteBitrateReport();
    msg.bandwidth = bitrate;
    msg.receiveTime = this.sim.now();
    const recorder = this.config.traceRecorder;
    if (recorder !== null) recorder.remb(msg.receiveTime, bitrate);
    this.applyUpdate(this.controller.onRemoteBitrateReport(msg));
  }

  updateNetworkAdapterId(adapterId: i32): void {
    this.adapterId = adapterId;
  }

  // Scenario::ChangeRoute for the forward direction.
  changeRoute(sendRoute: NetworkNode[]): void {
    this.sendRoute = sendRoute;
    const adapterChanged = this.adapterId != this.adapterIdAtLastRoute;
    this.adapterIdAtLastRoute = this.adapterId;
    if (this.config.resetOnAdapterIdChange && !adapterChanged) return;
    const now = this.sim.now();
    const msg = new NetworkRouteChange();
    msg.atTime = now;
    msg.constraints = makeConstraints(this.config, now);
    // TransportFeedbackAdapter::SetNetworkRoute: in-flight bytes and feedback
    // are tracked per route; packets sent on the old route are ignored.
    this.routeId++;
    this.outstanding = 0;
    const recorder = this.config.traceRecorder;
    if (recorder !== null) recorder.route(now, msg.constraints);
    this.applyUpdate(this.controller.onNetworkRouteChange(msg));
  }

  stopVideo(): void {
    this.videoActive = false;
  }

  startVideo(): void {
    this.videoActive = true;
  }

  // --- Timers ---

  onProcess(now: Timestamp): void {
    const msg = new ProcessInterval();
    msg.atTime = now;
    msg.pacerQueue = new Optional<DataSize>(DataSize.Bytes(this.queuedBytes));
    const recorder = this.config.traceRecorder;
    if (recorder !== null) recorder.process(now, msg.pacerQueue);
    this.applyUpdate(this.controller.onProcessInterval(msg));
    this.sim.schedule(new ProcessEvent(this), Unit.add(now, kProcessInterval));
  }

  onFrame(now: Timestamp): void {
    if (this.videoActive) {
      const rate = min(max(this.lastTargetRate, this.video.minDataRate), this.video.maxDataRate);
      const frameBytes = DataRate.bps(rate) / 8 / <i64>this.video.framerate;
      const packets = max<i64>((frameBytes + kMaxPacketSize - 1) / kMaxPacketSize, 1);
      const packetBytes = max<i64>(frameBytes / packets, 1);
      for (let i: i64 = 0; i < packets; ++i) {
        const packet = new SimPacket();
        packet.kind = PacketKind.kMedia;
        packet.size = DataSize.Bytes(packetBytes);
        packet.rtpSeq = this.nextRtpSeq++;
        this.queue.push(new QueuedPacket(packet, now));
        this.queuedBytes += packetBytes;
      }
    }
    this.sim.schedule(new FrameEvent(this), Unit.add(now, TimeDelta.Micros<i64>(1000000 / <i64>this.video.framerate)));
  }

  onPacerTick(now: Timestamp): void {
    this.updateDebt(now);

    // Probing.
    while (this.probeClusters.length > 0 && !this.isCongested()) {
      const cluster = this.probeClusters[0];
      const rate = cluster.config.targetDataRate;
      if (Unit.isInfinite(cluster.start)) cluster.start = now;
      const nextProbeTime = Unit.add(cluster.start, DataRate.timeToSend(DataSize.Bytes(cluster.sentBytes), rate));
      if (nextProbeTime > now) break;
      const burstBytes = max<i64>(DataSize.bytes(DataRate.mulTime(rate, cluster.config.minProbeDelta)), 1);
      let sentInBurst: i64 = 0;
      while (sentInBurst < burstBytes) {
        const packet = this.queue.length > 0 ? this.dequeueMedia() : this.createPadding(min(burstBytes - sentInBurst, kMaxPacketSize));
        this.sendPacket(packet, now, cluster.pacingInfo());
        sentInBurst += DataSize.bytes(packet.size);
        cluster.sentBytes += DataSize.bytes(packet.size);
        cluster.sentProbes++;
      }
      if (cluster.done()) this.probeClusters.shift();
      else break;
    }

    // Media.
    const pacingRate = this.effectivePacingRate();
    const burstAllowance = <f64>DataSize.bytes(DataRate.mulTime(pacingRate, this.config.pacerBurstInterval));
    while (this.queue.length > 0 && !this.isCongested() && this.mediaDebt <= burstAllowance) {
      this.sendPacket(this.dequeueMedia(), now, new PacedPacketInfo());
    }

    // Padding.
    if (this.queue.length == 0 && this.lastPaddingRate > DataRate.Zero && !this.isCongested() &&
        this.mediaDebt <= 0 && this.paddingDebt <= 0) {
      this.sendPacket(this.createPadding(kPaddingPacketSize), now, new PacedPacketInfo());
    }

    this.sim.schedule(new PacerEvent(this), Unit.add(now, kPacerTick));
  }

  onFeedbackTimer(now: Timestamp): void {
    if (this.maxReceivedTransportSeq >= this.feedbackWindowStart) {
      const report = new FeedbackReport();
      for (let seq = this.feedbackWindowStart; seq <= this.maxReceivedTransportSeq; ++seq) {
        report.seqs.push(seq);
        report.arrivals.push(this.arrivals.has(seq) ? this.arrivals.get(seq) : Timestamp.PlusInfinity);
      }
      this.feedbackWindowStart = this.maxReceivedTransportSeq + 1;
      const packet = new SimPacket();
      packet.kind = PacketKind.kFeedback;
      packet.size = DataSize.Bytes(kFeedbackPacketSize);
      packet.payload = report;
      sendOnRoute(packet, this.returnRoute, this.senderSink!, now);
    }
    this.sim.schedule(new FeedbackEvent(this), Unit.add(now, kFeedbackInterval));
  }

  onRtcpTimer(now: Timestamp): void {
    const packet = new SimPacket();
    packet.kind = PacketKind.kRtcpSenderReport;
    packet.size = DataSize.Bytes(kRtcpPacketSize);
    packet.payload = new SenderReport(now);
    sendOnRoute(packet, this.sendRoute, this.receiverSink!, now);
    this.sim.schedule(new RtcpEvent(this), Unit.add(now, kRtcpInterval));
  }

  // --- Packet reception ---

  onReceiverReportTimer(now: Timestamp): void {
    this.sendReceiverReport(now);
    this.sim.schedule(new ReceiverReportEvent(this), Unit.add(now, kRtcpInterval));
  }

  private sendReceiverReport(now: Timestamp): void {
    this.lastReceiverReport = now;
    const expected = this.rtpHighest - this.rtpLastReportHighest;
    const received = this.rtpReceived - this.rtpLastReportReceived;
    this.rtpLastReportHighest = this.rtpHighest;
    this.rtpLastReportReceived = this.rtpReceived;
    const rr = new SimPacket();
    rr.kind = PacketKind.kRtcpReceiverReport;
    rr.size = DataSize.Bytes(kRtcpPacketSize);
    const delaySinceLastSr = Unit.isFinite(this.lastSrArrival) ? Unit.sub(now, this.lastSrArrival) : TimeDelta.Zero;
    rr.payload = new ReceiverReport(this.lastSrSendTime, delaySinceLastSr, max<i64>(expected - received, 0), received);
    sendOnRoute(rr, this.returnRoute, this.senderSink!, now);
  }

  // Receive side BWE + RembThrottler (no transport feedback only).
  onRemoteEstimatorTimer(now: Timestamp): void {
    const estimator = this.remoteEstimator!;
    if (this.remotePending.length > 0) {
      const msg = new TransportPacketsFeedback();
      msg.feedbackTime = now;
      msg.packetFeedbacks = this.remotePending;
      this.remotePending = [];
      const result = estimator.incomingPacketFeedbackVector(msg, this.remoteRate!.bitrate(), null, null, false);
      if (result.updated) this.maybeSendRemb(result.targetBitrate, now);
    }
    this.sim.schedule(new RemoteEstimatorEvent(this), Unit.add(now, kRemoteEstimatorInterval));
  }

  private maybeSendRemb(bitrate: DataRate, now: Timestamp): void {
    // % threshold for if we should send a new REMB asap.
    const kSendThresholdPercent: i64 = 103;
    if (bitrate * kSendThresholdPercent / 100 > this.lastRembBitrate &&
        now < Unit.add(this.lastRembTime, kRembSendInterval)) {
      return;
    }
    this.lastRembTime = now;
    this.lastRembBitrate = bitrate;
    const packet = new SimPacket();
    packet.kind = PacketKind.kRtcpReceiverReport;
    packet.size = DataSize.Bytes(kRembPacketSize);
    packet.payload = new RembMessage(bitrate);
    sendOnRoute(packet, this.returnRoute, this.senderSink!, now);
  }

  // At the remote end.
  onRemotePacket(packet: SimPacket, at: Timestamp): void {
    if (packet.kind == PacketKind.kRtcpSenderReport) {
      this.lastSrSendTime = (<SenderReport>packet.payload).sendTime;
      this.lastSrArrival = at;
      return;
    }
    if (packet.transportSeq > 0) {
      const seq = packet.transportSeq;
      // TransportSequenceNumberFeedbackGenenerator: a late packet moves the
      // feedback window back so it gets reported (again).
      if (seq < this.feedbackWindowStart) this.feedbackWindowStart = seq;
      if (!this.arrivals.has(seq)) {
        this.arrivals.set(seq, at);
        this.arrivalOrder.push(seq);
      }
      this.maxReceivedTransportSeq = max(this.maxReceivedTransportSeq, seq);
      // Cull arrival times older than kBackWindow.
      while (this.arrivalOrder.length > 0) {
        const oldest = this.arrivalOrder[0];
        if (this.arrivals.has(oldest) && Unit.sub(at, this.arrivals.get(oldest)) < kBackWindow) break;
        this.arrivals.delete(oldest);
        this.arrivalOrder.shift();
      }
    }
    if (packet.kind == PacketKind.kMedia && packet.rtpSeq > 0) {
      const gap = packet.rtpSeq > this.rtpHighest + 1;
      this.rtpHighest = max(this.rtpHighest, packet.rtpSeq);
      this.rtpReceived++;
      // NACK: compound RTCP with a report block.
      if (gap && Unit.sub(at, this.lastReceiverReport) >= kMinNackInterval) this.sendReceiverReport(at);
      const estimator = this.remoteEstimator;
      if (estimator !== null) {
        const result = new PacketResult();
        result.sentPacket.sendTime = packet.sendTime;
        result.sentPacket.size = packet.size;
        result.receiveTime = at;
        this.remotePending.push(result);
        this.remoteRate!.update(at, packet.size, false);
      }
    }
  }

  // Back at the sender.
  onLocalPacket(packet: SimPacket, at: Timestamp): void {
    if (packet.kind == PacketKind.kFeedback) {
      this.onTransportFeedback(<FeedbackReport>packet.payload, at);
    } else if (packet.kind == PacketKind.kRtcpReceiverReport && packet.payload instanceof RembMessage) {
      this.setRemoteBitrate((<RembMessage>packet.payload).bitrate);
    } else if (packet.kind == PacketKind.kRtcpReceiverReport) {
      const rr = <ReceiverReport>packet.payload;
      const rtt = Unit.sub(Unit.sub(at, rr.lastSrSendTime), rr.delaySinceLastSr);
      if (Unit.isFinite(rr.lastSrSendTime) && rtt > TimeDelta.Zero) {
        const rttUpdate = new RoundTripTimeUpdate();
        rttUpdate.receiveTime = at;
        rttUpdate.roundTripTime = rtt;
        rttUpdate.smoothed = false;
        const recorder = this.config.traceRecorder;
        if (recorder !== null) recorder.rtt(at, rtt);
        this.applyUpdate(this.controller.onRoundTripTimeUpdate(rttUpdate));
      }
      const loss = new TransportLossReport();
      loss.receiveTime = at;
      loss.startTime = at;
      loss.endTime = at;
      loss.packetsLostDelta = <u64>rr.lost;
      loss.packetsReceivedDelta = <u64>rr.received;
      const recorder = this.config.traceRecorder;
      if (recorder !== null) recorder.loss(at, loss.packetsLostDelta, loss.packetsReceivedDelta);
      this.applyUpdate(this.controller.onTransportLossReport(loss));
    }
  }

  private onTransportFeedback(report: FeedbackReport, at: Timestamp): void {
    this.pruneHistory(at);
    const msg = new TransportPacketsFeedback();
    msg.feedbackTime = at;
    for (let i = 0; i < report.seqs.length; ++i) {
      const seq = report.seqs[i];
      const received = Unit.isFinite(report.arrivals[i]);
      // RetrievePacketFeedback: acknowledging `seq` releases the in-flight
      // bytes of every packet up to it.
      if (seq > this.lastAckSeq) {
        while (this.inFlight.length > 0 && this.inFlight[0].seq <= seq) {
          const entry = this.inFlight.shift();
          if (entry.routeId == this.routeId) this.outstanding = max<i64>(this.outstanding - entry.bytes, 0);
        }
        this.lastAckSeq = seq;
      }
      // Missing: history too small or packet reported as received twice.
      if (!this.history.has(seq)) continue;
      const record = this.history.get(seq);
      // Lost packets are not removed from history because they might be
      // reported as received by a later feedback.
      if (received) this.history.delete(seq);
      if (record.routeId != this.routeId) continue;
      const result = new PacketResult();
      result.sentPacket = record.sent;
      result.receiveTime = report.arrivals[i];
      msg.packetFeedbacks.push(result);
    }
    msg.dataInFlight = DataSize.Bytes(this.outstanding);
    if (msg.packetFeedbacks.length == 0) return;
    const recorder = this.config.traceRecorder;
    if (recorder !== null) recorder.feedback(msg);
    this.applyUpdate(this.controller.onTransportPacketsFeedback(msg));
  }

  // --- Internals ---

  private applyUpdate(update: NetworkControlUpdate): void {
    const target = update.targetRate;
    if (target !== null) this.lastTargetRate = target.targetRate;
    const pacer = update.pacerConfig;
    if (pacer !== null) {
      this.updateDebt(this.sim.now());
      this.lastPacingRate = pacer.dataRate();
      this.lastPaddingRate = pacer.padRate();
    }
    for (let i = 0; i < update.probeClusterConfigs.length; ++i) {
      this.probeClusters.push(new ActiveProbeCluster(update.probeClusterConfigs[i]));
    }
    const window = update.congestionWindow;
    if (window !== null) this.congestionWindow = window;
  }

  private effectivePacingRate(): DataRate {
    let rate = this.lastPacingRate;
    // Queue time limit: drain the queue within kQueueTimeLimit.
    if (this.queuedBytes > 0) {
      const drainRate = DataRate.fromSizeAndDuration(DataSize.Bytes(this.queuedBytes), kQueueTimeLimit);
      rate = max(rate, drainRate);
    }
    return rate;
  }

  private updateDebt(now: Timestamp): void {
    const elapsed = Unit.sub(now, this.lastPacerUpdate);
    if (elapsed <= TimeDelta.Zero) return;
    this.lastPacerUpdate = now;
    const mediaDrained = <f64>DataSize.bytes(DataRate.mulTime(this.effectivePacingRate(), elapsed));
    const paddingDrained = <f64>DataSize.bytes(DataRate.mulTime(this.lastPaddingRate, elapsed));
    this.mediaDebt = max(this.mediaDebt - mediaDrained, 0.0);
    this.paddingDebt = max(this.paddingDebt - paddingDrained, 0.0);
  }

  private isCongested(): bool {
    const window = this.congestionWindow;
    return window !== null && this.outstanding >= DataSize.bytes(window.value);
  }

  private dequeueMedia(): SimPacket {
    const entry = this.queue.shift();
    this.queuedBytes -= DataSize.bytes(entry.packet.size);
    return entry.packet;
  }

  private createPadding(bytes: i64): SimPacket {
    const packet = new SimPacket();
    packet.kind = PacketKind.kPadding;
    packet.size = DataSize.Bytes(max<i64>(bytes, 50));
    return packet;
  }

  private sendPacket(packet: SimPacket, now: Timestamp, pacingInfo: PacedPacketInfo): void {
    const bytes = DataSize.bytes(packet.size);
    this.mediaDebt += <f64>bytes;
    this.paddingDebt += <f64>bytes;
    const maxDebt = <f64>DataSize.bytes(DataRate.mulTime(this.effectivePacingRate(), kMaxDebtInTime));
    this.mediaDebt = min(this.mediaDebt, maxDebt);

    if (this.video.packetFeedback) {
      packet.transportSeq = this.nextTransportSeq++;
      this.outstanding += bytes;
      const sent = new SentPacket();
      sent.sendTime = now;
      sent.size = packet.size;
      sent.pacingInfo = pacingInfo;
      sent.sequenceNumber = packet.transportSeq;
      sent.dataInFlight = DataSize.Bytes(this.outstanding);
      this.history.set(packet.transportSeq, new SentRecord(sent, now, this.routeId));
      this.historyOrder.push(packet.transportSeq);
      this.inFlight.push(new InFlightEntry(packet.transportSeq, bytes, this.routeId));
      const recorder = this.config.traceRecorder;
      if (recorder !== null) recorder.sent(sent);
      this.applyUpdate(this.controller.onSentPacket(sent));
    }
    packet.sendTime = now;
    sendOnRoute(packet, this.sendRoute, this.receiverSink!, now);
  }

  private pruneHistory(now: Timestamp): void {
    const order = this.historyOrder;
    while (order.length > 0) {
      const seq = order[0];
      if (!this.history.has(seq)) {
        order.shift();
        continue;
      }
      const record = this.history.get(seq);
      if (Unit.sub(now, record.time) <= kSendTimeHistoryWindow) break;
      this.history.delete(seq);
      order.shift();
    }
  }
}

function makeConstraints(config: CallClientConfig, now: Timestamp): TargetRateConstraints {
  const c = new TargetRateConstraints();
  c.atTime = now;
  c.minDataRate = new Optional<DataRate>(config.minRate);
  c.maxDataRate = new Optional<DataRate>(config.maxRate);
  c.startingRate = new Optional<DataRate>(config.startRate);
  return c;
}

function makeStreamsConfig(config: CallClientConfig, video: VideoStreamConfig, now: Timestamp): StreamsConfig {
  const s = new StreamsConfig();
  s.atTime = now;
  s.maxTotalAllocatedBitrate = new Optional<DataRate>(video.maxDataRate);
  s.minTotalAllocatedBitrate = new Optional<DataRate>(video.minDataRate);
  s.maxPaddingRate = new Optional<DataRate>(video.padToRate);
  if (video.packetFeedback) {
    const factor = config.videoPacingFactor;
    s.pacingFactor = new Optional<f64>(factor !== null ? factor.value : <f64>kStrictPacingMultiplier);
  }
  return s;
}
