// The browser smoke test (Chromium): the landing, the start screen and its ride pick, a match from
// the countdown through a wave card, the keys, pause (resume, restart, quit, surrender), a won match,
// and the drop-in on a plain page (Escape gives the page back). Needs npm run check.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launch, open } from "./harness.mjs";

const SR = 'document.querySelector("#cf").shadowRoot';
const q = (page, sel, fn = "el => !!el") => page.evaluate(`(${fn})(${SR}.querySelector(${JSON.stringify(sel)}))`);
const text = (page, sel) => q(page, sel, "el => el ? el.innerText.replace(/\\s+/g, ' ').trim() : ''");
const browser = await launch(chromium);
let where = "landing";
try {
  // The landing: one h1, the hero battle, the four armies, the drop-in snippet, the byline.
  {
    const { page, errors, close } = await open(browser, { url: "/", width: 1440, height: 900 });
    await page.waitForFunction(() => window.crossfireDemo);
    const l = await page.evaluate(() => ({
      h1: document.querySelectorAll("h1").length,
      armies: [...document.querySelectorAll(".cf-army h3")].map((h) => h.textContent),
      images: [...document.images].map((i) => i.src),
      snippet: document.querySelector("#drop code").textContent,
      byline: /Chris Cooley/.test(document.querySelector(".site-foot").textContent),
      play: document.querySelector(".start-key").getAttribute("href"),
    }));
    assert.equal(l.h1, 1, "one h1");
    assert.deepEqual(l.armies, ["The swarm", "The button factories", "The fortified bases", "The frog and its flies", "All four at once"]);
    for (const src of new Set(l.images)) assert.equal(await page.evaluate(async (u) => (await fetch(u)).status, src), 200, `${src} loads`);
    assert.match(l.snippet, /dom-crossfire\.js/);
    assert.ok(l.byline, "by Chris Cooley");
    assert.equal(l.play, "./play/");
    assert.ok(await page.evaluate(() => window.crossfireDemo.world.foes.some((f) => f.on) || window.crossfireDemo.world.sites.some((s) => s.on)), "the hero battle has the armies in it");
    assert.deepEqual(errors, []);
    await close();
  }
  // The start screen: pick a ride (remembered), your partner is the other one.
  where = "start screen";
  {
    const { page, errors, close } = await open(browser, { url: "/play/", width: 1440, height: 900 });
    await page.waitForFunction(() => window.crossfire?.state === "intro");
    assert.equal(await text(page, ".sticker b"), "CROSSFIRE");
    const picks = await page.evaluate(`[...${SR}.querySelectorAll("[data-ride]")].map((b) => [b.dataset.ride, b.getAttribute("aria-pressed")])`);
    assert.deepEqual(picks, [["tank", "false"], ["plane", "true"]], "the plane is picked by default");
    assert.equal(await text(page, "[data-mate]"), "YOUR AI PARTNER: THE TANK");
    await page.evaluate(`${SR}.querySelector("[data-ride=tank]").click()`);
    assert.equal(await text(page, "[data-mate]"), "YOUR AI PARTNER: THE PLANE");
    assert.equal(await page.evaluate(() => localStorage.getItem("crossfire:ride")), "tank", "the pick is remembered");
    assert.equal(await page.evaluate(() => window.crossfire.ride), "tank");
    assert.equal(await text(page, "[data-ll]"), "LONG", "the tank's special is LONG");
    await page.evaluate(`${SR}.querySelector("[data-ride=plane]").click()`);
    assert.equal(await text(page, "[data-ll]"), "SALVO", "the plane's special is SALVO");
    assert.ok(await q(page, ".legend", "el => !el.hidden"), "the waves legend shows on desktop");

    // PRESS START: the kit's launch, the countdown, then wave 1's card.
    where = "match";
    await page.evaluate(`${SR}.querySelector("[data-go]").click()`);
    await page.waitForFunction(() => window.crossfire.state === "count");
    await page.waitForFunction(() => window.crossfire.state === "play", null, { timeout: 6000 });
    await page.waitForFunction(`${SR}.querySelector("[data-wave] b")?.textContent === "SWARM PROTOCOL"`);
    assert.match(await text(page, "[data-wave]"), /^SECTION 1 · WAVE 1\/4 SWARM PROTOCOL Bugs eat the letters .* PLANE · .* TANK · /);
    assert.equal(await text(page, "[data-wv]"), "1/4");
    assert.equal(await text(page, "[data-wl]"), "S1 · SWARM");
    assert.equal(await text(page, "[data-pn]"), "TANK", "the partner's readout is the tank");
    // Fly and fire with the keyboard: you move, your guns shoot.
    await page.waitForFunction(() => window.crossfire.world.crew[0].drop >= 1, null, { timeout: 5000 });
    const y0 = await page.evaluate(() => window.crossfire.world.crew[0].y);
    await page.keyboard.down("KeyW");
    await page.keyboard.down("Space");
    await page.waitForTimeout(600);
    await page.keyboard.up("KeyW");
    const fired = await page.evaluate(() => window.crossfire.world.shells.filter((s) => s.on && s.owner === 0 && !s.foe).length);
    await page.keyboard.up("Space");
    assert.ok((await page.evaluate(() => window.crossfire.world.crew[0].y)) < y0 - 30, "W flies you up");
    assert.ok(fired > 0, `Space fires (${fired} bolts in the air)`);
    // The partner fights on its own.
    await page.waitForFunction(() => window.crossfire.world.crew[1].alive && window.crossfire.world.crew[1].drop >= 1, null, { timeout: 6000 });
    await page.waitForFunction(() => window.crossfire.world.foes.some((f) => f.on), null, { timeout: 8000 });

    // Pause: P, the kit overlay, RESUME counts back in; RESTART; QUIT TO MENU.
    where = "pause";
    await page.keyboard.press("KeyP");
    await page.waitForFunction(() => window.crossfire.state === "paused");
    assert.match(await text(page, "[data-ov]"), /BATTLE PAUSED PAUSED RESUME RESTART QUIT TO MENU SURRENDER/);
    await page.evaluate(`${SR}.querySelector("[data-resume]").click()`);
    assert.equal(await page.evaluate(() => window.crossfire.state), "play");
    await page.waitForFunction(`${SR}.querySelector("[data-c]")?.textContent === "3"`, null, { timeout: 2000 }); // resume counts down first
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.crossfire.state === "paused");
    await page.evaluate(`${SR}.querySelector("[data-surrender]").click()`);
    await page.waitForFunction(() => window.crossfire.state === "end", null, { timeout: 5000 });
    assert.match(await text(page, "[data-ov]"), /WHITE FLAG GAME OVER SCORE \d+ WAVES 0 \/ 17 YOU · PLANE .* PARTNER · TANK .* PLAY AGAIN SWAP RIDES/);
    await page.evaluate(`${SR}.querySelector("[data-new]").click()`);
    await page.waitForFunction(() => window.crossfire.state === "intro");
    assert.ok(await q(page, "[data-ride=plane]"), "SWAP RIDES goes back to the start screen");
    assert.deepEqual(errors, []);
    await close();
  }
  // A won match: a one-wave board, the wave cleared (every foe and site down), STAGE CLEAR.
  where = "win";
  {
    const { page, errors, close } = await open(browser, { url: "/play/", width: 1280, height: 800 });
    const r = await page.evaluate(async () => {
      window.crossfire.destroy();
      const { createCrossfire } = await import("/dist/dom-crossfire.mjs");
      let result = null;
      const g = (window.crossfire = createCrossfire(document.getElementById("cf"), { seed: 4, waves: 1, ride: "tank", onEnd: (x) => (result = x) }));
      g.engine.stop();
      g.start();
      g.world.steps(60 * 4); // countdown, then the wave card
      g.world.wave(2);
      g.world.steps(60 * 3);
      g.world.clear();
      g.world.steps(60 * 4); // cleared: the bonus, then the result
      g.engine.advance(1 / 60);
      return { state: g.state, result, score: g.score };
    });
    assert.equal(r.state, "end");
    assert.equal(r.result.won, true);
    assert.equal(r.result.ride, "tank");
    assert.ok(r.score >= 300, `the wave bonus is in the score (${r.score})`);
    await page.waitForTimeout(300);
    assert.match(await text(page, "[data-ov]"), /STAGE CLEAR YOU WIN/);
    assert.deepEqual(errors, []);
    await close();
  }
  // Click to fire (desktop): a held mouse button on the field fires, for both rides, from the moment
  // you land; a press on the scoreboard (mid-field, top) reaches the field too.
  where = "click to fire";
  for (const ride of ["tank", "plane"]) {
    const { page, errors, close } = await open(browser, { url: "/play/", width: 1440, height: 900 });
    await page.evaluate((ride) => (window.crossfire.ride = ride), ride);
    await page.evaluate(() => window.crossfire.start());
    await page.waitForFunction(() => window.crossfire.state === "play" && window.crossfire.world.crew[0].alive && window.crossfire.world.crew[0].drop >= 1, null, { timeout: 8000 });
    // Trigger pulls, not shells in the air: a shell fired into cover stops the frame it's fired.
    const shots = () => page.evaluate(() => window.crossfire.world.crew[0].shots);
    const box = await page.locator("#cf").boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
    const s0 = await shots();
    await page.mouse.down();
    await page.waitForTimeout(400);
    const held = (await shots()) - s0;
    await page.mouse.up();
    assert.ok(held > 0, `${ride}: a held click on the field fires right after landing (${held} shots)`);
    const hud = await page.evaluate(() => { const sr = document.querySelector("#cf").shadowRoot, r = sr.querySelector(".hud").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, pe: getComputedStyle(sr.querySelector(".hud")).pointerEvents, top: sr.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName }; });
    assert.equal(hud.pe, "none", "the scoreboard never takes the pointer");
    assert.equal(hud.top, "CANVAS", "a press on the scoreboard lands on the field");
    await page.waitForTimeout(500);
    await page.mouse.move(hud.x, hud.y);
    const s1 = await shots();
    await page.mouse.down();
    await page.waitForTimeout(300);
    const under = (await shots()) - s1;
    await page.mouse.up();
    assert.ok(under > 0, `${ride}: a held click under the scoreboard fires (${under} shots)`);
    assert.deepEqual(errors, []);
    await close();
  }
  // The drop-in on a plain page: the toggle, the page is the arena, Escape gives it back.
  where = "drop-in";
  {
    const { page, errors, close } = await open(browser, { url: "/host", width: 1280, height: 800 });
    const before = await page.evaluate(() => document.body.innerHTML);
    await page.addScriptTag({ url: "/dist/dom-crossfire.js" });
    await page.waitForFunction(() => window.DomCrossfire);
    // The drop-in waits behind its key (open: false).
    await page.evaluate(() => window.DomCrossfire.install({ ride: "tank" }).open());
    await page.waitForFunction(() => document.querySelector("[data-fizlet-host]")?.shadowRoot?.querySelector(".bz.embed"));
    await page.waitForTimeout(1500);
    const live = await page.evaluate(() => getComputedStyle(document.querySelector("[data-fizlet-host]").shadowRoot.querySelector(".bz")).position);
    assert.equal(live, "fixed", "the drop-in covers the page");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[data-fizlet-host]"));
    await page.waitForTimeout(1100);
    const after = await page.evaluate(() => document.body.innerHTML.replace(/<div data-crossfire-ignore="">.*?<\/div>/g, ""));
    assert.equal(after.replace(/<script[^>]*><\/script>/g, ""), before.replace(/<script[^>]*><\/script>/g, ""), "the page is exactly as it was");
    assert.deepEqual(errors, []);
    await close();
  }
  console.log("DOM Crossfire browser test green: landing, start screen and ride pick, countdown, wave card, keys, partner, pause, surrender, a won match, click to fire (both rides), the drop-in.");
} catch (err) {
  console.error(`browser test failed at: ${where}`);
  throw err;
} finally {
  await browser.close();
}
