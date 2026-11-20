/**
 * @fzlt/core/track: board paths for roll-and-move games. Spaces along a closed loop or an open path,
 * straight between the points you give or on a smooth curve through them, in board coordinates
 * [x, z] (diorama's floor plane; y is up). Jumps (chutes, ladders, shortcuts) take a token from one
 * space to another; several tokens on one space spread around it, then stack upward.
 * - `move(token, steps)` works out the whole move at once: the hops (a step per space, then any
 *   jumps), with a flag on each for passing the start ("go"), bouncing back, the finish and the
 *   landing; an open path ends by stopping at the end, needing the exact count, or bouncing back.
 * - The hops are data with times: `sample(t, out)` gives the moving token's [x, y, z] (an arc per
 *   step, a slide or climb for a jump), `apply(ob, t)` writes it into a diorama object's `pos`.
 * - Events, if you pass an event ring (`engine.events`), as `move` works the move out: `track:pass`,
 *   `track:jump`, `track:finish`, `track:land` and `track:stay` (an exact finish overshot), each with
 *   the token and the space.
 * No randomness (the dice decide) and no allocation per move or sample (typed arrays, fixed capacity).
 * Lengths use steer's exact `hypot` (the builtin boxes its arguments).
 */
import { hypot } from "./steer";

const TAU = 6.283185307179586;

/** Something that takes events: an engine's ring (`engine.events`). */
export interface TrackEvents {
  emit(type: string, a?: number, b?: number): unknown;
}

/** How an open path ends when a move would go past the last space. */
export type TrackFinish = "stop" | "exact" | "bounce";

/** Options for `track()`: the path, its spaces, jumps, sharing, the end rule and the hop's look. */
export interface TrackOptions {
  /** The path's points, [x0, z0, x1, z1, …], in board units. */
  points: ArrayLike<number>;
  /** A loop: the last space leads to the first (default false: an open path, start to finish). */
  closed?: boolean;
  /** Lay this many spaces at even distances along the path (default: one space per point). */
  spaces?: number;
  /** A smooth curve through the points (Catmull-Rom) instead of straight lines; needs `spaces`. */
  smooth?: boolean;
  /** Jumps as [from, to] space pairs: a ladder up, a chute down, a shortcut. */
  jumps?: ArrayLike<ArrayLike<number>>;
  /** Tokens side by side on a space before the next ones stack on top (one number, or one per space; default 4). */
  cap?: number | ArrayLike<number>;
  /** How far apart tokens that share a space stand from its centre (default 0.3). */
  spacing?: number;
  /** The height of one stacked level (default 0.3). */
  level?: number;
  /** The most tokens (default 8). */
  tokens?: number;
  /** An open path's end: "stop" at the last space (default), "exact" (a move past it does not move)
   *  or "bounce" (count back from it). */
  finish?: TrackFinish;
  /** The space a token passes on a loop to "pass go" (default 0). */
  start?: number;
  /** The arc's height over a step (default 0.6). */
  hop?: number;
  /** Seconds per step (default 0.22). */
  hopTime?: number;
  /** Board units per second along a jump (default 6; at least 1.5 steps long). */
  jumpSpeed?: number;
  /** The most hops in one move (default 64). */
  maxHops?: number;
  /** An event ring for `track:pass`, `track:jump`, `track:finish`, `track:land`. */
  events?: TrackEvents;
}

/** Hop kinds and flags (`hops.kind`, `hops.flag`). */
export const HOP = {
  /** A step to the next (or previous) space. */
  step: 0,
  /** A jump from a space to its target. */
  jump: 1,
  /** Flag: this hop enters the start space going forward on a loop (pass go). */
  pass: 1,
  /** Flag: a step backward after the end (bounce). */
  back: 2,
  /** Flag: the move ends on the last space of an open path. */
  finish: 4,
  /** Flag: the last hop of the move. */
  land: 8,
} as const;

