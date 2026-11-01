// DOM Crossfire's rules: one arena, one score, five cartridges. Every PERIOD seconds the console
// glitches (GLITCH_S of frozen static) and the rules channel-surf to the next cartridge in a seeded
// order: the board, the bar and the score stay; only what the stick, the fire key and the foes mean
// changes. Each cartridge is the minimum of its original game's feel:
//   CH1 Null Invaders   the fleet marches, descends and bombs; you slide along the bottom and shoot up
//   CH2 Byte Runner     no gun: eat the bytes, dodge the flies; a big byte makes the flies edible
//   CH3 Sherman Bytes   a tank: the hull turns before it drives, the turret aims itself at pillboxes
//   CH4 Swarm Protocol  the swarm floods in from every edge and grows; you fire where you move
//   CH5 DOM Battlefield the grid locks moves to tiles; squads step on the beat; take the flags
// Deterministic and allocation-free in a step (./world says how): typed arrays, the seeded random,
// integer event arguments.
import { overlap } from "../vendor/fizlet/collide";
import { sprites } from "../vendor/fizlet/sprite";
import { ROLE } from "./look";
import { A, spawn, pressed, CAP, FIRE_BIT, WW, WH, X, Y, VX, VY, SCORE, HP, COOL, ANGLE, S0, AIM, SHIELD, SEAT, SPAWN, OVER, CART, CT, GLITCH, CH, ORDER, FLEET, POWER, BEAT, FX, FY, KILLS, RNG, type World } from "./world";

/** Seconds a channel stays on air (its glitch included), the glitch itself, and the cartridges. */
export const PERIOD = 30, GLITCH_S = 0.9, CARTS = 5;
export const NULL_I = 0, BYTE = 1, SHERMAN = 2, SWARM = 3, FIELD = 4;
/** The channel guide: name and the one rule that changed, per cartridge (channel = index + 1). */
export const NAMES = ["NULL INVADERS", "BYTE RUNNER", "SHERMAN BYTES", "SWARM PROTOCOL", "DOM BATTLEFIELD"];
export const RULE = ["THE FLEET DESCENDS", "NO GUN · EAT THE BYTES", "THE TURRET AIMS", "THE SWARM FLOODS IN", "THE GRID LOCKS YOUR MOVES"];
/** Each channel's colour (Board UI roles): the hero, the OSD and the static wear it. */
export const ACCENT = [ROLE.sys, ROLE.fallin, ROLE.advance, ROLE.attack, ROLE.cmd];

/** Thing kinds. Shots and bombs are shared; the rest belong to one cartridge each. */
const SHOT = 0, BOMB = 1, ALIEN = 2, FOOD = 3, BIG = 4, FLY = 5, PILL = 6, BUG = 7, SQUAD = 8, FLAG = 9;
/** Battlefield tiles: 16 × 12 of 48 units fill the 768 × 576 world exactly. */
export const T = 48, COLS = WW / T, ROWS = WH / T;
const HERO_R = 14;

const PI = Math.PI;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const tile = (v: number, n: number) => clamp(Math.floor(v / T), 0, n - 1) * T + T / 2;
const hard = (w: World) => 1 + w.g[CH]! * 0.14;
// The step's number registers (Blitz's pattern): V8 boxes a double passed to, or returned from, a
// call it doesn't inline, so helpers trade numbers through R: write, call, read back at once.
// R[0] a turn's goal, R[1] its most · R[2] a roll of the seeded random · R[4..7] the step's dt,
// difficulty and the hero's x, y (DT, HK, PX, PY).
const R = new Float64Array(10);
/** arr[i] turned toward R[0] by at most R[1], the short way round: fizlet/steer's `turn`, done in
 *  place (its double return boxes when V8 doesn't inline the call). */
function turnIn(arr: Float64Array, i: number) {
  const from = arr[i]!, d = Math.atan2(Math.sin(R[0]! - from), Math.cos(R[0]! - from)), m = R[1]!;
  arr[i] = from + (d > m ? m : d < -m ? -m : d);
}
/** R[2] = the step's seeded random in [0, 1): an LCG on g[RNG] (in the world's bytes, so lockstep
 *  peers and the hash agree), seeded from the engine's random once per round, never in a step. */
function roll(w: World) {
  const v = (Math.imul(w.g[RNG]! >>> 0, 1664525) + 1013904223) >>> 0;
  w.g[RNG] = v;
  R[2] = v / 4294967296;
}


