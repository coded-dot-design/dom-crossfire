// The settle guard: the run's clocks never sleep mid-match, and a quiet game stays quiet. A match
// with nobody touching anything still plays (its clock keeps pace with the wall clock); paused, it
// takes no steps; the landing's hero battle rests when it's scrolled away (no frames); after the
// drop-in closes (Escape) nothing of the game runs a frame and the page is exactly as it was.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launch, open } from "./harness.mjs";

// Count the animation frames the page asks for (every engine schedules through requestAnimationFrame).
const init = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__frames = 0;
  window.requestAnimationFrame = (fn) => raf((t) => (window.__frames++, fn(t)));
};
const frames = (page) => page.evaluate(() => window.__frames);
const browser = await launch(chromium);
try {
  // The play page: a board match, nobody at the keys.
  {
    const { page, errors, close } = await open(browser, { url: "/play/", init });
    await page.evaluate(() => window.crossfire.start());
    await page.waitForFunction(() => window.crossfire.elapsed > 0, null, { timeout: 8000 });
    const samples = [], f0 = await frames(page);
    for (let i = 0; i < 12; i++) samples.push(await page.evaluate(() => [performance.now(), window.crossfire.elapsed])), await page.waitForTimeout(250);
    for (let i = 4; i < samples.length; i++) assert.ok(samples[i][1] > samples[i - 4][1], `the match clock moved in every second (${samples[i - 4][1]} → ${samples[i][1]})`);
    const wall = (samples.at(-1)[0] - samples[0][0]) / 1000, game = samples.at(-1)[1] - samples[0][1];
    assert.ok(game > wall * 0.3, `the match kept pace (${game.toFixed(2)} s of play in ${wall.toFixed(2)} s)`);
    assert.ok((await frames(page)) - f0 > 60, "frames are counted while it plays");
    await page.keyboard.press("KeyP");
    await page.waitForFunction(() => window.crossfire.state === "paused");
    const t = await page.evaluate(() => window.crossfire.elapsed);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.crossfire.elapsed), t, "paused: the match takes no steps");
    assert.deepEqual(errors, []);
    await close();
  }
  // The landing: the hero battle runs on screen and rests off it; the drop-in gives the page back.
  {
    const { page, errors, close } = await open(browser, { url: "/", init, width: 1280, height: 800 });
    await page.waitForFunction(() => window.crossfireDemo?.engine);
    const a = await frames(page);
    await page.waitForTimeout(600);
    assert.ok((await frames(page)) - a > 15, "the hero battle plays on screen");
    await page.evaluate(() => scrollTo({ top: 1800, behavior: "instant" }));
    await page.waitForTimeout(500);
    const b = await frames(page);
    await page.waitForTimeout(1000);
    assert.equal((await frames(page)) - b, 0, "scrolled away, the hero battle rests (no frames)");
    const before = await page.evaluate(() => document.querySelector("main").innerHTML);
    await page.click("[data-drop]");
    await page.waitForFunction(() => document.querySelector("[data-fizlet-host]"));
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[data-fizlet-host]"));
    await page.waitForTimeout(1200); // the knocks finish (≤ 1 s each), then nothing should run
    const c = await frames(page);
    await page.waitForTimeout(1000);
    assert.equal((await frames(page)) - c, 0, "after the drop-in closes the page is quiet");
    assert.equal(await page.evaluate(() => document.querySelector("main").innerHTML), before, "the page is exactly as it was");
    assert.deepEqual(errors, []);
    await close();
  }
  console.log("DOM Crossfire settle guard green: the match keeps pace, pause holds, the hero rests off screen, quiet after the drop-in closes.");
} finally {
  await browser.close();
}
