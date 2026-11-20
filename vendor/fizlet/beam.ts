/**
 * @fzlt/core/beam: lasers on a board. Parts (mirrors, splitters, blockers, targets, emitters) stand on
 * a flat board plane in board coordinates [x, z], free or on a grid; `run()` casts every emitter's
 * ray, reflecting off mirrors at any angle, passing through and splitting at splitters, stopping at
 * blockers, targets and the board's edge, and writes the segments and hits into fixed typed arrays.
 * - A part is a segment (`len`, turned by `a`) or a circle (`r`). Angles are radians from +x toward
 *   +z; on a diorama an object turned to angle a has `rot[1] = −a`. Multiples of π/4 take exact
 *   directions (no `Math.cos` rounding), so a grid puzzle traces the same bits in every browser.
 * - Deterministic: the same parts give the same segments in the same order (depth first, the
 *   transmitted ray before the reflected one). `bounces` caps the turns on one path (`capped` counts
 *   the paths it stopped), `segs` the segments (`dropped` counts the rest).
 * - `dioramaBeam` draws the result on an `@fzlt/core/diorama` board: glowing beams as decals in the
 *   depth sort (split into short pieces so they sort among the parts), a pulse of points along them,
 *   sparks where a beam hits a target or a blocker; a re-routed beam grows out from where it changed.
 * No allocation per `run()` or `show()` in the steady state. 2D lengths use steer's exact `hypot`.
 */
import type { Diorama, DioramaObject, DioramaPoints } from "./diorama";
import { hypot } from "./steer";

/** Part kinds, as stored in `kind`. */
export const MIRROR = 1, SPLITTER = 2, BLOCKER = 3, TARGET = 4, EMITTER = 5;
/** A part's kind by name. */
export type BeamKind = "mirror" | "splitter" | "blocker" | "target" | "emitter";
const KINDS: BeamKind[] = ["mirror", "splitter", "blocker", "target", "emitter"];

/** One part to `add`: where it stands, its shape and what it does to a beam. */
export interface BeamPart {
  /** What it does: reflect, split (pass and reflect), stop, stop and light, or emit. */
  kind: BeamKind;
  /** Board x (or `col` on the grid). */
  x?: number;
  /** Board z (or `row` on the grid). */
  z?: number;
  /** Grid column: x is the cell's centre (needs `grid`). */
  col?: number;
  /** Grid row: z is the cell's centre. */
  row?: number;
  /** Angle, radians from +x toward +z: a segment's direction, or an emitter's beam (default 0). */
  a?: number;
  /** Segment length (default: the grid cell, or 1). */
  len?: number;
  /** A circle of this radius instead of a segment (a peg, a round target). */
  r?: number;
  /** A mirror reflects on its front only (the side its normal (−sin a, cos a) points to); its back blocks. */
  one?: boolean;
  /** Off: beams pass it, emitters stay dark (default on). */
  off?: boolean;
  /** Anything (the game's object). */
  tag?: unknown;
}

/** Options for `beam()`: capacities, the cap on turns, the board's edge and grid. */
export interface BeamOptions {
  /** The most parts (default 64). */
  cap?: number;
  /** The most segments per run (default 256). */
  segs?: number;
  /** The most hits per run (default 128). */
  hits?: number;
  /** The most turns (mirror or splitter hits) on one path (default 24). */
  bounces?: number;
  /** The board's edge [x0, z0, x1, z1]: beams stop there (default ±10,000). */
  bounds?: ArrayLike<number>;
  /** A grid: cell size and the board point of cell (0, 0)'s corner; `col`/`row` place parts on it. */
  grid?: { cell: number; x0?: number; z0?: number };
}

const S = Math.SQRT1_2, Q = Math.PI / 4, C8 = [1, S, 0, -S, -1, -S, 0, S], S8 = [0, S, 1, S, 0, -S, -1, -S], EPS = 1e-9;