// ---------- Art: characters as data, coloured by palette (0-4 the channels' accents) ----------
const pal = (b: string) => ({ b, h: ROLE.flag, o: ROLE.rim });
export const art = sprites({
  ship: { colors: { o: "o", b: "b", h: "h" }, frames: [["...o...", "..obo..", "..oho..", ".obbbo.", "obbbbbo", "oo.o.oo"]] },
  frog: { colors: { o: "o", b: "b", h: "h" }, frames: [[".hh.hh.", "ohoboho", "obbbbbo", "obbbbbo", ".obbbo.", "oo...oo"], [".hh.hh.", "ohoboho", "obbbbbo", "obbbbbo", "oobbboo", "......."]] },
  tank: { colors: { o: "o", b: "b", h: "h" }, frames: [["ooooooo.", "ohohohoo", "obbbbbbo", "obbbbbbo", "obbbbbbo", "obbbbbbo", "ohohohoo", "ooooooo."]] },
  cursor: { colors: { o: "o", b: "b", h: "h" }, frames: [["..ooo..", ".obbbo.", "obb.bbo", "ob.h.bo", "obb.bbo", ".obbbo.", "..ooo.."]] },
  trooper: { colors: { o: "o", b: "b", h: "h" }, frames: [[".ooo.", "obbbo", ".oho.", "obbbo", "ob.bo", ".o.o."], [".ooo.", "obbbo", ".oho.", "obbbo", "ob.bo", "o...o"]] },
  alien: { colors: { b: "b", h: "h" }, frames: [["..b....b..", "...b..b...", "..bbbbbb..", ".bbhbbhbb.", "bbbbbbbbbb", "b.bbbbbb.b", "b.b....b.b", "...bb.bb.."], ["..b....b..", "b..b..b..b", "b.bbbbbb.b", "bbbhbbhbbb", "bbbbbbbbbb", ".bbbbbbbb.", "..b....b..", ".b......b."]] },
  fly: { colors: { b: "b", h: "h" }, frames: [["hh...hh", ".hhbhh.", "..bbb..", "..bbb..", "...b..."], ["..h.h..", ".hhbhh.", "hhbbbhh", "..bbb..", "...b..."]] },
  pill: { colors: { o: "o", b: "b", h: "h" }, frames: [[".oooooo.", "obbbbbbo", "obhbbhbo", "obbbbbbo", "obbbbbbo", "obhbbhbo", "obbbbbbo", ".oooooo."]] },
  bug: { colors: { b: "b", h: "h" }, frames: [["b.b.b", ".bbb.", "bbhbb", ".bbb.", "b...b"], [".b.b.", "bbbbb", ".bhb.", "bbbbb", ".b.b."]] },
  flag: { colors: { o: "o", b: "b" }, frames: [["obbb.", "obbbb", "obbb.", "o....", "o....", "o...."]] },
}, { palettes: [...ACCENT.map(pal), pal(ROLE.teamB), pal(ROLE.sys), { "*": ROLE.flag }, pal(ROLE.hurt)] });
const ENEMY = 5, SCARED = 6, FLASH = 7, GOLD = 8;
const HERO = [0, 1, 2, 3, 4]; // sprite ids in the set's order: ship, frog, tank, cursor, trooper

// ---------- The channels ----------
/** Put cartridge `c` on air: clear the arena, place the seats for its rules and lay out its board. */
function tune(w: World, c: number) {
  const g = w.g, s = w.s;
  g[CART] = c;
  w.alive.fill(0);
  g[SPAWN] = 0.6; g[POWER] = 0; g[KILLS] = 0; g[BEAT] = 0.6; g[FLEET] = 1;
  for (let p = 0; p < w.players; p++) {
    const k = p * SEAT;
    s[k + COOL] = 0.3;
    s[k + ANGLE] = c === FIELD ? -PI / 2 : -PI / 2;
    s[k + AIM] = -PI / 2;
    if (c === FIELD) (s[k + X] = tile(s[k + X]!, COLS)), (s[k + Y] = tile(s[k + Y]!, ROWS)), (s[k + VX] = s[k + X]!), (s[k + VY] = s[k + Y]!);
  }
  if (c === NULL_I) fleet(w);
  else if (c === BYTE) bytes(w);
  else if (c === FIELD) flag(w);
  w.emit("channel", c, g[CH]! | 0);
}

