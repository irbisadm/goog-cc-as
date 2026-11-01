# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard rules

- Commits use Conventional Commits with a DCO sign-off, e.g. `git commit -s -m "feat: alr detector"` (prefixes in use: `feat:`, `chore:`, `docs:`).

## Project

Port of libwebrtc's send-side congestion control (GoogCC) from C++ to AssemblyScript, pinned to upstream **M154** (`branch-heads/8037` @ `7cb44cfa`) (see readme.md "Upstream revision"). The readme also holds the per-component status table and the field-trial defaults table — update both when porting a component.

## Commands

```bash
nvm use                           # Node version from .nvmrc (24.x); run before npm/node commands
npm test                          # node tests/run.js: compile + run every tests/assembly/**/*.spec.ts
node tests/run.js <spec> [test]   # filter by spec path substring, then by test name substring
npm run asbuild                   # asc assembly/index.ts (debug + release) into build/
npm run test:trace                # replay simulator traces through the port, compare with tests/golden (C++ outputs)
npm run trace:compare             # same, against upstream C++ GoogCC built from cpp/ via tools/cpp-replay
```

`asbuild` only compiles exported *functions*; classes behind the `export *` in `assembly/index.ts` are not type-checked by it. AssemblyScript compiles code only when it is reached, so **the specs are the real compile check** — every ported class needs a spec that exercises it, generic helpers included (e.g. `TimeDelta.Millis<f64>`).

The test runner (`tests/run.js`) compiles each spec with `--bindings esm` into `build/tests/` and calls every exported `test_*` function; a failed expectation (`abort`) fails only that test. Assertions live in `tests/assembly/expect.ts` (`expectEq`, `expectNear`, `expectOptionalEq`, `expectHasValue`, ...). gmock mocks become recording subclasses (see `acknowledged-bitrate-estimator.spec.ts`). The port must stay bit-exact with upstream C++: after changing controller code run `npm run test:trace`; after changing the simulator (which changes the recorded traces) refresh the golden outputs with `node tools/replay/trace.mjs update-golden` (needs cpp/). `tools/replay/readme.md` documents the trace format. `tests/assembly/scenario/` is a test-only mini network simulator replacing upstream `test/scenario` for the `GoogCcScenario.*` tests; its header comment lists which upstream mechanisms it models. Upstream test helpers/fixtures are ported as non-spec modules next to the spec (e.g. `delay-based-bwe-unittest-helper.ts`). When upstream tests configure a component through field-trial strings, keep the strings and convert them with a test-only parser (shared helpers in `tests/assembly/field-trial-test-parser.ts`, per-component converters such as `loss-based-bwe-v2-test-config.ts`); the library never parses field trials. A test that hangs (e.g. an upstream `while (state != X)` loop) blocks the whole runner — there is no per-test timeout.

## Porting conventions

- `cpp/` — local, **gitignored** blob-less sparse git clone of upstream (`https://webrtc.googlesource.com/src`), checked out at the pinned revision. Read the C++ (and its `*_unittest.cc`) before porting or changing a file; never edit it. Add directories with `git -C cpp sparse-checkout add /<dir>/`. To re-sync with a newer milestone: `git -C cpp fetch origin refs/branch-heads/<N>:refs/remotes/origin/branch-heads/<N>`, then `git -C cpp diff <old> <new> -- <ported files>` and port the changes. `cpp.d44ecfe7/` is the old snapshot (the previous pin) and can be deleted.
- One upstream `.h/.cc` pair → one `.ts` file, same relative path, `snake_case` → `kebab-case` (`goog_cc/alr_detector.cc` → `goog-cc/alr-detector.ts`). Helper classes stay in the file of their upstream `.cc`. First line: `// Port of <upstream path> @ M154.`; specs mirror under `tests/assembly/`.
- Naming: members/methods → camelCase; `kConstant` names are kept.
- **Units** (`assembly/units/`) are `i64` type aliases in upstream scale (Timestamp/TimeDelta µs, DataRate bps, DataSize bytes), ±infinity = `I64.MAX_VALUE`/`I64.MIN_VALUE`. Each alias has a same-named namespace mirroring the C++ API: `TimeDelta.Millis(x)`, `TimeDelta.ms(d)`, `DataRate.kbps<f64>(r)`, `DataRate.fromSizeAndDuration(size, dt)` (C++ `size / dt`), `DataRate.timeToSend(size, rate)`, `DataRate.mulTime(rate, dt)`. `<`, `>`, `min`, `max` work directly; `+`/`-` that may involve infinities must use `Unit.add`/`Unit.sub`; `unit * double` → `Unit.mulF`, `unit / unit` → `Unit.ratio`. Integer accessors round to nearest like upstream.
- `std::optional<primitive>` → `Optional<T> | null` (`assembly/types/optional.ts`); optional structs → `Class | null`. In hot paths a `hasX` flag + value is fine.
- Field trials are **not parsed**: each component takes a config class whose defaults equal the upstream defaults; out-of-range handling mirrors upstream (`validate()` or reject-to-default). RtcEventLog and UMA metrics are dropped.
- C++ structs → classes with reference semantics; `clone()` where upstream mutates a copy (e.g. `RobustThroughputEstimator` window). C++ out-parameters → a private field or returned object.
- Time comes from `Environment.clock()` (`assembly/api/environment/environment.ts`), like upstream's `env_.clock().CurrentTime()`; tests use `createEnvironment(new SimulatedClock(...))`. Upstream `const Environment&` constructor args stay as the first parameter; the field-trial config object follows it.
- Keep upstream `float` vs `double` (`f32`/`f64`) — it affects results.
- AssemblyScript gotchas: a default parameter like `x: Foo = new Foo()` is resolved in the *caller's* file and fails to compile across modules — use `x: Foo | null = null` and construct inside. Don't name a directory `std/` (clashes with the AS stdlib in the entry file). A constructor cannot `return` early, and cannot touch `this` (fields or methods) until every non-nullable field is assigned — build values in locals first. No closures capturing locals; compare `u32` with literals as `x > 1000`, not `1000 < x`.
- The repo stores LF (`core.autocrlf=input`); some working-copy files have CRLF — either is fine.
