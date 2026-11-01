// Squad play end to end on the squad page (play/squad/): four browsers (simulated clients) join one
// room through the room card on a stand-in room server (tests/rooms.mjs), each with its own ride; the
// room fills, every screen starts the same match, and they stay in lockstep with no desync. Then two
// people and P1's START NOW: a squad of two plus the AI partner. Needs npm run check.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launch, open } from "./harness.mjs";
import { rooms } from "./rooms.mjs";

const browser = await launch(chromium);
let where = "";
try {
  /** n people join room `room`, each with their ride; `go` (P1 presses START NOW) when not full. */
  async function squad(n, ridesOf, room, go = false) {
    const server = rooms();
    const peers = [];
    for (let i = 0; i < n; i++) {
      const p = await open(browser, { url: `/play/squad/?rooms=wss://rooms.test&room=${room}`, width: 1440, height: 900, before: (ctx) => server.attach(ctx) });
      peers.push(p);
      await p.page.waitForFunction(() => window.crossfire);
      await p.page.fill("input[name=code]", "CROSSFIRE-TEST");
      await p.page.click(`[data-ride=${ridesOf[i]}]`);
      await p.page.click("[data-join]");
      await p.page.waitForFunction(() => document.querySelector(".room").dataset.step !== "join");
    }
    if (go) {
      await peers[0].page.waitForSelector("[data-start]:not([hidden])");
      await peers[0].page.click("[data-start]");
    }
    for (const p of peers) await p.page.waitForFunction(() => document.querySelector(".room").dataset.step === "play", null, { timeout: 8000 });
    // Let the match run: the countdown, then wave 1.
    await Promise.all(peers.map((p) => p.page.waitForFunction(() => window.crossfire.net && window.crossfire.net.frame > 600, null, { timeout: 40000 })));
    const out = [];
    for (const p of peers)
      out.push(await p.page.evaluate(() => ({ desync: window.crossfire.net.desync, lost: window.crossfire.net.lost, frame: window.crossfire.net.frame, crew: window.crossfire.world.crew.map((u) => `${u.kind ? "plane" : "tank"}${u.human ? "" : "·AI"}`).join(" "), you: window.crossfire.world.crew.findIndex((u) => u.you), rows: document.querySelectorAll("[data-rows] tr").length })));
    for (const p of peers) assert.deepEqual(p.errors, []);
    return { out, peers };
  }
  where = "4 players";
  const four = await squad(4, ["plane", "tank", "tank", "plane"], 1);
  four.out.forEach((o, i) => {
    assert.equal(o.desync, -1, `P${i + 1}: no desync`);
    assert.equal(o.lost, 0, `P${i + 1}: nobody left`);
    assert.equal(o.crew, "plane tank tank plane", `P${i + 1}: four people, their rides, no AI`);
    assert.equal(o.you, i, `P${i + 1} is seat ${i}`);
    assert.equal(o.rows, 4, `P${i + 1}: the card lists the squad`);
  });
  for (const p of four.peers) await p.close();
  where = "2 players, START NOW";
  const two = await squad(2, ["tank", "tank"], 2, true);
  two.out.forEach((o, i) => {
    assert.equal(o.desync, -1, `P${i + 1}: no desync`);
    assert.equal(o.crew, "tank tank plane·AI", "two people keep the AI partner (it flies the plane)");
  });
  for (const p of two.peers) await p.close();
  console.log("DOM Crossfire squad page green: four simulated clients join one room with their rides and play one match in lockstep (no desync); two with P1's START NOW keep the AI partner.");
} catch (err) {
  console.error(`squad test failed at: ${where}`);
  throw err;
} finally {
  await browser.close();
}