/** A beam board: `add` parts, `run()` after any change, then read `segs` and `hits`. */
export function beam(o: BeamOptions = {}) {
  const cap = o.cap ?? 64, SG = o.segs ?? 256, HC = o.hits ?? 128, BN = o.bounces ?? 24, bd = o.bounds || [-1e4, -1e4, 1e4, 1e4];
  const g = o.grid, cell = g ? g.cell : 1, gx = g ? g.x0 ?? 0 : 0, gz = g ? g.z0 ?? 0 : 0;
  const f = (n: number) => new Float64Array(n);
  // Parts: kind, centre, direction (unit), half length, radius, flags (1 off, 2 one-sided), hits this run.
  const kind = new Uint8Array(cap), x = f(cap), z = f(cap), a = f(cap), ux = f(cap), uz = f(cap), h = f(cap), r = f(cap), flag = new Uint8Array(cap), lit = new Uint16Array(cap);
  const tag: unknown[] = [];
  // Segments: start, end, distance from the emitter at the start, power, turns, the part at the end (−1: the edge), the emitter.
  const x0 = f(SG), z0 = f(SG), x1 = f(SG), z1 = f(SG), sl = f(SG), sp = f(SG), sg = new Uint16Array(SG), se = new Int16Array(SG), ss = new Int16Array(SG);
  // Hits: the part, the point, the segment that ends there.
  const hp = new Int16Array(HC), hx = f(HC), hz = f(HC), hs = new Int16Array(HC);
  // Pending rays (a split pushes one): position, direction, distance, power, turns, emitter, the part it leaves.
  const RC = 64, R = f(RC * 6 + 6), RI = new Int32Array(RC * 4 + 4), W = f(2), PS = f(6), oct = new Int8Array(cap);
  let np = 0, rn = 0;

  /** Part i's direction from its angle: a multiple of π/4 takes the exact table (and an octant, so
   *  a reflection between two of them is exact too); any other angle, cos and sin. */
  function dirOf(i: number) {
    const q = a[i]! / Q, k = Math.round(q);
    if (Math.abs(q - k) < 1e-12) { const m = ((k % 8) + 8) % 8; ux[i] = C8[m]!; uz[i] = S8[m]!; oct[i] = m; }
    else (ux[i] = Math.cos(a[i]!)), (uz[i] = Math.sin(a[i]!)), (oct[i] = -1);
  }
  /** The octant of direction (dx, dz) if it is exactly a table direction, else −1. */
  function octOf(dx: number, dz: number) {
    for (let m = 0; m < 8; m++) if (C8[m] === dx && S8[m] === dz) return m;
    return -1;
  }
  function add(p: BeamPart) {
    if (np >= cap) throw new RangeError("beam: more parts than cap");
    const i = np++;
    kind[i] = KINDS.indexOf(p.kind) + 1;
    x[i] = p.col != null ? gx + (p.col + 0.5) * cell : p.x ?? 0;
    z[i] = p.row != null ? gz + (p.row + 0.5) * cell : p.z ?? 0;
    a[i] = p.a ?? 0;
    h[i] = (p.len ?? cell) / 2;
    r[i] = p.r ?? 0;
    flag[i] = (p.off ? 1 : 0) | (p.one ? 2 : 0);
    tag[i] = p.tag ?? null;
    dirOf(i);
    return i;
  }
  /** Push the ray staged in PS (x, z, dx, dz, distance, power): integers in, so no double is boxed. */
  function push(gn: number, src: number, from: number, oc: number) {
    if (rn >= RC) return void api.dropped++;
    const j = rn * 6, k = rn++ * 4;
    for (let c = 0; c < 6; c++) R[j + c] = PS[c]!;
    RI[k] = gn; RI[k + 1] = src; RI[k + 2] = from; RI[k + 3] = oc;
  }
  /** W = [t, part] of the nearest thing ray (R row j) meets, leaving part `from`. */
  function nearest(j: number, from: number) {
    const px = R[j]!, pz = R[j + 1]!, dx = R[j + 2]!, dz = R[j + 3]!;
    // The board's edge.
    let t = Infinity;
    if (dx > EPS) t = (bd[2]! - px) / dx; else if (dx < -EPS) t = (bd[0]! - px) / dx;
    if (dz > EPS) t = Math.min(t, (bd[3]! - pz) / dz); else if (dz < -EPS) t = Math.min(t, (bd[1]! - pz) / dz);
    let best = -1;
    for (let i = 0; i < np; i++) {
      if (i === from || flag[i]! & 1 || kind[i] === EMITTER) continue;
      const qx = x[i]! - px, qz = z[i]! - pz;
      let ti: number;
      if (r[i]! > 0) {
        const b = qx * dx + qz * dz, c = qx * qx + qz * qz - r[i]! * r[i]!, disc = b * b - c;
        if (b <= 0 || disc < 0) continue;
        ti = b - Math.sqrt(disc);
      } else {
        const vx = ux[i]!, vz = uz[i]!, den = dx * vz - dz * vx;
        if (Math.abs(den) < 1e-12) continue;
        ti = (qx * vz - qz * vx) / den;
        if (Math.abs((qx * dz - qz * dx) / den) > h[i]! + EPS) continue;
      }
      if (ti > EPS && ti < t) (t = ti), (best = i);
    }
    W[0] = t;
    W[1] = best;
  }
  /** Follow the ray in R row j until it ends; splits push more rows. */
  function follow(j: number, k: number) {
    for (;;) {
      nearest(j, RI[k + 2]!);
      const t = W[0]!, p = W[1]!, px = R[j]!, pz = R[j + 1]!;
      let dx = R[j + 2]!, dz = R[j + 3]!;
      if (api.n >= SG) return void api.dropped++;
      const s = api.n++, ex = px + dx * t, ez = pz + dz * t, gn = RI[k]!;
      x0[s] = px; z0[s] = pz; x1[s] = ex; z1[s] = ez; sl[s] = R[j + 4]!; sp[s] = R[j + 5]!; sg[s] = gn; se[s] = p; ss[s] = RI[k + 1]!;
      if (p < 0) return;
      lit[p] = lit[p]! + 1;
      if (api.nh < HC) (hp[api.nh] = p), (hx[api.nh] = ex), (hz[api.nh] = ez), (hs[api.nh++] = s);
      const kd = kind[p]!;
      if (kd !== MIRROR && kd !== SPLITTER) return;
      // The normal at the hit: a segment's (−uz, ux), a circle's outward.
      let nx: number, nz: number;
      if (r[p]! > 0) (nx = (ex - x[p]!) / r[p]!), (nz = (ez - z[p]!) / r[p]!);
      else (nx = -uz[p]!), (nz = ux[p]!);
      const dn = dx * nx + dz * nz;
      if (kd === MIRROR && flag[p]! & 2 && dn > 0) return; // the back of a one-sided mirror
      if (gn >= BN) return void api.capped++;
      // Reflect: exact from the table when the ray and the mirror both lie on it (2φ − θ), else d − 2(d·n)n.
      const l = R[j + 4]! + t, od = RI[k + 3]!, om = r[p]! > 0 ? -1 : oct[p]!, ro = od >= 0 && om >= 0 ? (((2 * om - od) % 8) + 8) % 8 : -1;
      const rx = ro >= 0 ? C8[ro]! : dx - 2 * dn * nx, rz = ro >= 0 ? S8[ro]! : dz - 2 * dn * nz;
      if (kd === SPLITTER) {
        const pw = R[j + 5]! / 2;
        R[j + 5] = pw;
        PS[0] = ex; PS[1] = ez; PS[2] = rx; PS[3] = rz; PS[4] = l; PS[5] = pw;
        push(gn + 1, RI[k + 1]!, p, ro);
      } else (dx = rx), (dz = rz), (RI[k + 3] = ro);
      R[j] = ex; R[j + 1] = ez; R[j + 2] = dx; R[j + 3] = dz; R[j + 4] = l;
      RI[k] = gn + 1; RI[k + 2] = p;
    }
  }
  /** Trace the ray staged in PS from emitter `src` (−1: none) to every end. */
  function trace(src: number) {
    const dl = hypot(PS[2]!, PS[3]!) || 1, j = RC * 6, k = RC * 4, oc = src >= 0 ? oct[src]! : -1;
    if (oc < 0) (PS[2] = PS[2]! / dl), (PS[3] = PS[3]! / dl);
    PS[4] = 0;
    rn = 0;
    push(0, src, src, oc >= 0 ? oc : octOf(PS[2]!, PS[3]!));
    // Depth first: pop the newest pending ray into the scratch row past the stack and follow it to
    // its end; a split pushes its reflected ray, which runs next.
    while (rn > 0) {
      rn--;
      for (let c = 0; c < 6; c++) R[j + c] = R[rn * 6 + c]!;
      for (let c = 0; c < 4; c++) RI[k + c] = RI[rn * 4 + c]!;
      follow(j, k);
    }
    return api.n;
  }
  function reset() {
    api.n = api.nh = api.capped = api.dropped = 0;
    lit.fill(0);
  }
  function run() {
    reset();
    for (let i = 0; i < np; i++)
      if (kind[i] === EMITTER && !(flag[i]! & 1)) (PS[0] = x[i]!), (PS[1] = z[i]!), (PS[2] = ux[i]!), (PS[3] = uz[i]!), (PS[5] = 1), trace(i);
    api.ver++;
    return api.n;
  }

  const api = {
    /** Parts added. */
    get parts() {
      return np;
    },
    /** Per part: its kind (MIRROR … EMITTER), centre, angle, direction, half length, radius. */
    kind, x, z, a, ux, uz, h, r,
    /** Per part: 1 off, 2 one-sided. */
    flag,
    /** Per part: hits in the last run (a target is lit when > 0). */
    lit,
    /** Per part: what `add` was given as `tag`. */
    tag,
    /** Segments in the last run. */
    n: 0,
    /** Segment start and end, board coordinates. */
    x0, z0, x1, z1,
    /** Segment: distance along its path from the emitter at the start (a re-route grows from here). */
    sl,
    /** Segment: power (1, halved at each split). */
    sp,
    /** Segment: turns before it. */
    sg,
    /** Segment: the part it ends on, or −1 at the board's edge. */
    se,
    /** Segment: its emitter (−1 for `cast`). */
    ss,
    /** Hits in the last run. */
    nh: 0,
    /** Hit: the part, the point, the segment that ends there. */
    hp, hx, hz, hs,
    /** Paths the `bounces` cap stopped in the last run. */
    capped: 0,
    /** Segments or splits past capacity in the last run. */
    dropped: 0,
    /** Runs so far (a drawing helper redraws when it changes). */
    ver: 0,
    /** Add a part; returns its index. */
    add,
    /** Move part i to (px, pz), turned to angle `ang` (radians). Then `run()`. */
    set(i: number, px: number, pz: number, ang = a[i]!) {
      x[i] = px;
      z[i] = pz;
      a[i] = ang;
      dirOf(i);
    },
    /** Turn part i by `da` radians (a quarter turn of a grid mirror: π/2). Then `run()`. */
    turn(i: number, da: number) {
      a[i] = a[i]! + da;
      dirOf(i);
    },
    /** Switch part i on or off. Then `run()`. */
    enable(i: number, on: boolean) {
      flag[i] = on ? flag[i]! & ~1 : flag[i]! | 1;
    },
    /** The grid cell [col, row] holding board point (px, pz): out = [col, row]. */
    cellAt(px: number, pz: number, out: { [i: number]: number }) {
      out[0] = Math.floor((px - gx) / cell);
      out[1] = Math.floor((pz - gz) / cell);
      return out;
    },
    /** The part centred in grid cell (col, row), or −1. */
    partAt(col: number, row: number) {
      const cx = gx + (col + 0.5) * cell, cz = gz + (row + 0.5) * cell;
      for (let i = 0; i < np; i++) if (Math.abs(x[i]! - cx) < 1e-9 && Math.abs(z[i]! - cz) < 1e-9) return i;
      return -1;
    },
    /** Targets lit in the last run. */
    litCount() {
      let c = 0;
      for (let i = 0; i < np; i++) if (kind[i] === TARGET && lit[i]) c++;
      return c;
    },
    /** Clear the last run (segments, hits, lit). */
    reset,
    /** Append one ray from (px, pz) along (dx, dz) (no emitter part) at `power`; returns the segment count. */
    cast(px: number, pz: number, dx: number, dz: number, power = 1) {
      PS[0] = px; PS[1] = pz; PS[2] = dx; PS[3] = dz; PS[5] = power;
      return trace(-1);
    },
    /** Clear, then cast every emitter that is on; returns the segment count. */
    run,
  };
  return api;
}
/** What `beam` returns. */
export type Beam = ReturnType<typeof beam>;

