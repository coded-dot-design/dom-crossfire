// Replays: the same seed gives the same match, frame for frame, with no Math.random in play; another
// seed gives another match; drawing a step once or twice plays the same match (the screen's shake has
// its own random). Needs npm run check.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launch, open } from "./harness.mjs";

const FRAMES = 3600; // one minute at 60 Hz

test("same seed, same match; drawing never draws from the match's random", async () => {
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { url: "/host", width: 1280, height: 760, entry: true });
    await page.evaluate(() => {
      for (const id of ["a", "b"]) {
        const d = document.createElement("div");
        d.id = id;
        d.style.cssText = "position:relative;width:1100px;height:640px";
        document.body.append(d);
      }
    });
    /** A digest of the world every 10 s: the rides, every foe and site, the score, the random's state. */
    const play = (seed, ride, renders = 1, board = false) =>
      page.evaluate(async ([seed, ride, renders, board, frames]) => {
        for (const id of ["a", "b"]) document.getElementById(id).replaceChildren();
        const g = window.mod.createCrossfire(document.getElementById(seed % 2 ? "a" : "b"), board ? { seed, ride } : { demo: true, seed, ride });
        g.engine.stop();
        if (board) g.start();
        let calls = 0;
        const real = Math.random;
        Math.random = () => (calls++, real());
        const digest = [];
        for (let f = 1; f <= frames; f++) {
          for (let r = 0; r < renders; r++) g.engine.advance(1 / 60 / renders);
          if (f % 600 === 0) {
            const w = g.world;
            digest.push(
              w.crew.map((u) => [u.alive, Math.round(u.x * 100), Math.round(u.y * 100), u.hp, u.kills, u.deaths, u.tier].join(",")).join("|"),
              w.foes.filter((x) => x.on).map((x) => [x.kind, Math.round(x.x), Math.round(x.y), x.hp].join(",")).join("|"),
              w.sites.filter((x) => x.on).map((x) => [x.kind, Math.round(x.x), Math.round(x.y), x.hp].join(",")).join("|"),
              g.wave, g.score, w.eaten, g.engine.random.state,
            );
          }
        }
        Math.random = real;
        g.destroy();
        return { digest: digest.join("\n"), calls, wave: g.wave };
      }, [seed, ride, renders, board, FRAMES]);
    const a = await play(41, "plane"), b = await play(41, "plane"), c = await play(42, "plane"), t = await play(41, "tank");
    assert.equal(a.calls, 0, "no Math.random while playing");
    assert.equal(a.digest, b.digest, "same seed, same match");
    assert.notEqual(a.digest, c.digest, "another seed, another match");
    assert.notEqual(a.digest, t.digest, "the other ride, another match");
    assert.ok(a.wave > 5, `the attract match turns its waves over (wave ${a.wave} after a minute)`);
    const once = await play(5, "tank", 1, true), twice = await play(5, "tank", 2, true);
    assert.equal(twice.digest, once.digest, "drawing twice a step plays the same board match");
    assert.deepEqual(errors, []);
    console.log(`replay: seed 41 twice → identical over ${FRAMES} frames, 42 and the tank differ, 0 Math.random calls, a board match plays the same drawn once or twice a step`);
  } finally {
    await browser.close();
  }
});
