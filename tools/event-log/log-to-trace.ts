// Converts an RtcEventLog (new format) into a goog-cc trace v2:
//
//   node tools/event-log/log-to-trace.ts <log.rtc> [out.trace]
//
// Then e.g. `node tools/replay/trace.mjs replay out.trace`.

import {readFileSync, writeFileSync} from "node:fs";

import {LogBasedNetworkControllerSimulation} from "./log-simulation.ts";
import {rtcEventLog} from "./rtc-event-log.ts";

export async function logToTrace(bytes: Uint8Array): Promise<string> {
  const log = new rtcEventLog.ParsedRtcEventLog();
  const status = log.parseString(bytes);
  if (!status.ok()) throw new Error(`failed to parse the event log: ${status.message()}`);
  const simulation = new LogBasedNetworkControllerSimulation(rtcEventLog);
  simulation.processEventsInLog(log);
  return simulation.trace();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error("usage: node tools/event-log/log-to-trace.ts <log.rtc> [out.trace]");
    process.exit(2);
  }
  const trace = await logToTrace(new Uint8Array(readFileSync(input)));
  if (output) writeFileSync(output, trace);
  else process.stdout.write(trace);
}