/** Options for `dioramaBeam`: where the beams sit, their look and their motion. */
export interface DioramaBeamOptions {
  /** The id of the board object the parts stand on: board [x, z] is from its top centre. */
  on: string;
  /** The beams' height over the board (default 0.35). */
  y?: number;
  /** The cluster they sort in (default "@" + on, the board's own). */
  cluster?: string;
  /** Their layer in it (default 5: among parts resting on a root board). */
  layer?: number;
  /** Glow colour (default `#ff3b3b`). */
  color?: string;
  /** Core colour (default `#fff1ea`). */
  core?: string;
  /** Spark colour (default `#ffd36b`). */
  spark?: string;
  /** Beam width, world units (default 0.1). */
  width?: number;
  /** The longest piece a segment is drawn in (default 1): shorter pieces sort better among parts. */
  piece?: number;
  /** The most pieces (default 192). */
  pieces?: number;
  /** How fast a beam grows out, world units per second (default 24). */
  speed?: number;
  /** Pulse points' spacing along the beam (default 1.6; 0: none). */
  pulse?: number;
  /** Pulse speed, world units per second (default 5). */
  pulseSpeed?: number;
  /** The most pulse points (default 96). */
  dots?: number;
  /** The most sparks (default 64). */
  sparks?: number;
  /** Seconds the pulse plays after a change before it fades and `show` lets the engine settle (default 1.4; Infinity: always). */
  hold?: number;
  /** false (reduced motion): beams appear at once, no pulse, no sparks. */
  motion?: boolean;
  /** Called when a target's light turns on (the beam reached it) or off: tint the target. */
  light?: (part: number, on: boolean) => void;
}