function fleet(w: World) {
  g0: for (let r = 0; r < 4; r++)
    for (let col = 0; col < 8; col++) {
      const i = ((A[0] = 150 + col * 62), (A[1] = 70 + r * 46), (A[2] = 0), (A[3] = 0), (A[4] = 15), spawn(w, ALIEN));
      if (i < 0) break g0;
      w.hp[i] = r === 0 ? 2 : 1;
    }
  w.g[FLEET] = 1;
}
function bytes(w: World) {
  for (let r = 0; r < 6; r++)
    for (let col = 0; col < 11; col++) {
      const corner = (r === 0 || r === 5) && (col === 0 || col === 10);
      ((A[0] = 84 + col * 60), (A[1] = 90 + r * 80), (A[2] = 0), (A[3] = 0), (A[4] = corner ? 10 : 5), spawn(w, corner ? BIG : FOOD));
    }
}
function flag(w: World) {
  const s = w.s;
  for (let n = 0; n < 12; n++) {
    const x = tile((roll(w), R[2]!) * WW, COLS), y = tile(T + (roll(w), R[2]!) * (WH - 2 * T), ROWS);
    const dx = x - s[X]!, dy = y - s[Y]!;
    if (dx * dx + dy * dy > T * T * 16 || n === 11) return void ((w.g[FX] = x), (w.g[FY] = y));
  }
}
/** A spot on the arena at least `far` from seat 0 (a few seeded tries, then the last one). */
const at = new Float64Array(2);
function away(w: World, far: number, margin: number) {
  for (let n = 0; n < 10; n++) {
    at[0] = margin + (roll(w), R[2]!) * (WW - 2 * margin);
    at[1] = margin + (roll(w), R[2]!) * (WH - 2 * margin);
    const dx = at[0] - w.s[X]!, dy = at[1] - w.s[Y]!;
    if (dx * dx + dy * dy > far * far) return;
  }
}
const count = (w: World, kind: number) => {
  let n = 0;
  for (let i = 0; i < CAP; i++) if (w.alive[i] && w.kind[i] === kind) n++;
  return n;
};

/** Armor off seat p, in hundredths (an integer: see A). */
function hurt(w: World, p: number, pct: number) {
  const k = p * SEAT;
  if (w.s[k + SHIELD]! > 0 || w.g[OVER]) return;
  w.s[k + HP] = Math.max(0, w.s[k + HP]! - pct / 100);
  w.s[k + SHIELD] = 1;
  w.emit("hurt", p, pct, w.s[k + X]! | 0, w.s[k + Y]! | 0);
  if (w.s[k + HP]! <= 0) w.g[OVER] = 1;
}
/** Points to seat p, popped at A[5], A[6]. */
function score(w: World, p: number, pts: number) {
  w.s[p * SEAT + SCORE]! += pts;
  w.emit("hit", p, pts, A[5]! | 0, A[6]! | 0);
}
/** A shot from A[0], A[1] along A[7] at `speed` (integers). */
function fire(w: World, p: number, speed: number, r: number) {
  A[2] = Math.cos(A[7]!) * speed;
  A[3] = Math.sin(A[7]!) * speed;
  A[4] = r;
  spawn(w, SHOT);
  w.emit("fire", p);
}

// ---------- The step's parts: small functions (a rare path deopts only its own), numbers in R ----------
const DT = 4, HK = 5, PX = 6, PY = 7;

/** The glitch is over: the next cartridge on air. */
function nextChannel(w: World) {
  w.g[GLITCH] = 0;
  w.g[CH]!++;
  tune(w, w.g[ORDER + (w.g[CH]! | 0)]! | 0);
}
/** Survived a channel: a bonus and a little armor back, then the console scrambles. */
function scramble(w: World) {
  const g = w.g, s = w.s;
  for (let p = 0; p < w.players; p++) {
    const k = p * SEAT;
    s[k + HP] = Math.min(1, s[k + HP]! + 0.15);
    (A[5] = s[k + X]!), (A[6] = s[k + Y]! - 30), score(w, p, (50 * (g[CH]! + 1)) | 0);
  }
  g[GLITCH] = GLITCH_S;
  g[CT] = 0;
  w.emit("glitch", g[ORDER + (g[CH]! | 0) + 1]! | 0, g[CH]! | 0);
}
/** A cleared board's bonus (wave clear, all bytes eaten). */
function cleared(w: World, pts: number, kind: number) {
  for (let p = 0; p < w.players; p++) (A[5] = WW / 2), (A[6] = WH / 3), score(w, p, pts);
  w.emit("wave", kind);
}

