// Port of api/transport/network_types.{h,cc} @ M154.
//
// C++ structs become classes with reference semantics: upstream copies
// (`res.push_back(fb)`) share the instance here. Call clone() where upstream
// mutates a copy.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../units";
import {Optional} from "../../types/optional";
import {EcnMarking} from "./ecn-marking";

// Represents constraints and rates related to the currently enabled streams.
// This is used as input to the congestion controller via the StreamsConfig
// struct.
export class BitrateAllocationLimits {
  // The total minimum send bitrate required by all sending streams.
  minAllocatableRate: DataRate = DataRate.Zero;
  // The total maximum allocatable bitrate for all currently available streams.
  maxAllocatableRate: DataRate = DataRate.Zero;
  // The max bitrate to use for padding. The sum of the per-stream max padding
  // rate.
  maxPaddingRate: DataRate = DataRate.Zero;
}

// Use StreamsConfig for information about streams that is required for specific
// adjustments to the algorithms in network controllers. Especially useful
// for experiments.
export class StreamsConfig {
  atTime: Timestamp = Timestamp.PlusInfinity;
  requestsAlrProbing: Optional<bool> | null = null;
  // If `enable_repeated_initial_probing` is set to true, Probes are sent
  // periodically every 1s during the first 5s after the network becomes
  // available. The probes ignores max_total_allocated_bitrate.
  enableRepeatedInitialProbing: bool = false;
  pacingFactor: Optional<f64> | null = null;
  // TODO(srte): Use BitrateAllocationLimits here.
  minTotalAllocatedBitrate: Optional<DataRate> | null = null;
  maxPaddingRate: Optional<DataRate> | null = null;
  maxTotalAllocatedBitrate: Optional<DataRate> | null = null;
}

export class TargetRateConstraints {
  atTime: Timestamp = Timestamp.PlusInfinity;
  minDataRate: Optional<DataRate> | null = null;
  maxDataRate: Optional<DataRate> | null = null;
  // The initial bandwidth estimate to base target rate on. This should be used
  // as the basis for initial OnTargetTransferRate and OnPacerConfig callbacks.
  startingRate: Optional<DataRate> | null = null;
}

// Send side information

export class NetworkAvailability {
  atTime: Timestamp = Timestamp.PlusInfinity;
  networkAvailable: bool = false;
}

export class NetworkRouteChange {
  atTime: Timestamp = Timestamp.PlusInfinity;
  // The TargetRateConstraints are set here so they can be changed synchronously
  // when network route changes.
  constraints: TargetRateConstraints = new TargetRateConstraints();
  // If true, the change is significant enough to warrant a reset of the
  // bandwidth estimator.
  restartBwe: bool = true;
}

export class PacedPacketInfo {
  // TODO(srte): Move probing info to a separate, optional struct.
  static readonly kNotAProbe: i32 = -1;

  sendBitrate: DataRate = DataRate.Zero;
  probeClusterId: i32 = PacedPacketInfo.kNotAProbe;
  probeClusterMinProbes: i32 = -1;
  probeClusterMinBytes: i32 = -1;
  probeClusterBytesSent: i32 = 0;

  constructor(
    probeClusterId: i32 = PacedPacketInfo.kNotAProbe,
    probeClusterMinProbes: i32 = -1,
    probeClusterMinBytes: i32 = -1,
  ) {
    this.probeClusterId = probeClusterId;
    this.probeClusterMinProbes = probeClusterMinProbes;
    this.probeClusterMinBytes = probeClusterMinBytes;
  }

  equals(rhs: PacedPacketInfo): bool {
    return this.sendBitrate == rhs.sendBitrate &&
      this.probeClusterId == rhs.probeClusterId &&
      this.probeClusterMinProbes == rhs.probeClusterMinProbes &&
      this.probeClusterMinBytes == rhs.probeClusterMinBytes;
  }

  clone(): PacedPacketInfo {
    const c = new PacedPacketInfo(this.probeClusterId, this.probeClusterMinProbes, this.probeClusterMinBytes);
    c.sendBitrate = this.sendBitrate;
    c.probeClusterBytesSent = this.probeClusterBytesSent;
    return c;
  }
}

