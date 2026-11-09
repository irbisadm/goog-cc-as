// Replays a goog-cc trace (readme.md) through this port's
// GoogCcNetworkController and prints every update in the same format as the
// C++ driver in tools/cpp-replay.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../assembly/units";
import {Optional} from "../../assembly/types/optional";
import {SimulatedClock} from "../../assembly/system-wrappers/clock";
import {createEnvironment} from "../../assembly/api/environment/environment";
import {
  NetworkAvailability,
  NetworkControlUpdate,
  NetworkRouteChange,
  PacedPacketInfo,
  PacketResult,
  ProcessInterval,
  RemoteBitrateReport,
  RoundTripTimeUpdate,
  SentPacket,
  TransportLossReport,
  TransportPacketsFeedback,
} from "../../assembly/api/transport/network-types";
import {NetworkControllerConfig, NetworkControllerInterface} from "../../assembly/api/transport/network-control";
import {GoogCcNetworkController} from "../../assembly/modules/congestion-controller/goog-cc/goog-cc-network-control";

class Tokens {
  private i: i32 = 0;
  constructor(private parts: string[]) {}
  str(): string { return this.parts[this.i++]; }
  int(): i64 { return I64.parseInt(this.parts[this.i++]); }
  num(): f64 { return parseFloat(this.parts[this.i++]); }
}

function optRate(bps: i64): Optional<DataRate> | null {
  return bps < 0 ? null : new Optional<DataRate>(DataRate.BitsPerSec<i64>(bps));
}

function pacingInfo(t: Tokens): PacedPacketInfo {
  const cluster = <i32>t.int();
  const minProbes = <i32>t.int();
  const minBytes = <i32>t.int();
  return new PacedPacketInfo(cluster, minProbes, minBytes);
}

// printf("%.6f") for values produced by GoogCC (finite, small).
function fixed6(x: f64): string {
  const negative = x < 0;
  const v = <i64>Math.round(Math.abs(x) * 1e6);
  let frac = (v % 1000000).toString();
  while (frac.length < 6) frac = "0" + frac;
  return (negative && v != 0 ? "-" : "") + (v / 1000000).toString() + "." + frac;
}

function format(tUs: i64, u: NetworkControlUpdate): string {
  if (u.targetRate === null && u.pacerConfig === null && u.congestionWindow === null && u.probeClusterConfigs.length == 0) {
    return "";
  }
  let line = "update " + tUs.toString();
  const r = u.targetRate;
  if (r !== null) {
    const rtt = r.networkEstimate.roundTripTime;
    line += " target=" + DataRate.bps(r.targetRate).toString() +
      " loss=" + (<i64>Math.round(<f64>r.networkEstimate.lossRateRatio * 255.0)).toString() +
      " rtt=" + (Unit.isFinite(rtt) ? TimeDelta.us(rtt).toString() : "-1") +
      " limited=" + (r.isBandwidthLimited ? "1" : "0") +
      " cwnd_reduce=" + fixed6(r.cwndReduceRatio);
  }
  const p = u.pacerConfig;
  if (p !== null) {
    line += " pacer=" + DataSize.bytes(p.dataWindow).toString() + "/" + TimeDelta.us(p.timeWindow).toString() + "/" +
      DataSize.bytes(p.padWindow).toString();
  }
  const cwnd = u.congestionWindow;
  if (cwnd !== null) line += " cwnd=" + DataSize.bytes(cwnd.value).toString();
  if (u.probeClusterConfigs.length > 0) {
    line += " probes=";
    for (let i = 0; i < u.probeClusterConfigs.length; ++i) {
      const c = u.probeClusterConfigs[i];
      line += (i > 0 ? "," : "") + c.id.toString() + ":" + DataRate.bps(c.targetDataRate).toString() + ":" +
        TimeDelta.us(c.targetDuration).toString() + ":" + TimeDelta.us(c.minProbeDelta).toString() + ":" +
        c.targetProbeCount.toString();
    }
  }
  return line + "\n";
}

