// The converter must reproduce the stored traces in tests/golden/event-log/
// from the event logs they were made from (copies of rtc-event-log's golden
// logs, stored next to them).

import assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

import {logToTrace} from "./log-to-trace.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const golden = join(root, "tests", "golden", "event-log");

for (const file of readdirSync(golden).filter((f) => f.endsWith(".trace"))) {
  const name = file.replace(/\.trace$/, "");
  test(`log-to-trace ${name}`, async () => {
    const trace = await logToTrace(new Uint8Array(readFileSync(join(golden, `${name}.rtc`))));
    assert.equal(trace, readFileSync(join(golden, file), "utf8"));
  });
}