export class SentPacket {
  sendTime: Timestamp = Timestamp.PlusInfinity;
  // Size of packet with overhead up to IP layer.
  size: DataSize = DataSize.Zero;
  // Size of preceeding packets that are not part of feedback.
  priorUnackedData: DataSize = DataSize.Zero;
  // Probe cluster id and parameters including bitrate, number of packets and
  // number of bytes.
  pacingInfo: PacedPacketInfo = new PacedPacketInfo();
  // True if the packet is an audio packet, false for video, padding, RTX etc.
  audio: bool = false;
  // Transport independent sequence number, any tracked packet should have a
  // sequence number that is unique over the whole call and increasing by 1 for
  // each packet.
  sequenceNumber: i64 = 0;
  // Tracked data in flight when the packet was sent, excluding unacked data.
  dataInFlight: DataSize = DataSize.Zero;

  clone(): SentPacket {
    const c = new SentPacket();
    c.sendTime = this.sendTime;
    c.size = this.size;
    c.priorUnackedData = this.priorUnackedData;
    c.pacingInfo = this.pacingInfo.clone();
    c.audio = this.audio;
    c.sequenceNumber = this.sequenceNumber;
    c.dataInFlight = this.dataInFlight;
    return c;
  }
}

export class ReceivedPacket {
  sendTime: Timestamp = Timestamp.MinusInfinity;
  receiveTime: Timestamp = Timestamp.PlusInfinity;
  size: DataSize = DataSize.Zero;
}

// Transport level feedback

export class RemoteBitrateReport {
  receiveTime: Timestamp = Timestamp.PlusInfinity;
  bandwidth: DataRate = DataRate.Infinity;
}

export class RoundTripTimeUpdate {
  receiveTime: Timestamp = Timestamp.PlusInfinity;
  roundTripTime: TimeDelta = TimeDelta.PlusInfinity;
  smoothed: bool = false;
}

export class TransportLossReport {
  receiveTime: Timestamp = Timestamp.PlusInfinity;
  startTime: Timestamp = Timestamp.PlusInfinity;
  endTime: Timestamp = Timestamp.PlusInfinity;
  packetsLostDelta: u64 = 0;
  packetsReceivedDelta: u64 = 0;
}

// Packet level feedback

// PacketResult::RtpPacketInfo.
export class RtpPacketInfo {
  ssrc: u32 = 0;
  rtpSequenceNumber: u16 = 0;
  isRetransmission: bool = false;

  clone(): RtpPacketInfo {
    const c = new RtpPacketInfo();
    c.ssrc = this.ssrc;
    c.rtpSequenceNumber = this.rtpSequenceNumber;
    c.isRetransmission = this.isRetransmission;
    return c;
  }
}

export class PacketResult {
  sentPacket: SentPacket = new SentPacket();
  receiveTime: Timestamp = Timestamp.PlusInfinity;
  // Delta from when feedback was sent and the packet was received. Can be used
  // for calculating round trip time per packet.
  arrivalTimeOffset: Optional<TimeDelta> | null = null;
  // Ecn marking from the feedback report how this packet was received.
  ecn: EcnMarking = EcnMarking.kNotEct;

  // Indicates if packet was sent with ECN marking 'ect1'.
  sentWithEct1: bool = false;

  // Indicates if packet was reported lost for the first time.
  reportedLostForTheFirstTime: bool = false;

  // Indicates if packet was recovered, i.e., previously feedback report marked
  // this packet as lost, but current report marks it as received.
  reportedRecoveredForTheFirstTime: bool = false;

  // `rtp_packet_info` is only set if the feedback is related to a RTP packet.
  rtpPacketInfo: RtpPacketInfo | null = null;

  isReceived(): bool {
    return !Unit.isPlusInfinity(this.receiveTime);
  }