/** Draw beam `b` on diorama `d`. `show(t)` (t: a running clock in seconds) before each `d.draw()`;
 *  true while anything moves (a beam growing, sparks, the pulse within `hold` of a change). */
export function dioramaBeam(d: Diorama, b: Beam, o: DioramaBeamOptions) {
  const PC = o.pieces ?? 192, SG = b.x0.length, cl = o.cluster ?? "@" + o.on, layer = o.layer ?? 5, by = o.y ?? 0.35, wd = o.width ?? 0.1, pl = o.piece ?? 1;
  const speed = o.speed ?? 24, gap = o.pulse ?? 1.6, pv = o.pulseSpeed ?? 5, hold = o.hold ?? 1.4, motion = o.motion !== false, life = 0.55, SPK = 8;
  const col = o.color || "#ff3b3b", core = o.core || "#fff1ea", spc = o.spark || "#ffd36b";
  const f = (n: number) => new Float64Array(n);
  // Pieces: board start/end, distance at each end, power; their sort point (world) in `at`.
  const qx0 = f(PC), qz0 = f(PC), qx1 = f(PC), qz1 = f(PC), ql0 = f(PC), ql1 = f(PC), qp = f(PC), at = f(PC * 3), WP = f(PC * 6);
  // The last result, to find where a re-route starts.
  const ox0 = f(SG), oz0 = f(SG), ox1 = f(SG), oz1 = f(SG);
  // Per part: lit on screen, when the beam reached it, where.
  const NP = b.kind.length, on = new Uint8Array(NP), seen = new Uint8Array(NP), reach = f(NP).fill(-1e9), rx = f(NP), rz = f(NP), reachL = f(NP);
  const B = f(15), X = f(3), Y = f(6), L = f(4), TS = f(5); // TS: t, last t, reveal, last change, pulse envelope
  let npc = 0, on_ = 0, ver = -1, prevN = 0, total = 0, par: DioramaObject | null = null;
  const glow = (p: DioramaPoints) => (ctx: CanvasRenderingContext2D, i: number) => {
    const al = p.a[i]!;
    ctx.globalAlpha = al * 0.3;
    ctx.fillStyle = p === sparks ? spc : col;
    ctx.beginPath();
    ctx.arc(p.sx[i]!, p.sy[i]!, p.sr[i]! * 2.4, 0, 6.283185307179586);
    ctx.fill();
    ctx.globalAlpha = al;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(p.sx[i]!, p.sy[i]!, p.sr[i]!, 0, 6.283185307179586);
    ctx.fill();
  };
  const dots = d.points({ cap: o.dots ?? 96, cluster: cl, layer }), sparks = d.points({ cap: o.sparks ?? 64, cluster: cl, layer: layer + 0.5 });
  dots.paint = glow(dots);
  sparks.paint = glow(sparks);

  /** X = board point L[li], L[li + 1] at height L[3] (world, through the board's last matrix). */
  function world(li: number) {
    const p = par || (par = d.get(o.on) || null), lx = L[li]!, ly = (p ? p.size[1]! : 0) + L[3]!, lz = L[li + 1]!;
    if (!p) return void ((X[0] = lx), (X[1] = ly), (X[2] = lz));
    const m = p.M;
    X[0] = m[0]! * lx + m[1]! * ly + m[2]! * lz + m[9]!;
    X[1] = m[3]! * lx + m[4]! * ly + m[5]! * lz + m[10]!;
    X[2] = m[6]! * lx + m[7]! * ly + m[8]! * lz + m[11]!;
  }
  /** Piece i on screen (WP, cut at the reveal by `show`): three strokes, a wide glow, a glow and the core. */
  function piece(ctx: CanvasRenderingContext2D, i: number) {
    const l0 = ql0[i]!;
    basis(d, B);
    X[0] = WP[i * 6]!; X[1] = WP[i * 6 + 1]!; X[2] = WP[i * 6 + 2]!;
    proj(B, X, Y, 0);
    const zz = Y[5]!;
    X[0] = WP[i * 6 + 3]!; X[1] = WP[i * 6 + 4]!; X[2] = WP[i * 6 + 5]!;
    proj(B, X, Y, 2);
    if (zz <= 0.05) return;
    const k = (B[12]! * wd) / zz, pw = qp[i]!, env = TS[4]!, wob = 1 + env * 0.35 * Math.sin(TS[0]! * 9 - l0 * 0.7);
    ctx.lineCap = "round";
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(Y[0]!, Y[1]!);
    ctx.lineTo(Y[2]!, Y[3]!);
    ctx.globalAlpha = 0.16 * pw * wob;
    ctx.lineWidth = k * 4;
    ctx.stroke();
    ctx.globalAlpha = 0.45 * pw * wob;
    ctx.lineWidth = k * 1.8;
    ctx.stroke();
    ctx.globalAlpha = Math.min(1, 0.55 + pw * 0.45);
    ctx.strokeStyle = core;
    ctx.lineWidth = k * 0.6;
    ctx.stroke();
  }
  // The test for a live piece stays out here: the painter's calls are then hot enough to inline (a
  // call made by a few of its invocations is not, and its double arguments would be boxed).
  for (let i = 0; i < PC; i++) d.decal(cl, layer, (ctx) => void (i < npc && ql0[i]! < TS[2]! && piece(ctx, i)), at.subarray(i * 3, i * 3 + 3));

  /** A new result: pieces from its segments; the reveal falls back to where it first differs. */
  function rebuild() {
    let k = 0;
    while (k < b.n && k < prevN && b.x0[k] === ox0[k] && b.z0[k] === oz0[k] && b.x1[k] === ox1[k] && b.z1[k] === oz1[k]) k++;
    let from = Infinity;
    for (let s = k; s < b.n; s++) from = Math.min(from, b.sl[s]!);
    if (k < b.n || k < prevN) TS[3] = TS[0]!;
    TS[2] = motion ? Math.min(TS[2]!, from) : Infinity;
    npc = 0;
    total = 0;
    for (let s = 0; s < b.n; s++) {
      const dx = b.x1[s]! - b.x0[s]!, dz = b.z1[s]! - b.z0[s]!, len = hypot(dx, dz), m = Math.max(1, Math.ceil(len / pl));
      total = Math.max(total, b.sl[s]! + len);
      for (let c = 0; c < m && npc < PC; c++, npc++) {
        qx0[npc] = b.x0[s]! + (dx * c) / m; qz0[npc] = b.z0[s]! + (dz * c) / m;
        qx1[npc] = b.x0[s]! + (dx * (c + 1)) / m; qz1[npc] = b.z0[s]! + (dz * (c + 1)) / m;
        ql0[npc] = b.sl[s]! + (len * c) / m; ql1[npc] = b.sl[s]! + (len * (c + 1)) / m; qp[npc] = b.sp[s]!;
      }
      ox0[s] = b.x0[s]!; oz0[s] = b.z0[s]!; ox1[s] = b.x1[s]!; oz1[s] = b.z1[s]!;
    }
    prevN = b.n;
    // What each part is hit by now; a part no longer hit goes dark at once.
    seen.fill(0);
    for (let q = 0; q < b.nh; q++) {
      const p = b.hp[q]!, s = b.hs[q]!, l = b.sl[s]! + hypot(b.x1[s]! - b.x0[s]!, b.z1[s]! - b.z0[s]!);
      if (!seen[p] || l < reachL[p]!) (reachL[p] = l), (rx[p] = b.hx[q]!), (rz[p] = b.hz[q]!);
      seen[p] = 1;
    }
    for (let p = 0; p < NP; p++) if (on[p] && !seen[p]) setOn(p, 0);
    ver = b.ver;
  }
  function setOn(p: number, v: number) {
    on[p] = v;
    if (v) reach[p] = TS[0]!;
    if (b.kind[p] === TARGET && o.light) o.light(p, !!v);
  }
  /** Pulse points, sparks and sort points for the frame at TS[0]. */
  function showAt() {
    const t = TS[0]!, dt = Math.max(0, t - TS[1]!);
    TS[1] = t;
    if (ver !== b.ver) rebuild();
    if (motion && TS[2]! < total) TS[2] = TS[2]! + speed * dt;
    const rv = TS[2]!, env = motion ? Math.max(0, 1 - (t - TS[3]!) / hold) : 0;
    TS[4] = env;
    let busy = motion && rv < total;
    for (let p = 0; p < NP; p++) if (seen[p] && !on[p] && rv >= reachL[p]! - 1e-9) setOn(p, 1);
    L[3] = by;
    // Each piece in the world, cut at the reveal (WP: start, end), and its sort point.
    for (let i = 0; i < npc; i++) {
      const l0 = ql0[i]!, l1 = ql1[i]!, u = rv >= l1 ? 1 : rv <= l0 ? 0 : (rv - l0) / (l1 - l0 || 1);
      L[0] = qx0[i]!; L[1] = qz0[i]!;
      world(0);
      WP[i * 6] = X[0]!; WP[i * 6 + 1] = X[1]!; WP[i * 6 + 2] = X[2]!;
      L[0] = qx0[i]! + (qx1[i]! - qx0[i]!) * u; L[1] = qz0[i]! + (qz1[i]! - qz0[i]!) * u;
      world(0);
      WP[i * 6 + 3] = X[0]!; WP[i * 6 + 4] = X[1]!; WP[i * 6 + 5] = X[2]!;
      L[0] = (qx0[i]! + qx1[i]!) / 2; L[1] = (qz0[i]! + qz1[i]!) / 2;
      world(0);
      at[i * 3] = X[0]!; at[i * 3 + 1] = X[1]!; at[i * 3 + 2] = X[2]!;
    }
    // The pulse: points every `gap` along each revealed piece, moving out from the emitter.
    let nd = 0;
    if (env > 0 && gap > 0)
      for (let i = 0; i < npc && nd < dots.x.length; i++) {
        const l0 = ql0[i]!, l1 = Math.min(ql1[i]!, rv), off = (t * pv) % gap;
        for (let l = Math.ceil((l0 - off) / gap) * gap + off; l < l1 && nd < dots.x.length; l += gap) {
          const u = (l - l0) / (ql1[i]! - l0 || 1);
          L[0] = qx0[i]! + (qx1[i]! - qx0[i]!) * u; L[1] = qz0[i]! + (qz1[i]! - qz0[i]!) * u;
          world(0);
          dots.x[nd] = X[0]!; dots.y[nd] = X[1]!; dots.z[nd] = X[2]!; dots.r[nd] = wd * 0.9; dots.a[nd++] = env * qp[i]!;
        }
      }
    dots.n = nd;
    if (env > 0) busy = true;
    // Sparks: a burst where a beam reaches a target or a blocker.
    let ns = 0;
    for (let p = 0; p < NP && motion; p++) {
      const age = t - reach[p]!, kd = b.kind[p];
      if (!on[p] || age >= life || (kd !== TARGET && kd !== BLOCKER)) continue;
      busy = true;
      for (let j = 0; j < SPK && ns < sparks.x.length; j++, ns++) {
        const hsh = Math.imul((p + 1) * 73856093 ^ (j + 1) * 19349663, 0x9e3779b1) >>> 0, an = (hsh / 4294967296) * 6.283185307179586, sv = 1.2 + ((hsh >>> 7) & 255) / 128;
        L[0] = rx[p]! + Math.cos(an) * sv * age; L[1] = rz[p]! + Math.sin(an) * sv * age; L[3] = by + age * (1.8 - age * 4);
        world(0);
        sparks.x[ns] = X[0]!; sparks.y[ns] = X[1]!; sparks.z[ns] = X[2]!; sparks.r[ns] = wd * 0.5; sparks.a[ns] = 1 - age / life;
      }
    }
    sparks.n = ns;
    on_ = 0;
    for (let p = 0; p < NP; p++) if (on[p] && b.kind[p] === TARGET) on_++;
    return busy;
  }
  return {
    /** Per part: 1 once the drawn beam reached it (a target's light). */
    on,
    /** Pieces drawn. */
    get pieces() {
      return npc;
    },
    /** Targets lit on screen. */
    get lit() {
      return on_;
    },
    /** The pulse points and sparks pools. */
    dots,
    sparks,
    /** Pose the beams at t (seconds, a running clock); true while anything still moves. */
    show(t: number) {
      TS[0] = t;
      return showAt();
    },
  };
}
/** What `dioramaBeam` returns. */
export type DioramaBeam = ReturnType<typeof dioramaBeam>;

