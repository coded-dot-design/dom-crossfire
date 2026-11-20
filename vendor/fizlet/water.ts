/**
 * @fzlt/core/water: animated water for `@fzlt/core/diorama` scenes (a bay, a pond, a wave pool),
 * lifted from the Salvo Bay prototype. `water(d, { rect | outline, level, … })` builds the water's
 * body (depth bands as prisms) and paints its surface in the diorama's depth sort: wave crests that
 * roll across, a drifting sheen, foam lapping along the edges you pick, bow waves and wakes behind
 * the objects you `wake`, and pooled effects: `splash` (a column of water, spray, a crown of drops,
 * rings and ripples that travel out), `ripple`, `bubbles` and `whirl` (something going down).
 * - The surface is a function: `height(x, z, t)` is the same for the same (x, z, t) on every run (sines
 *   of the wave, plus the optional `swell`: a travelling, peeling crest a surfer can ride, its
 *   `slope` and its `crest` position). Effects are seeded (`seed`), so a replay splashes the same.
 * - It has its own clock: `step(dt)` moves it and returns `busy`. The idle roll runs `idle` seconds
 *   after the last effect or `stir()`, then rests, so the engine can settle; `still` (reduced motion,
 *   on by default when the page asks for it) freezes the surface and keeps every effect short.
 * - Everything is clipped to the outline and drawn from fixed pools (particles, rings, whirls, bubble
 *   emitters, wake trails): no allocation per `step` or draw in the steady state; past a pool's
 *   capacity an effect is dropped, never grown. Wakes read the object's world matrix from the last
 *   draw. DOM-free (one `matchMedia` read for the `still` default); 2D lengths use steer's exact `hypot`.
 */
import type { Diorama, DioramaObject, DioramaPoints } from "./diorama";
import { hypot } from "./steer";

/** The wave: crests every `len` world units rolling along `dir` at `speed` units/s, `amp` high. */
export interface WaveOptions {
  /** Height of the wave (default 0.03). */
  amp?: number;
  /** Crest to crest (default 2). */
  len?: number;
  /** Units per second along `dir` (default 0.3). */
  speed?: number;
  /** Where the crests roll, [x, z] (default [0, 1]: toward a camera on +z). */
  dir?: ArrayLike<number>;
  /** The crests' alpha (default 0.13). */
  alpha?: number;
}
/** Foam along the outline's edges (bit i: edge i, from point i to i + 1, for the first 31; a rect's
 *  are 1 far (−z), 2 right (+x), 4 near (+z), 8 left (−x)). */
export interface FoamOptions {
  /** The edges with foam (default every edge). */
  edges?: number;
  /** Alpha (default 0.62). */
  alpha?: number;
  /** The ragged band's width in world units (default 0.15). */
  width?: number;
}
/** A swell for a wave pool: one crest that travels across along `dir` and breaks (peels) along it. */
export interface SwellOptions {
  /** Height (default 0.6). */
  amp?: number;
  /** Width of its back; the face in front is half as wide (default 1.5). */
  width?: number;
  /** Units per second along `dir` (default 2). */
  speed?: number;
  /** Travel direction, [x, z] (default the wave's). */
  dir?: ArrayLike<number>;
  /** Seconds between sets (default: the time to cross, plus 2). */
  period?: number;
  /** The break runs along the crest (from its low end) at this many units/s (default 0: no break). */
  peel?: number;
  /** Alpha of its light and shade (default 0.5). */
  alpha?: number;
}
/** A depth band under the surface band, from the bottom up. */
export interface WaterBand {
  /** Thickness. */
  h: number;
  /** `#rrggbb`. */
  color: string;
  /** 0..1 (default 1). */
  alpha?: number;
}
/** Options for `water`. Give `rect` or `outline`. */
export interface WaterOptions {
  /** [x0, z0, x1, z1], world. */
  rect?: ArrayLike<number>;
  /** [x, z] points round the water (any simple polygon), world. */
  outline?: ArrayLike<ArrayLike<number>>;
  /** The surface's height, y (default 0). */
  level?: number;
  /** The surface band's colour (default `#a8def0`). */
  color?: string;
  /** Its alpha (default 0.84). */
  alpha?: number;
  /** Its thickness (default 0.25). */
  depth?: number;
  /** Depth bands under it, bottom first. */
  bands?: ArrayLike<WaterBand>;
  /** false: no body, only the surface (you built the water's faces yourself). */
  body?: boolean;
  /** The moving light: crests, foam, sheen, drops and bubbles (default `#ffffff`). */
  light?: string;
  /** The wave (false: a flat surface, no crests). */
  wave?: WaveOptions | false;
  /** Foam along the edges (false: none). */
  foam?: FoamOptions | false;
  /** The sheen's alpha (default 0.09; false: none). */
  sheen?: number | false;
  /** A swell (wave pool). */
  swell?: SwellOptions | false;
  /** The diorama cluster it draws in (default its own, anchored at its centre). */
  cluster?: string;
  /** The surface band's layer (default 3): depth bands at layer − 2, the surface paint at + 0.6,
   *  particles at + 1 (the layer of what floats on it). */
  layer?: number;
  /** Particles (default 320); whirls and bubble emitters are 8 each. */
  cap?: number;
  /** Rings and ripples (default 24). */
  rings?: number;
  /** Seconds the surface keeps rolling after the last effect or `stir()` (default 6; Infinity: always). */
  idle?: number;
  /** Reduced motion: a still surface, short effects (default: the page's prefers-reduced-motion). */
  still?: boolean;
  /** Effects' seed (default 1). */
  seed?: number;
  /** Time offset of the roll, so two pools don't move in step (default 0). */
  phase?: number;
}
/** Options for `wake`: where the bow is and how much wave it makes at rest. */
export interface WakeOptions {
  /** Centre to bow along the heading (default half the object's x size). */
  size?: number;
  /** Half its beam (default half its z size). */
  width?: number;
  /** The bow wave's strength at rest, 0..1 (default 0.6; 0: only when it moves). */
  rest?: number;
}
/** A wake on one object: its speed and heading (from its world matrix over the last steps) and the
 *  trail behind it, newest first: `trail` holds [x, z, hx, hz, age] per sample, `n` of them. */