  // PacketResult::ReceiveTimeOrder as a comparator for Array.sort.
  static receiveTimeOrder(lhs: PacketResult, rhs: PacketResult): i32 {
    if (lhs.receiveTime != rhs.receiveTime)
      return lhs.receiveTime < rhs.receiveTime ? -1 : 1;
    if (lhs.sentPacket.sendTime != rhs.sentPacket.sendTime)
      return lhs.sentPacket.sendTime < rhs.sentPacket.sendTime ? -1 : 1;
    if (lhs.sentPacket.sequenceNumber != rhs.sentPacket.sequenceNumber)
      return lhs.sentPacket.sequenceNumber < rhs.sentPacket.sequenceNumber ? -1 : 1;
    return 0;
  }

  clone(): PacketResult {
    const c = new PacketResult();
    c.sentPacket = this.sentPacket.clone();
    c.receiveTime = this.receiveTime;
    const offset = this.arrivalTimeOffset;
    c.arrivalTimeOffset = offset !== null ? new Optional<TimeDelta>(offset.value) : null;
    c.ecn = this.ecn;
    c.sentWithEct1 = this.sentWithEct1;
    c.reportedLostForTheFirstTime = this.reportedLostForTheFirstTime;
    c.reportedRecoveredForTheFirstTime = this.reportedRecoveredForTheFirstTime;
    const info = this.rtpPacketInfo;
    c.rtpPacketInfo = info !== null ? info.clone() : null;
    return c;
  }
}

export class TransportPacketsFeedback {
  feedbackTime: Timestamp = Timestamp.PlusInfinity;
  dataInFlight: DataSize = DataSize.Zero;

  transportSupportsEcn: bool = false;
  packetFeedbacks: PacketResult[] = [];
  // Arrival times for messages without send time information.
  sendlessArrivalTimes: Timestamp[] = [];

  receivedWithSendInfo(): PacketResult[] {
    const res: PacketResult[] = [];
    for (let i = 0; i < this.packetFeedbacks.length; ++i) {
      const fb = this.packetFeedbacks[i];
      if (fb.isReceived()) res.push(fb);
    }
    return res;
  }

  lostWithSendInfo(): PacketResult[] {
    const res: PacketResult[] = [];
    for (let i = 0; i < this.packetFeedbacks.length; ++i) {
      const fb = this.packetFeedbacks[i];
      if (!fb.isReceived()) res.push(fb);
    }
    return res;
  }

  packetsWithFeedback(): PacketResult[] {
    return this.packetFeedbacks.slice(0);
  }

  sortedByReceiveTime(): PacketResult[] {
    const res = this.receivedWithSendInfo();
    res.sort(PacketResult.receiveTimeOrder);
    return res;
  }

  // True if at least one packet is CE marked.
  hasPacketWithEcnCe(): bool {
    for (let i = 0; i < this.packetFeedbacks.length; ++i) {
      if (this.packetFeedbacks[i].ecn == EcnMarking.kCe) return true;
    }
    return false;
  }
}

// Network estimation

export class NetworkEstimate {
  atTime: Timestamp = Timestamp.PlusInfinity;
  // Deprecated, use TargetTransferRate::target_rate instead.
  bandwidth: DataRate = DataRate.Infinity;
  roundTripTime: TimeDelta = TimeDelta.PlusInfinity;
  lossRateRatio: f32 = 0;
}

// Network control

export class PacerConfig {
  static readonly kDefaultTimeInterval: TimeDelta = TimeDelta.Millis(40);

  static create(
    atTime: Timestamp,
    sendRate: DataRate,
    padRate: DataRate,
    timeWindow: TimeDelta = PacerConfig.kDefaultTimeInterval,
  ): PacerConfig {
    const pacerConfig = new PacerConfig();
    pacerConfig.atTime = atTime;
    pacerConfig.timeWindow = timeWindow;
    // Note that precision is lost here, since DataSize store number of bytes.
    pacerConfig.dataWindow = DataRate.mulTime(sendRate, pacerConfig.rateWindow());
    pacerConfig.padWindow = DataRate.mulTime(padRate, pacerConfig.rateWindow());
    return pacerConfig;
  }

