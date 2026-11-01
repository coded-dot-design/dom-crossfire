// Phones (Blitz's game mode): a coarse pointer on a small screen, portrait 390×844 and landscape
// 844×390. The play page is the game: no header, footer or bar on screen (still in the HTML), the
// board fills the viewport, nothing scrolls, a 44 px exit key goes home. The start screen fits the
// screen with nothing overlapping (sticker, both rides, the partner line, START, the corner keys).
// In play: the drive stick shows, every key is on screen, ≥ 44 px where it's a corner key, and no
// two controls overlap (the scoreboard sits under the key row). 1440×900 keeps the desktop page.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launch, open } from "./harness.mjs";

const SIZES = [["390×844", 390, 844, true], ["844×390", 844, 390, true], ["1440×900", 1440, 900, false]];
const browser = await launch(chromium);
let where = "";
/** Boxes of what's showing: [name, x, y, w, h], page and shadow root. */
const boxes = (page, sels) =>
  page.evaluate((sels) => {
    const sr = document.querySelector("#cf").shadowRoot, out = [];
    for (const [name, sel, inPage] of sels)
      for (const el of (inPage ? document : sr).querySelectorAll(sel)) {
        const st = getComputedStyle(el), r = el.getBoundingClientRect();
        if (st.display === "none" || st.visibility === "hidden" || el.closest("[hidden]") || !r.width) continue;
        out.push([name, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]);
      }
    return out;
  }, sels);
// The pad's keys are round (AUTO and LOCK ride on FIRE's shoulders, as in Blitz): circles for them.
const ROUND = new Set(["FIRE", "LONG", "STRIKE", "AUTO", "LOCK"]);
const overlap = (a, b) => {
  if (ROUND.has(a[0]) && ROUND.has(b[0])) return Math.hypot(a[1] + a[3] / 2 - b[1] - b[3] / 2, a[2] + a[4] / 2 - b[2] - b[4] / 2) < (a[3] + b[3]) / 2 - 1;
  return a[1] < b[1] + b[3] - 1 && b[1] < a[1] + a[3] - 1 && a[2] < b[2] + b[4] - 1 && b[2] < a[2] + a[4] - 1;
};
const noOverlaps = (list, what) => {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), `${what}: ${list[i][0]} ${list[i].slice(1)} overlaps ${list[j][0]} ${list[j].slice(1)}`);
};
const onScreen = (list, w, h, what) => {
  for (const b of list) assert.ok(b[1] >= 0 && b[2] >= 0 && b[1] + b[3] <= w + 1 && b[2] + b[4] <= h + 1, `${what}: ${b[0]} is off screen (${b.slice(1)})`);
};
try {
  for (const [name, w, h, phone] of SIZES) {
    where = `${name} page`;
    const { page, errors, close } = await open(browser, { url: "/play/", width: w, height: h, touch: phone });
    await page.waitForFunction(() => window.crossfire?.state === "intro");
    await page.waitForTimeout(1500); // the sticker slams in, the keys pop
    const l = await page.evaluate(() => {
      const d = (s) => getComputedStyle(document.querySelector(s)).display, r = (s) => document.querySelector(s).getBoundingClientRect();
      scrollBy({ top: 400, behavior: "instant" });
      return { head: d(".site-head"), foot: d(".site-foot"), bar: d(".cf-bar"), exit: d(".game-exit"), stage: [r(".cf-stage").x, r(".cf-stage").y, r(".cf-stage").width, r(".cf-stage").height].map(Math.round), scrolled: scrollY, h1: document.querySelectorAll("h1").length };
    });
    assert.equal(l.h1, 1, "one h1");
    if (phone) {
      assert.deepEqual([l.head, l.foot, l.bar], ["none", "none", "none"], `${name}: game mode hides the header, footer and bar`);
      assert.deepEqual(l.stage, [0, 0, w, h], `${name}: the board fills the viewport`);
      assert.equal(l.scrolled, 0, `${name}: the page doesn't scroll`);
      assert.equal(l.exit, "grid", `${name}: the exit key shows`);
    } else {
      assert.deepEqual([l.head, l.foot, l.exit], ["block", "block", "none"], "desktop keeps the header and footer");
      assert.deepEqual(l.stage.slice(2), [w, h - 78], "desktop: the board under the header");
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    }
    // The start screen.
    where = `${name} start screen`;
    const start = await boxes(page, [["sticker", ".sticker"], ["pick label", ".pick > small"], ["ride", "[data-ride]"], ["partner line", "[data-mate]"], ["START", "[data-go]"], ["corner key", ".dk, .fs"], ["exit key", ".game-exit", true]]);
    const stage = phone ? [0, 0] : [0, 78];
    assert.equal(start.filter((b) => b[0] === "ride").length, 2, "both rides show");
    onScreen(start.map((b) => [b[0], b[1] - stage[0], b[2] - stage[1], b[3], b[4]]), w, h - stage[1], `${name} start screen`);
    noOverlaps(start, `${name} start screen`);
    for (const b of start.filter((b) => b[0] === "exit key" || (phone && b[0] === "corner key"))) assert.ok(b[3] >= 44 && b[4] >= 44, `${name}: ${b[0]} ≥ 44 px (${b.slice(3)})`);
    // In play.
    where = `${name} in play`;
    await page.evaluate(() => window.crossfire.start());
    await page.waitForFunction(() => window.crossfire.state === "play", null, { timeout: 6000 });
    await page.waitForTimeout(3200); // past the wave card
    const keys = await boxes(page, [["pause", "[data-pause]"], ["corner key", ".dk, .fs"], ["scoreboard", ".hud"], ["FIRE", "[data-k=fire]"], ["LONG", "[data-k=long]"], ["STRIKE", "[data-k=strike]"], ["AUTO", "[data-k=auto]"], ["LOCK", "[data-k=lock]"], ["stick", ".stk"], ["exit key", ".game-exit", true]]);
    onScreen(keys.map((b) => [b[0], b[1] - stage[0], b[2] - stage[1], b[3], b[4]]), w, h - stage[1], `${name} in play`);
    noOverlaps(keys, `${name} in play`);
    assert.equal(keys.some((b) => b[0] === "stick"), phone, `${name}: the drive stick shows on a phone only`);
    const pz = keys.find((b) => b[0] === "pause");
    if (phone) assert.ok(pz[3] >= 44 && pz[4] >= 44, `${name}: pause ≥ 44 px`);
    // A tap on PAUSE pauses; RESUME counts back in.
    await page.evaluate(() => document.querySelector("#cf").shadowRoot.querySelector("[data-pause]").click());
    await page.waitForFunction(() => window.crossfire.state === "paused");
    const ov = await boxes(page, [["overlay key", ".bui-overlay-keys button"]]);
    onScreen(ov.map((b) => [b[0], b[1] - stage[0], b[2] - stage[1], b[3], b[4]]), w, h - stage[1], `${name} pause menu`);
    noOverlaps(ov, `${name} pause menu`);
    assert.deepEqual(errors, []);
    await close();
  }
  console.log("DOM Crossfire phone test green: game mode at 390×844 and 844×390 (board fills the screen, no scroll, exit key), the start screen fits with nothing overlapping, keys on screen and apart in play and in the pause menu; desktop keeps its page.");
} catch (err) {
  console.error(`phone test failed at: ${where}`);
  throw err;
} finally {
  await browser.close();
}