function nullRules(w: World) {
  const g = w.g, hk = R[HK]!;
  let n = 0, edge = 0;
  for (let i = 0; i < CAP; i++) if (w.alive[i] && w.kind[i] === ALIEN) n++;
  if (n === 0) return void (cleared(w, 100, 0), fleet(w));
  const v = (34 + (32 - n) * 7) * hk * g[FLEET]! * R[DT]!;
  for (let i = 0; i < CAP; i++)
    if (w.alive[i] && w.kind[i] === ALIEN) {
      w.x[i]! += v;
      if (w.x[i]! < 22 || w.x[i]! > WW - 22) edge = 1;
    }
  if (edge) descend(w);
  if (g[SPAWN]! <= 0) {
    g[SPAWN] = (0.95 - Math.min(0.4, (32 - n) * 0.012)) / hk;
    roll(w);
    let j = Math.floor(R[2]! * CAP);
    for (let t = 0; t < CAP; t++, j = (j + 1) % CAP)
      if (w.alive[j] && w.kind[j] === ALIEN) {
        (A[0] = w.x[j]!), (A[1] = w.y[j]! + 14), (A[2] = 0), (A[3] = 230 * hk), (A[4] = 5), spawn(w, BOMB);
        break;
      }
  }
}
/** The fleet hit a wall: turn, step down; landed, it costs armor and a fresh fleet comes. */
function descend(w: World) {
  w.g[FLEET] = -w.g[FLEET]!;
  let low = 0;
  for (let i = 0; i < CAP; i++)
    if (w.alive[i] && w.kind[i] === ALIEN) clampIn(w.x, i, 22, WW - 22), (w.y[i]! += 20), (low = Math.max(low, w.y[i]!));
  if (low <= WH - 110) return;
  hurt(w, 0, 30);
  for (let i = 0; i < CAP; i++) if (w.kind[i] === ALIEN) w.alive[i] = 0;
  fleet(w);
}
function byteRules(w: World) {
  const g = w.g;
  if (g[POWER]! > 0 && (g[POWER]! -= R[DT]!) <= 0) (g[POWER] = 0), (g[KILLS] = 0);
  if (count(w, FOOD) + count(w, BIG) === 0) cleared(w, 150, 1), bytes(w);
  if (g[SPAWN]! > 0) return;
  g[SPAWN] = 1.6;
  if (count(w, FLY) >= 3 + g[CH]!) return;
  roll(w);
  const corner = Math.floor(R[2]! * 4);
  const i = ((A[0] = corner & 1 ? WW - 24 : 24), (A[1] = corner & 2 ? WH - 24 : 24), (A[2] = 0), (A[3] = 0), (A[4] = 12), spawn(w, FLY));
  if (i >= 0) w.a[i] = Math.atan2(R[PY]! - w.y[i]!, R[PX]! - w.x[i]!);
}
function shermanRules(w: World) {
  const g = w.g;
  if (g[SPAWN]! > 0) return;
  g[SPAWN] = 1.3;
  if (count(w, PILL) >= 3 + (g[CH]! >> 1)) return;
  away(w, 240, 56);
  roll(w);
  const i = ((A[0] = at[0]!), (A[1] = at[1]!), (A[2] = 1 + R[2]!), (A[3] = 0), (A[4] = 17), spawn(w, PILL));
  if (i >= 0) (w.hp[i] = 3), (w.a[i] = Math.atan2(R[PY]! - at[1]!, R[PX]! - at[0]!));
}
function swarmRules(w: World) {
  const g = w.g, hk = R[HK]!;
  if (g[SPAWN]! > 0) return;
  g[SPAWN] = Math.max(0.12, 0.42 - g[CT]! * 0.009) / hk;
  if (count(w, BUG) >= 70) return;
  roll(w);
  const side = Math.floor(R[2]! * 4);
  roll(w);
  const u = R[2]!, x = side === 0 ? -10 : side === 1 ? WW + 10 : u * WW, y = side === 2 ? -10 : side === 3 ? WH + 10 : u * WH;
  roll(w);
  const i = ((A[0] = x), (A[1] = y), (A[2] = (70 + R[2]! * 40) * hk), (A[3] = 0), (A[4] = 7), spawn(w, BUG));
  if (i >= 0) w.a[i] = Math.atan2(R[PY]! - y, R[PX]! - x);
}
function fieldRules(w: World) {
  const g = w.g;
  if (g[SPAWN]! <= 0) squad(w);
  if ((g[BEAT]! -= R[DT]!) <= 0) beat(w);
  const dx = R[PX]! - g[FX]!, dy = R[PY]! - g[FY]!;
  if (dx * dx + dy * dy < 400) (A[5] = g[FX]!), (A[6] = g[FY]!), score(w, 0, 30), w.emit("flag", 0), flag(w);
}
function squad(w: World) {
  w.g[SPAWN] = 1.5;
  if (count(w, SQUAD) >= 3 + w.g[CH]!) return;
  away(w, T * 6, T / 2);
  roll(w);
  A[0] = Math.min(COLS - 1, Math.floor(at[0]! / T)) * T + T / 2;
  A[1] = R[2]! < 0.6 ? T / 2 : Math.min(ROWS - 1, Math.floor(at[1]! / T)) * T + T / 2;
  (A[2] = A[0]!), (A[3] = A[1]!), (A[4] = 15);
  const i = spawn(w, SQUAD);
  if (i >= 0) w.hp[i] = 2;
}
/** The beat: every squad steps one tile at you, along the longer way (a coin on a tie). */
function beat(w: World) {
  const s = w.s;
  w.g[BEAT] = 0.62 / R[HK]!;
  for (let i = 0; i < CAP; i++) {
    if (!w.alive[i] || w.kind[i] !== SQUAD) continue;
    const dx = s[VX]! - w.vx[i]!, dy = s[VY]! - w.vy[i]!, ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
    let h = ax > ay;
    if (ax === ay) roll(w), (h = R[2]! < 0.5);
    if (h && dx) w.vx[i]! += dx > 0 ? T : -T;
    else if (dy) w.vy[i]! += dy > 0 ? T : -T;
  }
  w.emit("beat", 0);
}