/** B = diorama `d`'s camera as it draws: eye (0–2), right (3–5), up (6–8), forward (9–11), focal
 *  (12) and the screen centre (13, 14). */
function basis(d: Diorama, B: Float64Array) {
  const c = d.cam, cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), hh = d.height;
  B[0] = c.tx + c.dist * sy * cp; B[1] = c.ty + c.dist * sp; B[2] = c.tz + c.dist * cy * cp;
  B[3] = cy; B[4] = 0; B[5] = -sy;
  B[6] = -sy * sp; B[7] = cp; B[8] = -cy * sp;
  B[9] = -sy * cp; B[10] = -sp; B[11] = -cy * cp;
  B[12] = hh / 2 / Math.tan(c.fov / 2); B[13] = d.width / 2 + c.ox; B[14] = hh / 2 + c.oy;
}
/** Y[yi], Y[yi + 1] = world point X on screen under B (CSS px); Y[5] = its depth (a returned double would be boxed). */
function proj(B: Float64Array, X: Float64Array, Y: Float64Array, yi: number) {
  const dx = X[0]! - B[0]!, dy = X[1]! - B[1]!, dz = X[2]! - B[2]!, zz = dx * B[9]! + dy * B[10]! + dz * B[11]!, k = B[12]! / Math.max(zz, 0.05);
  Y[yi] = B[13]! + (dx * B[3]! + dy * B[4]! + dz * B[5]!) * k;
  Y[yi + 1] = B[14]! - (dx * B[6]! + dy * B[7]! + dz * B[8]!) * k;
  Y[5] = zz;
}