export interface WaterWake {
  /** The object it follows. */
  readonly ob: DioramaObject;
  /** Centre to bow. */
  size: number;
  /** Half the beam. */
  width: number;
  /** The bow wave at rest, 0..1. */
  rest: number;
  /** Units per second, smoothed. */
  speed: number;
  /** Heading [hx, hz] (the direction of travel, or the object's +x at rest). */
  hx: number;
  /** Heading z. */
  hz: number;
  /** [x, z, hx, hz, age] per sample, newest first (and 4 slots of its own state after them). */
  readonly trail: Float64Array;
  /** Live samples. */
  n: number;
}

const TAU = 6.283185307179586, G = 9.8, PS = 10, TN = 16, TLIFE = 1.4;
// Particle types.
const DROP = 0, COLUMN = 1, BUBBLE = 2;

function reduced() {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
const unit = (v: ArrayLike<number> | undefined, out: Float64Array) => {
  const x = v ? v[0]! : 0, z = v ? v[1]! : 1, l = hypot(x, z) || 1;
  return (out[0] = x / l), (out[1] = z / l), out;
};

/** Water on diorama `d`. Call `step(dt)` from a fixed step (it returns `busy`); the diorama's own
 *  `draw()` paints it. */
export function water(d: Diorama, o: WaterOptions) {
  const r = o.rect, src = o.outline || (r ? [[r[0]!, r[1]!], [r[2]!, r[1]!], [r[2]!, r[3]!], [r[0]!, r[3]!]] : [[-1, -1], [1, -1], [1, 1], [-1, 1]]);
  const n = src.length, OX = new Float64Array(n), OZ = new Float64Array(n);
  let area = 0, cx = 0, cz = 0;
  for (let i = 0; i < n; i++) (OX[i] = src[i]![0]!), (OZ[i] = src[i]![1]!), (cx += OX[i]! / n), (cz += OZ[i]! / n);
  for (let i = 0; i < n; i++) area += OX[i]! * OZ[(i + 1) % n]! - OX[(i + 1) % n]! * OZ[i]!;
  const inw = area < 0 ? -1 : 1, Y = o.level ?? 0, layer = o.layer ?? 3, light = o.light || "#ffffff";
  const wv = o.wave === false ? null : o.wave || {}, amp = wv ? wv.amp ?? 0.03 : 0, len = wv ? wv.len ?? 2 : 2, spd = wv ? wv.speed ?? 0.3 : 0, crestA = wv ? wv.alpha ?? 0.13 : 0;
  const fo = o.foam === false ? null : o.foam || {}, edges = fo ? fo.edges ?? -1 : 0, foamA = fo ? fo.alpha ?? 0.62 : 0, foamW = fo ? fo.width ?? 0.15 : 0;
  const sheenA = o.sheen === false ? 0 : o.sheen ?? 0.09, idle = o.idle ?? 6, phase = o.phase || 0;
  const DIR = unit(wv ? wv.dir : undefined, new Float64Array(2)), dx = DIR[0]!, dz = DIR[1]!;
  // The outline's extent along the wave (u) and across it (v).
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const u = OX[i]! * dx + OZ[i]! * dz, v = -OX[i]! * dz + OZ[i]! * dx;
    (u0 = Math.min(u0, u)), (u1 = Math.max(u1, u)), (v0 = Math.min(v0, v)), (v1 = Math.max(v1, v));
  }
  // The swell, in its own (su, sv) frame.
  const sw = o.swell || null, SD = unit(sw ? sw.dir || (wv && wv.dir) || undefined : undefined, new Float64Array(2)), sdx = SD[0]!, sdz = SD[1]!;
  let su0 = Infinity, su1 = -Infinity, sv0 = Infinity, sv1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const u = OX[i]! * sdx + OZ[i]! * sdz, v = -OX[i]! * sdz + OZ[i]! * sdx;
    (su0 = Math.min(su0, u)), (su1 = Math.max(su1, u)), (sv0 = Math.min(sv0, v)), (sv1 = Math.max(sv1, v));
  }
  const sAmp = sw ? sw.amp ?? 0.6 : 0, sW = sw ? sw.width ?? 1.5 : 1, sSpd = sw ? sw.speed ?? 2 : 1, sPeel = sw ? sw.peel ?? 0 : 0, sA = sw ? sw.alpha ?? 0.5 : 0;
  const sPer = sw ? sw.period ?? (su1 - su0 + 3 * sW) / sSpd + 2 : 1;

  // The body: depth bands, then the surface band, as prisms on the outline.
  const bodies: DioramaObject[] = [];
  let cl = o.cluster;
  if (!cl) d.cluster((cl = "water@" + cx.toFixed(2) + "," + cz.toFixed(2)), { at: [cx, Y, cz] });
  if (o.body !== false) {
    const bands = o.bands || [], top = o.depth ?? 0.25;
    let y = Y - top;
    for (let i = 0; i < bands.length; i++) y -= bands[i]!.h;
    const put = (h: number, color: string, alpha: number, ly: number) => {
      bodies.push(d.add({ shape: "prism", outline: src, size: [0, h, 0], pos: [0, y, 0], color, alpha, cluster: cl, layer: ly, pick: false }));
      y += h;
    };
    for (let i = 0; i < bands.length; i++) put(bands[i]!.h, bands[i]!.color, bands[i]!.alpha ?? 1, layer - 2);
    put(top, o.color || "#a8def0", o.alpha ?? 0.84, layer);
  }

  // Pools: particles (x y z, vx vy vz, life, max, type, size), rings (x z spread age life), whirls
  // (x z size age life), bubble emitters (x z spread left), wakes.
  const CAP = o.cap ?? 320, NR = o.rings ?? 24, NW = 8;
  const P = new Float64Array(CAP * PS), RG = new Float64Array(NR * 5), WH = new Float64Array(NW * 5), EM = new Float64Array(NW * 4);
  const TY = new Uint8Array(CAP), wakes: WaterWake[] = [], S = new Float64Array(4), RS = new Uint32Array(1);
  RS[0] = (o.seed ?? 1) >>> 0;
  const R = () => {
    let t = (RS[0] = RS[0]! + 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // S: [0] the surface's clock, [1] absolute step time, [2] roll until (absolute), [3] live count.
  S[2] = idle;
  const pts: DioramaPoints = d.points({
    cap: CAP, cluster: cl, layer: layer + 1,
    paint(ctx, i, p) {
      ctx.beginPath();
      ctx.arc(p.sx[i]!, p.sy[i]!, Math.max(0.8, p.sr[i]!), 0, TAU);
      if (TY[i] === BUBBLE) return void ((ctx.strokeStyle = light), (ctx.lineWidth = 1.3), ctx.stroke());
      ctx.fillStyle = light;
      ctx.fill();
    },
  });

  function spawn(type: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number) {
    for (let k = 0; k < CAP; k++) {
      const q = k * PS;
      if (P[q + 6]! > 0) continue;
      (P[q] = x), (P[q + 1] = y), (P[q + 2] = z), (P[q + 3] = vx), (P[q + 4] = vy), (P[q + 5] = vz);
      (P[q + 6] = P[q + 7] = life), (P[q + 8] = type), (P[q + 9] = size);
      return;
    }
  }
  /** A ring: centre, how far it spreads, how long it lives, a delay. */
  function ring(x: number, z: number, spread: number, life: number, delay: number) {
    for (let i = 0; i < NR; i++) if (RG[i * 5 + 4]! <= 0) return void ((RG[i * 5] = x), (RG[i * 5 + 1] = z), (RG[i * 5 + 2] = spread), (RG[i * 5 + 3] = -delay), (RG[i * 5 + 4] = life));
  }
  function stir(sec = idle) {
    S[2] = Math.max(S[2]!, S[1]! + sec);
  }
  /** The wave's crest wobble: the same in `height` and the painted crests. */
  const wig = (u: number, v: number, t: number) => 0.2 * Math.sin(0.9 * v + 1.3 * t + 0.85 * u);
  /** The swell's set time, or −1 between sets. */
  const setT = (t: number) => (sw ? t - Math.floor(t / sPer) * sPer : -1);
  /** The swell's crest position along its dir at set time ts. */
  const crestU = (ts: number) => su0 - 2 * sW + sSpd * ts;
  function swellH(x: number, z: number, t: number) {
    const ts = setT(t);
    if (ts < 0) return 0;
    const du = x * sdx + z * sdz - crestU(ts), v = -x * sdz + z * sdx, q = du > 0 ? du / (0.5 * sW) : du / sW;
    return sAmp * Math.exp(-q * q) * (sPeel && v < sv0 + sPeel * ts ? 0.55 : 1);
  }
  /** The surface's height over `level` at (x, z) at time t (default now). */
  function height(x: number, z: number, t = S[0]!) {
    const tt = t + phase, u = x * dx + z * dz, v = -x * dz + z * dx;
    return amp * Math.sin((TAU / len) * (u - spd * tt + wig(u, v, tt))) + (sw ? swellH(x, z, t) : 0);
  }

  function step(dt: number) {
    const still = api.still;
    S[1] = S[1]! + dt;
    const rolling = !still && S[1]! < S[2]!;
    if (rolling) S[0] = S[0]! + dt;
    let on = rolling;
    for (let i = 0; i < CAP; i++) {
      const q = i * PS;
      if (P[q + 6]! <= 0) continue;
      on = true;
      const ty = P[q + 8]!;
      P[q + 6] = P[q + 6]! - dt;
      if (ty === BUBBLE) P[q + 9] = P[q + 9]! + dt * 0.12;
      else P[q + 4] = P[q + 4]! - G * dt;
      (P[q] = P[q]! + P[q + 3]! * dt), (P[q + 1] = P[q + 1]! + P[q + 4]! * dt), (P[q + 2] = P[q + 2]! + P[q + 5]! * dt);
      // Drops and the column end where they fall back in.
      if (ty !== BUBBLE && P[q + 1]! < Y && P[q + 4]! < 0) P[q + 6] = 0;
    }
    for (let i = 0; i < NR; i++) if (RG[i * 5 + 4]! > 0 && (on = true) && (RG[i * 5 + 3] = RG[i * 5 + 3]! + dt) >= RG[i * 5 + 4]!) RG[i * 5 + 4] = 0;
    for (let i = 0; i < NW; i++) {
      if (WH[i * 5 + 4]! > 0 && (on = true) && (WH[i * 5 + 3] = WH[i * 5 + 3]! + dt) >= WH[i * 5 + 4]!) WH[i * 5 + 4] = 0;
      const e = i * 4;
      if (EM[e + 3]! <= 0) continue;
      on = true;
      EM[e + 3] = EM[e + 3]! - dt;
      // About 27 a second, breaking on the surface over where it goes down.
      if (R() < 27 * dt) spawn(BUBBLE, EM[e]! + (R() - 0.5) * EM[e + 2]!, Y + 0.015, EM[e + 1]! + (R() - 0.5) * EM[e + 2]!, 0, 0, 0, 0.35 + R() * 0.5, 0.03 + R() * 0.05);
    }
    for (let i = 0; i < wakes.length; i++) {
      const w = wakes[i]!, M = w.ob.M, x = M[9]!, z = M[11]!, tr = w.trail;
      // Not drawn yet (no world matrix): nothing to follow.
      if (M[0]! * M[0]! + M[3]! * M[3]! + M[6]! * M[6]! < 0.5) continue;
      const lx = tr[TN * 5]!, lz = tr[TN * 5 + 1]!, mx = x - lx, mz = z - lz, m = hypot(mx, mz);
      // The first step, or a jump (over a unit in a step): it starts again from here.
      const fresh = tr[TN * 5 + 2] === 0 || m > 1;
      (tr[TN * 5] = x), (tr[TN * 5 + 1] = z), (tr[TN * 5 + 2] = 1);
      if (fresh) (w.n = 0), (w.speed = 0);
      const sp = fresh ? 0 : m / dt;
      w.speed += (sp - w.speed) * Math.min(1, dt * 8);
      if (sp > 0.05) (w.hx = mx / m), (w.hz = mz / m), stir();
      else if (w.speed < 0.05) {
        const hl = hypot(M[0]!, M[6]!) || 1;
        (w.hx = M[0]! / hl), (w.hz = M[6]! / hl);
      }
      // The trail: a sample every 0.08 s while it moves; samples age out.
      let k = 0;
      for (let j = 0; j < w.n; j++) if ((tr[j * 5 + 4] = tr[j * 5 + 4]! + dt) < TLIFE) k = j + 1;
      w.n = k;
      if (k) on = true;
      tr[TN * 5 + 3] = tr[TN * 5 + 3]! + dt;
      if (sp > 0.05 && !still && tr[TN * 5 + 3]! >= 0.08) {
        tr[TN * 5 + 3] = 0;
        tr.copyWithin(5, 0, (TN - 1) * 5);
        (tr[0] = x), (tr[1] = z), (tr[2] = w.hx), (tr[3] = w.hz), (tr[4] = 0);
        w.n = Math.min(TN, w.n + 1);
      }
      if (w.speed > 0.05) on = true;
    }
    // The particles into the diorama's pool, alpha by type and age.
    let j = 0;
    for (let i = 0; i < CAP; i++) {
      const q = i * PS, l = P[q + 6]!;
      if (l <= 0) continue;
      const u = l / P[q + 7]!, ty = P[q + 8]!;
      (pts.x[j] = P[q]!), (pts.y[j] = P[q + 1]!), (pts.z[j] = P[q + 2]!), (pts.r[j] = P[q + 9]!), (TY[j] = ty);
      pts.a[j++] = ty === COLUMN ? 0.92 : ty === BUBBLE ? Math.min(1, u * 3) : Math.min(1, u * 2);
    }
    pts.n = j;
    S[3] = j;
    return (api.busy = on);
  }

  // ---- painting (a decal in the sort, clipped to the outline) ----
  // Hot paths pass coordinates through K (a call with number arguments that V8 does not inline boxes
  // them): K[0..2] a world point, K[3..5] a frame point; the camera's basis per paint in B; a path's
  // screen points are buffered (SP, FM: moveTo flags, NP: count), then `out` draws it.
  const K = new Float64Array(8), B = new Float64Array(16), MAXP = 2048, SP = new Float64Array(MAXP * 2), FM = new Uint8Array(MAXP), NP = new Int32Array(1);
  /** K[0..2] (world) to the screen: moveTo or lineTo. */
  function mv(first: boolean) {
    const ex = K[0]! - B[0]!, ey = K[1]! - B[1]!, ez = K[2]! - B[2]!, k = B[12]! / Math.max(ex * B[9]! + ey * B[10]! + ez * B[11]!, 0.05);
    const sx = B[13]! + (ex * B[3]! + ez * B[5]!) * k, sy = B[14]! - (ex * B[6]! + ey * B[7]! + ez * B[8]!) * k;
    const i = NP[0]!;
    if (i >= MAXP) return;
    (SP[i * 2] = sx), (SP[i * 2 + 1] = sy), (FM[i] = first ? 1 : 0), (NP[0] = i + 1);
  }
  /** The buffered path: fill (0), stroke (1) or clip (2) it. One place calls the canvas's path
   *  methods, so they stay monomorphic and inlined. */
  function out(ctx: CanvasRenderingContext2D, how: number) {
    ctx.beginPath();
    for (let i = 0; i < NP[0]!; i++) FM[i] ? ctx.moveTo(SP[i * 2]!, SP[i * 2 + 1]!) : ctx.lineTo(SP[i * 2]!, SP[i * 2 + 1]!);
    how === 2 ? (ctx.closePath(), ctx.clip()) : how ? ctx.stroke() : ctx.fill();
  }
  /** K[3], K[5] (u along the wave, v across) to the surface, then mv. */
  function uv(first: boolean) {
    (K[0] = K[3]! * dx - K[5]! * dz), (K[1] = Y + 0.005), (K[2] = K[3]! * dz + K[5]! * dx);
    mv(first);
  }
  /** K[3], K[5] in the swell's frame, at its height (K[4]: the crest, K[7]: the break), then mv. */
  function suv(first: boolean) {
    const u = K[3]!, v = K[5]!, du = u - K[4]!, q = du > 0 ? du / (0.5 * sW) : du / sW;
    (K[0] = u * sdx - v * sdz), (K[2] = u * sdz + v * sdx);
    K[1] = Y + 0.01 + sAmp * Math.exp(-q * q) * (sPeel && v < K[7]! ? 0.55 : 1);
    mv(first);
  }
  /** The swell's band between du = K[4] + a and + b (from the crest at K[4]), across sv p..q (in BD). */
  const BD = new Float64Array(4), SB = new Float64Array([-1.7, -1, -0.12, -1, -0.45, -0.22, -0.45, -0.04, -0.34, 0, 0.22, 0.55, 0.22, 0.5, 0.3]);
  function band(ctx: CanvasRenderingContext2D) {
    const m = Math.max(2, Math.ceil((BD[3]! - BD[2]!) / 0.4)), h = (BD[3]! - BD[2]!) / m;
    NP[0] = 0;
    for (let k = 0; k <= m; k++) (K[3] = K[4]! + BD[0]!), (K[5] = BD[2]! + k * h), suv(!k);
    for (let k = m; k >= 0; k--) (K[3] = K[4]! + BD[1]!), (K[5] = BD[2]! + k * h), suv(false);
    out(ctx, 0);
  }
  function paint(ctx: CanvasRenderingContext2D) {
    const t = S[0]! + phase, a0 = ctx.globalAlpha, c = d.cam, cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    // The camera's basis, as diorama builds it: eye, right, up, forward, focal, the screen centre.
    (B[0] = c.tx + c.dist * sy * cp), (B[1] = c.ty + c.dist * sp), (B[2] = c.tz + c.dist * cy * cp);
    (B[3] = cy), (B[4] = 0), (B[5] = -sy), (B[9] = -sy * cp), (B[10] = -sp), (B[11] = -cy * cp);
    (B[6] = sy * B[10]!), (B[7] = -sy * B[9]! - cy * B[11]!), (B[8] = cy * B[10]!);
    (B[12] = d.focal()), (B[13] = d.width / 2 + c.ox), (B[14] = d.height / 2 + c.oy);
    ctx.save();
    NP[0] = 0;
    for (let i = 0; i < n; i++) (K[0] = OX[i]!), (K[1] = Y), (K[2] = OZ[i]!), mv(!i);
    out(ctx, 2);
    ctx.fillStyle = ctx.strokeStyle = light;
    B[15] = t;
    surface(ctx);
    wakesP(ctx);
    effects(ctx);
    ctx.restore();
    ctx.globalAlpha = a0;
  }
  const m = Math.max(4, Math.min(48, Math.ceil((v1 - v0) / 0.5))), hv = (v1 - v0) / m;
  /** Crests, sheen, foam and the swell. */
  function surface(ctx: CanvasRenderingContext2D) {
    const t = B[15]!;
    // Crests: wavy bands rolling along dir, fading in at the far side and out at the near one.
    if (crestA) {
      const base = spd * t + len / 4;
      for (let u = Math.ceil((u0 - base) / len) * len + base; u < u1 + len * 0.15; u += len) {
        ctx.globalAlpha = crestA * Math.sin(Math.PI * Math.max(0, Math.min(1, (u - u0 + len * 0.5) / (u1 - u0 + len))));
        NP[0] = 0;
        for (let k = 0; k <= m; k++) (K[5] = v0 + k * hv), (K[3] = u - 0.2 * Math.sin(0.9 * K[5]! + 1.3 * t + 0.85 * u)), uv(!k);
        for (let k = m; k >= 0; k--) (K[5] = v0 + k * hv), (K[3] = u - len * 0.14 - Math.sin(k * 0.6 - t * 0.9 + u) * 0.04 - 0.2 * Math.sin(0.9 * K[5]! + 1.3 * t + 0.85 * u)), uv(false);
        out(ctx, 0);
      }
    }
    // The sheen: a broad soft band drifting slowly across.
    if (sheenA) {
      const s = v0 + ((t * 0.16) % (v1 - v0 + 4)) - 2;
      ctx.globalAlpha = sheenA;
      NP[0] = 0;
      (K[3] = u0), (K[5] = s), uv(true);
      (K[5] = s + 1.4), uv(false);
      (K[3] = u1), (K[5] = s + 0.2), uv(false);
      (K[5] = s - 1.2), uv(false);
      out(ctx, 0);
    }
    // Foam on the edges: a ragged band that breathes in and out, and a fainter line lapping further in.
    if (foamA) {
      K[1] = Y + 0.005;
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = pass ? foamA * (0.25 + 0.2 * Math.sin(t * 1.7)) : foamA;
        ctx.lineWidth = 1.2;
        NP[0] = 0;
        for (let i = 0; i < n; i++) {
          if (!(edges & (1 << i))) continue;
          const ax = OX[i]!, az = OZ[i]!, ex = OX[(i + 1) % n]! - ax, ez = OZ[(i + 1) % n]! - az, el = hypot(ex, ez) || 1;
          const nx = (-ez / el) * inw, nz = (ex / el) * inw, km = Math.max(1, Math.ceil(el / 0.5));
          for (let back = 0; back < 2 - pass; back++)
            for (let k = 0; k <= km; k++) {
              const f = (back ? km - k : k) / km, s = f * el + i * 7.3;
              const w = pass ? 2 * foamW + 0.1 * Math.sin(t * 1.7 + s * 0.5) : back ? foamW * (0.77 + 0.23 * Math.sin(s * 2.3 + t * 2.1)) + 0.035 * Math.sin(s * 0.7 - t * 1.3) : -0.05;
              (K[0] = ax + ex * f + nx * w), (K[2] = az + ez * f + nz * w), mv(!k && !back);
            }
        }
        out(ctx, pass);
      }
    }
    // The swell: a shaded back, a lit face, the lip and the whitewater where it has broken.
    if (sw) {
      const ts = S[0]! - Math.floor(S[0]! / sPer) * sPer, pk = sPeel ? Math.min(sv1, sv0 + sPeel * ts) : sv0;
      (K[4] = su0 - 2 * sW + sSpd * ts), (K[7] = pk);
      // Bands from its back to its toe (from the crest, in widths) with their shade (−) or light (+).
      for (let i = 0; i < 15; i += 3) {
        const a = SB[i + 2]!;
        ctx.globalAlpha = sA * (a < 0 ? -a : a);
        ctx.fillStyle = a < 0 ? "#0d2c44" : light;
        (BD[0] = SB[i]! * sW), (BD[1] = SB[i + 1]! * sW), (BD[2] = a < 0 ? sv0 : pk), (BD[3] = sv1), band(ctx);
      }
      if (pk > sv0) (ctx.globalAlpha = Math.min(1, sA * 1.5)), (BD[0] = -sW * 0.5), (BD[1] = sW * 0.6), (BD[2] = sv0), (BD[3] = pk), band(ctx);
      ctx.globalAlpha = Math.min(1, sA * 1.6);
      ctx.lineWidth = 2.5;
      NP[0] = 0;
      for (let k = 0; k <= m; k++) (K[3] = K[4]!), (K[5] = pk + ((sv1 - pk) * k) / m), suv(!k);
      out(ctx, 1);
    }
  }
  /** Bow waves at rest and under way, the wash astern, and the trail spreading out behind. */
  function wakesP(ctx: CanvasRenderingContext2D) {
    const t = B[15]!;
    K[1] = Y + 0.006;
    for (let i = 0; i < wakes.length; i++) {
      const w = wakes[i]!, M = w.ob.M, ux = w.hx, uz = w.hz, g = w.rest + Math.min(1, w.speed / 1.5), q = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 1.9);
      if (g <= 0.01 || w.ob.hidden) continue;
      const h = w.size, s = 1 + Math.min(0.8, w.speed * 0.3), bx = M[9]! + ux * h, bz = M[11]! + uz * h, ex = M[9]! - ux * (h + 0.1), ez = M[11]! - uz * (h + 0.1);
      ctx.globalAlpha = Math.min(1, foamA * g * (0.6 + 0.4 * q) + 0.1);
      ctx.lineWidth = 1.6;
      NP[0] = 0;
      for (let sg = -1; sg <= 1; sg += 2) {
        const a = w.width * 0.9 + 0.08 * q, b = (w.width * 1.45 + 0.1 * q) * s, e = (0.35 + 0.1 * q) * s, f = (0.9 + 0.1 * q) * s, r = (0.4 + 0.15 * q) * s;
        (K[0] = bx + ux * 0.08), (K[2] = bz + uz * 0.08), mv(true);
        (K[0] = bx - ux * e - uz * sg * a), (K[2] = bz - uz * e + ux * sg * a), mv(false);
        (K[0] = bx - ux * f - uz * sg * b), (K[2] = bz - uz * f + ux * sg * b), mv(false);
        (K[0] = ex - uz * sg * w.width * 0.55), (K[2] = ez + ux * sg * w.width * 0.55), mv(true);
        (K[0] = ex - ux * r - uz * sg * w.width * 0.8), (K[2] = ez - uz * r + ux * sg * w.width * 0.8), mv(false);
      }
      out(ctx, 1);
      const tr = w.trail;
      ctx.lineWidth = 1.2;
      for (let k = 0; k + 1 < w.n; k++) {
        const j = k * 5;
        ctx.globalAlpha = foamA * 0.8 * (1 - tr[j + 9]! / TLIFE);
        NP[0] = 0;
        for (let sg = -1; sg <= 1; sg += 2)
          for (let e = 0; e < 2; e++) {
            const jj = j + e * 5, sp = w.width * 0.8 + tr[jj + 4]! * 0.55;
            (K[0] = tr[jj]! - tr[jj + 3]! * sg * sp), (K[2] = tr[jj + 1]! + tr[jj + 2]! * sg * sp), mv(!e);
          }
        out(ctx, 1);
      }
    }
  }
  /** Rings and ripples (eased out, thinning as they go), and whirlpools. */
  function effects(ctx: CanvasRenderingContext2D) {
    K[1] = Y + 0.01;
    for (let i = 0; i < NR; i++) {
      const q = i * 5;
      if (RG[q + 4]! <= 0 || RG[q + 3]! < 0) continue;
      const u = RG[q + 3]! / RG[q + 4]!, rr = 0.12 + (1 - (1 - u) * (1 - u)) * RG[q + 2]!;
      ctx.globalAlpha = (1 - u) * 0.9;
      ctx.lineWidth = 1 + (1 - u) * 2;
      NP[0] = 0;
      for (let k = 0; k <= 28; k++) (K[0] = RG[q]! + Math.cos((k / 28) * TAU) * rr), (K[2] = RG[q + 1]! + Math.sin((k / 28) * TAU) * rr), mv(!k);
      out(ctx, 1);
    }
    // Whirlpools: three arms turning in, fading as it settles.
    ctx.lineWidth = 2;
    K[1] = Y + 0.012;
    for (let i = 0; i < NW; i++) {
      const q = i * 5, life = WH[q + 4]!, tt = WH[q + 3]!;
      if (life <= 0) continue;
      const u = tt / life, sz = WH[q + 2]!;
      ctx.globalAlpha = Math.min(1, u * 5) * (1 - u) * 0.8;
      NP[0] = 0;
      for (let a = 0; a < 3; a++)
        for (let k = 0; k <= 12; k++) {
          const th = (a / 3) * TAU + k * 0.42 + tt * 3.2, rr = sz * (1 - k * 0.073) * (1 - u * 0.4);
          (K[0] = WH[q]! + Math.cos(th) * rr), (K[2] = WH[q + 1]! + Math.sin(th) * rr), mv(!k);
        }
      out(ctx, 1);
    }
  }
  d.decal(cl, layer + 0.6, paint);

  const api = {
    /** The surface band and depth bands (diorama objects), bottom first. */
    bodies,
    /** The particle pool in the diorama's sort. */
    points: pts,
    /** The surface's height, y. */
    level: Y,
    /** Reduced motion: the surface holds still and effects stay short. */
    still: o.still ?? reduced(),
    /** True while anything moves (set by `step`). */
    busy: true,
    /** The surface's clock (seconds it has rolled). */
    get time() {
      return S[0]!;
    },
    /** Live particles after the last step. */
    get live() {
      return S[3]!;
    },
    step,
    /** Keep the surface rolling `sec` more seconds (default `idle`). */
    stir,
    height,
    /** The surface's slope at (x, z): out = [dh/dx, dh/dz]. */
    slope<T extends { [i: number]: number }>(x: number, z: number, out: T, t = S[0]!): T {
      out[0] = (height(x + 0.01, z, t) - height(x - 0.01, z, t)) / 0.02;
      out[1] = (height(x, z + 0.01, t) - height(x, z - 0.01, t)) / 0.02;
      return out;
    },
    /** The swell now: out = [crest along its dir (x·dx + z·dz), the break point across it (from its
     *  low end), its height]; false when there is no swell or the crest is off the water. */
    crest(out: { [i: number]: number }, t = S[0]!) {
      const ts = setT(t), uc = crestU(ts);
      out[0] = uc;
      out[1] = sPeel ? Math.min(sv1, sv0 + sPeel * ts) : sv0;
      out[2] = sAmp;
      return !!sw && uc > su0 - sW && uc < su1 + sW;
    },
    /** A miss: a column of water that rises and falls back, spray and a crown of drops at its foot,
     *  a ring and ripples running out (size scales it). */
    splash(x: number, z: number, size = 1) {
      stir();
      const k = Math.sqrt(size);
      if (api.still) {
        for (let i = 0; i < 10; i++) {
          const a = R() * TAU, s = (0.5 + R() * 1.3) * k;
          spawn(DROP, x, Y + 0.05, z, Math.cos(a) * s, (2.6 + R() * 2.4) * k, Math.sin(a) * s, 0.45, 0.08 * size);
        }
        return ring(x, z, 0.9 * size, 0.5, 0);
      }
      for (let i = 0; i < 18; i++) {
        const h = R();
        spawn(COLUMN, x + (R() - 0.5) * 0.16 * size, Y + 0.02, z + (R() - 0.5) * 0.16 * size, (R() - 0.5) * 0.3, (3.2 + h * 4.4) * k, (R() - 0.5) * 0.3, 2, (0.3 - h * 0.15) * size);
      }
      for (let i = 0; i < 30; i++) {
        const a = R() * TAU, s = (0.6 + R() * 1.5) * k;
        spawn(DROP, x, Y + (0.3 + R() * 1.4) * size, z, Math.cos(a) * s, (1.5 + R() * 3.4) * k, Math.sin(a) * s, 1.4, (0.05 + R() * 0.06) * size);
      }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU, s = (1.6 + R() * 0.5) * k;
        spawn(DROP, x + Math.cos(a) * 0.2 * size, Y + 0.04, z + Math.sin(a) * 0.2 * size, Math.cos(a) * s, (1.6 + R() * 1.2) * k, Math.sin(a) * s, 1, (0.06 + R() * 0.03) * size);
      }
      ring(x, z, 0.9 * size, 0.9, 0), ring(x, z, 2.2 * size, 1.6, 0.12), ring(x, z, 3.2 * size, 2.2, 0.4), ring(x, z, 1.4 * size, 1.3, 0.9);
    },
    /** A ring and a ripple running out from (x, z). */
    ripple(x: number, z: number, size = 1) {
      stir();
      ring(x, z, size, api.still ? 0.4 : 0.9, 0);
      api.still || ring(x, z, 2 * size, 1.5, 0.15);
    },
    /** Bubbles breaking on the surface round (x, z) for `sec` seconds, `spread` across. */
    bubbles(x: number, z: number, sec = 2.4, spread = 1) {
      stir();
      if (api.still) return;
      for (let i = 0; i < NW; i++) if (EM[i * 4 + 3]! <= 0) return void ((EM[i * 4] = x), (EM[i * 4 + 1] = z), (EM[i * 4 + 2] = spread), (EM[i * 4 + 3] = sec));
    },
    /** A whirlpool at (x, z), `size` across its arms, for `sec` seconds, and its rings. */
    whirl(x: number, z: number, size = 1.5, sec = 2.6) {
      stir();
      ring(x, z, size, api.still ? 0.5 : 1.8, api.still ? 0 : 0.3);
      if (api.still) return;
      ring(x, z, size * 1.9, 2.4, 0.9);
      for (let i = 0; i < NW; i++) if (WH[i * 5 + 4]! <= 0) return void ((WH[i * 5] = x), (WH[i * 5 + 1] = z), (WH[i * 5 + 2] = size), (WH[i * 5 + 3] = 0), (WH[i * 5 + 4] = sec));
    },
    /** Bow waves and a trail behind `ob` (its position from its world matrix, as of the last draw). */
    wake(ob: DioramaObject, w: WakeOptions = {}): WaterWake {
      const k: WaterWake = { ob, size: w.size ?? ob.size[0]! / 2, width: w.width ?? ob.size[2]! / 2, rest: w.rest ?? 0.6, speed: 0, hx: 1, hz: 0, trail: new Float64Array(TN * 5 + 4), n: 0 };
      wakes.push(k);
      return k;
    },
    /** Stop a wake. */
    unwake(k: WaterWake) {
      const i = wakes.indexOf(k);
      if (i >= 0) wakes.splice(i, 1);
    },
    /** End every effect now (the surface keeps its clock). */
    clear() {
      P.fill(0), RG.fill(0), WH.fill(0), EM.fill(0), (pts.n = 0);
      for (let i = 0; i < wakes.length; i++) wakes[i]!.n = 0;
    },
  };
  return api;
}
/** What `water` returns. */
export type Water = ReturnType<typeof water>;