/** Shots and bombs fly straight and leave the arena. */
function fly(w: World, i: number) {
  const dt = R[DT]!;
  w.x[i]! += w.vx[i]! * dt;
  w.y[i]! += w.vy[i]! * dt;
  if (w.x[i]! < -20 || w.x[i]! > WW + 20 || w.y[i]! < -20 || w.y[i]! > WH + 20) w.alive[i] = 0;
}
/** Byte Runner's flies: chase you, or flee while you're powered. */
function buzz(w: World, i: number) {
  const dt = R[DT]!, scared = w.g[POWER]! > 0;
  (R[0] = Math.atan2(R[PY]! - w.y[i]!, R[PX]! - w.x[i]!) + (scared ? PI : 0)), (R[1] = 2.6 * dt), turnIn(w.a, i);
  const v = (scared ? 80 : 118 * R[HK]!) * dt, wob = Math.sin(w.t[i]! * 7 + i) * 0.5;
  w.x[i]! += Math.cos(w.a[i]! + wob) * v;
  w.y[i]! += Math.sin(w.a[i]! + wob) * v;
  clampIn(w.x, i, 12, WW - 12);
  clampIn(w.y, i, 12, WH - 12);
}
/** Sherman's pillboxes: the turret follows you; a shell every couple of seconds once built. */
function pillbox(w: World, i: number) {
  const dt = R[DT]!, hk = R[HK]!;
  (R[0] = Math.atan2(R[PY]! - w.y[i]!, R[PX]! - w.x[i]!)), (R[1] = 2.4 * dt), turnIn(w.a, i);
  if (w.t[i]! <= 0.8 || (w.vx[i]! -= dt) > 0) return;
  roll(w);
  w.vx[i] = 1.9 / hk + R[2]! * 0.6;
  const c = Math.cos(w.a[i]!), sn = Math.sin(w.a[i]!);
  (A[0] = w.x[i]! + c * 20), (A[1] = w.y[i]! + sn * 20), (A[2] = c * 250 * hk), (A[3] = sn * 250 * hk), (A[4] = 6), spawn(w, BOMB);
  w.emit("shell", 0);
}
/** Swarm bugs: home in with a wobble; after 7 s a bug grows (faster, tougher, worth more). */
function crawl(w: World, i: number) {
  const dt = R[DT]!;
  if (w.hp[i] === 1 && w.t[i]! > 7) (w.hp[i] = 2), (w.r[i] = 11), (w.vx[i]! *= 1.35);
  (R[0] = Math.atan2(R[PY]! - w.y[i]!, R[PX]! - w.x[i]!)), (R[1] = 3.2 * dt), turnIn(w.a, i);
  const v = w.vx[i]! * dt, wob = Math.sin(w.t[i]! * 9 + i) * 0.35;
  w.x[i]! += Math.cos(w.a[i]! + wob) * v;
  w.y[i]! += Math.sin(w.a[i]! + wob) * v;
}
/** Battlefield squads slide into the tile the beat gave them. */
function march(w: World, i: number) {
  const e = 14 * R[DT]! > 1 ? 1 : 14 * R[DT]!;
  w.x[i]! += (w.vx[i]! - w.x[i]!) * e;
  w.y[i]! += (w.vy[i]! - w.y[i]!) * e;
}
/** What thing i does when it touches the hero: eaten, eats a fly, or costs armor. */
function touch(w: World, i: number) {
  const g = w.g, s = w.s, kind = w.kind[i]!, dx = w.x[i]! - R[PX]!, dy = w.y[i]! - R[PY]!, reach = w.r[i]! + HERO_R;
  if (dx * dx + dy * dy >= reach * reach) return;
  if (kind === FOOD) return void ((w.alive[i] = 0), (s[SCORE]! += 1), w.emit("eat", 0, 1, w.x[i]! | 0, w.y[i]! | 0));
  if (kind === BIG) return void ((w.alive[i] = 0), (g[POWER] = 6), w.emit("power", 0), (A[5] = w.x[i]!), (A[6] = w.y[i]!), score(w, 0, 10));
  if (kind === FLY && g[POWER]! > 0) return void ((w.alive[i] = 0), (g[KILLS] = Math.min(4, g[KILLS]! + 1)), (A[5] = w.x[i]!), (A[6] = w.y[i]!), score(w, 0, 20 << (g[KILLS]! | 0)));
  if (s[SHIELD]! > 0) return;
  w.alive[i] = 0;
  hurt(w, 0, kind === BOMB ? 16 : kind === BUG ? (w.hp[i] === 2 ? 12 : 6) : kind === ALIEN ? 30 : 22);
  if (kind !== BOMB) w.emit("hit", 0, 0, w.x[i]! | 0, w.y[i]! | 0);
}
/** A shot: the first foe it overlaps takes a hit; the last hit scores. */
function shot(w: World, i: number) {
  for (let j = 0; j < CAP; j++) {
    if (!w.alive[j]) continue;
    const kj = w.kind[j]!;
    if (kj !== ALIEN && kj !== PILL && kj !== BUG && kj !== SQUAD) continue;
    if (!overlap(w.x, w.y, w.r, i, j)) continue;
    w.alive[i] = 0;
    if ((w.hp[j]! -= 1) > 0) return void w.emit("dent", 0, 0, w.x[j]! | 0, w.y[j]! | 0);
    w.alive[j] = 0;
    (A[5] = w.x[j]!), (A[6] = w.y[j]!), score(w, 0, kj === ALIEN ? (w.y[j]! < 100 ? 20 : 10) : kj === PILL ? 25 : kj === BUG ? (w.r[j]! > 8 ? 8 : 3) : 15);
    return;
  }
}