export function replay(trace: string): string {
  const lines = trace.split("\n");
  const out: string[] = [];
  let clock: SimulatedClock | null = null;
  let controller: NetworkControllerInterface | null = null;
  for (let li = 0; li < lines.length; ++li) {
    const line = lines[li];
    if (line.length == 0 || line.charAt(0) == "#") continue;
    const t = new Tokens(line.split(" "));
    const type = t.str();
    const tUs = t.int();
    const at = Timestamp.Micros<i64>(tUs);
    if (clock !== null && at > clock.currentTime()) clock.advanceTime(Unit.sub(at, clock.currentTime()));

    if (type == "init") {
      const minBps = t.int(), maxBps = t.int(), startBps = t.int();
      const maxAlloc = t.int(), minAlloc = t.int(), maxPad = t.int();
      const pacingFactor = t.num();
      const c = new SimulatedClock(at);
      clock = c;
      const config = new NetworkControllerConfig(createEnvironment(c));
      config.constraints.atTime = at;
      config.constraints.minDataRate = optRate(minBps);
      config.constraints.maxDataRate = optRate(maxBps);
      config.constraints.startingRate = optRate(startBps);
      config.streamBasedConfig.atTime = at;
      config.streamBasedConfig.maxTotalAllocatedBitrate = optRate(maxAlloc);
      config.streamBasedConfig.minTotalAllocatedBitrate = optRate(minAlloc);
      config.streamBasedConfig.maxPaddingRate = optRate(maxPad);
      if (pacingFactor >= 0) config.streamBasedConfig.pacingFactor = new Optional<f64>(pacingFactor);
      controller = new GoogCcNetworkController(config);
      continue;
    }
    const ctrl = controller!;
    let update: NetworkControlUpdate = new NetworkControlUpdate();
    if (type == "avail") {
      const msg = new NetworkAvailability();
      msg.atTime = at;
      msg.networkAvailable = t.int() != 0;
      update = ctrl.onNetworkAvailability(msg);
    } else if (type == "process") {
      const queue = t.int();
      const msg = new ProcessInterval();
      msg.atTime = at;
      if (queue >= 0) msg.pacerQueue = new Optional<DataSize>(DataSize.Bytes<i64>(queue));
      update = ctrl.onProcessInterval(msg);
    } else if (type == "sent") {
      const msg = new SentPacket();
      msg.sendTime = at;
      msg.sequenceNumber = t.int();
      msg.size = DataSize.Bytes<i64>(t.int());
      msg.dataInFlight = DataSize.Bytes<i64>(t.int());
      msg.pacingInfo = pacingInfo(t);
      msg.priorUnackedData = DataSize.Bytes<i64>(t.int());
      update = ctrl.onSentPacket(msg);
    } else if (type == "feedback") {
      const msg = new TransportPacketsFeedback();
      msg.feedbackTime = at;
      msg.dataInFlight = DataSize.Bytes<i64>(t.int());
      const n = t.int();
      for (let i: i64 = 0; i < n; ++i) {
        const r = new PacketResult();
        r.sentPacket.sequenceNumber = t.int();
        r.sentPacket.sendTime = Timestamp.Micros<i64>(t.int());
        r.sentPacket.size = DataSize.Bytes<i64>(t.int());
        const recv = t.int();
        r.receiveTime = recv < 0 ? Timestamp.PlusInfinity : Timestamp.Micros<i64>(recv);
        r.sentPacket.pacingInfo = pacingInfo(t);
        r.sentPacket.priorUnackedData = DataSize.Bytes<i64>(t.int());
        msg.packetFeedbacks.push(r);
      }
      update = ctrl.onTransportPacketsFeedback(msg);
    } else if (type == "rtt") {
      const msg = new RoundTripTimeUpdate();
      msg.receiveTime = at;
      msg.roundTripTime = TimeDelta.Micros<i64>(t.int());
      msg.smoothed = false;
      update = ctrl.onRoundTripTimeUpdate(msg);
    } else if (type == "loss") {
      const msg = new TransportLossReport();
      msg.receiveTime = at;
      msg.startTime = at;
      msg.endTime = at;
      msg.packetsLostDelta = <u64>t.int();
      msg.packetsReceivedDelta = <u64>t.int();
      update = ctrl.onTransportLossReport(msg);
    } else if (type == "remb") {
      const msg = new RemoteBitrateReport();
      msg.receiveTime = at;
      msg.bandwidth = DataRate.BitsPerSec<i64>(t.int());
      update = ctrl.onRemoteBitrateReport(msg);
    } else if (type == "route") {
      const msg = new NetworkRouteChange();
      msg.atTime = at;
      msg.constraints.atTime = at;
      msg.constraints.minDataRate = optRate(t.int());
      msg.constraints.maxDataRate = optRate(t.int());
      msg.constraints.startingRate = optRate(t.int());
      update = ctrl.onNetworkRouteChange(msg);
    } else {
      abort("unknown event: " + line);
      unreachable();
    }
    const formatted = format(tUs, update);
    if (formatted.length > 0) out.push(formatted);
  }
  return out.join("");
}
