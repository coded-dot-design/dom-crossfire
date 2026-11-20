/**
 * @fzlt/core/diorama: software 3D for cutaway tabletop scenes, drawn on a 2D canvas you own. A scene
 * is data: objects `{ id, shape, size, pos, rot, color, on }` where `on` names the object it rests on
 * (its `pos` is then from the parent's top centre, and it moves, tilts and sinks with it, its alpha
 * and tint inherited). Flat-shaded convex shapes (box with a face mask, wedge, cylinder or cone,
 * prism from an outline, group), one directional light, edge lines, blob shadows, picking.
 * - Painter's sort by cluster → layer → depth: a cluster is a group drawn together (fixed ranks
 *   first, then far to near by its anchor), a layer orders parts inside it, and depth orders the
 *   rest. `below` puts the faces under a cut plane on their own layer (hulls under water).
 * - Points (sparks, shells, smoke) and decals go into the same sort, so effects sit between faces;
 *   a pool with `rank: "depth"` sorts each point among the clusters by its own depth.
 * - Limits: faces are never split, so two faces that cross each other, or a big face beside a small
 *   one at the wrong depth, can draw in the wrong order: split them into parts, or order them with
 *   clusters and layers. A face with a vertex behind the camera is dropped, not clipped.
 * - Pools: there is no `remove`; add a fixed pool up front and let go of an object (a composite with
 *   its parts) with `ob.off = true`: its whole subtree stops drawing, shadowing, picking and costing
 *   matrix work. `hidden` hides the object alone (an invisible parent whose parts still show).
 * - No allocation per `draw()` in the steady state (typed arrays, a merge sort into fixed buffers,
 *   shades cached as strings). No DOM of its own and no clock: call `draw()` from the engine's render
 *   phase (`engine.add({ render: () => d.draw() })`) or on your own, and `resize()` after a resize.
 * Colours are `#rrggbb`. 2D lengths use steer's exact `hypot` (the builtin boxes its arguments).
 */
import { hypot } from "./steer";

/** The shapes: `box` (`mask` drops faces), `wedge` (a ramp, tall at −x), `cyl` (`sides`, `top`
 *  scale: 0 is a cone), `prism` (an `outline` of [x, z] points, `taper` scales its bottom) and `group`
 *  (no faces: a parent to move, tilt and tag a set of parts). */
export type DioramaShape = "box" | "wedge" | "cyl" | "prism" | "group";

/** One object to `add`. Sizes and positions are world units; y is up; the origin is the bottom centre. */
export interface DioramaObjectDef {
  /** A name for `get`, `on` and an `on` parent. */
  id?: string;
  /** The shape (default `box`). */
  shape?: DioramaShape;
  /** [width (x), height (y), depth (z)] (default [1, 1, 1]). */
  size?: ArrayLike<number>;
  /** Position: world, or from the parent's top centre when `on` is set. */
  pos?: ArrayLike<number>;
  /** Rotation in radians, [x, y, z], applied y, then x, then z. */
  rot?: ArrayLike<number>;
  /** `#rrggbb` (default `#cccccc`). */
  color?: string;
  /** 0..1, multiplied down through the children (default 1). */
  alpha?: number;
  /** A colour that replaces this object's and its children's (a hit flash, a selection). */
  tint?: string | null;
  /** Not drawn (its children still are: an invisible parent). */
  hidden?: boolean;
  /** Off with its whole subtree: none of them draw, cast a shadow or pick, and their matrices are not
   *  computed (`M` keeps its last value until it is on again). Let go of a pooled composite with it. */
  off?: boolean;
  /** The id of the object it rests on. */
  on?: string | null;
  /** Blob shadow strength on the parent's top, 0..1 (0: none); drawn on the parent's layer + 0.5. */
  shadow?: number;
  /** Order inside its cluster, 0..655 in steps of 0.01 (default: its parent's + 1, so what rests on
   *  something draws after it and its shadow, which sits at the parent's + 0.5; at the root, 4). */
  layer?: number;
  /** Faces whose centre is under the plane y draw on `layer` (a hull under the water line). */
  below?: { y: number; layer: number } | null;
  /** Layers it and its children drop by while it is on the far side of its parent: its place across
   *  the parent (`pos` x, z, turned with the parent) points away from the eye, along the ray from the
   *  eye to the parent (right anywhere on screen, not only in the middle). A wheel set above
   *  the body with `behind` past it draws over the body on the near side and under it on the far
   *  side, at any heading and view (default 0: off). */
  behind?: number;
  /** Its cluster's name; default: its parent's, or its own (anchored on itself) at the root. */
  cluster?: string;
  /** Full brightness: the light does not shade it (a lamp). */
  emissive?: boolean;
  /** `false`: `pick` passes through it. */
  pick?: boolean;
  /** Anything; `root()` climbs to the nearest tagged ancestor. */
  tag?: unknown;
  /** box: the faces kept, a bit mask (1 top, 2 bottom, 4 +x, 8 −x, 16 +z, 32 −z; default 63). */
  mask?: number;
  /** cyl: sides (default 10). */
  sides?: number;
  /** cyl: the top's scale (default 1; under 0.02, a cone). */
  top?: number;
  /** prism: the outline, [x, z] points. */
  outline?: ArrayLike<ArrayLike<number>>;
  /** prism: the bottom's scale (default 1). */
  taper?: number;
}

/** A live object: change `pos`, `rot`, `color`, `alpha`, `tint`, `hidden`, `off`, `shadow`, `layer`, `behind`
 *  between draws. `M` is its world matrix from the last draw it was on in (3 × 3 rotation row by row, then x, y, z). */
export interface DioramaObject {
  /** Its name, or null. */
  readonly id: string | null;
  /** Its shape. */
  readonly shape: DioramaShape;
  /** [w, h, d]. */
  readonly size: Float64Array;
  /** Position (see `DioramaObjectDef.pos`). */
  pos: Float64Array;
  /** Rotation, radians. */
  rot: Float64Array;
  /** `#rrggbb`. */
  color: string;
  /** 0..1. */
  alpha: number;
  /** Colour override for it and its children, or null. */
  tint: string | null;
  /** Not drawn (its children still are). */
  hidden: boolean;
  /** Off with its whole subtree: not drawn, no shadows, not picked, matrices not computed. */
  off: boolean;
  /** Blob shadow strength. */
  shadow: number;
  /** Order inside its cluster. */
  layer: number;
  /** The cut plane. */
  below: { y: number; layer: number } | null;
  /** Layers it drops by on the far side of its parent. */
  behind: number;
  /** Unshaded. */
  emissive: boolean;
  /** Pickable. */
  pick: boolean;
  /** Anything. */
  tag: unknown;
  /** The parent's id (change it with `on()`). */
  readonly on: string | null;
  /** The parent object. */
  readonly parent: DioramaObject | null;
  /** The world matrix from the last draw. */
  readonly M: Float64Array;
}

/** The orbit camera: it looks at (tx, ty, tz) from `dist` away, turned by `yaw` and raised by `pitch`
 *  (radians); `fov` is the vertical field of view; (ox, oy) shift the picture in CSS px. */