  atTime: Timestamp = Timestamp.PlusInfinity;
  // Pacer should send at most data_window data over time_window duration.
  // If `time_window` is TimeDelta::Zero, Pacer should pace every packet as
  // accurate as possible and data_rate() is calculated as
  // data_window/TimeDelta::Seconds(1);
  dataWindow: DataSize = DataSize.Infinity;
  timeWindow: TimeDelta = TimeDelta.PlusInfinity;
  rateWindow(): TimeDelta {
    return Unit.isZero(this.timeWindow) ? TimeDelta.Seconds(1) : this.timeWindow;
  }
  // Pacer should send at least pad_window data over time_window duration.
  padWindow: DataSize = DataSize.Zero;

  dataRate(): DataRate { return DataRate.fromSizeAndDuration(this.dataWindow, this.rateWindow()); }
  padRate(): DataRate { return DataRate.fromSizeAndDuration(this.padWindow, this.rateWindow()); }
}

export class ProbeClusterConfig {
  atTime: Timestamp = Timestamp.PlusInfinity;
  targetDataRate: DataRate = DataRate.Zero;
  // Duration of a probe.
  targetDuration: TimeDelta = TimeDelta.Zero;
  // Delta time between sent bursts of packets during probe.
  minProbeDelta: TimeDelta = TimeDelta.Millis(2);
  targetProbeCount: i32 = 0;
  id: i32 = 0;
}

export class TargetTransferRate {
  atTime: Timestamp = Timestamp.PlusInfinity;
  // The estimate on which the target rate is based on.
  networkEstimate: NetworkEstimate = new NetworkEstimate();
  targetRate: DataRate = DataRate.Zero;
  cwndReduceRatio: f64 = 0;

  // True if WebRTC is actively sending near estimated link capacity (not in
  // ALR).
  isBandwidthLimited: bool = true;
}

// Contains updates of network controller comand state. Using optionals to
// indicate whether a member has been updated. The array of probe clusters
// should be used to send out probes if not empty.
export class NetworkControlUpdate {
  congestionWindow: Optional<DataSize> | null = null;
  pacerConfig: PacerConfig | null = null;
  probeClusterConfigs: ProbeClusterConfig[] = [];
  targetRate: TargetTransferRate | null = null;

  hasUpdates(): bool {
    return this.congestionWindow !== null || this.pacerConfig !== null ||
      this.probeClusterConfigs.length > 0 || this.targetRate !== null;
  }
}

// Process control

export class ProcessInterval {
  atTime: Timestamp = Timestamp.PlusInfinity;
  pacerQueue: Optional<DataSize> | null = null;
}

// Under development, subject to change without notice.
export class NetworkStateEstimate {
  confidence: f64 = NaN;
  // The time the estimate was received/calculated.
  updateTime: Timestamp = Timestamp.MinusInfinity;
  lastReceiveTime: Timestamp = Timestamp.MinusInfinity;
  lastSendTime: Timestamp = Timestamp.MinusInfinity;

  // Total estimated link capacity.
  linkCapacity: DataRate = DataRate.MinusInfinity;
  // Used as a safe measure of available capacity.
  linkCapacityLower: DataRate = DataRate.MinusInfinity;
  // Used as limit for increasing bitrate.
  linkCapacityUpper: DataRate = DataRate.MinusInfinity;

  preLinkBufferDelay: TimeDelta = TimeDelta.MinusInfinity;
  postLinkBufferDelay: TimeDelta = TimeDelta.MinusInfinity;
  propagationDelay: TimeDelta = TimeDelta.MinusInfinity;

  // Only for debugging
  timeDelta: TimeDelta = TimeDelta.MinusInfinity;
  lastFeedTime: Timestamp = Timestamp.MinusInfinity;
  crossDelayRate: f64 = NaN;
  spikeDelayRate: f64 = NaN;
  linkCapacityStdDev: DataRate = DataRate.MinusInfinity;
  linkCapacityMin: DataRate = DataRate.MinusInfinity;
  crossTrafficRatio: f64 = NaN;
}
