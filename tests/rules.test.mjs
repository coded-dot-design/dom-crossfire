// Each army behaves like its own game, its section escalates to a mini-boss, and the rides have their strengths. Board matches on a fixed
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
      const g = window.wave(5), w = g.world;
      for (const u of w.crew) (u.shield = 1e9), (u.cool = 1e9), (u.strikes = u.rail = 0);
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
      const g = window.wave(9), w = g.world;
      for (const u of w.crew) (u.shield = 1e9), (u.cool = 1e9), (u.strikes = u.rail = 0);
      const walls = w.blocks.filter((b) => b.site >= 0 && b.hp > 0).length;
      w.steps(60 * 8);
      return { bases: w.sites.filter((s) => s.on && s.kind === 2).length, walls, tanks: w.foes.filter((f) => f.on && f.kind === 3).length };
    });
    assert.ok(sb.bases >= 1, `bases (${sb.bases})`);
    assert.equal(sb.walls, sb.bases * 4, "four wall segments a base");
    assert.ok(sb.tanks >= 2, `a squad rolled out (${sb.tanks} tanks)`);
    // 4 Byte Runner, flipped: no pipes; pellets sit on the blocks and are the enemies' food. A fly that
    // eats one gets a tier (more HP, faster); the frog grows with each, and once big its tongue eats a
    // ride whole after a tell (a beat where it marks the spot).
    const br = await page.evaluate(() => {
      const g = window.wave(13, "tank"), w = g.world;
      for (const u of w.crew) (u.shield = 1e9), (u.cool = 1e9), (u.strikes = u.rail = 0);
      w.steps(60 * 10);
      const pel = Array.from({ length: w.pellets }, (_, i) => w.pellet(i));
      const onBlock = pel.filter(([x, y]) => w.blocks.some((b) => b.site < 0 && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)).length;
      const flies = w.foes.filter((f) => f.on && f.kind === 4), frog = w.foes.find((f) => f.on && f.kind === 5);
      // A fly that eats: put one on a pellet, step.
      const p = pel.findIndex((q) => q[2]), fly = flies.sort((a, b) => a.tier - b.tier)[0];
      if (fly.tier === 3) (fly.tier = 1), (fly.max = fly.hp = 1); // every fly already fed: start one fresh
      const before = { tier: fly.tier, max: fly.max };
      [fly.x, fly.y] = w.pellet(p);
      w.steps(2);
      const after = { tier: fly.tier, max: fly.max, gone: !w.pellet(p)[2] };
      // The frog eats four pellets, then its tongue: park your tank, unshielded, in reach.
      while (frog.eaten < 4) {
        const q = Array.from({ length: w.pellets }, (_, i) => i).find((i) => w.pellet(i)[2]);
        [frog.x, frog.y] = w.pellet(q);
        w.steps(1);
      }
      const you = w.crew[0];
      for (const f of w.foes) if (f !== frog) f.on = false;
      you.shield = 0;
      [you.x, you.y] = [frog.x + 120, frog.y];
      frog.cool = 0;
      let tell = false;
      for (let s = 0; s < 60 * 3 && you.alive; s++) (w.steps(1), (tell ||= frog.mode === 1), you.alive && ([you.x, you.y] = [frog.x + 120, frog.y]));
      return { pipes: "pipes" in w, pellets: w.pellets, onBlock, flies: flies.length, frog: !!frog, before, after, eaten: frog.eaten, tell, down: !you.alive };
    });
    assert.equal(br.pipes, false, "no food pipes");
    assert.ok(br.pellets >= 6 && br.onBlock >= br.pellets - 2, `pellets on the blocks (${br.onBlock} of ${br.pellets})`);
    assert.ok(br.flies >= 2 && br.frog, `flies and the frog are on the board (${br.flies} flies)`);
    assert.ok(br.after.gone && br.after.tier === br.before.tier + 1 && br.after.max > br.before.max, `a fly that eats a pellet gets stronger (tier ${br.before.tier} → ${br.after.tier})`);
    assert.ok(br.eaten >= 4, "the frog grew on four pellets");
    assert.ok(br.tell, "the frog's tongue gives a tell first");
    assert.ok(br.down, "then a big frog eats a ride whole");
    // Sections escalate: the fourth wave of each brings its mini-boss.
    const bosses = await page.evaluate(() => [4, 8, 12, 16].map((wv) => {
      const g = window.wave(wv), w = g.world;
      for (const u of w.crew) (u.shield = 1e9), (u.cool = 1e9), (u.strikes = u.rail = 0);
      w.steps(60 * 4);
      const b = w.foes.find((f) => f.on && f.boss);
      return [g.world.section, g.world.step, b ? b.kind : 0];
    }));
    assert.deepEqual(bosses, [[1, 4, 1], [2, 4, 2], [3, 4, 3], [4, 4, 5]], "the queen, the mothership, the heavy, the big frog");
    // The rides: the plane's guns shred the air and barely scratch armour; the tank's the other way round.
    const kinds = await page.evaluate(() => window.wave(9, "plane").world.crew.map((u) => u.kind));
    assert.deepEqual(kinds, [1, 0], "you fly the plane, your partner drives the tank");
    // Wall damage: ten plane bolts vs one tank shell into a wall (the shooter's ride decides).
    const walls = await page.evaluate(() => {
      const hit = (ride, n) => {
        const g = window.wave(9, ride), w = g.world, u = w.crew[0], b = w.blocks.find((x) => x.site >= 0 && x.hp > 0);
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