export interface DioramaCamera {
  /** Turn around the target (radians). */
  yaw: number;
  /** Look down from the horizon (radians; π/2 is straight down). */
  pitch: number;
  /** Distance to the target. */
  dist: number;
  /** Target x. */
  tx: number;
  /** Target y. */
  ty: number;
  /** Target z. */
  tz: number;
  /** Screen shift x, CSS px. */
  ox: number;
  /** Screen shift y, CSS px. */
  oy: number;
  /** Vertical field of view (radians). */
  fov: number;
}

/** A screen rectangle in CSS px: `fit` keeps every point inside it. */
export interface SafeRect {
  /** Left. */
  x0: number;
  /** Top. */
  y0: number;
  /** Right. */
  x1: number;
  /** Bottom. */
  y1: number;
}

/** `clamp` limits, each [min, max]. */
export interface CameraLimits {
  /** Yaw range. */
  yaw?: ArrayLike<number>;
  /** Pitch range. */
  pitch?: ArrayLike<number>;
  /** Distance range. */
  dist?: ArrayLike<number>;
}

/** Options for `points`: capacity, where they sort, their colour or their own painter. */
export interface PointsOptions {
  /** How many (fixed). */
  cap: number;
  /** The cluster they sort in (default: after every cluster, by depth among themselves). */
  cluster?: string;
  /** Their layer inside it (default 5). */
  layer?: number;
  /** `"depth"`: each point sorts among the clusters by its own depth, as if it were an unfixed
   *  cluster anchored on itself (debris behind a figure draws before it, in front after it);
   *  `cluster` is then ignored. Default: the pool sorts in one cluster. */
  rank?: "depth";
  /** Fill colour of the default disc (default `#ffffff`; `color[i]` overrides one). */
  color?: string;
  /** Paint point i yourself: its screen centre and radius are `sx[i]`, `sy[i]`, `sr[i]` (CSS px). */
  paint?: (ctx: CanvasRenderingContext2D, i: number, p: DioramaPoints) => void;
}

/** A fixed pool of points drawn in the depth sort: write `x`, `y`, `z` (world), `r` (world radius),
 *  `a` (alpha, 0 skips it) for 0 ≤ i < `n`, then draw. `sx`, `sy`, `sr` are their screen values. */
export interface DioramaPoints {
  /** Live count: points 0..n−1 draw. */
  n: number;
  /** World x. */
  readonly x: Float64Array;
  /** World y. */
  readonly y: Float64Array;
  /** World z. */
  readonly z: Float64Array;
  /** World radius. */
  readonly r: Float64Array;
  /** Alpha (starts at 1). */
  readonly a: Float64Array;
  /** Per-point fill, or undefined for the pool's colour. */
  readonly color: (string | undefined)[];
  /** Screen x from the last draw. */
  readonly sx: Float64Array;
  /** Screen y from the last draw. */
  readonly sy: Float64Array;
  /** Screen radius from the last draw. */
  readonly sr: Float64Array;
  /** The cluster they sort in, or null. */
  cluster: string | null;
  /** Their layer. */
  layer: number;
  /** `"depth"`: each point ranks among the clusters by its depth; null: in `cluster`. */
  rank: "depth" | null;
  /** The default disc colour. */
  colorAll: string;
  /** A custom painter, or null. */
  paint: PointsOptions["paint"] | null;
}

/** Options for `diorama`: light, background, overlay, edges and capacities. */
export interface DioramaOptions {
  /** The light's direction (towards the light; default [0.5, 1, 0.4]). */
  light?: ArrayLike<number>;
  /** Ambient light, 0..1 (default 0.56). */
  ambient?: number;
  /** Clear colour each draw (a string, or a function read each draw); none: transparent. */
  background?: string | (() => string);
  /** Shadow colour (default `#000000`); a getter is read each draw. */
  shadowColor?: string;
  /** Edge lines (default true). */
  edge?: boolean;
  /** Paint over the finished frame (HUD, cursors): `overlay(ctx, d)`. */
  overlay?: (ctx: CanvasRenderingContext2D, d: Diorama) => void;
  /** The most pixel density drawn (default 2). */
  maxDpr?: number;
  /** Vertex capacity (default 16384; `add` throws past it). */
  maxVerts?: number;
  /** Faces, shadows, points and decals per frame (default 8192; past it they are dropped and counted). */
  maxFaces?: number;
  /** Blob shadows per frame (default 512). */
  maxShadows?: number;
}

interface Mesh { nv: number; v: Float64Array; nf: number; fs: Int32Array; fc: Int32Array; fv: Int32Array; nrm: Float64Array; cen: Float64Array }
interface Cluster { name: string; fixed: number | null; at: ArrayLike<number> | null; follow: Obj | null; ci: number }
interface Obj extends DioramaObject {
  on: string | null; parent: Obj | null; mesh: Mesh; vb: number; top: number; i: number; cl: Cluster | null; clName: string | null;
  sq: boolean; et: string | null;
}
interface Decal { cl: string; layer: number; fn: (ctx: CanvasRenderingContext2D) => void; at: ArrayLike<number> | null }

