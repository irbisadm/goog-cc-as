// Draws docs/estimate-vs-capacity.svg: GoogCC target rate vs. link capacity on
// the scenario simulator. Usage: npm run plot
import asc from "assemblyscript/asc";
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "build", "tools", "estimate-vs-capacity.wasm");
mkdirSync(dirname(out), {recursive: true});
const {error, stderr} = await asc.main([
  "tools/plot/estimate-vs-capacity.ts", "--outFile", "build/tools/estimate-vs-capacity.wasm",
  "--bindings", "esm", "--optimizeLevel", "3", "--exportRuntime",
], {stdout: process.stdout});
if (error) {
  console.error(stderr.toString());
  process.exit(1);
}
const {run} = await import(pathToFileURL(out.replace(/\.wasm$/, ".js")).href);
const rows = run().trim().split("\n").slice(1).map((l) => l.split(",").map(Number));
writeFileSync(join(root, "build", "tools", "estimate-vs-capacity.csv"), "time_s,capacity_kbps,target_kbps\n" +
  rows.map((r) => r.join(",")).join("\n") + "\n");

const W = 800, H = 360, L = 64, R = 20, T = 40, B = 48;
const tMax = rows[rows.length - 1][0];
const yMax = Math.ceil(Math.max(...rows.map((r) => Math.max(r[1], r[2]))) / 500) * 500;
const x = (t) => (L + (t / tMax) * (W - L - R)).toFixed(1);
const y = (v) => (T + (1 - v / yMax) * (H - T - B)).toFixed(1);
const line = (i) => rows.map((r) => `${x(r[0])},${y(r[i])}`).join(" ");
// Capacity as a step function.
const steps = [];
rows.forEach((r, k) => {
  if (k > 0 && r[1] !== rows[k - 1][1]) steps.push(`${x(r[0])},${y(rows[k - 1][1])}`);
  steps.push(`${x(r[0])},${y(r[1])}`);
});
const yTicks = [];
for (let v = 0; v <= yMax; v += 500) yTicks.push(v);
const xTicks = [];
for (let t = 0; t <= tMax; t += 10) xTicks.push(t);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">
<style>
  .bg { fill: #ffffff } .grid { stroke: #e5e7eb } .axis { fill: #4b5563 } .title { fill: #111827 }
  .cap { stroke: #9ca3af; stroke-dasharray: 6 4 } .est { stroke: #2563eb }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #0f172a } .grid { stroke: #1f2937 } .axis { fill: #9ca3af } .title { fill: #e5e7eb }
    .cap { stroke: #6b7280 } .est { stroke: #60a5fa }
  }
</style>
<rect class="bg" width="${W}" height="${H}"/>
<text class="title" x="${L}" y="22" font-size="14" font-weight="600">GoogCC target rate vs. link capacity (mini simulator, 50 ms one-way delay)</text>
${yTicks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v)}" dy="4" text-anchor="end">${v}</text>`).join("\n")}
${xTicks.map((t) => `<text class="axis" x="${x(t)}" y="${H - B + 18}" text-anchor="middle">${t}</text>`).join("\n")}
<text class="axis" x="${(L + W - R) / 2}" y="${H - 10}" text-anchor="middle">time, s</text>
<text class="axis" transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">kbps</text>
<polyline class="cap" fill="none" stroke-width="2" points="${steps.join(" ")}"/>
<polyline class="est" fill="none" stroke-width="2" points="${line(2)}"/>
<line class="cap" x1="${W - R - 230}" x2="${W - R - 200}" y1="${T + 8}" y2="${T + 8}" stroke-width="2"/>
<text class="axis" x="${W - R - 194}" y="${T + 12}">link capacity</text>
<line class="est" x1="${W - R - 110}" x2="${W - R - 80}" y1="${T + 8}" y2="${T + 8}" stroke-width="2"/>
<text class="axis" x="${W - R - 74}" y="${T + 12}">target rate</text>
</svg>
`;
mkdirSync(join(root, "docs"), {recursive: true});
writeFileSync(join(root, "docs", "estimate-vs-capacity.svg"), svg);
console.log(`docs/estimate-vs-capacity.svg: ${rows.length} samples, max ${yMax} kbps`);
