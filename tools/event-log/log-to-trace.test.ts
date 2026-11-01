// The converter must reproduce the stored traces in tests/golden/event-log/
// from the event logs they were made from (rtc-event-log's golden logs, in a
// sibling checkout). Skipped without the parser or the logs.

import assert from "node:assert/strict";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

import {logToTrace} from "./log-to-trace.ts";
import {loadRtcEventLog} from "./rtc-event-log.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const golden = join(root, "tests", "golden", "event-log");
const logs = join(root, "..", "rtc-event-log", "test", "logging", "rtc-event-log", "golden");

const available = (await loadRtcEventLog()) !== null && existsSync(logs);

for (const file of readdirSync(golden).filter((f) => f.endsWith(".trace"))) {
  const name = file.replace(/\.trace$/, "");
  test(`log-to-trace ${name}`, {skip: available ? false : "rtc-event-log or its golden logs not available"}, async () => {
    const trace = await logToTrace(new Uint8Array(readFileSync(join(logs, `${name}.rtc`))));
    assert.equal(trace, readFileSync(join(golden, file), "utf8"));
  });
}