const TAU = 6.283185307179586;
/** `#rrggbb` darkened (b < 1) or lifted toward white (b > 1), as an rgb() string. */
function rgb(col: string, b: number) {
  const n = parseInt(col.slice(1), 16), f = (c: number) => (b <= 1 ? c * b : c + (255 - c) * (b - 1) * 0.9) | 0;
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

// ---- meshes (local space, origin at the bottom centre, y up; faces turned to point outward) ----
function mk(V: number[][], F: number[][]): Mesh {
  const nv = V.length, v = new Float64Array(nv * 3);
  let mx = 0, my = 0, mz = 0, tot = 0, k = 0;
  V.forEach((p, i) => { v[i * 3] = p[0]!; v[i * 3 + 1] = p[1]!; v[i * 3 + 2] = p[2]!; mx += p[0]! / nv; my += p[1]! / nv; mz += p[2]! / nv; });
  F.forEach((f) => (tot += f.length));
  const nf = F.length, fs = new Int32Array(nf), fc = new Int32Array(nf), fv = new Int32Array(tot), nrm = new Float64Array(nf * 3), cen = new Float64Array(nf * 3);
  F.forEach((f, i) => {
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    const c = f.length;
    for (let j = 0; j < c; j++) {
      const a = V[f[j]!]!, b = V[f[(j + 1) % c]!]!;
      // Newell's normal: exact for a planar polygon, any winding.
      nx += (a[1]! - b[1]!) * (a[2]! + b[2]!); ny += (a[2]! - b[2]!) * (a[0]! + b[0]!); nz += (a[0]! - b[0]!) * (a[1]! + b[1]!);
      cx += a[0]! / c; cy += a[1]! / c; cz += a[2]! / c;
    }
    if (nx * (cx - mx) + ny * (cy - my) + nz * (cz - mz) < 0) (f = f.slice().reverse()), (nx = -nx), (ny = -ny), (nz = -nz);
    const l = len3(nx, ny, nz) || 1;
    nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
    cen[i * 3] = cx; cen[i * 3 + 1] = cy; cen[i * 3 + 2] = cz;
    fs[i] = k; fc[i] = c;
    for (const vi of f) fv[k++] = vi;
  });
  return { nv, v, nf, fs, fc, fv, nrm, cen };
}
function shapeMesh(d: DioramaObjectDef, s: Float64Array): Mesh {
  const w = s[0]!, h = s[1]!, dd = s[2]!, x = w / 2, z = dd / 2, V: number[][] = [], F: number[][] = [];
  switch (d.shape) {
    case "group": break;
    case "wedge":
      V.push([-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [-x, h, -z], [-x, h, z]);
      F.push([0, 1, 2, 3], [0, 3, 5, 4], [1, 4, 5, 2], [0, 1, 4], [3, 2, 5]);
      break;
    case "cyl": {
      const n = d.sides || 10, t = d.top ?? 1, bot: number[] = [], top: number[] = [];
      for (let i = 0; i < n; i++) { const a = ((i + 0.5) / n) * TAU; V.push([Math.cos(a) * x, 0, Math.sin(a) * z]); bot.push(i); }
      if (t < 0.02) { V.push([0, h, 0]); for (let i = 0; i < n; i++) F.push([i, (i + 1) % n, n]); }
      else {
        for (let i = 0; i < n; i++) { V.push([V[i]![0]! * t, h, V[i]![2]! * t]); top.push(n + i); F.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]); }
        F.push(top);
      }
      F.push(bot);
      break;
    }
    case "prism": {
      const p = d.outline!, t = d.taper ?? 1, n = p.length, bot: number[] = [], top: number[] = [];
      for (let i = 0; i < n; i++) { V.push([p[i]![0]! * t, 0, p[i]![1]! * t]); bot.push(i); }
      for (let i = 0; i < n; i++) { V.push([p[i]![0]!, h, p[i]![1]!]); top.push(n + i); F.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]); }
      F.push(top, bot);
      break;
    }
    default: {
      const m = d.mask ?? 63;
      V.push([-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z]);
      [[4, 5, 6, 7], [0, 1, 2, 3], [1, 2, 6, 5], [0, 3, 7, 4], [3, 2, 6, 7], [0, 1, 5, 4]].forEach((f, i) => m & (1 << i) && F.push(f));
    }
  }
  return mk(V, F);
}

/** A diorama on `canvas`: `add` objects, aim `cam` (or `fit` it), then `draw()`. It never touches
 *  the DOM beyond the canvas's backing store (`resize`), and allocates nothing per draw. */
