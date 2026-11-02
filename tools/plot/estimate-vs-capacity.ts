// Runs GoogCC on the scenario simulator over a link whose capacity changes in
// steps and returns "time_s,capacity_kbps,target_kbps" samples every 100 ms.
// Used by tools/plot/plot.mjs to draw docs/estimate-vs-capacity.svg.
import {DataRate, TimeDelta} from "../../assembly/units";
import {Scenario} from "../../tests/assembly/scenario/scenario";
import {CallClientConfig} from "../../tests/assembly/scenario/call-client";
import {NetworkSimulationConfig} from "../../tests/assembly/scenario/network-node";

function link(capacityKbps: i64): NetworkSimulationConfig {
  const c = new NetworkSimulationConfig();
  c.bandwidth = DataRate.KilobitsPerSec(capacityKbps);
  c.delay = TimeDelta.Millis(50);
  return c;
}

export function run(): string {
  // [start second, capacity kbps]
  const steps: i64[] = [0, 1000, 25, 500, 45, 2000, 70, 300, 90, 1500];
  const durationS: i64 = 110;

  const s = new Scenario();
  const sendNet = s.createSimulationNode(link(steps[1]));
  const retNet = s.createSimulationNode(link(0));
  retNet.config.bandwidth = DataRate.Infinity;
  const config = new CallClientConfig();
  config.startRate = DataRate.KilobitsPerSec(300);
  config.maxRate = DataRate.KilobitsPerSec(3000);
  const client = s.createVideoSendingClient(config, [sendNet], [retNet]);

  let out = "time_s,capacity_kbps,target_kbps\n";
  let capacity = steps[1];
  let next = 2;
  for (let tenths: i64 = 0; tenths <= durationS * 10; ++tenths) {
    if (next < steps.length && tenths == steps[next] * 10) {
      capacity = steps[next + 1];
      sendNet.updateConfig(link(capacity));
      next += 2;
    }
    if (tenths > 0) s.runFor(TimeDelta.Millis(100));
    out += (<f64>tenths / 10).toString() + "," + capacity.toString() + "," +
      DataRate.kbps(client.targetRate()).toString() + "\n";
  }
  return out;
}
