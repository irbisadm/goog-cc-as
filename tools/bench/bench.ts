// Speed benchmark of this port's GoogCcNetworkController (see readme.md).
// load() parses a goog-cc trace once into a flat array of numbers; run()
// replays it `iterations` times through a fresh controller each time. The
// timed part builds the messages and calls the controller, like the C++
// driver in tools/cpp-replay/bench.cc, so trace parsing and output formatting
// are not measured.
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

// Event codes in the flat array; must match tools/cpp-replay/bench.cc.
const kInit: i64 = 0, kAvail: i64 = 1, kProcess: i64 = 2, kSent: i64 = 3, kFeedback: i64 = 4;
const kRtt: i64 = 5, kLoss: i64 = 6, kRemb: i64 = 7, kRoute: i64 = 8;

let data: i64[] = [];
let numEvents: i32 = 0;

// Parses `trace` (tools/replay/readme.md); returns the number of events.
export function load(trace: string): i32 {
  data = [];
  numEvents = 0;
  const lines = trace.split("\n");
  for (let li = 0; li < lines.length; ++li) {
    const line = lines[li];
    if (line.length == 0 || line.charAt(0) == "#") continue;
    const parts = line.split(" ");
    const type = parts[0];
    let code: i64 = -1;
    if (type == "init") code = kInit;
    else if (type == "avail") code = kAvail;
    else if (type == "process") code = kProcess;
    else if (type == "sent") code = kSent;
    else if (type == "feedback") code = kFeedback;
    else if (type == "rtt") code = kRtt;
    else if (type == "loss") code = kLoss;
    else if (type == "remb") code = kRemb;
    else if (type == "route") code = kRoute;
    else abort("unknown event: " + line);
    data.push(code);
    for (let i = 1; i < parts.length; ++i) {
      // The init line's pacing factor is a double; store its bits.
      data.push(code == kInit && i == 8 ? reinterpret<i64>(parseFloat(parts[i])) : I64.parseInt(parts[i]));
    }
    numEvents++;
  }
  return numEvents;
}

function optRate(bps: i64): Optional<DataRate> | null {
  return bps < 0 ? null : new Optional<DataRate>(DataRate.BitsPerSec<i64>(bps));
}

// Folds an update into the checksum (same formula as the C++ driver).
function fold(sum: i64, u: NetworkControlUpdate): i64 {
  const r = u.targetRate;
  if (r !== null) sum = sum * 31 + DataRate.bps(r.targetRate);
  const p = u.pacerConfig;
  if (p !== null) sum = sum * 31 + DataSize.bytes(p.dataWindow);
  const cwnd = u.congestionWindow;
  if (cwnd !== null) sum = sum * 31 + DataSize.bytes(cwnd.value);
  sum = sum * 31 + <i64>u.probeClusterConfigs.length;
  return sum;
}

function replayOnce(): i64 {
  let sum: i64 = 0;
  let clock: SimulatedClock | null = null;
  let controller: NetworkControllerInterface | null = null;
  let i = 0;
  const n = data.length;
  while (i < n) {
    const code = data[i++];
    const tUs = data[i++];
    const at = Timestamp.Micros<i64>(tUs);
    if (clock !== null && at > clock.currentTime()) clock.advanceTime(Unit.sub(at, clock.currentTime()));
    if (code == kInit) {
      const minBps = data[i++], maxBps = data[i++], startBps = data[i++];
      const maxAlloc = data[i++], minAlloc = data[i++], maxPad = data[i++];
      const pacingFactor = reinterpret<f64>(data[i++]);
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
    let update: NetworkControlUpdate;
    if (code == kAvail) {
      const msg = new NetworkAvailability();
      msg.atTime = at;
      msg.networkAvailable = data[i++] != 0;
      update = ctrl.onNetworkAvailability(msg);
    } else if (code == kProcess) {
      const queue = data[i++];
      const msg = new ProcessInterval();
      msg.atTime = at;
      if (queue >= 0) msg.pacerQueue = new Optional<DataSize>(DataSize.Bytes<i64>(queue));
      update = ctrl.onProcessInterval(msg);
    } else if (code == kSent) {
      const msg = new SentPacket();
      msg.sendTime = at;
      msg.sequenceNumber = data[i++];
      msg.size = DataSize.Bytes<i64>(data[i++]);
      msg.dataInFlight = DataSize.Bytes<i64>(data[i++]);
      const cluster = <i32>data[i++], minProbes = <i32>data[i++], minBytes = <i32>data[i++];
      msg.pacingInfo = new PacedPacketInfo(cluster, minProbes, minBytes);
      msg.priorUnackedData = DataSize.Bytes<i64>(data[i++]);
      update = ctrl.onSentPacket(msg);
    } else if (code == kFeedback) {
      const msg = new TransportPacketsFeedback();
      msg.feedbackTime = at;
      msg.dataInFlight = DataSize.Bytes<i64>(data[i++]);
      const count = data[i++];
      for (let k: i64 = 0; k < count; ++k) {
        const r = new PacketResult();
        r.sentPacket.sequenceNumber = data[i++];
        r.sentPacket.sendTime = Timestamp.Micros<i64>(data[i++]);
        r.sentPacket.size = DataSize.Bytes<i64>(data[i++]);
        const recv = data[i++];
        r.receiveTime = recv < 0 ? Timestamp.PlusInfinity : Timestamp.Micros<i64>(recv);
        const cluster = <i32>data[i++], minProbes = <i32>data[i++], minBytes = <i32>data[i++];
        r.sentPacket.pacingInfo = new PacedPacketInfo(cluster, minProbes, minBytes);
        r.sentPacket.priorUnackedData = DataSize.Bytes<i64>(data[i++]);
        msg.packetFeedbacks.push(r);
      }
      update = ctrl.onTransportPacketsFeedback(msg);
    } else if (code == kRtt) {
      const msg = new RoundTripTimeUpdate();
      msg.receiveTime = at;
      msg.roundTripTime = TimeDelta.Micros<i64>(data[i++]);
      msg.smoothed = false;
      update = ctrl.onRoundTripTimeUpdate(msg);
    } else if (code == kLoss) {
      const msg = new TransportLossReport();
      msg.receiveTime = at;
      msg.startTime = at;
      msg.endTime = at;
      msg.packetsLostDelta = <u64>data[i++];
      msg.packetsReceivedDelta = <u64>data[i++];
      update = ctrl.onTransportLossReport(msg);
    } else if (code == kRemb) {
      const msg = new RemoteBitrateReport();
      msg.receiveTime = at;
      msg.bandwidth = DataRate.BitsPerSec<i64>(data[i++]);
      update = ctrl.onRemoteBitrateReport(msg);
    } else {
      const msg = new NetworkRouteChange();
      msg.atTime = at;
      msg.constraints.atTime = at;
      msg.constraints.minDataRate = optRate(data[i++]);
      msg.constraints.maxDataRate = optRate(data[i++]);
      msg.constraints.startingRate = optRate(data[i++]);
      update = ctrl.onNetworkRouteChange(msg);
    }
    sum = fold(sum, update);
  }
  return sum;
}

// Replays the loaded trace `iterations` times; returns the checksum of the
// last replay (the same for every replay).
export function run(iterations: i32): i64 {
  let sum: i64 = 0;
  for (let it = 0; it < iterations; ++it) sum = replayOnce();
  return sum;
}