// ---------- What the stick and the fire key mean, per cartridge (R[AX], R[AY]: the stick) ----------
const AX = 8, AY = 9;
/** arr[i] clamped to lo..hi in place. */
function clampIn(arr: Float64Array, i: number, lo: number, hi: number) {
  const v = arr[i]!;
  arr[i] = v < lo ? lo : v > hi ? hi : v;
}
/** Null Invaders: slide along the bottom, shoot up. */
function seatNull(w: World, p: number, k: number, ready: number) {
  const s = w.s, dt = R[DT]!;
  s[k + X]! += R[AX]! * 380 * dt;
  clampIn(s, k + X, 24, WW - 24);
  s[k + Y]! += (WH - 44 - s[k + Y]!) * (10 * dt > 1 ? 1 : 10 * dt);
  if (ready) (s[k + COOL] = 0.17), (A[0] = s[k + X]!), (A[1] = s[k + Y]! - 18), (A[7] = -PI / 2), fire(w, p, 760, 4);
}
/** Byte Runner: run anywhere; the fire key is a dud. */
function seatByte(w: World, p: number, k: number, dud: number) {
  const s = w.s, dt = R[DT]!;
  s[k + X]! += R[AX]! * 290 * dt;
  s[k + Y]! += R[AY]! * 290 * dt;
  clampIn(s, k + X, 20, WW - 20);
  clampIn(s, k + Y, 20, WH - 20);
  if (dud) w.emit("dud", p);
}
/** Sherman Bytes: the hull turns before it drives (its weight); the turret finds the nearest pillbox. */
function seatTank(w: World, p: number, k: number, ready: number) {
  const s = w.s, dt = R[DT]!, ax = R[AX]!, ay = R[AY]!, m2 = ax * ax + ay * ay, m = m2 >= 1 ? 1 : Math.sqrt(m2);
  if (m > 0.2) {
    const to = Math.atan2(ay, ax);
    (R[0] = to), (R[1] = 3.8 * dt), turnIn(s, k + ANGLE);
    const v = 230 * m * Math.max(0.12, Math.cos(to - s[k + ANGLE]!)) * dt;
    s[k + X]! += Math.cos(s[k + ANGLE]!) * v;
    s[k + Y]! += Math.sin(s[k + ANGLE]!) * v;
    clampIn(s, k + X, 22, WW - 22);
    clampIn(s, k + Y, 22, WH - 22);
  }
  let best = -1, bd = 1e12;
  for (let i = 0; i < CAP; i++)
    if (w.alive[i] && w.kind[i] === PILL) {
      const dx = w.x[i]! - s[k + X]!, dy = w.y[i]! - s[k + Y]!, d = dx * dx + dy * dy;
      if (d < bd) (bd = d), (best = i);
    }
  (R[0] = best < 0 ? s[k + ANGLE]! : Math.atan2(w.y[best]! - s[k + Y]!, w.x[best]! - s[k + X]!)), (R[1] = 5 * dt), turnIn(s, k + AIM);
  if (ready) (s[k + COOL] = 0.42), (A[0] = s[k + X]! + Math.cos(s[k + AIM]!) * 24), (A[1] = s[k + Y]! + Math.sin(s[k + AIM]!) * 24), (A[7] = s[k + AIM]!), fire(w, p, 620, 6);
}
/** Swarm Protocol: run anywhere, fire where you last moved (a fast stream that fans a little). */
function seatSwarm(w: World, p: number, k: number, ready: number) {
  const s = w.s, dt = R[DT]!, ax = R[AX]!, ay = R[AY]!;
  s[k + X]! += ax * 300 * dt;
  s[k + Y]! += ay * 300 * dt;
  clampIn(s, k + X, 18, WW - 18);
  clampIn(s, k + Y, 18, WH - 18);
  if (ax * ax + ay * ay > 0.09) s[k + AIM] = Math.atan2(ay, ax);
  if (!ready) return;
  const odd = (w.g[KILLS]! | 0) & 1;
  w.g[KILLS] = odd ^ 1;
  (s[k + COOL] = 0.085), (A[0] = s[k + X]!), (A[1] = s[k + Y]!), (A[7] = s[k + AIM]! + (odd ? 0.05 : -0.05)), fire(w, p, 780, 4);
}
/** DOM Battlefield: one tile per step, a step every 0.16 s while held; the seat slides into it. */
function seatGrid(w: World, p: number, k: number, ready: number) {
  const s = w.s, dt = R[DT]!, ax = R[AX]!, ay = R[AY]!, aax = ax < 0 ? -ax : ax, aay = ay < 0 ? -ay : ay;
  if ((s[k + S0]! -= dt) <= 0 && (aax > 0.4 || aay > 0.4)) {
    const h = aax >= aay, dx = h ? (ax > 0 ? 1 : -1) : 0, dy = h ? 0 : ay > 0 ? 1 : -1;
    s[k + VX]! += dx * T;
    s[k + VY]! += dy * T;
    clampIn(s, k + VX, T / 2, WW - T / 2);
    clampIn(s, k + VY, T / 2, WH - T / 2);
    s[k + ANGLE] = Math.atan2(dy, dx);
    s[k + S0] = 0.16;
  }
  const e = 20 * dt > 1 ? 1 : 20 * dt;
  s[k + X]! += (s[k + VX]! - s[k + X]!) * e;
  s[k + Y]! += (s[k + VY]! - s[k + Y]!) * e;
  if (ready) (s[k + COOL] = 0.26), (A[0] = s[k + VX]!), (A[1] = s[k + VY]!), (A[7] = s[k + ANGLE]!), fire(w, p, 660, 5);
}

