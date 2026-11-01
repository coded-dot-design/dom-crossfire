// Each army behaves like its own game, and the rides have their strengths. Board matches on a fixed
// seed, stepped by hand (world.steps: the match's own clock). Needs npm run check.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launch, open } from "./harness.mjs";

test("the four armies and the two rides", async () => {
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { url: "/host", width: 1280, height: 760, entry: true });
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.id = "a";
      d.style.cssText = "position:relative;width:1100px;height:640px";
      document.body.append(d);
      /** A board match on wave w, the countdown done, you parked out of the way. */
      window.wave = (w, ride = "plane", seed = 3) => {
        window.g?.destroy();
        const g = (window.g = window.mod.createCrossfire(document.getElementById("a"), { seed, ride }));
        g.engine.stop();
        g.start();
        g.world.steps(200);
        g.world.wave(w);
        return g;
      };
    });
    // 1 Swarm Protocol: bugs come in from the edges and eat letters into binary; they grow.
    const swarm = await page.evaluate(() => {
      const g = window.wave(1), w = g.world, before = w.eaten;
      for (const u of w.crew) u.shield = 1e9; // nobody dies: we're watching the bugs
      let grown = 0, bugs = 0;
      for (let s = 0; s < 60 * 40; s++) {
        w.steps(1);
        for (const f of w.foes) if (f.on && f.kind === 1) (bugs = Math.max(bugs, 1)), (grown = Math.max(grown, f.tier));
        for (const u of w.crew) u.cool = 99; // hold fire, so the swarm can feed
      }
      return { glyphs: w.glyphs, before, eaten: w.eaten, bugs, grown };
    });
    assert.ok(swarm.glyphs > 30, `the board has copy (${swarm.glyphs} letters)`);
    assert.equal(swarm.before, 0);
    assert.ok(swarm.eaten > 10, `bugs ate letters into binary (${swarm.eaten})`);
    assert.ok(swarm.grown >= 2, `a bug grew (tier ${swarm.grown}) after six letters`);
    // 2 Null Invaders: button factories release aliens; a broken factory stops.
    const inv = await page.evaluate(() => {
      const g = window.wave(2), w = g.world;
      for (const u of w.crew) (u.shield = 1e9), (u.cool = 1e9);
      w.steps(60 * 12);
      const factories = w.sites.filter((s) => s.on && s.kind === 1), aliens = w.foes.filter((f) => f.on && f.kind === 2).length;
      for (const s of factories) s.hp = 0.001;
      return { factories: factories.length, aliens, kinds: [...new Set(w.foes.filter((f) => f.on && f.kind === 2).map((f) => f.sub))].length };
    });
    assert.ok(inv.factories >= 2, `factories on the board (${inv.factories})`);
    assert.ok(inv.aliens >= 4, `aliens came out of them (${inv.aliens})`);
    assert.ok(inv.kinds >= 2, "drones, crabs and squids");
    // 3 Sherman Bytes: bases with four walls, squads sortie; the tank breaches walls, the plane barely scratches them.
    const sb = await page.evaluate(() => {
      const g = window.wave(3), w = g.world;
      for (const u of w.crew) (u.shield = 1e9), (u.cool = 1e9);
      const walls = w.blocks.filter((b) => b.site >= 0 && b.hp > 0).length;
      w.steps(60 * 8);
      return { bases: w.sites.filter((s) => s.on && s.kind === 2).length, walls, tanks: w.foes.filter((f) => f.on && f.kind === 3).length };
    });
    assert.ok(sb.bases >= 1, `bases (${sb.bases})`);
    assert.equal(sb.walls, sb.bases * 4, "four wall segments a base");
    assert.ok(sb.tanks >= 2, `a squad rolled out (${sb.tanks} tanks)`);
    // 4 Byte Runner: pipes with pellets and power squares; a power square turns the flies blue, and a blue fly is eaten.
    const br = await page.evaluate(() => {
      const g = window.wave(4, "tank"), w = g.world;
      for (const u of w.crew) (u.shield = 1e9), (u.cool = 1e9);
      w.steps(60 * 10);
      const flies = w.foes.filter((f) => f.on && f.kind === 4);
      // Park your tank on a power square (your stick is idle, so it stays put), step once.
      const you = w.crew[0], mate = w.crew[1];
      let p = 0;
      while (p < w.pellets && !(w.pellet(p)[3] && w.pellet(p)[2])) p++;
      [you.x, you.y] = w.pellet(p);
      mate.x = mate.y = 9999;
      w.steps(1);
      const power = w.power, score = g.score;
      // A blue fly that touches you is eaten: 100 points (then 200, 300, 400).
      const fly = w.foes.find((f) => f.on && f.kind === 4);
      [fly.x, fly.y, fly.pipe] = [you.x, you.y, -1];
      w.steps(1);
      return { pellets: w.pellets, flies: flies.length, power, eaten: !fly.on, points: g.score - score };
    });
    assert.ok(br.pellets > 20, `pipes full of pellets (${br.pellets})`);
    assert.ok(br.flies >= 3, `flies on the pipes (${br.flies})`);
    assert.ok(br.power > 5, `a power square turned the flies blue (${br.power.toFixed(1)} s)`);
    assert.ok(br.eaten && br.points >= 100, `a blue fly was eaten (+${br.points})`);
    // The rides: the plane's guns shred the air and barely scratch armour; the tank's the other way round.
    const kinds = await page.evaluate(() => window.wave(3, "plane").world.crew.map((u) => u.kind));
    assert.deepEqual(kinds, [1, 0], "you fly the plane, your partner drives the tank");
    // Wall damage: ten plane bolts vs one tank shell into a wall (the shooter's ride decides).
    const walls = await page.evaluate(() => {
      const hit = (ride, n) => {
        const g = window.wave(3, ride), w = g.world, u = w.crew[0], b = w.blocks.find((x) => x.site >= 0 && x.hp > 0);
        for (const x of w.crew) x.shield = 1e9;
        for (const f of w.foes) f.on = false;
        const s0 = b.hp;
        for (let k = 0; k < n; k++) {
          const s = w.shells.find((x) => !x.on);
          Object.assign(s, { on: true, owner: 0, foe: false, rail: false, kind: ride === "tank" ? 0 : 1, tgt: -1, x: b.x + b.w / 2, y: b.y - 30, vx: 0, vy: 600, life: 1 });
          w.steps(6);
        }
        return s0 - b.hp;
      };
      return { plane: hit("plane", 10), tank: hit("tank", 1) };
    });
    assert.ok(walls.tank >= 1, `one tank shell takes a wall point (${walls.tank})`);
    assert.ok(walls.plane <= walls.tank * 2.5, `ten plane bolts barely scratch a wall (${walls.plane.toFixed(2)})`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
