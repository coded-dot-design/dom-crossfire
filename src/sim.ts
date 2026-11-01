// DOM Crossfire's simulation step: every seat's input, then the world, on the fixed step. Deterministic
// (./world says how), so solo and lockstep run the same code.
import type { Engine } from "../vendor/fizlet/kernel/engine";
import { ROUND } from "./type";
import { rules } from "./rules";
import { world, HP, OVER, PREV, SEAT, TIME, type World } from "./world";

/** A world with the rules' own state made (once, never in a step). */
export function create(e: Engine, players: number): World {
  const w = world(e, players);
  w.ext = rules.make(w);
  return w;
}

/** A fresh round: empty world, every seat placed by the rules. */
export function reset(w: World) {
  w.g.fill(0);
  w.s.fill(0);
  w.alive.fill(0);
  for (let p = 0; p < w.players; p++) (w.s[p * SEAT + HP] = 1), rules.seat0(w, p);
  rules.start(w);
}

/** One fixed step: every seat's input, then the world. Ends the round at the clock. */
export function step(w: World, inputs: Uint32Array, dt: number) {
  if (w.g[OVER]) return;
  w.g[TIME]! += dt;
  for (let p = 0; p < w.players; p++) {
    const b = inputs[p]!, k = p * SEAT;
    rules.seat(w, p, k, b, w.s[k + PREV]! | 0, dt);
    w.s[k + PREV] = b;
  }
  rules.world(w, dt);
  if (!w.g[OVER] && w.g[TIME]! >= ROUND) w.g[OVER] = rules.timeUp(w);
}

