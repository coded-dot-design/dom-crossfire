// DOM Crossfire in Chromium, the smoke gate: the arcade shell with its HUD preset plays on a real page.
// Countdown, then play; keys move the seat; P pauses (the flow's overlay) and resumes; the bar
// drags; the touch lock holds while it runs; a finished round shows the result; Escape gives the
// page back exactly. The pause card's SURRENDER key ends the round lost (where the type has it).
// Reduced motion: the round plays with no sparks. The board page (index.html): PLAY starts the
// game on it and Escape gives it back. The layout at 1440, 390 and 360: the HUD, the arena and its
// channel bar never cover the page. On a phone: the touch pad (stick) and the bar on screen.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launch, open, overlay } from "./harness.mjs";

const browser = await launch(chromium);
const until = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout });
try {
  // ---------- Desktop ----------
  const { page, errors, close } = await open(browser);
  const before = await page.evaluate(() => document.body.innerHTML);
  await page.evaluate(() => (window.game = window.mod.createDomCrossfire({ theme: "dark", seed: 7 })).start());
  let ui = await overlay(page);
  assert.ok(ui?.bui && ui.bar, "the Board UI kit root and the HUD bar are up");
  assert.equal(ui.readouts, 4, "the type's readouts are on the bar");
  for (const k of ["Pause game (P)", "Close game and restore page (Esc)"]) assert.ok(ui.keys.includes(k), `the bar has the ${k} key (${ui.keys})`);
  // The countdown holds the game's clock, then play starts.
  assert.equal(await page.evaluate(() => window.game.getSnapshot().elapsed), 0, "nothing runs during the countdown");
  await until(page, () => window.game.getSnapshot().elapsed > 0.2);

  // The touch lock: no pinch or double-tap zoom while the board is up.
  assert.equal(await page.evaluate(() => document.documentElement.style.touchAction), "manipulation");
  assert.ok(await page.evaluate(() => !document.body.dispatchEvent(new Event("gesturestart", { cancelable: true }))), "a pinch gesture is cancelled");

  // Keys move seat 0 (one cell per press on a d-pad game).
  const seat = () => page.evaluate(() => [window.game.world.s[0], window.game.world.s[1]]);
  const s0 = await seat();
  for (const key of ["ArrowRight", "ArrowUp"]) (await page.keyboard.down(key), await page.waitForTimeout(220), await page.keyboard.up(key), await page.waitForTimeout(60));
  const s1 = await seat();
  assert.ok(s1[0] !== s0[0] || s1[1] !== s0[1], `the seat moved (${s0} → ${s1})`);
  await page.keyboard.press("Space");

  // P pauses: the flow's overlay; P again resumes.
  await page.keyboard.press("KeyP");
  await until(page, () => window.game.getSnapshot().status === "paused");
  await until(page, () => /PAUSED/.test(document.querySelector("[data-fizlet-host]").shadowRoot.querySelector(".bui-overlay")?.textContent ?? ""));
  const t = await page.evaluate(() => window.game.getSnapshot().elapsed);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.game.getSnapshot().elapsed), t, "paused: the clock holds");
  await page.keyboard.press("KeyP");
  await until(page, () => window.game.getSnapshot().status === "running");

  // The bar drags (in-page scoreboards always drag), from its readouts, not a key.
  const rect = () => page.evaluate(() => { const r = document.querySelector("[data-fizlet-host]").shadowRoot.querySelector(".bui > section").getBoundingClientRect(); return [r.x, r.y]; });
  const grab = await page.evaluate(() => { const r = document.querySelector("[data-fizlet-host]").shadowRoot.querySelector(".bui > section .bui-readouts").getBoundingClientRect(); return [r.x + 4, r.y + r.height / 2]; });
  const r0 = await rect();
  await page.mouse.move(grab[0], grab[1]);
  await page.mouse.down();
  await page.mouse.move(grab[0] - 120, grab[1] + 160, { steps: 6 });
  await page.mouse.up();
  const r1 = await rect();
  assert.ok(Math.abs(r1[0] - r0[0] + 120) < 4 && Math.abs(r1[1] - r0[1] - 160) < 4, `the bar followed the pointer (${r0} → ${r1})`);

  // A finished round: the result card (and the best score kept on this device).
  await page.evaluate(() => window.game.finish(true));
  await until(page, () => window.game.getSnapshot().status === "won");
  ui = await overlay(page);
  assert.ok(ui.sticker.length > 0, "the result sticker is up");
  assert.ok(ui.result.length > 0, `the result lists the round (${ui.result})`);
  assert.equal(await page.evaluate(() => document.body.innerHTML), before, "the round ended: the page is already back");

  // Recall: Escape gives the page back exactly, gestures included.
  await page.keyboard.press("Escape");
  await until(page, () => !document.querySelector("[data-fizlet-host]"));
  assert.equal(await page.evaluate(() => document.body.innerHTML), before, "Recall gives the page back exactly");
  assert.equal(await page.evaluate(() => document.documentElement.style.touchAction), "", "the page's gestures are back");
  assert.ok(await page.evaluate(() => document.body.dispatchEvent(new Event("gesturestart", { cancelable: true }))), "pinch is the page's again");
  assert.deepEqual(errors, []);
  await close();

  // ---------- Surrender: the pause card's white flag ends the round, lost ----------
  if (true) {
    const s = await open(browser);
    await s.page.evaluate(() => (window.game = window.mod.createDomCrossfire({ seed: 7 })).start());
    await until(s.page, () => window.game.getSnapshot().elapsed > 0.2);
    await s.page.keyboard.press("KeyP");
    await until(s.page, () => window.game.getSnapshot().status === "paused");
    await s.page.evaluate(() => document.querySelector("[data-fizlet-host]").shadowRoot.querySelector(".bui-overlay [data-k=surrender]").click());
    await until(s.page, () => window.game.getSnapshot().status === "gameover");
    assert.ok((await overlay(s.page)).sticker.length > 0, "the result sticker is up after the flag");
    await s.page.evaluate(() => window.game.stop());
    assert.deepEqual(s.errors, []);
    await s.close();
  }

  // ---------- Reduced motion: the same round, no sparks ----------
  const calm = await open(browser, { reducedMotion: "reduce" });
  const calmBefore = await calm.page.evaluate(() => document.body.innerHTML);
  await calm.page.evaluate(() => (window.game = window.mod.createDomCrossfire({ seed: 7 })).start());
  await until(calm.page, () => window.game.getSnapshot().elapsed > 0.2);
  await calm.page.keyboard.down("Space");
  await calm.page.keyboard.down("ArrowLeft");
  await calm.page.waitForTimeout(1500);
  await calm.page.keyboard.up("ArrowLeft");
  await calm.page.keyboard.up("Space");
  assert.equal(await calm.page.evaluate(() => window.game.getSnapshot().particles ?? 0), 0, "no sparks under reduced motion");
  await calm.page.evaluate(() => window.game.finish(false));
  await until(calm.page, () => window.game.getSnapshot().status === "gameover");
  await calm.page.keyboard.press("Escape");
  await until(calm.page, () => !document.querySelector("[data-fizlet-host]"));
  assert.equal(await calm.page.evaluate(() => document.body.innerHTML), calmBefore, "Recall under reduced motion");
  assert.deepEqual(calm.errors, []);
  await calm.close();

  // ---------- The board page: PLAY starts the game on it, Escape gives it back ----------
  const board = await open(browser, { url: "/index.html", entry: null });
  const boardBefore = await board.page.evaluate(() => document.querySelector("main").innerHTML);
  await board.page.click("#play");
  await until(board.page, () => window.game?.getSnapshot().elapsed > 0.2);
  assert.ok((await board.page.evaluate(() => window.game.getSnapshot().board?.indexed ?? 0)) > 0, "the board page's words are the board");
  await board.page.keyboard.press("Escape");
  await until(board.page, () => !document.querySelector("[data-fizlet-host]"));
  assert.equal(await board.page.evaluate(() => document.querySelector("main").innerHTML), boardBefore, "the board page is back exactly");
  assert.deepEqual(board.errors, []);
  await board.close();

  // ---------- Layout: the HUD, the arena and its channel bar never cover the page ----------
  // The board page at 1440, 390 and 360 while playing: the HUD clears the H1 and the arena, the
  // arena block (bezel, screen and the channel bar when it shows) clears every page text block,
  // the channel banner sits inside the arena, and Recall scrolls back to where PLAY was pressed.
  const WW = 768, WH = 576; // the world (src/world.ts)
  for (const [width, height, touch] of [[1440, 900, false], [390, 844, true], [360, 740, true]]) {
    const at = `${width} px`, lay = await open(browser, { url: "/index.html", entry: null, width, height, touch });
    const p = lay.page, mainBefore = await p.evaluate(() => document.querySelector("main").innerHTML);
    const y0 = await p.evaluate(() => (document.getElementById("play").scrollIntoView({ block: "center" }), scrollY));
    await p.click("#play");
    await until(p, () => window.game?.getSnapshot().elapsed > 0.2);
    // A channel change, so the banner is up (the hero kept alive for it).
    await p.evaluate(() => { const w = window.game.world; w.s[5] = 1; w.g[4] = 29.5; });
    await until(p, () => /\b[ab]\b/.test(document.querySelector("[data-fizlet-host]").shadowRoot.querySelector(".sk-ban").className));
    await p.waitForTimeout(400);
    const r = await p.evaluate(([WW, WH]) => {
      const box = (b) => ({ x: b.left, y: b.top, r: b.right, b: b.bottom }), root = document.querySelector("[data-fizlet-host]").shadowRoot;
      const [k, x, y] = window.game.view;
      const visible = (b) => b.r > b.x && b.b > b.y && b.b > 0 && b.y < innerHeight;
      return {
        k,
        hud: box(root.querySelector(".sk").getBoundingClientRect()),
        h1: box(document.querySelector("h1").getBoundingClientRect()),
        // The bezel (10 world units round the screen) and the channel bar (to WH + 42) under it.
        arena: { x: x - 10 * k, y: y - 10 * k, r: x + (WW + 10) * k, b: y + (WH + (k > 0.75 ? 42 : 16)) * k },
        screen: { x, y, r: x + WW * k, b: y + WH * k },
        guide: k > 0.75 ? { x, y: y + (WH + 18) * k, r: x + WW * k, b: y + (WH + 42) * k } : null,
        banner: box(root.querySelector(".sk-ban").getBoundingClientRect()),
        text: [...document.querySelectorAll("main :is(h1,h2,p,li,footer,.row)")].map((el) => [el.tagName + " " + el.textContent.trim().slice(0, 24), box(el.getBoundingClientRect())]).filter(([, b]) => visible(b)),
      };
    }, [WW, WH]);
    const meets = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
    const show = (b) => `${Math.round(b.x)},${Math.round(b.y)} → ${Math.round(b.r)},${Math.round(b.b)}`;
    assert.ok(r.k > 0.3, `${at}: the arena has a playable size (scale ${r.k})`);
    assert.ok(!meets(r.hud, r.h1), `${at}: the HUD (${show(r.hud)}) clears the H1 (${show(r.h1)})`);
    assert.ok(!meets(r.hud, r.arena), `${at}: the HUD (${show(r.hud)}) clears the arena (${show(r.arena)})`);
    assert.ok(r.h1.y >= 0, `${at}: the H1 is on screen (${show(r.h1)})`);
    for (const [name, b] of r.text) {
      assert.ok(!meets(r.arena, b), `${at}: the arena block (${show(r.arena)}) clears "${name}" (${show(b)})`);
      if (r.guide) assert.ok(!meets(r.guide, b), `${at}: the channel bar (${show(r.guide)}) clears "${name}" (${show(b)})`);
    }
    assert.ok(width > 600 ? r.guide : true, `${at}: the channel bar shows on a wide screen`);
    const s = r.screen, n = r.banner;
    assert.ok(n.x >= s.x && n.r <= s.r && n.y >= s.y && n.b <= s.b, `${at}: the channel banner (${show(n)}) sits inside the arena (${show(s)})`);
    if (touch) {
      // Game mode on a phone: the pad sits on the arena's block, not on the page's copy.
      const pad = await p.evaluate(() => { const b = document.querySelector("[data-fizlet-host]").shadowRoot.querySelector(".bui-pad").getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom }; });
      for (const [name, b] of r.text) assert.ok(!meets(pad, b), `${at}: the pad (${show(pad)}) clears "${name}" (${show(b)})`);
      assert.ok(pad.y >= s.b, `${at}: the pad (${show(pad)}) sits under the arena (${show(s)})`);
    }
    await p.keyboard.press("Escape");
    await until(p, () => !document.querySelector("[data-fizlet-host]"));
    assert.equal(await p.evaluate(() => document.querySelector("main").innerHTML), mainBefore, `${at}: the page is back exactly`);
    assert.equal(await p.evaluate(() => document.documentElement.getAttribute("style")), null, `${at}: the page's padding is back`);
    assert.ok(Math.abs((await p.evaluate(() => scrollY)) - y0) <= 1, `${at}: Recall scrolls back to where PLAY was pressed (${y0})`);
    assert.deepEqual(lay.errors, []);
    await lay.close();
  }

  // ---------- Phone ----------
  const phone = await open(browser, { width: 390, height: 844, touch: true });
  await phone.page.evaluate(() => (window.game = window.mod.createDomCrossfire({ theme: "light", seed: 7 })).start());
  ui = await overlay(phone.page);
  assert.ok(ui.pad && ui.stick, `the touch pad (${"stick"}) is up on a phone`);
  const bar = await phone.page.evaluate(() => { const r = document.querySelector("[data-fizlet-host]").shadowRoot.querySelector(".bui > section").getBoundingClientRect(); return [r.left, r.right, r.top]; });
  assert.ok(bar[0] >= 0 && bar[1] <= 390 && bar[2] >= 0, `the bar fits a 390 px screen (${bar})`);
  await phone.page.evaluate(() => window.game.stop());
  assert.deepEqual(phone.errors, []);
  await phone.close();
  console.log(`DOM Crossfire (shooter): countdown, moves, pause, the bar drags, touch lock, result, Recall, ${true ? "surrender, " : ""}reduced motion, board page, layout at 1440, 390 and 360, phone pad.`);
} finally {
  await browser.close();
}
