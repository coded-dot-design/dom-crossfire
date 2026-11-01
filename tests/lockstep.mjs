// Squad play: 2, 3 and 4 people in lockstep over the in-memory link stay identical, frame for frame.
// Each peer has its own screen size and only its own person's input (a scripted stream of drives,
// shots, specials, airstrikes and aim modes, and the ride they picked); the match must still be one
// match: the same digest every 600 frames, the same hash at the end, no desync, no Math.random. A
// slow, jittered link plays the very same match as an instant one (the replay). Two people keep the
// AI partner as a third ride; three or four play alone. Needs npm run check.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launch, open } from "./harness.mjs";

const FRAMES = Number(process.env.FRAMES ?? 3600);
const browser = await launch(chromium);
try {
  const { page, errors } = await open(browser, { url: "/host", width: 1280, height: 1400 });
  /** n peers, `frames` lockstep frames, each peer's digest every 600 frames. rides[i]: 0 tank, 1 plane. */
  const run = (o) =>
    page.evaluate(async ({ frames, latency, jitter, seed, n, rides, scripted = true }) => {
      const { createCrossfire, memory } = await import("/dist/dom-crossfire-net.mjs");
      for (const el of document.querySelectorAll(".peer")) el.remove();
      const sizes = [[1100, 640], [700, 460], [600, 400], [390, 300]];
      for (let i = 0; i < n; i++) document.body.insertAdjacentHTML("beforeend", `<div class="peer" id="p${i}" style="position:relative;width:${sizes[i][0]}px;height:${sizes[i][1]}px"></div>`);
      const hub = memory({ peers: n, latency, jitter, seed: 5 });
      // Scripted hands: each peer's own seeded stream, which only that peer knows.
      const hands = (slot) => {
        let s = 1000 + slot * 77;
        const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
        return () => {
          const mx = (r() * 3) | 0, my = (r() * 3) | 0, aim = (r() * 3) | 0;
          let b = mx | (my << 2) | (aim << 7) | (rides[slot] << 9);
          if (r() < 0.4) b |= 16;
          if (r() < 0.01) b |= 32;
          if (r() < 0.004) b |= 64;
          return (b | (((r() * 256) | 0) << 16) | (((r() * 256) | 0) << 24)) >>> 0;
        };
      };
      const peers = Array.from({ length: n }, (_, slot) => createCrossfire(document.getElementById(`p${slot}`), { seed, net: { transport: hub.ends[slot], slot, players: n, ...(scripted ? { input: hands(slot) } : {}) } }));
      for (const g of peers) g.engine.stop(); // step by hand: the shared clock must not add frames
      let calls = 0;
      const real = Math.random;
      Math.random = () => (calls++, real());
      const digests = peers.map(() => []);
      const snap = (g) => g.world.crew.map((u) => [u.kind, u.human ? "H" : "A", u.alive, Math.round(u.x * 100), Math.round(u.y * 100), u.hp, u.kills, u.deaths].join(",")).join("|") + `#${g.wave}#${g.score}#${g.world.foes.filter((f) => f.on).length}#${g.hash()}`;
      let ticks = 0;
      while (peers.some((g) => g.net.frame < frames) && ticks < frames * 10) {
        hub.tick();
        ticks++;
        peers.forEach((g, i) => {
          if (g.net.frame >= frames) return;
          const before = g.net.frame;
          g.engine.advance(1 / 60);
          if (g.net.frame !== before && g.net.frame % 600 === 0) digests[i].push(snap(g));
        });
      }
      Math.random = real;
      const out = {
        frames: peers.map((g) => g.net.frame), stalls: peers.map((g) => g.net.stalls), desync: peers.map((g) => g.net.desync), digests, calls,
        final: peers.map((g) => g.hash()), rosters: peers.map((g) => g.world.crew.map((u) => `${u.kind ? "plane" : "tank"}${u.human ? "" : "·AI"}`).join(" ")),
        you: peers.map((g) => g.world.crew.findIndex((u) => u.you)), kills: peers[0].world.crew.reduce((a, u) => a + u.kills, 0), states: peers.map((g) => g.state),
      };
      peers.forEach((g) => g.destroy());
      return out;
    }, o);

  const same = (r, n, what) => {
    assert.deepEqual(r.frames, Array(n).fill(r.frames[0]), `${what}: every peer ran the frames`);
    for (let i = 1; i < n; i++) assert.deepEqual(r.digests[i], r.digests[0], `${what}: peer ${i + 1} plays the same match as peer 1`);
    assert.deepEqual(r.final, Array(n).fill(r.final[0]), `${what}: the same state hash at the end`);
    assert.deepEqual(r.desync, Array(n).fill(-1), `${what}: no hash check ever differed`);
    assert.equal(r.calls, 0, `${what}: no Math.random in the match`);
  };
  // Four people, mixed rides, an instant link; then the same over a slow, jittered link (the replay).
  const four = await run({ frames: FRAMES, latency: 0, jitter: 0, seed: 41, n: 4, rides: [1, 0, 0, 1] });
  same(four, 4, "4 players");
  assert.equal(four.digests[0].length, FRAMES / 600);
  assert.equal(four.rosters[0], "plane tank tank plane", "four people, their rides, no AI");
  assert.deepEqual(four.you, [0, 1, 2, 3], "each screen is its own seat");
  assert.ok(four.kills > 0, "the squad fought (the match isn't idle)");
  // The replay: the same seed and the same hands, run again from scratch: the same match.
  const again = await run({ frames: FRAMES, latency: 0, jitter: 0, seed: 41, n: 4, rides: [1, 0, 0, 1] });
  assert.deepEqual(again.digests, four.digests, "4 players: the same seed replays the same match");
  const slow = await run({ frames: FRAMES, latency: 6, jitter: 5, seed: 41, n: 4, rides: [1, 0, 0, 1] });
  same(slow, 4, "4 players, slow link");
  assert.ok(slow.stalls.every((s) => s > 0), "a link slower than the input delay makes everyone wait");
  assert.deepEqual(slow.digests[0], four.digests[0], "delayed, jittered, reordered inputs: the very same match");
  // Three people: no AI. Two: the AI partner takes the ride they have fewer of.
  const three = await run({ frames: 1200, latency: 2, jitter: 1, seed: 7, n: 3, rides: [0, 0, 1] });
  same(three, 3, "3 players");
  assert.equal(three.rosters[0], "tank tank plane");
  const two = await run({ frames: 1200, latency: 2, jitter: 1, seed: 8, n: 2, rides: [0, 0] });
  same(two, 2, "2 players");
  assert.equal(two.rosters[0], "tank tank plane·AI", "two tanks: the AI flies the plane");
  // The real controls path (encode → word → human): keys held on the page, no scripted input.
  await page.keyboard.down("KeyD");
  const keys = await run({ frames: 900, latency: 2, jitter: 1, seed: 9, n: 2, rides: [0, 0], scripted: false });
  await page.keyboard.up("KeyD");
  same(keys, 2, "keys");
  assert.deepEqual(errors, []);
  console.log(`DOM Crossfire squad lockstep: 4 players identical over ${FRAMES} frames (instant and slow, jittered link: the same match), 3 and 2 players identical, 0 desyncs, 0 Math.random.`);
} finally {
  await browser.close();
}
