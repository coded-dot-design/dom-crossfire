// The zero-allocation check for the step (Blitz's, ported). A busy attract match (both rides AI,
// every army on the board: the finale, again and again) is warmed up, then 20,000 fixed steps
// run with no read or render (world.steps) while V8's minor GCs are counted. Two seeds, both rides.
// A board match with you idle on the crossfire wave runs too (your controls are read, never allocate).
// Needs npm run check.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { minorGCs } from "./gc.mjs";
import { launch, open } from "./harness.mjs";

const STEPS = 20000;

test("a busy match steps without allocating (minor GC ≤ 1 in 20 000 steps)", async () => {
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { url: "/host", width: 1280, height: 760, entry: true });
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.id = "a";
      d.style.cssText = "position:relative;width:1100px;height:640px";
      document.body.append(d);
    });
    for (const [seed, ride, board] of [[7, "plane", false], [8, "tank", false], [9, "tank", true]]) {
      const busy = await page.evaluate(async ([seed, ride, board]) => {
        window.g?.destroy();
        const g = (window.g = window.mod.createCrossfire(document.getElementById("a"), board ? { seed, ride } : { demo: true, seed, ride }));
        g.engine.stop(); // step by hand
        if (board) g.start(), g.world.steps(200);
        g.world.steps(6000); // warm up: the JIT, every pool, strikes, crates, the waves turning over
        g.world.wave(17); // then the finale: every army on the board
        g.world.steps(300);
        return g.world.foes.filter((f) => f.on).length + g.world.sites.filter((s) => s.on).length;
      }, [seed, ride, board]);
      assert.ok(busy >= 3, `the match is busy (${busy} foes and sites)`);
      const gcs = await minorGCs(page, (n) => window.g.world.steps(n), STEPS), what = `${board ? "board, you idle" : "attract"} (${ride}): ${gcs} minor GCs in ${STEPS} steps (Chrome ${browser.version()})`;
      if (process.env.GITHUB_ACTIONS) console.log(`::${gcs <= 1 ? "notice" : "error"} title=zero-gc::${what}`);
      else console.log(what);
      assert.ok(gcs <= 1, what);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
