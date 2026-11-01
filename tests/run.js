// Test runner for AssemblyScript specs.
//
// Every tests/assembly/**/*.spec.ts is compiled with asc into build/tests/,
// then every exported function whose name starts with `test_` is executed as
// an individual test case. A failed expectation (abort) fails only that case.
//
// Usage:
//   node tests/run.js                  run all specs
//   node tests/run.js <spec-filter>    run specs whose path contains the filter
//   node tests/run.js <spec> <test>    additionally filter test names
import asc from "assemblyscript/asc";
import {readdirSync, mkdirSync} from "node:fs";
import {join, relative, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specRoot = join(root, "tests", "assembly");
const outRoot = join(root, "build", "tests");
const [specFilter = "", testFilter = ""] = process.argv.slice(2);

function findSpecs(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findSpecs(path);
    return entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

const specs = findSpecs(specRoot)
  .filter((path) => relative(specRoot, path).includes(specFilter))
  .sort();

let passed = 0;
let failed = 0;
let compileErrors = 0;

for (const spec of specs) {
  const name = relative(specRoot, spec).replace(/\.spec\.ts$/, "");
  const outFile = join(outRoot, `${name}.wasm`);
  mkdirSync(dirname(outFile), {recursive: true});

  const {error, stderr} = await asc.main([
    relative(root, spec),
    "--outFile", relative(root, outFile),
    "--bindings", "esm",
    "--debug",
    "--sourceMap",
    "--exportRuntime",
  ], {stdout: process.stdout});
  if (error) {
    compileErrors++;
    console.log(`\n✗ ${name}: compilation failed\n${stderr.toString()}`);
    continue;
  }

  const module = await import(pathToFileURL(outFile.replace(/\.wasm$/, ".js")).href + `?t=${Date.now()}`);
  const tests = Object.keys(module)
    .filter((key) => key.startsWith("test_") && typeof module[key] === "function")
    .filter((key) => key.includes(testFilter));

  console.log(`\n${name}`);
  for (const test of tests) {
    try {
      module[test]();
      passed++;
      console.log(`  ✓ ${test.slice(5)}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${test.slice(5)}\n      ${e.message}`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed${compileErrors ? `, ${compileErrors} spec(s) failed to compile` : ""}`);
process.exit(failed || compileErrors ? 1 : 0);
