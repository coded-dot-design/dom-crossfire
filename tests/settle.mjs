// The settle guard: the run's clocks never sleep mid-match, and a quiet game stays quiet. A match
// with no input still counts down and plays (the game's time keeps pace with the wall clock, no
// stretch frozen); paused, the game takes no steps; after Recall nothing of the game runs a frame
// (no requestAnimationFrame left behind). Fizlet's settle (fizlet#112, #125): an engine that sleeps
// before something scheduled, or wakes by itself, fails here.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launch, open } from "./harness.mjs";

// Count animation frames the page asks for (every engine schedules through requestAnimationFrame).
const init = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__frames = 0;
  window.requestAnimationFrame = (fn) => raf((t) => (window.__frames++, fn(t)));
};
const browser = await launch(chromium);
try {
  const { page, errors, close } = await open(browser, { init });
  await page.evaluate(() => (window.game = window.mod.createDomCrossfire({ theme: "dark", seed: 3 })).start());
  // Countdown (3 s on the flow's clock), then 3 s of play with nobody touching anything.
  await page.waitForFunction(() => window.game.getSnapshot().elapsed > 0, null, { timeout: 8000 });
  const samples = [], fa = await page.evaluate(() => window.__frames);
  for (let i = 0; i < 12; i++) (samples.push(await page.evaluate(() => [performance.now(), window.game.getSnapshot().elapsed])), await page.waitForTimeout(250));
  // Never asleep: every 1 s span moves the game clock (a slow frame is jank, a still second is a
  // settled engine); over the 3 s it keeps pace (the engine catches up at most 4 steps a frame, so
  // a loaded machine reads slower, never zero).
  for (let i = 4; i < samples.length; i++) assert.ok(samples[i][1] > samples[i - 4][1], `the game clock moved in every second mid-match (${samples[i - 4][1]} → ${samples[i][1]})`);
  const wall = (samples.at(-1)[0] - samples[0][0]) / 1000, game = samples.at(-1)[1] - samples[0][1];
  assert.ok(game > wall * 0.3, `the game clock kept pace mid-match (${game.toFixed(2)} s of game in ${wall.toFixed(2)} s)`);
  const played = (await page.evaluate(() => window.__frames)) - fa;
  assert.ok(played > 60, `frames are counted while it plays (${played} in 3 s): the quiet checks below mean something`);
  // Paused: no steps.
  await page.keyboard.press("KeyP");
  await page.waitForFunction(() => window.game.getSnapshot().status === "paused");
  const t = await page.evaluate(() => window.game.getSnapshot().elapsed);
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.game.getSnapshot().elapsed), t, "paused: the game takes no steps");
  // Recall: nothing runs a frame afterwards.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[data-fizlet-host]"));
  await page.waitForTimeout(300);
  const f0 = await page.evaluate(() => window.__frames);
  await page.waitForTimeout(1000);
  const left = (await page.evaluate(() => window.__frames)) - f0;
  assert.equal(left, 0, `after Recall the page is quiet (${left} frames asked for in 1 s)`);
  assert.deepEqual(errors, []);
  await close();
  console.log("DOM Crossfire (shooter): settle guard green (clock keeps pace mid-match, paused holds, quiet after Recall).");
} finally {
  await browser.close();
}
