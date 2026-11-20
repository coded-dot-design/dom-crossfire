/**
 * @fzlt/core/dice: seeded dice for tabletop games. `roll(seed, n, sides)` gives the values; `dice()`
 * also builds a short tumble for each d6 (positions and orientations over time) that lands on the
 * value the seed picked, so every player who rolls the same seed sees the same roll.
 * - The values come from integer maths only (a 32-bit hash generator): the same seed gives the same
 *   values in every browser. The tumble is made to end on them (it is not a physics run that might
 *   land on an edge), so the face that lands up is the value by construction. The tumble is the
 *   look and never feeds a result: it keeps the builtin `Math.sin`, `cos`, `acos` and `**`, whose
 *   last bit may differ between engines (a path may differ in its last bits; the values never do), so
 *   an online sim reads `value`, never `path`.
 * - The path is data: `path` holds `frames` samples per die of [x, y, z, qx, qy, qz, qw] (y up, the
 *   centre's height over the floor, a unit quaternion), and `pose(i, t, out)` reads it at any time.
 * - `dioramaDice` builds the dice into an `@fzlt/core/diorama` scene (a chamfered body, pips painted
 *   on the faces that look at the camera) and shows them at a time; `popDome` puts them under a
 *   clear dome that you press: they jump, tumble and land.
 * No allocation per `roll`, `pose` or `show` in the steady state (typed arrays, fixed capacity).
 * Distances on the floor use steer's exact `hypot` (the builtin boxes its arguments).
 */
import type { Diorama, DioramaObject } from "./diorama";
import { hypot } from "./steer";

/** Options for `dice()`: how many, their size and the tumble's length and sample rate. */
export interface DiceOptions {
  /** Dice rolled at once (default 1; `n` can change up to `cap` between rolls). */
  count?: number;
  /** The most dice (default `count`). */
  cap?: number;
  /** Edge length in world units (default 1). */
  size?: number;
  /** Seconds from the throw to rest (default 1.4). */
  duration?: number;
  /** Samples per second in `path` (default 60). */
  rate?: number;
}

/** How `roll` throws: from where to where, how high, how far apart; or a pop from rest. */
export interface ThrowOptions {
  /** Where the throw starts, [x, z] on the floor (default [−4 × size, 0] from `to`). */
  from?: ArrayLike<number>;
  /** Where the dice land, [x, z] (default [0, 0]). */
  to?: ArrayLike<number>;
  /** How high the dice start over where they rest (a throw), or how high they jump (a pop); default 2.5 × size. */
  height?: number;
  /** Space between the dice across the throw (default 1.7 × size). */
  spread?: number;
  /** Each landing spot moves up to this far, seeded (default 0.35 × size). */
  jitter?: number;
  /** Full forward rolls on the way (default: by the distance; at least 1). */
  turns?: number;
  /** A pop: each die jumps from where it rests (the last roll's landing), straight up. */
  pop?: boolean;
}

// Value v: the face's normal, then two axes across it (u × v = n), in the die's own frame.
// Opposite faces add up to 7: 1 +y, 6 −y, 2 +x, 5 −x, 3 +z, 4 −z.
const FACE = new Int8Array([0, 1, 0, 1, 0, 0, 0, 0, -1, 1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, -1, -1, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 0, 1]);
const H = Math.SQRT1_2;
// The turn that puts value v's face up (x, y, z, w per value).
const BASE = new Float64Array([0, 0, 0, 1, 0, 0, H, H, -H, 0, 0, H, H, 0, 0, H, 0, 0, -H, H, 1, 0, 0, 0]);
const TAU = 6.283185307179586;

