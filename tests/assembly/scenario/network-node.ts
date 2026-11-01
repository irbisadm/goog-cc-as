// Network node of the scenario simulator, modelled on upstream
// test/network/simulated_network.cc @ M154: a FIFO queue feeding a capacity
// link (serialization at `bandwidth`), an optional pause applied when a packet
// leaves the capacity link, random loss, then a constant delay link that never
// reorders packets.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../assembly/units";
import {SimEvent} from "./event-loop";
import {Simulation} from "./simulation";

// NetworkSimulationConfig (test/scenario/scenario_config.h).
export class NetworkSimulationConfig {
  bandwidth: DataRate = DataRate.Infinity;
  delay: TimeDelta = TimeDelta.Zero;
  lossRate: f64 = 0;
  // std::optional<int>; 0 = unlimited.
  packetQueueLengthLimit: i32 = 0;
}

export abstract class PacketSink {
  abstract onPacketReceived(packet: SimPacket, at: Timestamp): void;
}

export enum PacketKind {
  kMedia,
  kPadding,
  kFeedback,
  kRtcpSenderReport,
  kRtcpReceiverReport,
  kCross,
  kTcpData,
  kTcpAck,
}

export class SimPacket {
  kind: PacketKind = PacketKind.kMedia;
  size: DataSize = DataSize.Zero;
  route: NetworkNode[] = [];
  hop: i32 = 0;
  sink: PacketSink | null = null;
  // Kind specific payload.
  transportSeq: i64 = -1; // media/padding with transport-wide sequence number
  rtpSeq: i64 = -1; // media sequence number (for RTCP loss statistics)
  sequence: i64 = 0; // TCP / generic sequence
  sendTime: Timestamp = Timestamp.MinusInfinity; // abs-send-time stand-in
  payload: Object | null = null;
}

// Simple deterministic PRNG (xorshift64*), seeded per node.
export class Random {
  private state: u64;
  constructor(seed: u64) {
    this.state = seed != 0 ? seed : 0x9E3779B97F4A7C15;
  }
  nextDouble(): f64 {
    let x = this.state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    this.state = x;
    const r = x * 0x2545F4914F6CDD1D;
    return <f64>(r >> 11) / <f64>(<u64>1 << 53);
  }
}

class CapacityExitEvent extends SimEvent {
  constructor(private node: NetworkNode) { super(); }
  fire(now: Timestamp): void { this.node.onCapacityExit(now); }
}

class DeliveryEvent extends SimEvent {
  constructor(private node: NetworkNode, private packet: SimPacket) { super(); }
  fire(now: Timestamp): void { this.node.deliver(this.packet, now); }
}

export class NetworkNode {
  config: NetworkSimulationConfig;
  private queue: SimPacket[] = [];
  private inCapacityLink: SimPacket | null = null;
  private lastCapacityExit: Timestamp = Timestamp.MinusInfinity;
  private lastDelivery: Timestamp = Timestamp.MinusInfinity;
  private pauseUntil: Timestamp = Timestamp.MinusInfinity;
  private random: Random;

  constructor(private sim: Simulation, config: NetworkSimulationConfig, seed: u64) {
    this.config = config;
    this.random = new Random(seed);
  }

  updateConfig(config: NetworkSimulationConfig): void {
    this.config = config;
  }

  pauseTransmissionUntil(until: Timestamp): void {
    this.pauseUntil = until;
  }

  enqueue(packet: SimPacket, now: Timestamp): void {
    const limit = this.config.packetQueueLengthLimit;
    // The queue holds limit - 1 packets, one more is in the capacity link.
    if (limit > 0 && this.inCapacityLink !== null && this.queue.length >= limit - 1) {
      return; // dropped
    }
    this.queue.push(packet);
    if (this.inCapacityLink === null) this.startNext(now);
  }

  private startNext(now: Timestamp): void {
    if (this.queue.length == 0) return;
    const packet = this.queue.shift();
    this.inCapacityLink = packet;
    const start = max(now, this.lastCapacityExit);
    let exit = start;
    const bandwidth = this.config.bandwidth;
    if (Unit.isFinite(bandwidth)) {
      exit = Unit.add(start, TimeDelta.Micros<i64>(DataSize.bytes(packet.size) * 8 * 1000000 / DataRate.bps(bandwidth)));
    }
    this.sim.schedule(new CapacityExitEvent(this), exit);
  }

  onCapacityExit(now: Timestamp): void {
    const packet = this.inCapacityLink!;
    this.inCapacityLink = null;
    let arrival = now;
    // If the network is paused, the pause is implemented as an extra delay.
    if (this.pauseUntil > arrival) arrival = this.pauseUntil;
    this.lastCapacityExit = arrival;
    const lost = this.config.lossRate > 0 && this.random.nextDouble() < this.config.lossRate;
    if (!lost) {
      let delivery = Unit.add(arrival, this.config.delay);
      // Reordering is not allowed.
      if (delivery < this.lastDelivery) delivery = this.lastDelivery;
      this.lastDelivery = delivery;
      this.sim.schedule(new DeliveryEvent(this, packet), delivery);
    }
    this.startNext(now);
  }

  deliver(packet: SimPacket, now: Timestamp): void {
    packet.hop++;
    if (packet.hop < packet.route.length) {
      packet.route[packet.hop].enqueue(packet, now);
    } else {
      const sink = packet.sink;
      if (sink !== null) sink.onPacketReceived(packet, now);
    }
  }
}

// Sends `packet` through `route` to `sink`. An empty route delivers directly.
export function sendOnRoute(packet: SimPacket, route: NetworkNode[], sink: PacketSink | null, now: Timestamp): void {
  packet.route = route;
  packet.hop = 0;
  packet.sink = sink;
  if (route.length == 0) {
    if (sink !== null) sink.onPacketReceived(packet, now);
    return;
  }
  route[0].enqueue(packet, now);
}