export function diorama(canvas: HTMLCanvasElement, o: DioramaOptions = {}) {
  const bg = o.background, ctx = canvas.getContext("2d", { alpha: !bg })!;
  const MAXV = o.maxVerts ?? 16384, MAXF = o.maxFaces ?? 8192, MAXS = o.maxShadows ?? 512, SHN = 14, maxDpr = o.maxDpr ?? 2;
  // Screen vertices (x, y, view depth) per object's slice; per-entry sort keys and what to paint.
  const SV = new Float64Array(MAXV * 3), KA = new Float64Array(MAXF), KD = new Float64Array(MAXF);
  const KIND = new Uint8Array(MAXF), FOBJ = new Int32Array(MAXF), FIDX = new Int32Array(MAXF), FLVL = new Uint8Array(MAXF);
  const O1 = new Uint32Array(MAXF), O2 = new Uint32Array(MAXF), SHP = new Float64Array(MAXS * 2 * SHN), SHA = new Float64Array(MAXS);
  // B: eye (0-2), right (3-5), up (6-8), forward (9-11), focal (12). C: the camera B was made from.
  const B = new Float64Array(13), FB = new Float64Array(13), C = new Float64Array(10), T = new Float64Array(3), Q = new Float64Array(3), BOX = new Float64Array(4), L = new Float64Array(3);
  const objs: Obj[] = [], order: Obj[] = [], byId = new Map<string, Obj>(), clusters = new Map<string, Cluster>(), clist: Cluster[] = [];
  const decals: Decal[] = [], pools: DioramaPoints[] = [], meshes = new Map<string, Mesh>(), SHADES = new Map<string, string[]>();
  let EA = new Float64Array(64), SH = new Float64Array(64), CD = new Float64Array(16), CR = new Int32Array(16), ORD = O1;
  let amb = 0.56, nf = 0, nv = 0, W = 1, H = 1, dpr = 1;
  const cam: DioramaCamera = { yaw: -0.5, pitch: 0.85, dist: 30, tx: 0, ty: 0, tz: 0, ox: 0, oy: 0, fov: 0.62 };
  const stats = { faces: 0, shadows: 0, points: 0, verts: 0, objects: 0, dropped: 0 };

  function setLight(v: ArrayLike<number>, a = amb) {
    const l = len3(v[0]!, v[1]!, v[2]!) || 1;
    L[0] = v[0]! / l; L[1] = v[1]! / l; L[2] = v[2]! / l;
    amb = a;
  }
  setLight(o.light || [0.5, 1, 0.4], o.ambient ?? 0.56);

  // ---- scene ----
  function add(d: DioramaObjectDef): DioramaObject {
    const shape = d.shape || "box", size = new Float64Array(d.size || [1, 1, 1]), on = d.on || null;
    const k = shape + size.join() + "|" + d.sides + "|" + d.top + "|" + d.mask + "|" + d.taper + (d.outline ? JSON.stringify(Array.from(d.outline, (p) => Array.from(p))) : "");
    let mesh = meshes.get(k);
    if (!mesh) meshes.set(k, (mesh = shapeMesh({ ...d, shape }, size)));
    if (nv + mesh.nv > MAXV) throw new RangeError("diorama: more vertices than maxVerts");
    const ob: Obj = {
      id: d.id ?? null, shape, size, pos: Float64Array.from(d.pos || [0, 0, 0]), rot: Float64Array.from(d.rot || [0, 0, 0]), color: d.color || "#cccccc",
      alpha: d.alpha ?? 1, tint: d.tint ?? null, hidden: !!d.hidden, off: !!d.off, shadow: d.shadow || 0, layer: d.layer ?? (on && byId.has(on) ? byId.get(on)!.layer + 1 : 4), below: d.below || null, behind: d.behind || 0,
      emissive: !!d.emissive, pick: d.pick !== false, tag: d.tag ?? null, on, parent: null, M: new Float64Array(12),
      mesh, vb: nv, top: shape === "group" ? 0 : size[1]!, i: objs.length, cl: null, clName: d.cluster || null, sq: shape === "box", et: null,
    };
    nv += mesh.nv;
    if (objs.length >= EA.length) { const e = new Float64Array(EA.length * 2); e.set(EA); EA = e; SH = new Float64Array(EA.length); }
    if (ob.clName && !clusters.has(ob.clName)) cluster(ob.clName, {}, ob);
    objs.push(ob);
    if (ob.id) byId.set(ob.id, ob);
    relink();
    return ob;
  }
  /** Parents before children (one pass computes every world matrix); clusters resolved. */
  function relink() {
    order.length = 0;
    const seen = new Set<Obj>();
    const visit = (ob: Obj) => {
      if (seen.has(ob)) return;
      seen.add(ob);
      if (ob.parent) visit(ob.parent);
      order.push(ob);
    };
    for (const ob of objs) ob.parent = (ob.on && byId.get(ob.on)) || null;
    objs.forEach(visit);
    for (const ob of order) {
      if (ob.clName) ob.cl = clusters.get(ob.clName)!;
      else if (ob.parent) ob.cl = ob.parent.cl;
      else {
        const n = "@" + (ob.id || ob.i);
        if (!clusters.has(n)) cluster(n, {}, ob);
        ob.cl = clusters.get(n)!;
      }
    }
  }
  function cluster(name: string, c: { fixed?: number; at?: ArrayLike<number> }, follow: Obj | null = null) {
    const old = clusters.get(name), cl: Cluster = old || { name, fixed: null, at: null, follow, ci: clist.length };
    cl.fixed = c.fixed ?? null;
    cl.at = c.at || null;
    if (c.at || c.fixed != null) cl.follow = null;
    if (!old) {
      clusters.set(name, cl);
      clist.push(cl);
      if (clist.length > CD.length) { const d = new Float64Array(CD.length * 2), r = new Int32Array(CD.length * 2); d.set(CD); r.set(CR); CD = d; CR = r; }
    }
  }
  function clear() {
    objs.length = order.length = clist.length = decals.length = pools.length = 0;
    byId.clear();
    clusters.clear();
    nv = nf = 0;
  }

  // ---- camera ----
  function basisOf(c: DioramaCamera, b: Float64Array) {
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    b[0] = c.tx + c.dist * sy * cp; b[1] = c.ty + c.dist * sp; b[2] = c.tz + c.dist * cy * cp;
    const fx = -sy * cp, fy = -sp, fz = -cy * cp, rx = cy, rz = -sy; // forward; right stays level (any pitch)
    b[3] = rx; b[4] = 0; b[5] = rz;
    b[6] = -rz * fy; b[7] = rz * fx - rx * fz; b[8] = rx * fy; // up = right × forward
    b[9] = fx; b[10] = fy; b[11] = fz;
    b[12] = H / 2 / Math.tan(c.fov / 2);
  }
  /** The basis for `cam`, rebuilt only when the camera or the canvas height changed. */
  function sync() {
    if (C[0] !== cam.yaw || C[1] !== cam.pitch || C[2] !== cam.dist || C[3] !== cam.tx || C[4] !== cam.ty || C[5] !== cam.tz || C[6] !== cam.fov || C[7] !== H) {
      C[0] = cam.yaw; C[1] = cam.pitch; C[2] = cam.dist; C[3] = cam.tx; C[4] = cam.ty; C[5] = cam.tz; C[6] = cam.fov; C[7] = H;
      basisOf(cam, B);
    }
  }
  function proj(b: Float64Array, c: DioramaCamera, x: number, y: number, z: number, out: { [i: number]: number }) {
    const dx = x - b[0]!, dy = y - b[1]!, dz = z - b[2]!, zz = dx * b[9]! + dy * b[10]! + dz * b[11]!, k = b[12]! / Math.max(zz, 0.05);
    out[0] = W / 2 + c.ox + (dx * b[3]! + dy * b[4]! + dz * b[5]!) * k;
    out[1] = H / 2 + c.oy - (dx * b[6]! + dy * b[7]! + dz * b[8]!) * k;
    out[2] = zz;
    return zz > 0.05;
  }
  /** BOX = the screen box of `pts` under camera c; false if one is behind it. */
  function bbox(c: DioramaCamera, pts: ArrayLike<number>) {
    basisOf(c, FB);
    BOX[0] = BOX[1] = Infinity;
    BOX[2] = BOX[3] = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      if (!proj(FB, c, pts[i]!, pts[i + 1]!, pts[i + 2]!, T)) return false;
      BOX[0] = Math.min(BOX[0]!, T[0]!); BOX[1] = Math.min(BOX[1]!, T[1]!); BOX[2] = Math.max(BOX[2]!, T[0]!); BOX[3] = Math.max(BOX[3]!, T[1]!);
    }
    return true;
  }
  function fit(c: DioramaCamera, pts: ArrayLike<number>, s: SafeRect) {
    const sw = s.x1 - s.x0, sh = s.y1 - s.y0;
    const ok = (d: number) => ((c.dist = d), bbox(c, pts) && BOX[2]! - BOX[0]! <= sw && BOX[3]! - BOX[1]! <= sh);
    let lo = 0, hi = Math.max(1, c.dist);
    while (!ok(hi) && hi < 1e7) (lo = hi), (hi *= 2);
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; ok(m) ? (hi = m) : (lo = m); }
    c.ox = c.oy = 0;
    ok(hi);
    c.ox = (s.x0 + s.x1 - BOX[0]! - BOX[2]!) / 2;
    c.oy = (s.y0 + s.y1 - BOX[1]! - BOX[3]!) / 2;
    return c;
  }
  const lim = (v: number, r: ArrayLike<number> | undefined) => (r ? Math.min(r[1]!, Math.max(r[0]!, v)) : v);
  function clamp(l: CameraLimits, c = cam) {
    c.yaw = lim(c.yaw, l.yaw);
    c.pitch = lim(c.pitch, l.pitch);
    c.dist = lim(c.dist, l.dist);
    return c;
  }

  // ---- colour: 41 shades per colour, made once as strings (never per frame) ----
  function shade(col: string, lvl: number) {
    let a = SHADES.get(col);
    if (!a) SHADES.set(col, (a = []));
    return a[lvl] || (a[lvl] = rgb(col, 0.5 + (lvl / 40) * 0.62));
  }

  // ---- frame ----
  function resize(w?: number, h?: number, r?: number) {
    w = w || canvas.clientWidth || 1;
    h = h || canvas.clientHeight || 1;
    r = Math.min(maxDpr, r || globalThis.devicePixelRatio || 1);
    if (w !== W || h !== H || r !== dpr) {
      W = w; H = h; dpr = r;
      canvas.width = Math.round(w * r);
      canvas.height = Math.round(h * r);
    }
  }
  /** a draws before b: lower cluster rank, then lower layer, then farther; ties keep submission order. */
  const before = (a: number, b: number) => KA[a]! < KA[b]! || (KA[a] === KA[b] && KD[a]! > KD[b]!);
  /** A stable merge sort of 0..n−1 into O1/O2 (insertion-sorted runs of 8 first): no allocation. */
  function sortKeys(n: number) {
    let a = O1, b = O2;
    for (let i = 0; i < n; i++) a[i] = i;
    for (let s = 0; s < n; s += 8)
      for (let i = s + 1, e = Math.min(n, s + 8); i < e; i++) {
        const x = a[i]!;
        let j = i - 1;
        for (; j >= s && before(x, a[j]!); j--) a[j + 1] = a[j]!;
        a[j + 1] = x;
      }
    for (let w = 8; w < n; w *= 2) {
      for (let lo = 0; lo < n; lo += 2 * w) {
        const mid = Math.min(n, lo + w), hi = Math.min(n, lo + 2 * w);
        let i = lo, j = mid, k = lo;
        while (i < mid && j < hi) b[k++] = before(a[j]!, a[i]!) ? a[j++]! : a[i++]!;
        while (i < mid) b[k++] = a[i++]!;
        while (j < hi) b[k++] = a[j++]!;
      }
      const t = a;
      a = b;
      b = t;
    }
    ORD = a;
  }
  // The frame runs in phases, each its own small function: a double passed to or returned from a call
  // the JIT does not inline is boxed (a heap number), so the hot loops take their inputs from typed
  // arrays (Q in, T out) and every call between phases carries small integers only.
  const keyA = (rank: number, layer: number) => (rank * 65536 + Math.max(0, Math.min(65535, Math.round(layer * 100)))) | 0; // an int: never boxed
  /** Queue one entry and return its index, or −1 when full (counted in stats.dropped). Its depth goes in KD. */
  function slot(kind: number, ka: number, ob: number, idx: number) {
    if (nf >= MAXF) return stats.dropped++, -1;
    KIND[nf] = kind; KA[nf] = ka; FOBJ[nf] = ob; FIDX[nf] = idx;
    return nf++;
  }
  /** T = Q (world) on screen, under `cam`; false behind the camera. */
  function projQ() {
    const dx = Q[0]! - B[0]!, dy = Q[1]! - B[1]!, dz = Q[2]! - B[2]!, zz = dx * B[9]! + dy * B[10]! + dz * B[11]!, k = B[12]! / Math.max(zz, 0.05);
    T[0] = W / 2 + cam.ox + (dx * B[3]! + dy * B[4]! + dz * B[5]!) * k;
    T[1] = H / 2 + cam.oy - (dx * B[6]! + dy * B[7]! + dz * B[8]!) * k;
    T[2] = zz;
    return zz > 0.05;
  }
  /** The view depth of Q. */
  const depthQ = () => (Q[0]! - B[0]!) * B[9]! + (Q[1]! - B[1]!) * B[10]! + (Q[2]! - B[2]!) * B[11]!;
  // Cluster i in draw order ranks 2i; the odd ranks between are for depth-ranked points.
  const rankOf = (name: string | null) => { const c = name ? clusters.get(name) : undefined; return c ? CR[c.ci]! : clist.length * 2; };
  /** A depth-ranked point at view depth T[2]: the odd rank after every cluster drawn before it
   *  (fixed ones, and unfixed ones at least as far); a binary search, clist being in draw order. */
  function rankT() {
    let lo = 0, hi = clist.length;
    while (lo < hi) { const m = (lo + hi) >> 1, c = clist[m]!; c.fixed != null || CD[c.ci]! >= T[2]! ? (lo = m + 1) : (hi = m); }
    return lo * 2 - 1;
  }
  const N = new Int32Array(5); // faces, shadows, points, verts, objects this frame

  /** 1) World matrices, parents first: R = Rparent · (Ry Rx Rz); t = tparent + Rparent · (pos + parent's top).
   *  An `off` object and its subtree are skipped: alpha −1 marks them for every later pass. */
  function matrices() {
    for (let n = 0; n < order.length; n++) {
      const ob = order[n]!, r = ob.rot, m = ob.M, p = ob.parent;
      if (ob.off || (p && EA[p.i]! < 0)) { EA[ob.i] = -1; continue; }
      N[4] = N[4]! + 1;
      const cx = Math.cos(r[0]!), sx = Math.sin(r[0]!), cy = Math.cos(r[1]!), sy = Math.sin(r[1]!), cz = Math.cos(r[2]!), sz = Math.sin(r[2]!);
      const a00 = cy, a01 = sy * sx, a02 = sy * cx, a11 = cx, a12 = -sx, a20 = -sy, a21 = cy * sx, a22 = cy * cx;
      const l00 = cz * a00 + sz * a01, l10 = sz * a11, l20 = cz * a20 + sz * a21;
      const l01 = -sz * a00 + cz * a01, l11 = cz * a11, l21 = -sz * a20 + cz * a21;
      const px = ob.pos[0]!, py = ob.pos[1]! + (p ? p.top : 0), pz = ob.pos[2]!;
      if (p) {
        const q = p.M;
        m[0] = q[0]! * l00 + q[1]! * l10 + q[2]! * l20; m[1] = q[0]! * l01 + q[1]! * l11 + q[2]! * l21; m[2] = q[0]! * a02 + q[1]! * a12 + q[2]! * a22;
        m[3] = q[3]! * l00 + q[4]! * l10 + q[5]! * l20; m[4] = q[3]! * l01 + q[4]! * l11 + q[5]! * l21; m[5] = q[3]! * a02 + q[4]! * a12 + q[5]! * a22;
        m[6] = q[6]! * l00 + q[7]! * l10 + q[8]! * l20; m[7] = q[6]! * l01 + q[7]! * l11 + q[8]! * l21; m[8] = q[6]! * a02 + q[7]! * a12 + q[8]! * a22;
        m[9] = q[9]! + q[0]! * px + q[1]! * py + q[2]! * pz; m[10] = q[10]! + q[3]! * px + q[4]! * py + q[5]! * pz; m[11] = q[11]! + q[6]! * px + q[7]! * py + q[8]! * pz;
        EA[ob.i] = EA[p.i]! * ob.alpha;
        ob.et = ob.tint || p.et;
      } else {
        m[0] = l00; m[1] = l01; m[2] = a02; m[3] = l10; m[4] = l11; m[5] = a12; m[6] = l20; m[7] = l21; m[8] = a22; m[9] = px; m[10] = py; m[11] = pz;
        EA[ob.i] = ob.alpha;
        ob.et = ob.tint;
      }
    }
  }
  /** 2) Cluster ranks: fixed ones first (by `fixed`), then far to near by their anchor's depth. */
  function ranks() {
    for (let i = 0; i < clist.length; i++) {
      const c = clist[i]!, f = c.follow, a = c.at;
      if (c.fixed != null) { CD[c.ci] = c.fixed; continue; }
      if (f) (Q[0] = f.M[9]!), (Q[1] = f.M[10]!), (Q[2] = f.M[11]!);
      else if (a) (Q[0] = a[0]!), (Q[1] = a[1]!), (Q[2] = a[2]!);
      else Q[0] = Q[1] = Q[2] = 0;
      CD[c.ci] = depthQ();
    }
    for (let i = 1; i < clist.length; i++) {
      const c = clist[i]!;
      let j = i - 1;
      for (; j >= 0 && clusterBefore(c, clist[j]!); j--) clist[j + 1] = clist[j]!;
      clist[j + 1] = c;
    }
    for (let i = 0; i < clist.length; i++) CR[clist[i]!.ci] = i * 2;
  }
  /** 3) Vertices to screen; faces to keys (back faces and faces reaching behind the camera dropped).
   *  SH: each object's layer drop (`behind`, summed down the tree), parents first. */
  function faces() {
    for (let n = 0; n < order.length; n++) {
      const ob = order[n]!, me = ob.mesh, p = ob.parent, px = ob.pos[0]!, pz = ob.pos[2]!;
      let sh = p ? SH[p.i]! : 0;
      if (ob.behind && p) {
        const q = p.M;
        // Along the ray from the eye to the parent (not the camera's axis: off the middle of the picture it differs).
        if ((q[0]! * px + q[2]! * pz) * (q[9]! - B[0]!) + (q[3]! * px + q[5]! * pz) * (q[10]! - B[1]!) + (q[6]! * px + q[8]! * pz) * (q[11]! - B[2]!) > 0) sh += ob.behind;
      }
      SH[ob.i] = sh;
      if (ob.hidden || !me.nf || EA[ob.i]! <= 0.01) continue;
      const m = ob.M, v = me.v, base = ob.vb * 3, rank = ob.cl ? CR[ob.cl.ci]! : 0, bl = ob.below;
      N[3] = N[3]! + me.nv;
      for (let i = 0; i < me.nv; i++) {
        const x = v[i * 3]!, y = v[i * 3 + 1]!, z = v[i * 3 + 2]!;
        Q[0] = m[0]! * x + m[1]! * y + m[2]! * z + m[9]!;
        Q[1] = m[3]! * x + m[4]! * y + m[5]! * z + m[10]!;
        Q[2] = m[6]! * x + m[7]! * y + m[8]! * z + m[11]!;
        projQ();
        SV[base + i * 3] = T[0]!; SV[base + i * 3 + 1] = T[1]!; SV[base + i * 3 + 2] = T[2]!;
      }
      for (let f = 0; f < me.nf; f++) {
        const nx0 = me.nrm[f * 3]!, ny0 = me.nrm[f * 3 + 1]!, nz0 = me.nrm[f * 3 + 2]!, cx0 = me.cen[f * 3]!, cy0 = me.cen[f * 3 + 1]!, cz0 = me.cen[f * 3 + 2]!;
        const nx = m[0]! * nx0 + m[1]! * ny0 + m[2]! * nz0, ny = m[3]! * nx0 + m[4]! * ny0 + m[5]! * nz0, nz = m[6]! * nx0 + m[7]! * ny0 + m[8]! * nz0;
        const wy = m[3]! * cx0 + m[4]! * cy0 + m[5]! * cz0 + m[10]!;
        const vx = m[0]! * cx0 + m[1]! * cy0 + m[2]! * cz0 + m[9]! - B[0]!, vy = wy - B[1]!, vz = m[6]! * cx0 + m[7]! * cy0 + m[8]! * cz0 + m[11]! - B[2]!;
        if (nx * vx + ny * vy + nz * vz >= 0) continue;
        const s0 = me.fs[f]!, c = me.fc[f]!;
        let k = 0;
        while (k < c && SV[base + me.fv[s0 + k]! * 3 + 2]! >= 0.1) k++;
        if (k < c) continue;
        const e = slot(0, keyA(rank, (bl && wy < bl.y ? bl.layer : ob.layer) - sh), ob.i, f);
        if (e < 0) continue;
        KD[e] = vx * B[9]! + vy * B[10]! + vz * B[11]!;
        FLVL[e] = Math.round((ob.emissive ? 1 : amb + (1 - amb) * Math.max(0, nx * L[0]! + ny * L[1]! + nz * L[2]!)) * 32);
        N[0] = N[0]! + 1;
      }
    }
  }
  /** 4) Blob shadows on the parent's top plane, in the parent's frame (a tilted parent tilts them): a
   *  soft superellipse under a box, an ellipse otherwise; they lift, grow and fade with height. */
  function shadows() {
    for (let n = 0; n < order.length; n++) {
      const ob = order[n]!, p = ob.parent, ea = EA[ob.i]!, s = N[1]!;
      if (!ob.shadow || ob.hidden || !p || ea <= 0.01 || s >= MAXS) continue;
      const m = ob.M, q = p.M, dx = m[9]! - q[9]!, dy = m[10]! - q[10]!, dz = m[11]! - q[11]!;
      // The object's centre and its x axis in the parent's frame (q's rotation is orthonormal: inverse = transpose).
      const lx = q[0]! * dx + q[3]! * dy + q[6]! * dz, lift = Math.max(0, q[1]! * dx + q[4]! * dy + q[7]! * dz - p.top), lz = q[2]! * dx + q[5]! * dy + q[8]! * dz;
      const fade = 1 - lift / 2.5;
      if (fade <= 0) continue;
      let ax = q[0]! * m[0]! + q[3]! * m[3]! + q[6]! * m[6]!, az = q[2]! * m[0]! + q[5]! * m[3]! + q[8]! * m[6]!;
      const al = hypot(ax, az) || 1;
      ax /= al; az /= al;
      const rx = ob.size[0]! / 2 + 0.06 + lift * 0.1, rz = ob.size[2]! / 2 + 0.06 + lift * 0.1, ox = lx + lift * 0.18, oz = lz - lift * 0.1, gy = p.top + 0.004;
      let ok = true;
      for (let k = 0; k < SHN; k++) {
        const a = (k / SHN) * TAU;
        let c = Math.cos(a), si = Math.sin(a);
        if (ob.sq) (c = Math.sign(c) * Math.abs(c) ** 0.35), (si = Math.sign(si) * Math.abs(si) ** 0.35);
        const px = ox + ax * rx * c - az * rz * si, pz = oz + az * rx * c + ax * rz * si;
        Q[0] = q[0]! * px + q[1]! * gy + q[2]! * pz + q[9]!;
        Q[1] = q[3]! * px + q[4]! * gy + q[5]! * pz + q[10]!;
        Q[2] = q[6]! * px + q[7]! * gy + q[8]! * pz + q[11]!;
        if (!projQ()) ok = false;
        SHP[(s * SHN + k) * 2] = T[0]!;
        SHP[(s * SHN + k) * 2 + 1] = T[1]!;
      }
      if (!ok) continue;
      const e = slot(1, keyA(p.cl ? CR[p.cl.ci]! : 0, p.layer + 0.5 - SH[p.i]!), ob.i, s);
      if (e < 0) continue;
      Q[0] = q[9]! + q[0]! * ox + q[1]! * gy + q[2]! * oz;
      Q[1] = q[10]! + q[3]! * ox + q[4]! * gy + q[5]! * oz;
      Q[2] = q[11]! + q[6]! * ox + q[7]! * gy + q[8]! * oz;
      KD[e] = depthQ();
      SHA[s] = ob.shadow * ea * fade;
      N[1] = s + 1;
    }
  }
  /** 5) Points (effects) and decals, in the same sort. */
  function extras() {
    for (let g = 0; g < pools.length; g++) {
      const P = pools[g]!, ka = keyA(rankOf(P.cluster), P.layer);
      for (let i = 0; i < P.n; i++) {
        if (P.a[i]! <= 0) continue;
        Q[0] = P.x[i]!; Q[1] = P.y[i]!; Q[2] = P.z[i]!;
        if (!projQ()) continue;
        const e = slot(2, P.rank ? keyA(rankT(), P.layer) : ka, g, i);
        if (e < 0) continue;
        P.sx[i] = T[0]!; P.sy[i] = T[1]!; P.sr[i] = (P.r[i]! * B[12]!) / T[2]!;
        KD[e] = T[2]!;
        N[2] = N[2]! + 1;
      }
    }
    for (let i = 0; i < decals.length; i++) {
      const dc = decals[i]!, a = dc.at, e = slot(3, keyA(rankOf(dc.cl), dc.layer), 0, i);
      if (e < 0) continue;
      if (a) (Q[0] = a[0]!), (Q[1] = a[1]!), (Q[2] = a[2]!), (KD[e] = depthQ());
      else KD[e] = Infinity;
    }
  }
  /** 6) Paint, back to front. */
  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    if (bg) (ctx.fillStyle = typeof bg === "function" ? bg() : bg), ctx.fillRect(0, 0, W, H);
    else ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = "round";
    for (let q = 0; q < nf; q++) {
      const e = ORD[q]!, kind = KIND[e];
      if (kind === 3) (ctx.globalAlpha = 1), decals[FIDX[e]!]!.fn(ctx);
      else if (kind === 2) {
        const P = pools[FOBJ[e]!]!, i = FIDX[e]!;
        ctx.globalAlpha = P.a[i]!;
        if (P.paint) P.paint(ctx, i, P);
        else (ctx.fillStyle = P.color[i] || P.colorAll), ctx.beginPath(), ctx.arc(P.sx[i]!, P.sy[i]!, P.sr[i]!, 0, TAU), ctx.fill();
      } else if (kind === 1) {
        const s = FIDX[e]!, j0 = s * SHN * 2;
        ctx.globalAlpha = SHA[s]!;
        ctx.beginPath();
        for (let k = 0; k < SHN; k++) k ? ctx.lineTo(SHP[j0 + k * 2]!, SHP[j0 + k * 2 + 1]!) : ctx.moveTo(SHP[j0]!, SHP[j0 + 1]!);
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle = o.shadowColor || "#000000";
        ctx.fill();
        ctx.globalAlpha = SHA[s]! * 0.45;
        ctx.lineWidth = 5;
        ctx.stroke();
      } else {
        const ob = objs[FOBJ[e]!]!, me = ob.mesh, f = FIDX[e]!, s0 = me.fs[f]!, c = me.fc[f]!, base = ob.vb * 3, ea = EA[ob.i]!;
        ctx.globalAlpha = ea;
        ctx.beginPath();
        for (let k = 0; k < c; k++) { const j = base + me.fv[s0 + k]! * 3; k ? ctx.lineTo(SV[j]!, SV[j + 1]!) : ctx.moveTo(SV[j]!, SV[j + 1]!); }
        ctx.closePath();
        const col = ob.et || ob.color, lv = FLVL[e]!;
        ctx.fillStyle = shade(col, lv);
        ctx.fill();
        if (o.edge !== false && ea > 0.95) (ctx.strokeStyle = shade(col, lv > 5 ? lv - 5 : 0)), (ctx.lineWidth = 0.9), ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  function draw() {
    sync();
    nf = stats.dropped = N[0] = N[1] = N[2] = N[3] = N[4] = 0;
    matrices();
    ranks();
    faces();
    shadows();
    extras();
    sortKeys(nf);
    paint();
    if (o.overlay) o.overlay(ctx, api);
    stats.faces = N[0]!;
    stats.shadows = N[1]!;
    stats.points = N[2]!;
    stats.verts = N[3]!;
    stats.objects = N[4]!;
  }
  const clusterBefore = (a: Cluster, b: Cluster) => {
    const fa = a.fixed != null, fb = b.fixed != null;
    return fa !== fb ? fa : fa ? CD[a.ci]! < CD[b.ci]! : CD[a.ci]! > CD[b.ci]!;
  };

  // ---- picking: the front-most face under a point; a ray onto a horizontal plane ----
  function inPoly(base: number, me: Mesh, f: number, x: number, y: number) {
    const s0 = me.fs[f]!, c = me.fc[f]!;
    let ins = false;
    for (let i = 0, j = c - 1; i < c; j = i++) {
      const a = base + me.fv[s0 + i]! * 3, b = base + me.fv[s0 + j]! * 3, ay = SV[a + 1]!, by = SV[b + 1]!;
      if (ay > y !== by > y && x < ((SV[b]! - SV[a]!) * (y - ay)) / (by - ay) + SV[a]!) ins = !ins;
    }
    return ins;
  }
  function pick(x: number, y: number): DioramaObject | null {
    for (let q = nf - 1; q >= 0; q--) {
      const e = ORD[q]!;
      if (KIND[e]) continue;
      const ob = objs[FOBJ[e]!]!;
      if (ob.pick && EA[ob.i]! > 0.2 && inPoly(ob.vb * 3, ob.mesh, FIDX[e]!, x, y)) return ob;
    }
    return null;
  }
  function ground(x: number, y: number, py: number, out: { [i: number]: number }) {
    sync();
    const k = B[12]!, sx = (x - W / 2 - cam.ox) / k, sy = -(y - H / 2 - cam.oy) / k;
    const dx = B[3]! * sx + B[6]! * sy + B[9]!, dy = B[4]! * sx + B[7]! * sy + B[10]!, dz = B[5]! * sx + B[8]! * sy + B[11]!;
    if (Math.abs(dy) < 1e-9) return false;
    const t = (py - B[1]!) / dy;
    if (t <= 0) return false;
    out[0] = B[0]! + dx * t;
    out[1] = py;
    out[2] = B[2]! + dz * t;
    return true;
  }

  const api = {
    /** The canvas's 2D context. */
    ctx,
    /** The camera `draw`, `project`, `ground` and `pick` use: change it freely between draws. */
    cam,
    /** The last draw: faces, shadows, points, verts, objects on (matrices computed; `off` subtrees left out), and entries dropped (over maxFaces). */
    stats,
    /** Add an object (`DioramaObjectDef`); returns its live handle. Throws past `maxVerts`. */
    add,
    /** The object named `id`. */
    get: (id: string): DioramaObject | undefined => byId.get(id),
    /** Rest `ob` on `parentId` (null: on nothing); its `pos` is from then on from the new parent's top. */
    on(ob: DioramaObject, parentId: string | null) {
      (ob as Obj).on = parentId;
      relink();
    },
    /** Remove every object, cluster, decal and point pool (meshes stay cached). */
    clear,
    /** Name a cluster: `{ fixed: n }` draws before every unfixed one, in n order (a room, a table);
     *  `{ at: [x, y, z] }` ranks it far to near by that point. Redefining one keeps its objects. */
    cluster: (name: string, c: { fixed?: number; at?: ArrayLike<number> }) => cluster(name, c),
    /** Paint `fn(ctx)` in the sort: in `cluster` at `layer`, behind that layer's faces, or by the
     *  depth of `at` (read each draw) among them. */
    decal(cl: string, layer: number, fn: (ctx: CanvasRenderingContext2D) => void, at: ArrayLike<number> | null = null) {
      decals.push({ cl, layer, fn, at });
    },
    /** A fixed pool of points (sparks, shells, smoke) drawn in the depth sort (`DioramaPoints`). */
    points(p: PointsOptions): DioramaPoints {
      const f = () => new Float64Array(p.cap), pool: DioramaPoints = {
        n: 0, x: f(), y: f(), z: f(), r: f(), a: f().fill(1), color: new Array(p.cap).fill(undefined), sx: f(), sy: f(), sr: f(),
        cluster: p.cluster ?? null, layer: p.layer ?? 5, rank: p.rank || null, colorAll: p.color || "#ffffff", paint: p.paint || null,
      };
      pools.push(pool);
      return pool;
    },
    /** Set the light's direction (towards it) and the ambient level. */
    setLight,
    /** Size the backing store: CSS width and height and the density (no arguments: the canvas's
     *  client size and devicePixelRatio, capped at `maxDpr`; a layout read, so call it after a resize). */
    resize,
    /** Frame `points` ([x, y, z, …], world) inside the safe rect: sets c.dist, then c.ox and c.oy so
     *  the points' screen box is centred in it. Uses c's yaw, pitch, target and fov; returns c. */
    fit,
    /** Hold `c` (default `cam`) inside the limits; returns c. */
    clamp,
    /** Draw the frame: matrices, sort, paint, then `overlay`. */
    draw,
    /** The front-most pickable object under (x, y) (CSS px), as of the last draw, or null. */
    pick,
    /** Where the ray under (x, y) meets the plane y = planeY: out = [x, y, z]; false if it never does. */
    ground,
    /** World (x, y, z) to screen: out = [x, y, depth]; false when behind the camera. */
    project(x: number, y: number, z: number, out: { [i: number]: number }) {
      sync();
      return proj(B, cam, x, y, z, out);
    },
    /** The camera's world position (the eye): out = [x, y, z]; returns out. */
    eye<T extends { [i: number]: number }>(out: T): T {
      sync();
      out[0] = B[0]!; out[1] = B[1]!; out[2] = B[2]!;
      return out;
    },
    /** Screen px per world unit at depth 1 (a size s at depth z is s × focal() / z px). */
    focal: () => (sync(), B[12]!),
    /** Call fn on every object (recolour on a theme change, find parts). */
    recolor(fn: (ob: DioramaObject) => void) {
      for (let i = 0; i < objs.length; i++) fn(objs[i]!);
    },
    /** The nearest ancestor with a `tag` (or the top of the chain): what a pick on a part belongs to. */
    root(ob: DioramaObject | null) {
      while (ob && ob.tag == null && ob.parent) ob = ob.parent;
      return ob;
    },
    /** CSS width, as last sized. */
    get width() {
      return W;
    },
    /** CSS height, as last sized. */
    get height() {
      return H;
    },
    /** Device pixels per CSS px. */
    get dpr() {
      return dpr;
    },
  };
  resize();
  return api;
}
/** What `diorama` returns. */
export type Diorama = ReturnType<typeof diorama>;

/** Options for `occlude`: the objects that may stand in the way and how they fade. */
export interface OccludeOptions {
  /** Root objects (no `on`) whose boxes (`size` from `pos`, turned by `rot[1]`) can hide the targets. */
  objects: DioramaObject[];
  /** The alpha of an object in the way (default 0.16). */
  ghost?: number;
  /** Seconds a full fade takes (default 0.15). */
  t?: number;
  /** Reduced motion: snap instead of fading (also a live field on the result). */
  reduced?: boolean;
  /** A box met within this distance of a target is touching it, not in the way (default 0). */
  near?: number;
}

/** Fade what stands between the eye and the targets (a chase camera in a town): each `step(dt, pts)`
 *  casts rays from `d.eye()` to every target point (`pts`: [x, y, z, …], world; `n` of them, default
 *  all) against each object's box; one in the way eases its `alpha` toward `ghost`, one the eye is
 *  inside toward 0, the rest back to 1. Returns true while anything is still fading (keep the engine
 *  awake). Writes `alpha` only (render side, never the sim). Boxes off the bounds of the eye and the
 *  targets are skipped; `tested` counts the boxes ray-tested in the last step. No allocation per step. */
export function occlude(d: Diorama, o: OccludeOptions) {
  const obs = o.objects, A = new Float64Array(obs.length).fill(1), E = new Float64Array(3);
  const R = new Float64Array(9), Bd = new Float64Array(6); // R: local origin, direction, extent; Bd: the rays' bounds
  const ghost = o.ghost ?? 0.16, near = o.near ?? 0, t = o.t ?? 0.15;
  const oc = {
    reduced: !!o.reduced,
    tested: 0,
    step(dt: number, pts: ArrayLike<number>, n = (pts.length / 3) | 0) {
      d.eye(E);
      let busy = false;
      for (let j = 0; j < 3; j++) {
        Bd[j] = Bd[j + 3] = E[j]!;
        for (let k = j; k < n * 3; k += 3) (Bd[j] = Math.min(Bd[j]!, pts[k]!)), (Bd[j + 3] = Math.max(Bd[j + 3]!, pts[k]!));
      }
      const rate = oc.reduced || t <= 0 ? 2 : dt / t;
      oc.tested = 0;
      for (let i = 0; i < obs.length; i++) {
        const ob = obs[i]!, s = ob.size, p = ob.pos, hx = s[0]! / 2, hz = s[2]! / 2, r = hx + hz;
        let goal = 1, j = 0;
        while (j < 3 && p[j]! + (j === 1 ? s[1]! : r) >= Bd[j]! && p[j]! - (j === 1 ? 0 : r) <= Bd[j + 3]!) j++;
        if (j > 2) {
          oc.tested++;
          const c = Math.cos(ob.rot[1]!), sn = Math.sin(ob.rot[1]!), ax = E[0]! - p[0]!, az = E[2]! - p[2]!;
          // World to the box's frame (turned by yaw, origin at its bottom centre).
          const lx = c * ax - sn * az, ly = E[1]! - p[1]!, lz = sn * ax + c * az;
          R[0] = lx; R[1] = ly; R[2] = lz; R[6] = hx; R[7] = s[1]!; R[8] = hz;
          for (let k = 0; k < n * 3; k += 3) {
            const bx = pts[k]! - p[0]!, bz = pts[k + 2]! - p[2]!;
            R[3] = c * bx - sn * bz - lx; R[4] = pts[k + 1]! - p[1]! - ly; R[5] = sn * bx + c * bz - lz;
            // Slabs: the segment's t range inside the box, eye at 0, target at 1; w counts the axes the eye is inside.
            let t0 = 0, t1 = 1, w = 0;
            for (j = 0; j < 3; j++) {
              const lo = j === 1 ? 0 : -R[6 + j]!, hi = R[6 + j]!, q = R[j]!, dd = R[3 + j]!;
              // Parallel to a slab: ±Infinity, so a miss outside it and no limit inside (IEEE does the case).
              const u = (lo - q) / dd, v = (hi - q) / dd;
              if (q > lo && q < hi) w++;
              t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v));
            }
            if (w > 2) { goal = 0; break; }
            if (t0 <= t1 && (1 - t0) * Math.sqrt(R[3]! * R[3]! + R[4]! * R[4]! + R[5]! * R[5]!) > near) { goal = ghost; break; }
          }
        }
        let a = A[i]!;
        a = a < goal ? Math.min(goal, a + rate) : Math.max(goal, a - rate);
        A[i] = ob.alpha = a;
        if (a !== goal) busy = true;
      }
      return busy;
    },
  };
  return oc;
}
