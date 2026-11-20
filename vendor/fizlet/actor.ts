/**
 * @fzlt/core/actor: units, bots, turrets and shots as data. One fixed-capacity table of typed arrays,
 * one row per actor: alive, side, kind, tag bits, health (`hp` of `max`) and a body (`x`, `y`,
 * heading `a`, velocity `vx`, `vy`, radius `r`). Nothing allocates after `actors()`: spawn takes a
 * free row, kill marks it dead, and `sweep()` (once per step, after your loops) gives dead rows
 * back. A game's own fields are its own typed arrays of length `cap`, indexed by row (cooldowns,
 * orders, timers). Iterate the dense list, which keeps spawn order, so a seeded run replays:
 *
 *   for (let k = 0; k < A.n; k++) { const i = A.list[k]!; if (!A.alive[i]) continue; ... }
 *
 * A row is reused once swept, so hold on to an actor across steps by its handle (`ref(i)`), not
 * its row: `get(handle)` is -1 once that actor is gone, even if its row lives again. Share the body
 * with @fzlt/core/steer by passing its arrays (`actors({ cap, x: m.x, y: m.y, a: m.a })`). With
 * `events` (engine.events) it rings `actor:spawn`, `actor:hurt` and `actor:kill` (a: row, b: side,
 * x, y: where, in whole pixels, v: damage, or health on spawn) for sound, effects and the HUD. Whole
 * pixels because small integers never box: a double passed to the ring can cost a heap number.
 */
import type { EventRing } from "./kernel/ring";

/** Options for `actors()`: capacity, sides, optional shared body arrays and the event ring. */
export interface ActorOptions {
  /** Rows (fixed: the arrays never grow; spawn returns -1 when full). */
  cap: number;
  /** Sides counted by `count(side)` (default 8, at most 32: `nearest` takes them as bits). */
  sides?: number;
  /** Bring your own body arrays (length ≥ cap), e.g. a steer's, so both move the same numbers. */
  x?: Float64Array;
  y?: Float64Array;
  a?: Float64Array;
  /** engine.events: actor:spawn, actor:hurt, actor:kill. */
  events?: EventRing;
}

