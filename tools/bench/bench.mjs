// Speed comparison: this port (AssemblyScript → wasm, run by Node's V8)
// against upstream C++ GoogCcNetworkController (clang -O3) on the same
// controller input. See README.md.
//
//   node tools/bench/bench.mjs [scenario...]   (needs cpp/, CMake, Ninja, abseil)
//
// Both sides parse each trace once into a flat array of numbers and then time
// only building the messages and calling the controller (a fresh controller
// per replay). A checksum over every update proves both did the same work.

import asc from "assemblyscript/asc";
import {execFileSync} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import {cpus} from "node:os";
import {dirname, join, relative} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "build", "bench");
mkdirSync(out, {recursive: true});

// Events replayed per timed round, and rounds per side (the median is reported).
const kEventsPerRound = 400_000;
const kRounds = 7;

async function compile(entry) {
  const outFile = join(out, entry.replace(/^.*\//, "").replace(/\.ts$/, ".wasm"));
  const {error, stderr} = await asc.main([
    entry, "--outFile", relative(root, outFile), "--bindings", "esm",
    "--optimizeLevel", "3", "--shrinkLevel", "0", "--noAssert", "--exportRuntime",
  ], {stdout: process.stdout});
  if (error) throw new Error(stderr.toString());
  return import(pathToFileURL(outFile.replace(/\.wasm$/, ".js")).href);
}

function cppBench() {
  const build = join(root, "build", "cpp-replay");
  execFileSync("cmake", ["-S", join(root, "tools", "cpp-replay"), "-B", build, "-G", "Ninja",
    "-DCMAKE_BUILD_TYPE=Release"], {stdio: ["ignore", "ignore", "inherit"]});
  execFileSync("ninja", ["-C", build, "goog_cc_bench"], {stdio: ["ignore", "ignore", "inherit"]});
  return join(build, "goog_cc_bench");
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const recorder = await compile("tools/replay/record-trace.ts");
const port = await compile("tools/bench/bench.ts");
const bin = cppBench();
const names = process.argv.length > 2 ? process.argv.slice(2) : recorder.scenarioNames().split(" ");

const rows = [];
for (const name of names) {
  const file = join(out, `${name}.trace`);
  const trace = recorder.record(name);
  writeFileSync(file, trace);
  const events = port.load(trace);
  const iterations = Math.max(1, Math.round(kEventsPerRound / events));

  const cpp = execFileSync(bin, [file, String(iterations), String(kRounds)]).toString();
  const cppChecksum = BigInt(cpp.match(/^checksum (\d+)$/m)[1]);
  const cppNs = [...cpp.matchAll(/^round_ns (\d+)$/gm)].map((m) => Number(m[1]));

  // Warm-up round (V8 tiers wasm up from Liftoff to TurboFan), then timed rounds.
  const portChecksum = BigInt.asUintN(64, BigInt(port.run(iterations)));
  const portNs = [];
  for (let r = 0; r < kRounds; ++r) {
    const start = process.hrtime.bigint();
    const sum = BigInt.asUintN(64, BigInt(port.run(iterations)));
    portNs.push(Number(process.hrtime.bigint() - start));
    if (sum !== portChecksum) throw new Error(`${name}: checksum changed between replays`);
  }
  if (portChecksum !== cppChecksum) {
    throw new Error(`${name}: port and C++ disagree (checksum ${portChecksum} vs ${cppChecksum})`);
  }
  const replays = iterations;
  const row = {
    name,
    events,
    cppUsPerReplay: median(cppNs) / replays / 1000,
    portUsPerReplay: median(portNs) / replays / 1000,
  };
  row.cppNsPerEvent = (row.cppUsPerReplay * 1000) / events;
  row.portNsPerEvent = (row.portUsPerReplay * 1000) / events;
  row.ratio = row.portUsPerReplay / row.cppUsPerReplay;
  rows.push(row);
  console.error(`${name}: ${events} events, C++ ${row.cppNsPerEvent.toFixed(0)} ns/event, wasm ${row.portNsPerEvent.toFixed(0)} ns/event (${row.ratio.toFixed(2)}×)`);
}

const clang = execFileSync("clang++", ["--version"]).toString().split("\n")[0];
const lines = [
  `CPU: ${cpus()[0].model}; Node ${process.version} (V8 ${process.versions.v8}); ${clang}, -O3; asc -O3 --noAssert; ` +
    `median of ${kRounds} rounds of ~${kEventsPerRound / 1000}k events.`,
  "",
  "| Trace | Events | C++ ns/event | wasm ns/event | wasm / C++ |",
  "|---|---:|---:|---:|---:|",
  ...rows.map((r) => `| ${r.name} | ${r.events} | ${r.cppNsPerEvent.toFixed(0)} | ${r.portNsPerEvent.toFixed(0)} | ${r.ratio.toFixed(2)}× |`),
];
writeFileSync(join(out, "results.json"), JSON.stringify(rows, null, 2) + "\n");
console.log(lines.join("\n"));