/** A board path on `o.points`: `place` tokens, `move` them, then `sample` the hops over time. */
export function track(o: TrackOptions) {
  const pts = o.points, np = pts.length >> 1, closed = !!o.closed, T = o.tokens ?? 8, MH = o.maxHops ?? 64;
  const n = o.spaces ?? np, sp = o.spacing ?? 0.3, lvl = o.level ?? 0.3, hh = o.hop ?? 0.6, ht = o.hopTime ?? 0.22, js = o.jumpSpeed ?? 6;
  if (np < 2 || n < 2) throw new RangeError("track: two points and two spaces at least");
  const x = new Float64Array(n), z = new Float64Array(n), a = new Float64Array(n), jump = new Int32Array(n).fill(-1);
  const capOf = (i: number) => Math.max(1, typeof o.cap === "number" ? o.cap : o.cap ? o.cap[i] ?? 4 : 4);
  // ---- the spaces: the points as they are, or even steps along a dense polyline ----
  if (o.spaces == null) for (let i = 0; i < n; i++) (x[i] = pts[i * 2]!), (z[i] = pts[i * 2 + 1]!);
  else {
    const seg = closed ? np : np - 1, per = o.smooth ? 16 : 1, m = seg * per + 1, px = new Float64Array(m), pz = new Float64Array(m), L = new Float64Array(m);
    const P = (i: number, k: number) => (closed ? pts[((i % np) + np) % np * 2 + k]! : pts[Math.max(0, Math.min(np - 1, i)) * 2 + k]!);
    for (let s = 0, j = 0; s < seg; s++)
      for (let q = 0; q < per || (s === seg - 1 && q === per); q++, j++) {
        const t = q / per, t2 = t * t, t3 = t2 * t;
        for (let k = 0; k < 2; k++) {
          const p0 = P(s - 1, k), p1 = P(s, k), p2 = P(s + 1, k), p3 = P(s + 2, k);
          // Catmull-Rom (uniform); per = 1 is the straight polyline (t is 0, then the end).
          const v = o.smooth ? 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3) : p1 + (p2 - p1) * t;
          (k ? pz : px)[j] = v;
        }
        if (j) L[j] = L[j - 1]! + hypot(px[j]! - px[j - 1]!, pz[j]! - pz[j - 1]!);
      }
    const tot = L[m - 1]!;
    for (let i = 0, j = 1; i < n; i++) {
      const d = (tot * i) / (closed ? n : n - 1);
      while (j < m - 1 && L[j]! < d) j++;
      const f = (d - L[j - 1]!) / (L[j]! - L[j - 1]! || 1);
      x[i] = px[j - 1]! + (px[j]! - px[j - 1]!) * f;
      z[i] = pz[j - 1]! + (pz[j]! - pz[j - 1]!) * f;
    }
  }
  // Heading: diorama's rot[1] that turns +x along the path (from the neighbours).
  for (let i = 0; i < n; i++) {
    const p = closed ? (i + n - 1) % n : Math.max(0, i - 1), q = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    a[i] = Math.atan2(-(z[q]! - z[p]!), x[q]! - x[p]!);
  }
  if (o.jumps) for (let i = 0; i < o.jumps.length; i++) jump[o.jumps[i]![0]!] = o.jumps[i]![1]!;
  const at = new Int32Array(T).fill(-1), seq = new Float64Array(T), start = o.start ?? 0, fin = o.finish ?? "stop";
  // Hops of the last move: kind, flag, from, to, times, and both ends [x, y, z].
  const hops = {
    /** Hops in the last move. */
    n: 0,
    kind: new Uint8Array(MH), flag: new Uint8Array(MH), from: new Int32Array(MH), to: new Int32Array(MH),
    t0: new Float64Array(MH), t1: new Float64Array(MH), A: new Float64Array(MH * 3), B: new Float64Array(MH * 3),
  };
  const V = new Float64Array(3);
  const C = new Float64Array(3); // the move's length, a sample's time and lift (doubles in closure variables are boxed)
  let mover = -1;
  /** Token k's place on space s if it stood there now: out = [x, y, z]. */
  function slot(k: number, out: { [i: number]: number }, s = at[k]!) {
    let r = 0, m = 0;
    for (let j = 0; j < T; j++) if (at[j] === s) (m++, seq[j]! < seq[k]! && j !== k && r++);
    if (at[k] !== s) (m++, (r = m - 1));
    return spot(s, r, m, out);
  }
  /** The r-th of m tokens on space s: side by side (cap of them per level), then levels up. */
  function spot(s: number, r: number, m: number, out: { [i: number]: number }) {
    const c = capOf(s), lv = Math.floor(r / c), on = Math.min(c, m - lv * c), j = r % c;
    out[0] = x[s]!;
    out[1] = lv * lvl;
    out[2] = z[s]!;
    if (on > 1) {
      const th = (TAU * j) / on + Math.PI / 2 + a[s]!, ca = Math.cos(th), sa = Math.sin(th);
      out[0] = x[s]! + ca * sp;
      out[2] = z[s]! - sa * sp;
    }
    return out;
  }
  /** Queue a hop of kind (0 a step, 1 a jump) from → to; its length comes from the kind (a double
   *  passed to a call is boxed, so none is). */
  function push(kind: number, flag: number, from: number, to: number) {
    const h = hops.n;
    if (h >= MH) return;
    hops.kind[h] = kind; hops.flag[h] = flag; hops.from[h] = from; hops.to[h] = to;
    hops.t0[h] = C[0]!;
    hops.t1[h] = C[0] = C[0]! + (kind ? Math.max(ht * 1.5, hypot(x[to]! - x[from]!, z[to]! - z[from]!) / js) : ht);
    hops.A[h * 3] = x[from]!; hops.A[h * 3 + 1] = 0; hops.A[h * 3 + 2] = z[from]!;
    hops.B[h * 3] = x[to]!; hops.B[h * 3 + 1] = 0; hops.B[h * 3 + 2] = z[to]!;
    hops.n = h + 1;
  }
  /** sample() at C[1]. */
  function pose(out: { [i: number]: number }) {
    const N = hops.n, t = C[1]!;
    if (!N) return mover >= 0 && slot(mover, out), false;
    let h = 0;
    while (h < N - 1 && t >= hops.t1[h]!) h++;
    const u = Math.max(0, Math.min(1, (t - hops.t0[h]!) / (hops.t1[h]! - hops.t0[h]!))), j = h * 3;
    // A step is an arc; a jump slides or climbs (eased, with a low arc).
    const e = hops.kind[h] ? u * u * (3 - 2 * u) : u, lift = (hops.kind[h] ? 0.25 : 1) * hh * 4 * e * (1 - e);
    out[0] = hops.A[j]! + (hops.B[j]! - hops.A[j]!) * e;
    out[1] = hops.A[j + 1]! + (hops.B[j + 1]! - hops.A[j + 1]!) * e + lift;
    out[2] = hops.A[j + 2]! + (hops.B[j + 2]! - hops.A[j + 2]!) * e;
    return t < C[0]!;
  }
  /** apply() at C[1], lifted by C[2]. */
  function put(ob: { pos: { [i: number]: number } }) {
    const m = pose(V);
    ob.pos[0] = V[0]!; ob.pos[1] = V[1]! + C[2]!; ob.pos[2] = V[2]!;
    return m;
  }
  const emit = (type: string, k: number, s: number) => o.events && o.events.emit(type, k, s);
  let order = 0;
  const api = {
    /** Spaces. */
    n,
    closed,
    /** Space centres. */
    x, z,
    /** Each space's heading: diorama's rot[1] that turns +x along the path. */
    a,
    /** Each space's jump target, or −1. */
    jump,
    /** Each token's space, or −1 off the board. */
    at,
    /** The last move's hops (`HOP` kinds and flags; `A`, `B`: each hop's ends, [x, y, z] × n). */
    hops,
    /** The token the last move moved, or −1. */
    get token() { return mover; },
    /** Seconds the last move takes. */
    duration: 0,
    /** Put token k on space s (−1 takes it off), with no hops. */
    place(k: number, s: number) {
      at[k] = s;
      seq[k] = ++order;
    },
    /** Tokens on space s. */
    count(s: number) {
      let m = 0;
      for (let j = 0; j < T; j++) if (at[j] === s) m++;
      return m;
    },
    /** Move token k by `steps` (negative: back) and any jumps where it lands. Fills `hops` and
     *  returns its count (0: it did not move, e.g. an exact finish it overshot). */
    move(k: number, steps: number) {
      hops.n = C[0] = api.duration = 0;
      mover = k;
      let p = at[k]! < 0 ? 0 : at[k]!, dir = steps < 0 ? -1 : 1, left = Math.abs(steps | 0), back = 0;
      const last = n - 1, from = p;
      if (!closed && fin === "exact" && dir > 0 && p + left > last) return emit("track:stay", k, p), 0;
      slot(k, V);
      const a0 = V[0]!, a1 = V[1]!, a2 = V[2]!;
      while (left > 0) {
        let q = p + dir;
        if (closed) q = (q + n) % n;
        else if (q > last) {
          if (fin !== "bounce") break;
          (dir = -1), (back = HOP.back), (q = p - 1);
        } else if (q < 0) break;
        const pass = closed && dir > 0 && q === start ? HOP.pass : 0;
        push(HOP.step, pass | back, p, q);
        if (pass) emit("track:pass", k, q);
        p = q;
        left--;
      }
      for (let g = 0; g < n && jump[p]! >= 0 && jump[p] !== p; g++) {
        const q = jump[p]!;
        push(HOP.jump, 0, p, q);
        emit("track:jump", k, q);
        p = q;
      }
      api.duration = C[0]!;
      if (!hops.n && p === from) return 0;
      at[k] = p;
      seq[k] = ++order;
      const h = hops.n - 1;
      // The move starts where the token stood and ends at its new place on a shared space.
      hops.A[0] = a0; hops.A[1] = a1; hops.A[2] = a2;
      slot(k, V);
      hops.B[h * 3] = V[0]!; hops.B[h * 3 + 1] = V[1]!; hops.B[h * 3 + 2] = V[2]!;
      hops.flag[h]! |= HOP.land | (!closed && p === last ? HOP.finish : 0);
      if (!closed && p === last) emit("track:finish", k, p);
      emit("track:land", k, p);
      return hops.n;
    },
    slot,
    spot,
    /** Where the moving token is at t seconds into the last move: out = [x, y, z] (y over the board's
     *  top). False once the move is over (out is then its landing place). */
    sample(t: number, out: { [i: number]: number }) {
      C[1] = t; // in a typed array, so the work below takes no double argument (it would be boxed)
      return pose(out);
    },
    /** Write `sample(t)` into a diorama object's `pos` (plus `y0` up); true while it moves. */
    apply(ob: { pos: { [i: number]: number } }, t: number, y0 = 0) {
      C[1] = t;
      C[2] = y0;
      return put(ob);
    },
  };
  return api;
}
/** What `track` returns. */
export type Track = ReturnType<typeof track>;
