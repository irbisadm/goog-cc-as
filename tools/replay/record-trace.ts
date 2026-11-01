// Records goog-cc traces from the scenario simulator (tests/assembly/scenario).
// Only default field trials are recorded: the C++ driver runs with none.
import {DataRate, TimeDelta, Unit} from "../../assembly/units";
import {Scenario} from "../../tests/assembly/scenario/scenario";
import {CallClientConfig, VideoStreamConfig} from "../../tests/assembly/scenario/call-client";
import {NetworkSimulationConfig} from "../../tests/assembly/scenario/network-node";
import {TraceRecorder} from "../../tests/assembly/scenario/trace-recorder";

function link(capacityKbps: i64, delayMs: i64, loss: f64 = 0): NetworkSimulationConfig {
  const c = new NetworkSimulationConfig();
  c.bandwidth = capacityKbps > 0 ? DataRate.KilobitsPerSec(capacityKbps) : DataRate.Infinity;
  c.delay = TimeDelta.Millis(delayMs);
  c.lossRate = loss;
  return c;
}

export function scenarioNames(): string {
  return "capacity-steps loss-10pct no-feedback route-change remb-cap";
}

export function record(name: string): string {
  const s = new Scenario();
  const recorder = new TraceRecorder();
  const config = new CallClientConfig();
  config.traceRecorder = recorder;
  if (name == "capacity-steps") {
    // Same link as docs/estimate-vs-capacity.svg.
    const steps: i64[] = [0, 1000, 25, 500, 45, 2000, 70, 300, 90, 1500];
    const sendNet = s.createSimulationNode(link(1000, 50));
    s.createVideoSendingClient(config, [sendNet], [s.createSimulationNode(link(0, 50))]);
    for (let i = 2; i < steps.length; i += 2) {
      s.runFor(TimeDelta.Seconds(steps[i] - steps[i - 2]));
      sendNet.updateConfig(link(steps[i + 1], 50));
    }
    s.runFor(TimeDelta.Seconds(20));
  } else if (name == "loss-10pct") {
    config.startRate = DataRate.KilobitsPerSec(300);
    config.maxRate = DataRate.KilobitsPerSec(1500);
    s.createVideoSendingClient(config, [s.createSimulationNode(link(2000, 200, 0.1))], [s.createSimulationNode(link(0, 200))]);
    s.runFor(TimeDelta.Seconds(60));
  } else if (name == "no-feedback") {
    config.startRate = DataRate.KilobitsPerSec(1000);
    const video = new VideoStreamConfig();
    video.packetFeedback = false;
    const net = s.createSimulationNode(link(1000, 100));
    s.createVideoSendingClient(config, [net], [s.createSimulationNode(link(0, 0))], video);
    s.runFor(TimeDelta.Seconds(20));
    net.updateConfig(link(1000, 100, 0.15));
    s.runFor(TimeDelta.Seconds(20));
  } else if (name == "route-change") {
    const a = s.createSimulationNode(link(200, 50));
    const b = s.createSimulationNode(link(800, 50));
    const client = s.createVideoSendingClient(config, [a], [s.createSimulationNode(link(0, 0))]);
    s.runFor(TimeDelta.Seconds(5));
    client.updateNetworkAdapterId(1);
    s.changeRoute(client, [b]);
    s.runFor(TimeDelta.Seconds(10));
  } else if (name == "remb-cap") {
    config.startRate = DataRate.KilobitsPerSec(1000);
    const client = s.createVideoSendingClient(config, [s.createSimulationNode(link(2000, 50))], [s.createSimulationNode(link(2000, 50))]);
    s.runFor(TimeDelta.Seconds(10));
    client.setRemoteBitrate(DataRate.KilobitsPerSec(250));
    s.runFor(TimeDelta.Seconds(1));
    client.setRemoteBitrate(DataRate.KilobitsPerSec(10000));
    s.runFor(TimeDelta.Seconds(10));
  } else {
    abort("unknown scenario " + name);
  }
  return recorder.toString();
}
