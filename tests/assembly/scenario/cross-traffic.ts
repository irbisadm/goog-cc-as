// Cross traffic for the scenario simulator.
//  - triggerPacketBurst: Scenario::TriggerPacketBurst.
//  - FakeTcpCrossTraffic: port of test/network/cross_traffic.cc @ M154.
import {DataSize, TimeDelta, Timestamp, Unit} from "../../../assembly/units";
import {SimEvent} from "./event-loop";
import {NetworkNode, PacketKind, PacketSink, SimPacket, sendOnRoute} from "./network-node";
import {Simulation} from "./simulation";

export function triggerPacketBurst(sim: Simulation, route: NetworkNode[], numPackets: i32, packetSize: i64): void {
  for (let i = 0; i < numPackets; ++i) {
    const packet = new SimPacket();
    packet.kind = PacketKind.kCross;
    packet.size = DataSize.Bytes(packetSize);
    sendOnRoute(packet, route, null, sim.now());
  }
}

// FakeTcpConfig (api/test/network_emulation/cross_traffic.h).
export class FakeTcpConfig {
  packetSize: DataSize = DataSize.Bytes(1200);
  sendLimit: DataSize = DataSize.PlusInfinity;
  processInterval: TimeDelta = TimeDelta.Millis(200);
  packetTimeout: TimeDelta = TimeDelta.Seconds(1);
}

class TcpProcessEvent extends SimEvent {
  constructor(private tcp: FakeTcpCrossTraffic) { super(); }
  fire(now: Timestamp): void { this.tcp.onProcessTimer(now); }
}

// Receives data packets and answers with ACKs.
class TcpReceiver extends PacketSink {
  constructor(private tcp: FakeTcpCrossTraffic) { super(); }
  onPacketReceived(packet: SimPacket, at: Timestamp): void { this.tcp.onRequest(<i32>packet.sequence, at); }
}

// Receives ACKs back at the TCP sender.
class TcpSender extends PacketSink {
  constructor(private tcp: FakeTcpCrossTraffic) { super(); }
  onPacketReceived(packet: SimPacket, at: Timestamp): void { this.tcp.onResponse(<i32>packet.sequence, at); }
}

export class FakeTcpCrossTraffic {
  private cwnd: f64 = 10;
  private ssthresh: f64 = Infinity;
  private ackReceived: bool = false;
  private lastAckedSeqNum: i32 = 0;
  private nextSequenceNumber: i32 = 0;
  private lastReductionTime: Timestamp = Timestamp.MinusInfinity;
  private lastRtt: TimeDelta = TimeDelta.Zero;
  private totalSent: DataSize = DataSize.Zero;
  private inFlight: Map<i32, Timestamp> = new Map<i32, Timestamp>();
  private running: bool = false;
  private receiver: TcpReceiver | null = null;
  private sender: TcpSender | null = null;

  constructor(
    private sim: Simulation,
    private conf: FakeTcpConfig,
    private sendRoute: NetworkNode[],
    private retRoute: NetworkNode[],
  ) {
    this.receiver = new TcpReceiver(this);
    this.sender = new TcpSender(this);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.sim.schedule(new TcpProcessEvent(this), this.sim.now());
  }

  stop(): void {
    this.running = false;
  }

  onProcessTimer(now: Timestamp): void {
    if (!this.running) return;
    this.sendPackets(now);
    this.sim.schedule(new TcpProcessEvent(this), Unit.add(now, this.conf.processInterval));
  }

  onRequest(sequenceNumber: i32, at: Timestamp): void {
    const kAckPacketSize: i64 = 20;
    const ack = new SimPacket();
    ack.kind = PacketKind.kTcpAck;
    ack.size = DataSize.Bytes(kAckPacketSize);
    ack.sequence = sequenceNumber;
    sendOnRoute(ack, this.retRoute, this.sender!, at);
  }

  onResponse(sequenceNumber: i32, at: Timestamp): void {
    if (!this.running) return;
    this.ackReceived = true;
    if (this.inFlight.has(sequenceNumber)) {
      this.lastRtt = Unit.sub(at, this.inFlight.get(sequenceNumber));
      this.inFlight.delete(sequenceNumber);
    }
    if (sequenceNumber - this.lastAckedSeqNum > 1) {
      this.handleLoss(at);
    } else if (this.cwnd <= this.ssthresh) {
      this.cwnd += 1;
    } else {
      this.cwnd += 1.0 / this.cwnd;
    }
    this.lastAckedSeqNum = max(sequenceNumber, this.lastAckedSeqNum);
    this.sendPackets(at);
  }

  private handleLoss(at: Timestamp): void {
    if (Unit.sub(at, this.lastReductionTime) < this.lastRtt) return;
    this.lastReductionTime = at;
    this.ssthresh = <f64>max(this.inFlight.size / 2, 2);
    this.cwnd = this.ssthresh;
  }

  private sendPackets(at: Timestamp): void {
    const cwnd = <i32>Math.ceil(this.cwnd);
    const packetsToSend = max(cwnd - this.inFlight.size, 0);
    let timeouts = false;
    const keys = this.inFlight.keys();
    const timeoutLimit = Unit.sub(at, this.conf.packetTimeout);
    for (let i = 0; i < keys.length; ++i) {
      if (this.inFlight.get(keys[i]) < timeoutLimit) {
        this.inFlight.delete(keys[i]);
        timeouts = true;
      }
    }
    if (timeouts) this.handleLoss(at);
    for (let i = 0; i < packetsToSend; ++i) {
      if (Unit.add(this.totalSent, this.conf.packetSize) > this.conf.sendLimit) break;
      this.inFlight.set(this.nextSequenceNumber, at);
      const packet = new SimPacket();
      packet.kind = PacketKind.kTcpData;
      packet.size = this.conf.packetSize;
      packet.sequence = this.nextSequenceNumber++;
      sendOnRoute(packet, this.sendRoute, this.receiver!, at);
      this.totalSent = Unit.add(this.totalSent, this.conf.packetSize);
    }
  }
}