/** A fixed-capacity actor table: typed-array rows with spawn, kill, hurt, heal, sweep, handles, side counts, tags and nearest. */
export function actors(o: ActorOptions) {
  const cap = Math.max(1, o.cap | 0), ns = Math.min(32, Math.max(1, (o.sides ?? 8) | 0)), ring = o.events;
  const f64 = () => new Float64Array(cap);
  const x = o.x ?? f64(), y = o.y ?? f64(), a = o.a ?? f64(), vx = f64(), vy = f64(), r = f64(), hp = f64(), max = f64();
  const alive = new Uint8Array(cap), side = new Uint8Array(cap), kind = new Uint8Array(cap), tags = new Uint32Array(cap);
  // Handles: gen × cap + row, kept under 2^30 so a handle is always a small integer (never boxed).
  const gen = new Uint32Array(cap), wrap = Math.max(1, Math.floor(2 ** 30 / cap));
  const list = new Int32Array(cap), free = new Int32Array(cap), per = new Int32Array(ns);
  // n: rows on the list (live and dead-not-swept); nf: free rows; live: alive rows; dirty: a kill since the last sweep.
  const c = new Int32Array(4), N = 0, NF = 1, LIVE = 2, DIRTY = 3;
  const reset = () => {
    alive.fill(0);
    per.fill(0);
    c[N] = c[LIVE] = c[DIRTY] = 0;
    c[NF] = cap;
    for (let k = 0; k < cap; k++) free[k] = cap - 1 - k; // row 0 first
  };
  reset();
  const kill = (i: number) => {
    if (!alive[i]) return false;
    alive[i] = 0;
    per[side[i]!]!--;
    c[LIVE]!--;
    c[DIRTY] = 1;
    ring?.emit("actor:kill", i, side[i], x[i]! | 0, y[i]! | 0, 0);
    return true;
  };
  return {
    cap, x, y, a, vx, vy, r, hp, max, alive, side, kind, tags, gen,
    /** The dense list: rows list[0..n), in spawn order (dead ones stay until `sweep()`). */
    list,
    get n() {
      return c[N]!;
    },
    /** Actors alive right now. */
    get live() {
      return c[LIVE]!;
    },
    /** A new actor on `side` with `health` (its max too); its body is zeroed. -1 when full. */
    spawn(s: number, health: number, k = 0, t = 0) {
      if (!c[NF] || s < 0 || s >= ns) return -1;
      const i = free[--c[NF]!]!;
      alive[i] = 1;
      side[i] = s;
      kind[i] = k;
      tags[i] = t;
      hp[i] = max[i] = health;
      x[i] = y[i] = a[i] = vx[i] = vy[i] = r[i] = 0;
      gen[i] = (gen[i]! + 1) % wrap;
      list[c[N]!++] = i;
      per[s]!++;
      c[LIVE]!++;
      ring?.emit("actor:spawn", i, s, 0, 0, health);
      return i;
    },
    /** Dead now (alive = 0, out of `count`); its row comes back at `sweep()`. False if already dead. */
    kill,
    /** Take `damage`; true when that killed it. */
    hurt(i: number, damage: number) {
      if (!alive[i]) return false;
      hp[i] = hp[i]! - damage;
      ring?.emit("actor:hurt", i, side[i], x[i]! | 0, y[i]! | 0, damage);
      return hp[i]! <= 0 && kill(i);
    },
    /** Back up by `amount`, never over max. */
    heal(i: number, amount: number) {
      if (alive[i]) hp[i] = Math.min(max[i]!, hp[i]! + amount);
    },
    /** Give dead rows back (keeps the list's order). Once per step, after the loops that kill. */
    sweep() {
      if (!c[DIRTY]) return;
      let w = 0;
      for (let k = 0; k < c[N]!; k++) {
        const i = list[k]!;
        if (alive[i]) list[w++] = i;
        else free[c[NF]!++] = i;
      }
      c[N] = w;
      c[DIRTY] = 0;
    },
    /** Live actors on side s. */
    count(s: number) {
      return s >= 0 && s < ns ? per[s]! : 0;
    },
    /** A handle that outlives the row: `get(ref(i))` is i while that actor lives, -1 after. */
    ref(i: number) {
      return gen[i]! * cap + i;
    },
    get(h: number) {
      const i = h % cap;
      return h >= 0 && alive[i] && gen[i]! * cap + i === h ? i : -1;
    },
    /** Every bit of `bits` set? / set or clear them. */
    has(i: number, bits: number) {
      return (tags[i]! & bits) === bits;
    },
    tag(i: number, bits: number, on = true) {
      tags[i] = on ? tags[i]! | bits : tags[i]! & ~bits;
    },
    /** The nearest live actor to i (not i) within `range`, on a side in the `sides` bits (1 << side)
     *  and carrying every `need` tag bit; -1 if none. Ties go to the earlier spawn. */
    nearest(i: number, range = Infinity, sides = -1, need = 0) {
      let best = -1, bd = range * range;
      for (let k = 0; k < c[N]!; k++) {
        const j = list[k]!;
        if (j === i || !alive[j] || !((sides >>> side[j]!) & 1) || (tags[j]! & need) !== need) continue;
        const dx = x[j]! - x[i]!, dy = y[j]! - y[i]!, d = dx * dx + dy * dy;
        if (d <= bd && (best < 0 || d < bd)) (best = j), (bd = d);
      }
      return best;
    },
    /** Everything dead and every row free (a new match). Handles from before stay stale. */
    clear: reset,
  };
}
/** The table `actors()` returns. */
export type Actors = ReturnType<typeof actors>;
