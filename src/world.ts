// DOM Crossfire's world: fixed size, typed arrays, inputs as bits. The same inputs and the same
// seed give the same state on every machine, so it runs solo (one seat) and in lockstep over
// fizlet/presence (2+ seats) unchanged. No DOM, no allocation, no Math.random or clocks in a step:
// randomness is the engine's seeded `random`, time is the fixed step. The step is ./sim, the
// rules ./rules (this module imports neither, so the rules can import it).
import type { Engine } from "../vendor/fizlet/kernel/engine";
import { ROUND } from "./type";
import type { Ext } from "./rules";

/** The world in sim units (drawn scaled to the viewport, so every screen plays the same match). */
export const WW = 768, WH = 576;
/** Seats and things are fixed: a full world refuses a spawn, it never grows. */
export const SEATS = 4, CAP = 128;

/** Globals: time played, over (0 playing, 1 lost, 2 won), a spawn timer, then the rules' own:
 *  the cartridge on air, seconds on this channel, the glitch left, how many channels so far, the
 *  channel order (5), and a scratch slot per cartridge (fleet direction, power, the beat…). */
export const TIME = 0, OVER = 1, SPAWN = 2, CART = 3, CT = 4, GLITCH = 5, CH = 6, ORDER = 7, FLEET = 12, POWER = 13, BEAT = 14, FX = 15, FY = 16, KILLS = 17, RNG = 18, GLOBALS = 19;
/** Per seat: position, velocity (a tile game's target), score, health 0..1, a cooldown, the hull or
 *  facing angle, last input bits, a step timer, the aim (turret) angle and the hit shield. */
export const X = 0, Y = 1, VX = 2, VY = 3, SCORE = 4, HP = 5, COOL = 6, ANGLE = 7, PREV = 8, S0 = 9, AIM = 10, SHIELD = 11, SEAT = 12;

/** Input bits: stick x and y (4 bits each, signed -7..7), fire, the action. */
export const FIRE_BIT = 1 << 8, ACT_BIT = 1 << 9;
const q = (v: number) => Math.max(-7, Math.min(7, Math.round(v * 7))) & 15;
export const encode = (x: number, y: number, fire: boolean, act: boolean) => q(x) | (q(y) << 4) | (fire ? FIRE_BIT : 0) | (act ? ACT_BIT : 0);
const nib = (n: number) => (n >= 8 ? n - 16 : n) / 7;
export const axisX = (bits: number) => nib(bits & 15);
export const axisY = (bits: number) => nib((bits >> 4) & 15);

export interface World {
  players: number;
  /** GLOBALS, then SEATS × SEAT, then the things' columns: one buffer, so one byte view hashes it all. */
  g: Float64Array;
  s: Float64Array;
  /** Things (rules decide what a kind is): position, velocity, radius, a timer, kind, alive (0/1),
   *  heading and hit points. */
  x: Float64Array; y: Float64Array; vx: Float64Array; vy: Float64Array; r: Float64Array; t: Float64Array; kind: Float64Array; alive: Float64Array; a: Float64Array; hp: Float64Array;
  /** The whole state as bytes (fizlet/presence hash32, the determinism check). */
  bytes: Uint8Array;
  random(): number;
  /** The rules' own fixed state (a grid board, steer movers): made once per world, never in a step. */
  ext: Ext;
  /** Events on the engine's ring (sound, popups, sparks are drawn from them in render). Pass
   *  integers (`x | 0`): a fractional number handed to a call can box, an allocation in the step. */
  emit(type: string, a?: number, b?: number, x?: number, y?: number): void;
}

export function world(e: Engine, players: number): World {
  const n = GLOBALS + SEATS * SEAT + CAP * 10, all = new Float64Array(n);
  let o = GLOBALS + SEATS * SEAT;
  const col = () => all.subarray(o, (o += CAP));
  const w = {
    players, g: all.subarray(0, GLOBALS), s: all.subarray(GLOBALS, GLOBALS + SEATS * SEAT),
    x: col(), y: col(), vx: col(), vy: col(), r: col(), t: col(), kind: col(), alive: col(), a: col(), hp: col(),
    bytes: new Uint8Array(all.buffer), random: e.random,
    emit: (type: string, a = 0, b = 0, x = 0, y = 0) => void e.events.emit(type, a, b, x, y),
    ext: null as unknown as Ext,
  };
  return w;
}

/** Scratch for calls that carry doubles (V8 boxes a double handed to a call it doesn't inline, an
 *  allocation in the step): the caller writes the slots, the callee reads them right away.
 *  0-4 a spawn's x, y, vx, vy, r · 5-6 a popup's x, y · 7 an angle. */
export const A = new Float64Array(8);
/** First free thing slot for a thing of `kind` at A[0..4] (x, y, vx, vy, r), or -1. */
export function spawn(w: World, kind: number) {
  for (let i = 0; i < CAP; i++)
    if (!w.alive[i]) return (w.x[i] = A[0]!), (w.y[i] = A[1]!), (w.vx[i] = A[2]!), (w.vy[i] = A[3]!), (w.r[i] = A[4]!), (w.t[i] = 0), (w.kind[i] = kind), (w.alive[i] = 1), (w.a[i] = 0), (w.hp[i] = 1), i;
  return -1;
}

/** Seconds left on the round clock. */
export const left = (w: World) => Math.max(0, ROUND - w.g[TIME]!);
/** Pressed this step (not held from the last one). */
export const pressed = (bits: number, prev: number, bit: number) => (bits & bit) !== 0 && (prev & bit) === 0;