export type Ext = null;
export const rules = {
  make: (_w: World): Ext => null,
  seat0(w: World, p: number) {
    w.s[p * SEAT + X] = (WW * (p + 1)) / (w.players + 1);
    w.s[p * SEAT + Y] = WH - 48;
  },
  /** A fresh round: the channel order (Null Invaders first, the other four shuffled), then CH1. */
  start(w: World) {
    const g = w.g;
    g[RNG] = (w.random() * 4294967296) >>> 0;
    for (let i = 0; i < CARTS; i++) g[ORDER + i] = i;
    for (let i = CARTS - 1; i > 1; i--) {
      const j = 1 + Math.floor((roll(w), R[2]!) * i), t = g[ORDER + i]!;
      (g[ORDER + i] = g[ORDER + j]!), (g[ORDER + j] = t);
    }
    g[CH] = 0; g[CT] = 0; g[GLITCH] = 0;
    tune(w, g[ORDER]!);
  },
  seat(w: World, p: number, k: number, bits: number, prev: number, dt: number) {
    const s = w.s;
    if (s[k + SHIELD]! > 0) s[k + SHIELD]! -= dt;
    s[k + COOL]! -= dt;
    if (w.g[GLITCH]! > 0) return; // the static: nothing moves
    // The stick (./world's axisX/axisY, inline: a double returned from a call boxes).
    const nx = bits & 15, ny = (bits >> 4) & 15;
    (R[DT] = dt), (R[AX] = (nx >= 8 ? nx - 16 : nx) / 7), (R[AY] = (ny >= 8 ? ny - 16 : ny) / 7);
    const ready = (bits & FIRE_BIT) !== 0 && s[k + COOL]! <= 0 ? 1 : 0, c = w.g[CART]! | 0;
    if (c === NULL_I) seatNull(w, p, k, ready);
    else if (c === BYTE) seatByte(w, p, k, pressed(bits, prev, FIRE_BIT) ? 1 : 0);
    else if (c === SHERMAN) seatTank(w, p, k, ready);
    else if (c === SWARM) seatSwarm(w, p, k, ready);
    else seatGrid(w, p, k, ready);
  },
  world(w: World, dt: number) {
    const g = w.g;
    g[CT]! += dt;
    // The glitch: static, then the next cartridge.
    if (g[GLITCH]! > 0) {
      if ((g[GLITCH]! -= dt) <= 0) nextChannel(w);
      return;
    }
    if (g[CT]! >= PERIOD && g[CH]! < CARTS - 1) return void scramble(w);
    (R[DT] = dt), (R[HK] = hard(w)), (R[PX] = w.s[X]!), (R[PY] = w.s[Y]!);
    g[SPAWN]! -= dt;
    const c = g[CART]! | 0;
    if (c === NULL_I) nullRules(w);
    else if (c === BYTE) byteRules(w);
    else if (c === SHERMAN) shermanRules(w);
    else if (c === SWARM) swarmRules(w);
    else fieldRules(w);
    // Every thing: move, its own behaviour, what it touches.
    for (let i = 0; i < CAP; i++) {
      if (!w.alive[i]) continue;
      const kind = w.kind[i]!;
      w.t[i]! += dt;
      if (kind === SHOT || kind === BOMB) fly(w, i);
      else if (kind === FLY) buzz(w, i);
      else if (kind === PILL) pillbox(w, i);
      else if (kind === BUG) crawl(w, i);
      else if (kind === SQUAD) march(w, i);
      if (!w.alive[i]) continue;
      if (kind === SHOT) shot(w, i);
      else touch(w, i);
    }
  },
  timeUp: (w: World) => (w.s[HP]! > 0 ? 2 : 1),
  /** The bar: Score, Channel (the cartridge's number), Signal (this channel's time left), Armor. */
  hud(w: World, out: Float64Array, me: number) {
    const g = w.g;
    out[0] = w.s[me * SEAT + SCORE]!;
    out[1] = (g[CART]! | 0) + 1;
    out[2] = g[GLITCH]! > 0 ? 0 : Math.max(0, 1 - g[CT]! / PERIOD);
    out[3] = w.s[me * SEAT + HP]!;
  },
  /** The arena's things and heroes in world units (the caller fits the world to the screen). */
  draw(w: World, c: CanvasRenderingContext2D, time: number, calm: boolean) {
    const g = w.g, cart = g[CART]! | 0, f = (time * 4) & 1, scared = g[POWER]! > 0;
    if (cart === FIELD && g[GLITCH]! <= 0) art.draw(c, "flag", 0, g[FX]!, g[FY]!, 0, 4, GOLD);
    for (let i = 0; i < CAP; i++) {
      if (!w.alive[i]) continue;
      const k = w.kind[i]!, x = w.x[i]!, y = w.y[i]!;
      if (k === SHOT) (c.fillStyle = ACCENT[cart]!), c.fillRect(x - 3, y - 3, 6, 6);
      else if (k === BOMB) (c.fillStyle = ROLE.teamB), c.fillRect(x - 3, y - 5, 6, 10);
      else if (k === FOOD) (c.fillStyle = ROLE.flag), c.fillRect(x - 3, y - 3, 6, 6);
      else if (k === BIG) (c.fillStyle = f ? ROLE.go : ROLE.flag), c.fillRect(x - 8, y - 8, 16, 16);
      else if (k === ALIEN) art.draw(c, "alien", f, x, y, 0, 3, w.hp[i]! > 1 ? GOLD : ENEMY);
      else if (k === FLY) art.draw(c, "fly", f, x, y, 0, 4, scared ? (g[POWER]! < 1.5 && f ? FLASH : SCARED) : ENEMY);
      else if (k === PILL) {
        art.draw(c, "pill", 0, x, y, 0, 4, w.t[i]! < 0.8 && f ? FLASH : ENEMY);
        c.strokeStyle = ROLE.teamB;
        c.lineWidth = 5;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + Math.cos(w.a[i]!) * 24, y + Math.sin(w.a[i]!) * 24);
        c.stroke();
      } else if (k === BUG) art.draw(c, "bug", f, x, y, 0, w.hp[i]! > 1 ? 4 : 3, w.hp[i]! > 1 ? GOLD : ENEMY);
      else if (k === SQUAD) art.draw(c, "trooper", f, x, y, 0, 5, w.hp[i]! > 1 ? ENEMY : GOLD);
    }
    for (let p = 0; p < w.players; p++) {
      const k = p * SEAT, x = w.s[k + X]!, y = w.s[k + Y]!;
      const blink = w.s[k + SHIELD]! > 0 && ((time * 12) & 1);
      c.globalAlpha = blink ? (calm ? 0.55 : 0.2) : 1;
      if (cart === SHERMAN) {
        art.draw(c, HERO[2]!, 0, x, y, w.s[k + ANGLE]!, 4, 2);
        c.strokeStyle = ROLE.rim;
        c.lineWidth = 9;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + Math.cos(w.s[k + AIM]!) * 28, y + Math.sin(w.s[k + AIM]!) * 28);
        c.stroke();
        c.strokeStyle = ROLE.flag;
        c.lineWidth = 4;
        c.stroke();
        c.fillStyle = ACCENT[2]!;
        c.fillRect(x - 7, y - 7, 14, 14);
      } else if (cart === SWARM) {
        art.draw(c, HERO[3]!, 0, x, y, 0, 4, 3);
        c.fillStyle = ACCENT[3]!;
        c.fillRect(x + Math.cos(w.s[k + AIM]!) * 26 - 3, y + Math.sin(w.s[k + AIM]!) * 26 - 3, 6, 6);
      } else art.draw(c, HERO[cart]!, cart === BYTE || cart === FIELD ? f : 0, x, y, 0, cart === FIELD ? 5 : 4, cart);
      c.globalAlpha = 1;
    }
  },
  stats: (w: World) => ({ score: w.s[SCORE]!, channels: (w.g[CH]! | 0) + 1, armor: Math.round(w.s[HP]! * 100), player: { x: w.s[X]!, y: w.s[Y]!, angle: w.s[AIM]! } }),
};