/** A seeded 32-bit generator (mulberry32) on one Uint32 of state: `seed` sets it, each call is [0, 1). */
function stream(s: Uint32Array) {
  return () => {
    let t = (s[0] = s[0]! + 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RS = new Uint32Array(1), R = stream(RS);

/** Roll `n` dice of `sides` faces from `seed` (any integer): `out[i]` gets 1..sides; returns the
 *  total. Integer maths only, so every browser gets the same values. `dice().roll` with the same
 *  seed lands on these values (d6). */
export function roll(seed: number, n = 1, sides = 6, out?: { [i: number]: number }): number {
  RS[0] = seed >>> 0;
  let tot = 0;
  for (let i = 0; i < n; i++) {
    const v = 1 + Math.floor(R() * sides);
    if (out) out[i] = v;
    tot += v;
  }
  return tot;
}

/** q = a · b (quaternions [x, y, z, w] at offsets). */
function qmul(o: Float64Array, oi: number, a: Float64Array, ai: number, b: Float64Array, bi: number) {
  const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!, bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  o[oi] = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
/** The turn by `ang` about the unit axis (x, y, z), at o[oi]. */
function qaxis(o: Float64Array, oi: number, x: number, y: number, z: number, ang: number) {
  const s = Math.sin(ang / 2);
  o[oi] = x * s; o[oi + 1] = y * s; o[oi + 2] = z * s; o[oi + 3] = Math.cos(ang / 2);
}

/** The quaternion [x, y, z, w] at q[qi] as a diorama `rot` (radians, applied y, then x, then z). */
export function euler(q: ArrayLike<number>, out: { [i: number]: number }, qi = 0) {
  const x = q[qi]!, y = q[qi + 1]!, z = q[qi + 2]!, w = q[qi + 3]!;
  const r12 = 2 * (y * z - x * w), r02 = 2 * (x * z + y * w), r22 = 1 - 2 * (x * x + y * y), r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z);
  out[0] = Math.asin(Math.max(-1, Math.min(1, -r12)));
  if (Math.abs(r12) < 0.999999) (out[1] = Math.atan2(r02, r22)), (out[2] = Math.atan2(r10, r11));
  else (out[1] = Math.atan2(-2 * (x * z - y * w), 1 - 2 * (y * y + z * z))), (out[2] = 0);
  return out;
}

/** Which value is up for the orientation at q[qi]: the face whose normal points most up. */
export function faceUp(q: ArrayLike<number>, qi = 0) {
  const x = q[qi]!, y = q[qi + 1]!, z = q[qi + 2]!, w = q[qi + 3]!;
  // The world y of each local axis: row 1 of the rotation matrix.
  const r0 = 2 * (x * y + z * w), r1 = 1 - 2 * (x * x + z * z), r2 = 2 * (y * z - x * w);
  let best = 1, top = -2;
  for (let v = 0; v < 6; v++) {
    const k = v * 9, up = FACE[k]! * r0 + FACE[k + 1]! * r1 + FACE[k + 2]! * r2;
    if (up > top) (top = up), (best = v + 1);
  }
  return best;
}

/** A set of d6 with tumble paths: `roll(seed, throw)` fills `value` and `path`; `pose(i, t, out)`
 *  reads die i at t seconds. Between rolls the dice rest where they landed. */
export function dice(o: DiceOptions = {}) {
  const cap = Math.max(1, o.cap ?? o.count ?? 1), s = o.size ?? 1, dur = o.duration ?? 1.4, rate = o.rate ?? 60;
  const F = Math.max(2, Math.ceil(dur * rate) + 1), path = new Float64Array(cap * F * 7), value = new Int32Array(cap).fill(1);
  // Scratch: start, end, three factor turns and the product (quaternions); hop table.
  const Q = new Float64Array(32), HOP = new Float64Array(10), P = new Float64Array(8);
  /** pose() at t = P[7]. */
  function poseAt(i: number, out: { [i: number]: number }) {
    const t = P[7]!, ft = Math.max(0, Math.min(F - 1, t * rate)), f = Math.min(F - 2, Math.floor(ft)), a = ft - f, j = (i * F + f) * 7;
    let d = 0;
    for (let k = 3; k < 7; k++) d += path[j + k]! * path[j + 7 + k]!;
    const sg = d < 0 ? -1 : 1;
    for (let k = 0; k < 7; k++) P[k] = path[j + k]! + ((k > 2 ? sg : 1) * path[j + 7 + k]! - path[j + k]!) * a;
    const l = Math.sqrt(P[3]! * P[3]! + P[4]! * P[4]! + P[5]! * P[5]! + P[6]! * P[6]!) || 1;
    for (let k = 0; k < 7; k++) out[k] = k > 2 ? P[k]! / l : P[k]!;
    return t * rate < F - 1;
  }
  const api = {
    /** Dice in the next roll (1..cap). */
    n: Math.min(cap, Math.max(1, o.count ?? 1)),
    cap, size: s, duration: dur, rate,
    /** Samples per die in `path`. */
    frames: F,
    /** Die i, frame f at (i × frames + f) × 7: x, y, z, qx, qy, qz, qw. */
    path,
    /** The value each die shows (1..6). */
    value,
    /** The sum of the last roll. */
    total: 0,
    /** Roll `n` dice from `seed`: values as `roll(seed, n, 6)`, and their tumbles. Returns the total. */
    roll(seed: number, t: ThrowOptions = {}) {
      // (Builtin trig below: the path is render-only; see the top of this file.)
      const n = api.n, pop = !!t.pop, to = t.to, h0 = t.height ?? 2.5 * s, sp = t.spread ?? 1.7 * s, jit = t.jitter ?? 0.35 * s;
      const tx = to ? to[0]! : 0, tz = to ? to[1]! : 0, fx = t.from ? t.from[0]! : tx - 4 * s, fz = t.from ? t.from[1]! : tz;
      api.total = roll(seed, n, 6, value);
      // The stream goes on from the values: everything below is the look, never the result.
      let dx = tx - fx, dz = tz - fz, dl = hypot(dx, dz);
      if (pop || dl < 1e-6) {
        const a = R() * TAU;
        (dx = Math.cos(a)), (dz = Math.sin(a)), (dl = 0);
      } else (dx /= dl), (dz /= dl);
      for (let i = 0; i < n; i++) {
        const b = (i * F + F - 1) * 7, off = (i - (n - 1) / 2) * sp, jr = jit * Math.sqrt(R()), ja = R() * TAU;
        // Landing spot (across the throw, then jitter) and the start: a throw from `from`, a pop from rest.
        const ex = tx - dz * off + Math.cos(ja) * jr, ez = tz + dx * off + Math.sin(ja) * jr;
        const sx = pop ? path[b]! : fx - dz * off, sz = pop ? path[b + 2]! : fz + dx * off;
        // Q[0..3] start orientation: where it rests (pop) or a seeded uniform turn (Shoemake).
        if (pop) for (let k = 0; k < 4; k++) Q[k] = path[b + 3 + k]!;
        else {
          const u1 = R(), u2 = R() * TAU, u3 = R() * TAU, a = Math.sqrt(1 - u1), c = Math.sqrt(u1);
          (Q[0] = a * Math.sin(u2)), (Q[1] = a * Math.cos(u2)), (Q[2] = c * Math.sin(u3)), (Q[3] = c * Math.cos(u3));
        }
        // Q[4..7] the end: value v up, then a seeded turn about y.
        qaxis(Q, 8, 0, 1, 0, R() * TAU);
        qmul(Q, 4, Q, 8, BASE, (value[i]! - 1) * 4);
        // Three factors that each run out to no turn at the end: a spin about y (ψ), m full rolls
        // forward about h = up × dir, and the turn d that joins start to end: start = Y(ψ)·d·end.
        const psi = (R() < 0.5 ? -1 : 1) * (1.5 + R() * 1.5), hx = dz, hz = -dx;
        const m = t.turns ?? (pop ? 1 + Math.floor(R() * 2) : Math.max(1, Math.round(hypot(ex - sx, ez - sz) / (3 * s))));
        qaxis(Q, 8, 0, -1, 0, psi); // Y(−ψ)
        qmul(Q, 12, Q, 8, Q, 0); // Y(−ψ)·start
        (Q[16] = -Q[4]!), (Q[17] = -Q[5]!), (Q[18] = -Q[6]!), (Q[19] = Q[7]!); // end⁻¹
        qmul(Q, 20, Q, 12, Q, 16); // d
        if (Q[23]! < 0) for (let k = 20; k < 24; k++) Q[k] = -Q[k]!;
        const w = Math.min(1, Q[23]!), sn = Math.sqrt(1 - w * w), phi = 2 * Math.acos(w);
        if (sn > 1e-9) (Q[24] = Q[20]! / sn), (Q[25] = Q[21]! / sn), (Q[26] = Q[22]! / sn);
        else (Q[24] = hx), (Q[25] = 0), (Q[26] = hz);
        // Hops (g = 1, then scaled to fit): up from the start height to the top, down, then bounces.
        const top = pop ? h0 : h0 * (1.05 + R() * 0.15), y0 = pop ? 0 : top * 0.92, air = 0.7 + R() * 0.1;
        HOP[0] = Math.sqrt(2 * (top - y0)) + Math.sqrt(2 * top); // first arc's length
        let tot = HOP[0]!;
        for (let k = 1; k < 4; k++) (HOP[k] = 2 * Math.sqrt(2 * top * 0.42 ** (2 * k))), (tot += HOP[k]!);
        const ts = tot / (air * dur), tu = Math.sqrt(2 * (top - y0));
        for (let f = 0; f < F; f++) {
          const tau = f / (F - 1), e1 = (1 - tau) ** 2, e2 = (1 - tau) ** 2.4, e3 = (1 - tau) ** 3, ph = tau * dur * ts, j = (i * F + f) * 7;
          // Height of the hop at physics time ph.
          let y = 0;
          if (ph < HOP[0]!) y = top - 0.5 * (ph - tu) ** 2;
          else {
            let a = HOP[0]!;
            for (let k = 1; k < 4; k++) {
              if (ph < a + HOP[k]!) { const hk = top * 0.42 ** (2 * k), c = ph - a - HOP[k]! / 2; y = Math.max(0, hk - 0.5 * c * c); break; }
              a += HOP[k]!;
            }
          }
          // Orientation: Y(ψ e3) · H(−2πm e2) · D(φ e1) · end.
          qaxis(Q, 8, Q[24]!, Q[25]!, Q[26]!, phi * e1);
          qmul(Q, 12, Q, 8, Q, 4);
          qaxis(Q, 8, hx, 0, hz, -TAU * m * e2);
          qmul(Q, 16, Q, 8, Q, 12);
          qaxis(Q, 8, 0, 1, 0, psi * e3);
          qmul(path, j + 3, Q, 8, Q, 16);
          // The centre rides on the lowest corner: half the box's extent along world y.
          const x = path[j + 3]!, yq = path[j + 4]!, z = path[j + 5]!, wq = path[j + 6]!;
          const ext = (s / 2) * (Math.abs(2 * (x * yq + z * wq)) + Math.abs(1 - 2 * (x * x + z * z)) + Math.abs(2 * (yq * z - x * wq)));
          const u = 1 - (1 - tau) ** 2.6;
          path[j] = sx + (ex - sx) * u;
          path[j + 1] = y + ext;
          path[j + 2] = sz + (ez - sz) * u;
        }
        path[b + 1] = s / 2; // at rest, flat
      }
      return api.total;
    },
    /** Die i at t seconds since the roll: out = [x, y, z, qx, qy, qz, qw]. False once it rests. */
    pose(i: number, t: number, out: { [i: number]: number }) {
      P[7] = t; // kept in a typed array: the work takes no double argument (a call would box it)
      return poseAt(i, out);
    },
  };
  // At rest before the first roll: in a row along x, 1 up.
  for (let i = 0; i < cap; i++)
    for (let f = 0; f < F; f++) {
      const j = (i * F + f) * 7;
      path[j] = (i - (cap - 1) / 2) * 1.7 * s;
      path[j + 1] = s / 2;
      path[j + 6] = 1;
    }
  return api;
}
/** What `dice` returns. */
export type Dice = ReturnType<typeof dice>;

/** B = diorama `d`'s camera as it draws it: eye (0–2), right (3–5), up (6–8), forward (9–11),
 *  focal (12) and the screen centre (13, 14). */
function basis(d: Diorama, B: Float64Array) {
  const c = d.cam, cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), h = d.height;
  B[0] = c.tx + c.dist * sy * cp; B[1] = c.ty + c.dist * sp; B[2] = c.tz + c.dist * cy * cp;
  B[3] = cy; B[4] = 0; B[5] = -sy;
  B[6] = -sy * sp; B[7] = cp; B[8] = -cy * sp;
  B[9] = -sy * cp; B[10] = -sp; B[11] = -cy * cp;
  B[12] = h / 2 / Math.tan(c.fov / 2); B[13] = d.width / 2 + c.ox; B[14] = h / 2 + c.oy;
}
/** Y[yi], Y[yi + 1] = world point X on screen under basis B (CSS px). */
function proj(B: Float64Array, X: Float64Array, Y: Float64Array, yi: number) {
  const dx = X[0]! - B[0]!, dy = X[1]! - B[1]!, dz = X[2]! - B[2]!, k = B[12]! / Math.max(dx * B[9]! + dy * B[10]! + dz * B[11]!, 0.05);
  Y[yi] = B[13]! + (dx * B[3]! + dy * B[4]! + dz * B[5]!) * k;
  Y[yi + 1] = B[14]! - (dx * B[6]! + dy * B[7]! + dz * B[8]!) * k;
}
/** X = the local point L[li..li + 2] through a diorama world matrix m. */
function world(m: Float64Array, L: Float64Array, li: number, X: Float64Array) {
  const x = L[li]!, y = L[li + 1]!, z = L[li + 2]!;
  X[0] = m[0]! * x + m[1]! * y + m[2]! * z + m[9]!;
  X[1] = m[3]! * x + m[4]! * y + m[5]! * z + m[10]!;
  X[2] = m[6]! * x + m[7]! * y + m[8]! * z + m[11]!;
}

/** Options for `dioramaDice`: what they rest on, the cluster to sort in, colours and shadow. */
export interface DioramaDiceOptions {
  /** The id of the object they rest on (the floor, a tray): `path` is from its top centre. */
  on: string;
  /** Their ids are `${id}0`, `${id}1`, … (default "die"). */
  id?: string;
  /** The cluster they sort in (default the parent's own, "@" + on). */
  cluster?: string;
  /** Body colour (default `#f6f1e7`). */
  color?: string;
  /** Pip colour (default `#1d1b22`). */
  pip?: string;
  /** Blob shadow strength (default 0.3). */
  shadow?: number;
}

// Pips per value in a face's (u, v) half-size units.
const PIPS = [[0, 0], [-0.5, -0.5, 0.5, 0.5], [-0.5, -0.5, 0, 0, 0.5, 0.5], [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5],
  [-0.5, -0.5, 0.5, -0.5, 0, 0, -0.5, 0.5, 0.5, 0.5], [-0.5, -0.5, -0.5, 0, -0.5, 0.5, 0.5, -0.5, 0.5, 0, 0.5, 0.5]];

/** Build `dc`'s dice into diorama `d`: per die a group (moved and turned by `show`) holding a
 *  chamfered body, and its pips painted in the depth sort on each face that looks at the camera.
 *  `show(t)` poses every die at t seconds since the roll (dice past `dc.n` are hidden); true while
 *  any still moves. Call it before `d.draw()`. */
export function dioramaDice(d: Diorama, dc: Dice, o: DioramaDiceOptions) {
  const s = dc.size, c = s * 0.09, hs = s / 2, id = o.id ?? "die", pip = o.pip || "#1d1b22", cl = o.cluster ?? "@" + o.on;
  const groups: DioramaObject[] = [], bodies: DioramaObject[] = [], at = new Float64Array(dc.cap * 18), P = new Float64Array(8);
  // Per face, in the body's frame (origin at its bottom centre): its centre, then the ends of its two half axes.
  const LP = new Float64Array(54), X = new Float64Array(3), S = new Float64Array(6), B = new Float64Array(15), TS = new Float64Array(1);
  for (let v = 0; v < 6; v++)
    for (let e = 0; e < 3; e++)
      for (let a = 0; a < 3; a++) LP[v * 9 + e * 3 + a] = (FACE[v * 9 + a]! + (e ? FACE[v * 9 + e * 3 + a]! : 0)) * hs + (a === 1 ? hs : 0);
  const outline = [[-hs, -hs + c], [-hs + c, -hs], [hs - c, -hs], [hs, -hs + c], [hs, hs - c], [hs - c, hs], [-hs + c, hs], [-hs, hs - c]];
  /** Paint die i's face v (value v + 1) if it looks at the camera: its pips through the face's
   *  screen axes. Integers in, typed arrays inside: nothing boxed per frame. */
  function face(ctx: CanvasRenderingContext2D, i: number, v: number) {
    if (groups[i]!.hidden) return;
    const m = bodies[i]!.M, pp = PIPS[v]!, r = d.dpr;
    basis(d, B);
    for (let e = 0; e < 3; e++) world(m, LP, v * 9 + e * 3, X), proj(B, X, S, e * 2);
    const ux = S[2]! - S[0]!, uy = S[3]! - S[1]!, vx = S[4]! - S[0]!, vy = S[5]! - S[1]!;
    if (ux * vy - uy * vx > -0.5) return; // turned away (or edge on)
    ctx.setTransform(r * ux, r * uy, r * vx, r * vy, r * S[0]!, r * S[1]!);
    ctx.fillStyle = pip;
    ctx.beginPath();
    for (let p = 0; p < pp.length; p += 2) ctx.moveTo(pp[p]! + 0.17, pp[p + 1]!), ctx.arc(pp[p]!, pp[p + 1]!, 0.17, 0, TAU);
    ctx.fill();
    ctx.setTransform(r, 0, 0, r, 0, 0);
  }
  /** show() at t = TS[0]: integers and typed arrays only. */
  function showAt() {
    const t = TS[0]!;
    let moving = false;
    basis(d, B);
    const ex = B[0]!, ey = B[1]!, ez = B[2]!;
    for (let i = 0; i < dc.cap; i++) {
      const g = groups[i]!, p = g.parent;
      g.hidden = i >= dc.n;
      if (g.hidden) continue;
      if (dc.pose(i, t, P)) moving = true;
      g.pos[0] = P[0]!; g.pos[1] = P[1]!; g.pos[2] = P[2]!;
      euler(P, g.rot, 3);
      // Sort points: each face's centre in the world (through the parent's last matrix), pulled a
      // little toward the eye so the pips sort just after their face.
      const x = P[3]!, y = P[4]!, z = P[5]!, w = P[6]!, m = p ? p.M : null, top = p && p.shape !== "group" ? p.size[1]! : 0;
      for (let v = 0; v < 6; v++) {
        const k = v * 9, nx = FACE[k]! * hs, ny = FACE[k + 1]! * hs, nz = FACE[k + 2]! * hs;
        // q · n (rotate the face normal), then add the die's centre.
        const tx = 2 * (y * nz - z * ny), ty = 2 * (z * nx - x * nz), tz = 2 * (x * ny - y * nx);
        let lx = P[0]! + nx + w * tx + y * tz - z * ty, ly = P[1]! + top + ny + w * ty + z * tx - x * tz, lz = P[2]! + nz + w * tz + x * ty - y * tx;
        if (m) { const a = lx, b = ly; lx = m[0]! * a + m[1]! * b + m[2]! * lz + m[9]!; ly = m[3]! * a + m[4]! * b + m[5]! * lz + m[10]!; lz = m[6]! * a + m[7]! * b + m[8]! * lz + m[11]!; }
        const qx = ex - lx, qy = ey - ly, qz = ez - lz, ql = (0.03 * s) / (Math.sqrt(qx * qx + qy * qy + qz * qz) || 1), j = i * 18 + v * 3;
        at[j] = lx + qx * ql; at[j + 1] = ly + qy * ql; at[j + 2] = lz + qz * ql;
      }
    }
    return moving;
  }
  for (let i = 0; i < dc.cap; i++) {
    const g = d.add({ id: id + i, shape: "group", size: [s, 0, s], on: o.on, shadow: o.shadow ?? 0.3, tag: { die: i } });
    const body = d.add({ id: id + i + "b", shape: "prism", outline, size: [s, s, s], pos: [0, -hs, 0], on: id + i, color: o.color || "#f6f1e7" });
    groups.push(g);
    bodies.push(body);
    for (let v = 0; v < 6; v++) d.decal(cl, body.layer, (ctx) => face(ctx, i, v), at.subarray(i * 18 + v * 3, i * 18 + v * 3 + 3));
  }
  return {
    /** Each die's group (its pos and rot are set by `show`). */
    groups,
    /** Each die's body (recolour it). */
    bodies,
    /** Pose every die at t seconds since the roll; true while any still moves. */
    show(t: number) {
      TS[0] = t;
      return showAt();
    },
  };
}

/** Options for `popDome`: where it stands, how big, its colours. */
export interface PopDomeOptions {
  /** The id of the object it stands on. */
  on: string;
  /** Its ids start with this (default "dome"): the plinth is `${id}`, the dice `${id}-die0`, … */
  id?: string;
  /** Where on the parent's top, [x, z] (default [0, 0]). */
  at?: ArrayLike<number>;
  /** The dome's radius (default 2.6 × the dice's size × √cap). */
  radius?: number;
  /** The plinth's colour (default `#d8473b`). */
  color?: string;
  /** The glass tint (default `#cfe8ff`). */
  glass?: string;
  /** The cluster it sorts in (default "@" + on). */
  cluster?: string;
  /** Options for the dice inside. */
  dice?: Partial<DioramaDiceOptions>;
}

/** `dc`'s dice under a clear dome on a plinth: `press(seed)` pops them (the dome dips, the dice jump,
 *  tumble and land on the values `roll(seed, n, 6)` gives) and returns the total; `show(t)` poses the
 *  dome and dice at t seconds since the press, true while it moves. */
export function popDome(d: Diorama, dc: Dice, o: PopDomeOptions) {
  const s = dc.size, id = o.id ?? "dome", R = o.radius ?? 2.6 * s * Math.sqrt(dc.cap), cl = o.cluster ?? "@" + o.on, ph = 0.3 * s, glass = o.glass || "#cfe8ff";
  const plinth = d.add({ id, shape: "cyl", sides: 18, size: [2.3 * R, ph, 2.3 * R], pos: [o.at ? o.at[0]! : 0, 0, o.at ? o.at[1]! : 0], on: o.on, color: o.color || "#d8473b", tag: { dome: id } });
  const view = dioramaDice(d, dc, { cluster: cl, ...o.dice, on: id, id: id + "-die" });
  const back = new Float64Array(3), front = new Float64Array(3), B = new Float64Array(15), X = new Float64Array(3), S = new Float64Array(4), sq = new Float64Array(2);
  const TOP = new Float64Array([0, ph, 0]);
  /** The glass, painted in the sort: the far rim (behind the dice), or the dome over them. */
  function glassAt(ctx: CanvasRenderingContext2D, near: number) {
    basis(d, B);
    world(plinth.M, TOP, 0, X);
    proj(B, X, S, 0);
    X[0] = X[0]! + B[3]! * R;
    X[2] = X[2]! + B[5]! * R;
    proj(B, X, S, 2);
    // Centre, half width, the rim's half depth, the dome's height (squashed by a press).
    const x = S[0]!, y = S[1]!, rx = Math.abs(S[2]! - x), ry = rx * Math.abs(Math.sin(d.cam.pitch)), rt = rx * (1 - sq[0]!);
    ctx.strokeStyle = glass;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (!near) {
      ctx.globalAlpha = 0.35;
      ctx.ellipse(x, y, rx, ry, 0, Math.PI, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.ellipse(x, y, rx, rt, 0, Math.PI, TAU);
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, rx * 0.74, rt * 0.74, 0, Math.PI * 1.12, Math.PI * 1.42);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  d.decal(cl, plinth.layer + 1, (ctx) => glassAt(ctx, 0), back);
  d.decal(cl, plinth.layer + 1, (ctx) => glassAt(ctx, 1), front);
  const DIP = 0.14, base = ph, TO = new Float64Array(2);
  /** show() at t = sq[1]. */
  function domeAt() {
    const t = sq[1]!;
    sq[0] = t > 0 && t < DIP ? 0.12 * Math.sin((Math.PI * t) / DIP) : 0;
    plinth.pos[1] = -sq[0]! * base;
    // Sort points: the far rim behind the dice, the glass in front of them.
    basis(d, B);
    world(plinth.M, TOP, 0, X);
    const fx = -B[9]!, fy = -B[10]!, fz = -B[11]!, cx = X[0]!, cy = X[1]!, cz = X[2]!;
    back[0] = cx - fx * R; back[1] = cy - fy * R; back[2] = cz - fz * R;
    front[0] = cx + fx * R * 1.05; front[1] = cy + fy * R * 1.05; front[2] = cz + fz * R * 1.05;
    return view.show(t > DIP / 2 ? t - DIP / 2 : 0) || t < DIP;
  }
  const api = {
    /** The plinth (move it, recolour it). */
    plinth,
    /** The dice view inside. */
    view,
    /** Pop the dice from `seed`; returns the total. Then `show(t)` from t = 0. */
    press(seed: number) {
      const sp = Math.min(1.5 * s, (R * 1.2) / dc.n);
      return dc.roll(seed, { pop: true, to: TO, height: Math.max(0.3 * s, R - 2 * s), spread: sp, jitter: Math.max(0, R - 0.9 * s - ((dc.n - 1) * sp) / 2) * 0.5 });
    },
    /** Pose the dome and dice at t seconds since the press (the dice leave at 0.07 s); true while moving. */
    show(t: number) {
      sq[1] = t;
      return domeAt();
    },
  };
  return api;
}
