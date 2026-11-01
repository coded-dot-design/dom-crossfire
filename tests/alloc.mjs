// The zero-allocation gate: the sim step (every seat's input, the rules, the world) allocates
// nothing. Bundles src/sim.ts with the Fizlet kernel, runs it on a real engine with scripted
// input (moving, firing, the action key, round after round) and counts young-generation GCs over
// three windows; the best window must be 0. Run with node --expose-gc (npm test).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PerformanceObserver, constants } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "dom-crossfire-alloc-"));
try {
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, `export { createEngine } from ${JSON.stringify(resolve("vendor/fizlet/kernel/engine"))};
export { create, reset, step } from ${JSON.stringify(resolve("src/sim"))};
export { encode, OVER, CART, GLITCH } from ${JSON.stringify(resolve("src/world"))};
export { PLAYERS } from ${JSON.stringify(resolve("src/type"))};`);
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: join(dir, "sim.mjs"), logLevel: "warning", define: { __KIT_CSS__: '""' } });
  const { createEngine, create, reset, step, encode, OVER, CART, GLITCH, PLAYERS } = await import(pathToFileURL(join(dir, "sim.mjs")).href);

  // Determinism first: two runs from one seed with the same inputs end on the same bytes (three
  // rounds, every channel and its glitch), so solo replays and lockstep agree.
  const replay = (seed) => {
    const en = createEngine({ seed, pause: { hidden: false, offscreen: false, editable: false } });
    const ww = create(en, PLAYERS), inp = new Uint32Array(PLAYERS);
    let fr = 0;
    en.add({ step(_e, dt) { for (let p = 0; p < PLAYERS; p++) inp[p] = encode(Math.cos(fr / 19 + p), Math.sin(fr / 23 + p), fr % 3 === 0, fr % 40 < 2); fr++; step(ww, inp, dt); if (ww.g[OVER]) reset(ww); } });
    reset(ww);
    for (let i = 0; i < 30000; i++) en.advance(en.dt);
    return Buffer.from(ww.bytes).toString("base64");
  };
  assert.equal(replay(11), replay(11), "same seed, same inputs: the same world");
  assert.notEqual(replay(11), replay(12), "another seed: another match");

  const e = createEngine({ seed: 7, pause: { hidden: false, offscreen: false, editable: false } });
  const w = create(e, PLAYERS), inputs = new Uint32Array(PLAYERS);
  // Scripted input, precomputed so the loop only reads it: each seat circles, fires, presses the action.
  const SCRIPT = new Uint32Array(240 * PLAYERS);
  for (let f = 0; f < 240; f++) for (let p = 0; p < PLAYERS; p++) SCRIPT[f * PLAYERS + p] = encode(Math.cos(f / 19 + p), Math.sin(f / 23 + p), f % 3 === 0, f % 40 < 2);
  let frame = 0;
  e.add({ step(_e, dt) {
    for (let p = 0; p < PLAYERS; p++) inputs[p] = SCRIPT[(frame % 240) * PLAYERS + p];
    frame++;
    step(w, inputs, dt);
    if (w.g[OVER]) reset(w);
  } });
  reset(w);
  const run = (n) => { for (let i = 0; i < n; i++) e.advance(e.dt); };
  // Warm up until every cartridge has been on air for 20,000 steps: the JIT settles and every rule
  // path runs (sprite-free, no DOM here). The scripted seat dies by CH2 or CH3 most rounds, so a
  // fixed 20,000 steps left CH3-CH5 to tier up inside the windows: unoptimized code boxes every
  // double, and that, not the step, was the young GCs (2026-11-01).
  const onAir = new Float64Array(5);
  let warm = 0;
  while (warm < 20000 || Math.min(...onAir) < 20000) {
    e.advance(e.dt);
    if (!w.g[GLITCH]) onAir[w.g[CART]]++;
    assert.ok(++warm < 2_000_000, `warm-up never reached every cartridge: ${onAir.join(", ")} steps on air`);
  }

  let best = Infinity;
  const windows = [];
  for (let k = 0; k < 3; k++) {
    globalThis.gc?.();
    let minor = 0;
    const obs = new PerformanceObserver((list) => { for (const x of list.getEntries()) if (x.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor++; });
    obs.observe({ entryTypes: ["gc"] });
    run(200000);
    await new Promise((r) => setTimeout(r, 50));
    obs.disconnect();
    best = Math.min(best, minor);
    windows.push(minor);
  }
  assert.ok(globalThis.gc, "run with node --expose-gc");
  assert.equal(best, 0, `the sim step allocates: ${best} young GCs in the best of 3 windows of 200,000 steps`);
  console.log(`DOM Crossfire: deterministic replay; 0 young GCs over 200,000 sim steps (windows ${windows.join(", ")}; warm-up ${warm} steps, every cartridge on air; shooter, ${PLAYERS} seat${PLAYERS > 1 ? "s" : ""}).`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
