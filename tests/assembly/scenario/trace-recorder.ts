// Records every input of the network controller as a goog-cc trace (format:
// tools/replay/readme.md), so the same input can be replayed through this port
// and through upstream C++ GoogCC.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../assembly/units";
import {Optional} from "../../../assembly/types/optional";
import {
  PacedPacketInfo,
  SentPacket,
  StreamsConfig,
  TargetRateConstraints,
  TransportPacketsFeedback,
} from "../../../assembly/api/transport/network-types";

function optBps(rate: Optional<DataRate> | null): string {
  return rate !== null ? DataRate.bps(rate.value).toString() : "-1";
}

function pacing(info: PacedPacketInfo): string {
  return info.probeClusterId.toString() + " " + info.probeClusterMinProbes.toString() + " " +
    info.probeClusterMinBytes.toString();
}

function us(t: Timestamp): string {
  return Timestamp.us(t).toString();
}

export class TraceRecorder {
  private parts: string[] = ["# goog-cc-trace v1\n"];

  init(at: Timestamp, constraints: TargetRateConstraints, streams: StreamsConfig): void {
    const factor = streams.pacingFactor;
    this.add("init " + us(at) + " " + optBps(constraints.minDataRate) + " " + optBps(constraints.maxDataRate) + " " +
      optBps(constraints.startingRate) + " " + optBps(streams.maxTotalAllocatedBitrate) + " " +
      optBps(streams.minTotalAllocatedBitrate) + " " + optBps(streams.maxPaddingRate) + " " +
      (factor !== null ? factor.value.toString() : "-1"));
  }

  availability(at: Timestamp, available: bool): void {
    this.add("avail " + us(at) + " " + (available ? "1" : "0"));
  }

  process(at: Timestamp, pacerQueue: Optional<DataSize> | null): void {
    this.add("process " + us(at) + " " + (pacerQueue !== null ? DataSize.bytes(pacerQueue.value).toString() : "-1"));
  }

  sent(packet: SentPacket): void {
    this.add("sent " + us(packet.sendTime) + " " + packet.sequenceNumber.toString() + " " +
      DataSize.bytes(packet.size).toString() + " " + DataSize.bytes(packet.dataInFlight).toString() + " " +
      pacing(packet.pacingInfo));
  }

  feedback(msg: TransportPacketsFeedback): void {
    let line = "feedback " + us(msg.feedbackTime) + " " + DataSize.bytes(msg.dataInFlight).toString() + " " +
      msg.packetFeedbacks.length.toString();
    for (let i = 0; i < msg.packetFeedbacks.length; ++i) {
      const p = msg.packetFeedbacks[i];
      line += " " + p.sentPacket.sequenceNumber.toString() + " " + us(p.sentPacket.sendTime) + " " +
        DataSize.bytes(p.sentPacket.size).toString() + " " + (p.isReceived() ? us(p.receiveTime) : "-1") + " " +
        pacing(p.sentPacket.pacingInfo);
    }
    this.add(line);
  }

  rtt(at: Timestamp, rtt: TimeDelta): void {
    this.add("rtt " + us(at) + " " + TimeDelta.us(rtt).toString());
  }

  loss(at: Timestamp, lost: u64, received: u64): void {
    this.add("loss " + us(at) + " " + lost.toString() + " " + received.toString());
  }

  remb(at: Timestamp, bitrate: DataRate): void {
    this.add("remb " + us(at) + " " + DataRate.bps(bitrate).toString());
  }

  route(at: Timestamp, constraints: TargetRateConstraints): void {
    this.add("route " + us(at) + " " + optBps(constraints.minDataRate) + " " + optBps(constraints.maxDataRate) + " " +
      optBps(constraints.startingRate));
  }

  toString(): string {
    return this.parts.join("");
  }

  private add(line: string): void {
    this.parts.push(line + "\n");
  }
}
