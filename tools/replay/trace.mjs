// goog-cc trace tooling (see README.md).
//   node tools/replay/trace.mjs record [name...]   -> build/traces/<name>.trace
//   node tools/replay/trace.mjs replay <file>      -> AssemblyScript port output
//   node tools/replay/trace.mjs compare [name...]  -> port vs upstream C++ (needs cpp/)
//   node tools/replay/trace.mjs update-golden      -> compare, then store the C++
//                                                    outputs in tests/golden/
//   node tools/replay/trace.mjs verify             -> port vs tests/golden/ (no C++)
//   node tools/replay/trace.mjs update-event-log-golden <log.rtc...>
//                                                 -> convert event logs, compare
//                                                    with C++, store trace + C++
//                                                    output in tests/golden/event-log/
//   node tools/replay/trace.mjs compare-file <trace...> -> port vs upstream C++ for
//                                                    given traces (e.g. converted
//                                                    from event logs)
import asc from "assemblyscript/asc";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {basename, dirname, join, relative} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const traces = join(root, "build", "traces");
const golden = join(root, "tests", "golden");
const eventLogGolden = join(golden, "event-log");

function firstDifference(port, reference) {
  const a = port.split("\n"), b = reference.split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; ++i) {
    if (a[i] !== b[i]) return {index: i, port: a[i] ?? "<end>", reference: b[i] ?? "<end>", total: a.length - 1};
  }
  return {index: -1, total: a.length - 1};
}

async function load(entry) {
  const out = join(root, "build", "tools", entry.replace(/\.ts$/, ".wasm"));
  mkdirSync(dirname(out), {recursive: true});
  const {error, stderr} = await asc.main([
    `tools/replay/${entry}`, "--outFile", relative(root, out), "--bindings", "esm",
    "--optimizeLevel", "3", "--exportRuntime",
  ], {stdout: process.stdout});
  if (error) throw new Error(stderr.toString());
  return import(pathToFileURL(out.replace(/\.wasm$/, ".js")).href);
}

function cppBinary() {
  const build = join(root, "build", "cpp-replay");
  const bin = join(build, "goog_cc_replay");
  if (!existsSync(join(root, "cpp", "modules", "congestion_controller", "goog_cc"))) {
    throw new Error("cpp/ (libwebrtc checkout) is missing, see CLAUDE.md");
  }
  execFileSync("cmake", ["-S", join(root, "tools", "cpp-replay"), "-B", build, "-G", "Ninja",
    "-DCMAKE_BUILD_TYPE=Release"], {stdio: "inherit"});
  execFileSync("ninja", ["-C", build], {stdio: "inherit"});
  return bin;
}

const [cmd, ...args] = process.argv.slice(2);
mkdirSync(traces, {recursive: true});

if (cmd === "record" || cmd === "compare" || cmd === "update-golden" || cmd === "verify") {
  const recorder = await load("record-trace.ts");
  const names = args.length > 0 ? args : recorder.scenarioNames().split(" ");
  const replayer = cmd !== "record" ? await load("replay.ts") : null;
  const bin = cmd === "compare" || cmd === "update-golden" ? cppBinary() : null;
  let failures = 0;
  for (const name of names) {
    const file = join(traces, `${name}.trace`);
    const trace = recorder.record(name);
    writeFileSync(file, trace);
    if (cmd === "record") {
      console.log(`${relative(root, file)}: ${trace.split("\n").length - 2} events`);
      continue;
    }
    const port = replayer.replay(trace);
    writeFileSync(join(traces, `${name}.port.txt`), port);
    let reference;
    if (cmd === "verify") {
      reference = readFileSync(join(golden, `${name}.cpp.txt`), "utf8");
    } else {
      reference = execFileSync(bin, {input: trace, maxBuffer: 1 << 30}).toString();
      writeFileSync(join(traces, `${name}.cpp.txt`), reference);
    }
    const d = firstDifference(port, reference);
    if (d.index < 0) {
      console.log(`${name}: identical to C++, ${d.total} updates`);
      if (cmd === "update-golden") {
        mkdirSync(golden, {recursive: true});
        writeFileSync(join(golden, `${name}.cpp.txt`), reference);
      }
    } else {
      failures++;
      console.log(`${name}: DIFFERS from C++ at update ${d.index + 1} of ${d.total}`);
      console.log(`  port: ${d.port}`);
      console.log(`  cpp:  ${d.reference}`);
    }
  }
  if (cmd === "verify" && args.length === 0 && existsSync(eventLogGolden)) {
    // Traces converted from event logs (tools/event-log), with C++ outputs.
    for (const file of readdirSync(eventLogGolden).filter((f) => f.endsWith(".trace")).sort()) {
      const name = file.replace(/\.trace$/, "");
      const port = replayer.replay(readFileSync(join(eventLogGolden, file), "utf8"));
      const d = firstDifference(port, readFileSync(join(eventLogGolden, `${name}.cpp.txt`), "utf8"));
      if (d.index < 0) {
        console.log(`event-log/${name}: identical to C++, ${d.total} updates`);
      } else {
        failures++;
        console.log(`event-log/${name}: DIFFERS from C++ at update ${d.index + 1} of ${d.total}`);
        console.log(`  port: ${d.port}`);
        console.log(`  cpp:  ${d.reference}`);
      }
    }
  }
  process.exit(failures ? 1 : 0);
} else if (cmd === "update-event-log-golden") {
  const {logToTrace} = await import("../event-log/log-to-trace.ts");
  const replayer = await load("replay.ts");
  const bin = cppBinary();
  mkdirSync(eventLogGolden, {recursive: true});
  let failures = 0;
  for (const file of args) {
    const name = basename(file).replace(/\.rtc$/, "");
    const trace = await logToTrace(new Uint8Array(readFileSync(file)));
    const port = replayer.replay(trace);
    const reference = execFileSync(bin, {input: trace, maxBuffer: 1 << 30}).toString();
    const d = firstDifference(port, reference);
    if (d.index < 0) {
      writeFileSync(join(eventLogGolden, `${name}.trace`), trace);
      writeFileSync(join(eventLogGolden, `${name}.cpp.txt`), reference);
      console.log(`event-log/${name}: identical to C++, ${d.total} updates, stored`);
    } else {
      failures++;
      console.log(`event-log/${name}: DIFFERS from C++ at update ${d.index + 1} of ${d.total}, not stored`);
      console.log(`  port: ${d.port}`);
      console.log(`  cpp:  ${d.reference}`);
    }
  }
  process.exit(failures ? 1 : 0);
} else if (cmd === "compare-file") {
  const replayer = await load("replay.ts");
  const bin = cppBinary();
  let failures = 0;
  for (const file of args) {
    const trace = readFileSync(file, "utf8");
    const port = replayer.replay(trace);
    const reference = execFileSync(bin, {input: trace, maxBuffer: 1 << 30}).toString();
    const d = firstDifference(port, reference);
    if (d.index < 0) {
      console.log(`${file}: identical to C++, ${d.total} updates`);
    } else {
      failures++;
      console.log(`${file}: DIFFERS from C++ at update ${d.index + 1} of ${d.total}`);
      console.log(`  port: ${d.port}`);
      console.log(`  cpp:  ${d.reference}`);
    }
  }
  process.exit(failures ? 1 : 0);
} else if (cmd === "replay") {
  const replayer = await load("replay.ts");
  process.stdout.write(replayer.replay(readFileSync(args[0], "utf8")));
} else {
  console.error("usage: trace.mjs record|replay|compare|compare-file|verify|update-golden ...");
  process.exit(2);
}
