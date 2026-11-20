/**
 * @fzlt/core/props: a kit of small low-poly models for `@fzlt/core/diorama` scenes, so a new diorama
 * starts furnished. Each prop is a function `prop(d, opts)` that adds a `group` root (its `size` is the
 * prop's footprint, so its blob shadow fits) and its parts resting on it, at `pos`, turned by `rot`
 * (yaw) and sized by `scale`, in soft pastel colours you can override by key; it returns the root.
 * Move, turn, tilt, tint or hide the root and the whole prop follows; `d.root(d.pick(x, y))` on any
 * part gives the root (its `tag` is the prop's name unless you pass one).
 * - Sets: nature (`pineTree`, `roundTree`, `bush`, `rocks`, `cactus`), town (`house`, `shop`,
 *   `lamppost`, `bench`, `fence`, `trafficCone`, `crates`), coast (`lighthouse`, `dock`, `buoy`) and
 *   display vehicles (`car`, `truck`). Import only the props you use: each is its own function.
 * - Units: about a metre (a house is 2.4 wide); local x is a prop's width, z its depth and +z its
 *   front (doors, windows, a car's side). `fence` and `dock` segments join end to end along x at
 *   `FENCE_STEP` and `DOCK_STEP` × scale.
 * - Variants: `seed` (an integer) picks heights, widths, turns and counts from integer maths, so every
 *   player who builds the same seed gets the same scene. Each jitter is one of eight steps, so the
 *   diorama's mesh cache stays small however many seeds a scene uses.
 * - Sorting: each prop is its own diorama cluster (named by its id) unless you pass `cluster`, and its
 *   parts are layered low to high, so props in a row never interleave. Make what they stand on a
 *   `fixed` cluster (`d.cluster("floor", { fixed: 0 })`), as clusters anchored on a point sort far to near.
 * - Colours: every prop reads `colors[key]` before its own default, and the keys are shared across
 *   props (`wood`, `roof`, `glass`, `metal`, `lamp`, …), so one object re-themes a scene (a night set).
 * Adding a prop allocates only what `d.add` does for its parts (pass an `id`; without one, a name is
 * made from a counter). Nothing runs per frame: props are data in the diorama, drawn by its `draw()`.
 */
import type { Diorama, DioramaObject } from "./diorama";

/** Options every prop takes. */
export interface PropOptions {
  /** The root's id (default `"prop" + n`, a counter); its parts are anonymous. */
  id?: string;
  /** The id of the object it stands on (its `pos` is then from that object's top centre). */
  on?: string | null;
  /** Position of its bottom centre, [x, y, z] (default [0, 0, 0]). */
  pos?: ArrayLike<number>;
  /** Turn around y, radians (default 0). */
  rot?: number;
  /** Size multiplier (default 1). */
  scale?: number;
  /** An integer picking the variant (default 0). */
  seed?: number;
  /** Colour overrides by key, `#rrggbb` (each prop lists its keys). */
  colors?: Readonly<Record<string, string | undefined>>;
  /** Its diorama cluster (default: its own, named by its id; null: its parent's). */
  cluster?: string | null;
  /** Blob shadow strength on what it stands on (default 0.16 when `on` is set). */
  shadow?: number;
  /** The root's layer (default: diorama's, its parent's + 1); parts layer above it. */
  layer?: number;
  /** `false`: `pick` passes through every part. */
  pick?: boolean;
  /** The root's tag (default: the prop's name, e.g. `"house"`). */
  tag?: unknown;
}

type Pal = Readonly<Record<string, string>>;
// One scratch definition, reused for every part: `d.add` copies what it keeps.
const SZ = new Float64Array(3), PS = new Float64Array(3), RT = new Float64Array(3);
const S: Record<string, unknown> = { size: SZ, pos: PS, rot: RT };
let D: Diorama, R: DioramaObject, O: PropOptions, P: Pal, K = 1, LV = 0, SEED = 0, N = 0;

/** Step k of the current seed: an integer 0..7 from integer maths (the same in every browser). */
function q(k: number) {
  let h = Math.imul(SEED, 0x9e3779b1) + Math.imul(k + 1, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 29;
}
/** 1 ± amp, in eight even steps picked by the seed. */
const j = (k: number, amp: number) => 1 + amp * ((q(k) - 3.5) / 3.5);
/** The colour for key: the caller's override, else the prop's default (a `#rrggbb` is itself). */
const c = (key: string) => (key[0] === "#" ? key : (O.colors && O.colors[key]) || P[key]!);

/** Start a prop: the group root, footprint [w, h, d] at scale 1. */
function root(d: Diorama, o: PropOptions, pal: Pal, name: string, w: number, h: number, dd: number) {
  D = d; O = o; P = pal; K = o.scale ?? 1; SEED = (o.seed ?? 0) | 0;
  const p = o.pos, id = o.id ?? "prop" + ++N, on = o.on ?? null;
  SZ[0] = w * K; SZ[1] = h * K; SZ[2] = dd * K;
  PS[0] = p ? p[0]! : 0; PS[1] = p ? p[1]! : 0; PS[2] = p ? p[2]! : 0;
  RT[0] = RT[2] = 0; RT[1] = o.rot ?? 0;
  S.id = id; S.shape = "group"; S.on = on; S.layer = o.layer; S.cluster = o.cluster === null ? undefined : o.cluster ?? id;
  S.shadow = o.shadow ?? (on ? 0.16 : 0); S.tag = o.tag ?? name; S.pick = o.pick;
  S.color = S.sides = S.top = S.mask = S.emissive = undefined;
  R = d.add(S as never);
  LV = R.layer;
  S.id = S.cluster = S.tag = undefined; S.shadow = 0; S.on = id;
  return R;
}
/** One part on the root: shape, size [w, h, d] and position [x, y, z] (scaled), colour key, layer
 *  step `lv`, then cyl sides and top (or box mask), a yaw and a roll around x (radians). */
function part(shape: string, w: number, h: number, dd: number, x: number, y: number, z: number, col: string, lv: number, sides = 0, top = 1, ry = 0, rx = 0, glow = false) {
  SZ[0] = w * K; SZ[1] = h * K; SZ[2] = dd * K;
  PS[0] = x * K; PS[1] = y * K; PS[2] = z * K;
  RT[0] = rx; RT[1] = ry; RT[2] = 0;
  S.shape = shape; S.color = c(col); S.layer = LV + lv; S.emissive = glow;
  S.sides = shape === "cyl" ? sides : undefined; S.top = shape === "cyl" ? top : undefined; S.mask = shape === "box" && sides ? sides : undefined;
  D.add(S as never);
}
const box = (w: number, h: number, dd: number, x: number, y: number, z: number, col: string, lv: number, mask = 0, ry = 0) => part("box", w, h, dd, x, y, z, col, lv, mask, 1, ry);
const cyl = (w: number, h: number, x: number, y: number, z: number, col: string, lv: number, sides: number, top: number, ry = 0) => part("cyl", w, h, w, x, y, z, col, lv, sides, top, ry);
/** A face mask: only the front (+z) face, for doors and windows laid on a wall. */
const FRONT = 16;
const HALF = Math.PI / 2;

// ---- nature ----
const PINE: Pal = { trunk: "#a47c5b", leaf: "#7fc79b", leaf2: "#a3d9ab" };
/** A pine: a trunk and three stacked cones (keys `trunk`, `leaf`, `leaf2`); the seed sets its
 *  height (±20%), girth (±12%) and turn. Footprint 2.1 × 3.5 × 2.1. */
export function pineTree(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, PINE, "pine", 2.1, 3.5, 2.1), h = j(0, 0.2), w = j(1, 0.12), t = q(2) * 0.4;
  cyl(0.36, 0.7 * h, 0, 0, 0, "trunk", 1, 6, 0.9);
  cyl(1.8 * w, 1.3 * h, 0, 0.55 * h, 0, "leaf", 2, 7, 0, t);
  cyl(1.4 * w, 1.1 * h, 0, 1.25 * h, 0, "leaf2", 3, 7, 0, t + 0.45);
  cyl(1 * w, 0.95 * h, 0, 1.9 * h, 0, "leaf", 4, 7, 0, t);
  return r;
}

const ROUND: Pal = { trunk: "#a47c5b", leaf: "#8fcf9b", leaf2: "#b0dfa8" };
/** A round-crowned tree: a trunk under a two-part crown (keys `trunk`, `leaf`, `leaf2`); the seed
 *  sets its height (±18%), crown width (±12%) and turn. Footprint 2.1 × 3 × 2.1. */
export function roundTree(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, ROUND, "tree", 2.1, 3, 2.1), h = j(0, 0.18), w = j(1, 0.12), t = q(2) * 0.4;
  cyl(0.3, 1.1 * h, 0, 0, 0, "trunk", 1, 6, 0.85);
  cyl(1.2 * w, 0.7 * h, 0, 0.95 * h, 0, "leaf", 2, 8, 1.5, t);
  cyl(1.8 * w, 0.85 * h, 0, 1.65 * h, 0, "leaf2", 3, 8, 0.45, t);
  return r;
}

const BUSH: Pal = { leaf: "#8fcf9b", leaf2: "#b0dfa8" };
/** A bush: a mound and two smaller ones beside it (keys `leaf`, `leaf2`); the seed sets their sizes
 *  and where the small ones sit. Footprint 2 × 0.8 × 1.4. */
export function bush(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, BUSH, "bush", 2, 0.8, 1.4), a = j(0, 0.15), b = j(1, 0.2), e = (q(2) - 3.5) * 0.06;
  cyl(1.1 * a, 0.62 * a, 0, 0, 0, "leaf", 1, 7, 0.5, q(3) * 0.3);
  cyl(0.62 * b, 0.42 * b, -0.6, 0, 0.18 + e, "leaf2", 1, 7, 0.45);
  cyl(0.55 * a, 0.36 * a, 0.62, 0, -0.15 - e, "leaf2", 1, 7, 0.45);
  return r;
}

const ROCKS: Pal = { rock: "#b9b5c6", rock2: "#d2cedb" };
/** A cluster of three rocks (keys `rock`, `rock2`); the seed sets their sizes and turns.
 *  Footprint 2 × 0.8 × 1.4. */
export function rocks(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, ROCKS, "rocks", 2, 0.8, 1.4), a = j(0, 0.15);
  cyl(1 * a, 0.62 * a, -0.2, 0, -0.1, "rock", 1, 5, 0.55, q(1) * 0.8);
  cyl(0.6 * j(2, 0.2), 0.4, 0.55, 0, 0.3, "rock2", 1, 6, 0.6, q(3) * 0.8);
  cyl(0.42, 0.26 * j(4, 0.2), -0.7, 0, 0.45, "rock2", 1, 5, 0.5, q(5) * 0.8);
  return r;
}

const CACTUS: Pal = { cactus: "#86c497", cactus2: "#a9d9ac", flower: "#f4a6b8" };
/** A cactus with two arms and, on odd seeds, a flower (keys `cactus`, `cactus2`, `flower`); the seed
 *  sets its height (±15%) and the arms' heights. Footprint 1.4 × 2 × 0.5. */
export function cactus(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, CACTUS, "cactus", 1.4, 2, 0.5), h = j(0, 0.15), a = 0.5 + q(1) * 0.05, b = 0.75 + q(2) * 0.05;
  cyl(0.5, 1.6 * h, 0, 0, 0, "cactus", 1, 8, 0.85);
  box(0.4, 0.2, 0.2, -0.38, a, 0, "cactus", 1);
  cyl(0.26, 0.55, -0.52, a, 0, "cactus2", 2, 6, 0.8);
  box(0.4, 0.2, 0.2, 0.38, b, 0, "cactus", 1);
  cyl(0.26, 0.45, 0.52, b, 0, "cactus2", 2, 6, 0.8);
  if (SEED & 1) cyl(0.24, 0.14, 0, 1.6 * h, 0, "flower", 3, 6, 0.4);
  return r;
}

// ---- town ----
const HOUSE: Pal = { wall: "#f6e7d8", roof: "#e9806f", trim: "#c9b8a6", door: "#a98a72", glass: "#bfe3f2", brick: "#d78f7d" };
/** A cottage: walls, a gable roof, a door and two windows on its front (+z) and a chimney (keys
 *  `wall`, `roof`, `trim`, `door`, `glass`, `brick`); the seed sets its wall height and the
 *  chimney's side. Footprint 2.6 × 2.7 × 2.2. */
export function house(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, HOUSE, "house", 2.6, 2.7, 2.2), h = 1.5 + q(0) * 0.03, s = SEED & 2 ? -1 : 1;
  box(2.4, h, 2, 0, 0, 0, "wall", 1);
  part("wedge", 1.3, 0.9, 2.2, 0.65, h, 0, "roof", 2);
  part("wedge", 1.3, 0.9, 2.2, -0.65, h, 0, "roof", 2, 0, 1, Math.PI);
  box(0.3, 0.75, 0.3, 0.6 * s, h + 0.2, -0.4, "brick", 3);
  box(0.5, 0.9, 0.04, -0.5, 0, 1.0, "door", 2, FRONT);
  box(0.5, 0.45, 0.04, 0.55, 0.6, 1.0, "glass", 2, FRONT);
  box(0.6, 0.06, 0.06, 0.55, 0.56, 1.0, "trim", 3);
  return r;
}

const SHOP: Pal = { wall: "#d8e8e0", trim: "#f7f2e8", awning: "#ef8a78", awning2: "#fbf4e6", door: "#8f9dc6", glass: "#bfe3f2" };
/** A corner shop: a box with a parapet, a shop window and door on its front (+z) under a striped
 *  awning (keys `wall`, `trim`, `awning`, `awning2`, `door`, `glass`); the seed sets its height and
 *  the stripes' count. Footprint 2.8 × 2.1 × 2.8. */
export function shop(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, SHOP, "shop", 2.8, 2.1, 2.8), h = 1.7 + q(0) * 0.02, n = 4 + (SEED & 1) * 2, sw = 2.6 / n;
  box(2.6, h, 2, 0, 0, -0.3, "wall", 1);
  box(2.72, 0.2, 2.1, 0, h, -0.3, "trim", 2);
  box(1.3, 0.75, 0.04, 0.45, 0.35, 0.7, "glass", 2, FRONT);
  box(0.5, 1.0, 0.04, -0.75, 0, 0.7, "door", 2, FRONT);
  // The awning: wedges sloping out from the wall (tall end at the wall), in alternating stripes.
  for (let i = 0; i < n; i++) part("wedge", 0.6, 0.4, sw, -1.3 + sw * (i + 0.5), 1.2, 1, i & 1 ? "awning2" : "awning", 1, 0, 1, -HALF);
  return r;
}

const LAMP: Pal = { metal: "#6e6878", lamp: "#ffe7a0" };
/** A street lamp: a foot, a post, a glowing lantern (unshaded) and its cap (keys `metal`, `lamp`).
 *  Footprint 0.5 × 2.9 × 0.5. */
export function lamppost(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, LAMP, "lamppost", 0.5, 2.9, 0.5);
  cyl(0.34, 0.16, 0, 0, 0, "metal", 1, 8, 0.7);
  cyl(0.1, 2.2, 0, 0.16, 0, "metal", 2, 6, 1);
  part("cyl", 0.34, 0.3, 0.34, 0, 2.36, 0, "lamp", 3, 6, 1.25, 0, 0, true);
  cyl(0.5, 0.24, 0, 2.66, 0, "metal", 4, 6, 0);
  return r;
}

const BENCH: Pal = { wood: "#d9a46c", metal: "#6e6878" };
/** A park bench facing +z: two side frames, a seat and a back (keys `wood`, `metal`).
 *  Footprint 1.7 × 0.9 × 0.5. */
export function bench(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, BENCH, "bench", 1.7, 0.9, 0.5);
  box(0.08, 0.4, 0.42, -0.68, 0, 0, "metal", 1);
  box(0.08, 0.4, 0.42, 0.68, 0, 0, "metal", 1);
  box(1.6, 0.08, 0.46, 0, 0.4, 0.01, "wood", 2);
  box(1.6, 0.34, 0.07, 0, 0.54, -0.2, "wood", 2);
  return r;
}

const FENCE: Pal = { fence: "#fbf7f0", post: "#e4d8ca" };
/** The length of a `fence` segment at scale 1: segments set this far apart along x join up. */
export const FENCE_STEP = 2;
/** A picket fence segment along x: two posts, two rails and three pickets (keys `fence`, `post`).
 *  Footprint 2 × 0.9 × 0.16. */
export function fence(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, FENCE, "fence", 2, 0.9, 0.16);
  box(0.14, 0.86, 0.14, -0.93, 0, 0, "post", 1);
  box(0.14, 0.86, 0.14, 0.93, 0, 0, "post", 1);
  box(1.72, 0.08, 0.05, 0, 0.25, -0.03, "fence", 1);
  box(1.72, 0.08, 0.05, 0, 0.58, -0.03, "fence", 1);
  for (let i = -1; i <= 1; i++) box(0.16, 0.74, 0.04, i * 0.55, 0.04, 0.02, "fence", 2);
  return r;
}

const CONE: Pal = { cone: "#f59a62", cone2: "#fbf7f0" };
/** A traffic cone: a square foot and a striped cone (keys `cone`, `cone2`). Footprint 0.5 × 0.7 × 0.5. */
export function trafficCone(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, CONE, "cone", 0.5, 0.7, 0.5);
  box(0.5, 0.06, 0.5, 0, 0, 0, "cone", 1);
  cyl(0.36, 0.24, 0, 0.06, 0, "cone", 2, 8, 0.7);
  cyl(0.252, 0.13, 0, 0.3, 0, "cone2", 3, 8, 0.76);
  cyl(0.19, 0.27, 0, 0.43, 0, "cone", 4, 8, 0);
  return r;
}

const CRATES: Pal = { wood: "#dcab72", wood2: "#c4925e" };
/** A stack of one to three crates (keys `wood`, `wood2`); the seed sets the count and their turns.
 *  Footprint 1.2 × 2 × 1.2. */
export function crates(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, CRATES, "crates", 1.2, 2, 1.2), n = 1 + (q(0) % 3);
  box(0.9, 0.8, 0.9, 0, 0, 0, "wood", 1, 0, (q(1) - 3.5) * 0.05);
  box(0.62, 0.1, 0.04, 0, 0.35, 0.45, "wood2", 2, FRONT, (q(1) - 3.5) * 0.05);
  if (n > 1) box(0.7, 0.62, 0.7, 0.06, 0.8, -0.04, "wood", 3, 0, (q(2) - 3.5) * 0.12);
  if (n > 2) box(0.5, 0.45, 0.5, -0.04, 1.42, 0.02, "wood2", 4, 0, (q(3) - 3.5) * 0.15);
  return r;
}

// ---- coast ----
const LIGHTHOUSE: Pal = { stone: "#aeb0bd", wall: "#faf6ee", stripe: "#ee8270", metal: "#5f6678", lamp: "#ffe7a0", roof: "#e66d5f", door: "#5f6678" };
/** A lighthouse: a stone foot, a tapering tower in red and white rings, a gallery, a glowing lamp
 *  room (unshaded) and a roof, a door on its front (keys `stone`, `wall`, `stripe`, `metal`, `lamp`,
 *  `roof`, `door`). Footprint 2.2 × 5 × 2.2. */
export function lighthouse(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, LIGHTHOUSE, "lighthouse", 2.2, 5, 2.2);
  cyl(2.2, 0.45, 0, 0, 0, "stone", 1, 9, 0.85);
  for (let i = 0; i < 4; i++) cyl(1.5 - i * 0.12, 0.8, 0, 0.45 + i * 0.8, 0, i & 1 ? "stripe" : "wall", 2 + i, 9, (1.38 - i * 0.12) / (1.5 - i * 0.12));
  box(0.36, 0.6, 0.04, 0, 0.45, 0.72, "door", 3, FRONT);
  cyl(1.3, 0.12, 0, 3.65, 0, "metal", 6, 9, 1);
  part("cyl", 0.72, 0.55, 0.72, 0, 3.77, 0, "lamp", 7, 9, 1, 0, 0, true);
  cyl(0.95, 0.5, 0, 4.32, 0, "roof", 8, 9, 0);
  cyl(0.1, 0.18, 0, 4.8, 0, "metal", 9, 5, 1);
  return r;
}

const DOCK: Pal = { deck: "#ddb689", plank: "#b98f63", post: "#a07a58", metal: "#6f6a78" };
/** The length of a `dock` segment at scale 1: segments set this far apart along x join up. */
export const DOCK_STEP = 3;
/** A dock segment along x: a deck with plank lines on four posts, and a bollard on even seeds (keys
 *  `deck`, `plank`, `post`, `metal`). Its deck is 0.5 up: stand it in the water. Footprint 3 × 0.9 × 1.4. */
export function dock(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, DOCK, "dock", 3, 0.9, 1.4);
  for (let i = 0; i < 4; i++) cyl(0.18, 0.5, i & 1 ? 1.3 : -1.3, 0, i & 2 ? 0.55 : -0.55, "post", 1, 6, 1);
  box(3, 0.16, 1.4, 0, 0.5, 0, "deck", 2);
  for (let i = 0; i < 4; i++) box(3, 0.01, 0.05, 0, 0.66, -0.52 + i * 0.35, "plank", 3, 1);
  if (!(SEED & 1)) cyl(0.26, 0.24, 1.2, 0.66, 0.5, "metal", 4, 8, 0.8);
  return r;
}

const BUOY: Pal = { buoy: "#ef7d6a", buoy2: "#fbf7f0", lamp: "#ffe7a0" };
/** A channel buoy: a red float, a white band, a cone and a small glowing light (unshaded) (keys
 *  `buoy`, `buoy2`, `lamp`). Footprint 0.6 × 1.1 × 0.6. */
export function buoy(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, BUOY, "buoy", 0.6, 1.1, 0.6);
  cyl(0.6, 0.4, 0, 0, 0, "buoy", 1, 8, 0.8);
  cyl(0.48, 0.26, 0, 0.4, 0, "buoy2", 2, 8, 0.72);
  cyl(0.34, 0.32, 0, 0.66, 0, "buoy", 3, 8, 0.2);
  part("cyl", 0.12, 0.12, 0.12, 0, 0.98, 0, "lamp", 4, 6, 1, 0, 0, true);
  return r;
}

// ---- vehicles (display models: no wheels turn) ----
const PAINTS = ["#ef7d6a", "#6db0cf", "#f2c96b", "#7fcfa8"];
/** A pair of wheels (axis along z) at x, outside a body of half-width hz. */
function axle(x: number, hz: number, rad: number) {
  part("cyl", rad * 2, 0.22, rad * 2, x, rad, hz, "tire", 1, 8, 1, 0, HALF);
  part("cyl", rad * 2, 0.22, rad * 2, x, rad, -hz - 0.22, "tire", 1, 8, 1, 0, HALF);
}
const CAR: Pal = { glass: "#d7eef8", tire: "#4a4656", lamp: "#fff3c4" };
/** A small car facing +x: a body, a cabin with sloped glass and a roof, headlights and four wheels
 *  (keys `paint`, `glass`, `tire`, `lamp`); without a `paint` override the seed picks one of four
 *  pastels. Footprint 2 × 1.1 × 1.2. */
export function car(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, CAR, "car", 2, 1.1, 1.2), paint = (o.colors && o.colors.paint) || PAINTS[q(0) & 3]!;
  box(1.9, 0.42, 0.9, 0, 0.16, 0, paint, 2);
  box(0.86, 0.36, 0.8, -0.15, 0.58, 0, "glass", 3);
  part("wedge", 0.3, 0.36, 0.8, 0.43, 0.58, 0, "glass", 3);
  part("wedge", 0.22, 0.36, 0.8, -0.69, 0.58, 0, "glass", 3, 0, 1, Math.PI);
  box(0.9, 0.06, 0.82, -0.15, 0.94, 0, paint, 4);
  box(0.04, 0.1, 0.2, 0.95, 0.4, 0.28, "lamp", 3, 4);
  box(0.04, 0.1, 0.2, 0.95, 0.4, -0.28, "lamp", 3, 4);
  axle(0.6, 0.34, 0.21);
  axle(-0.6, 0.34, 0.21);
  return r;
}

const TRUCK: Pal = { body: "#f7f2e8", glass: "#d7eef8", tire: "#4a4656", lamp: "#fff3c4", metal: "#6f6a78" };
/** A box truck facing +x: a chassis, a cab with a windscreen, a cargo box and six wheels (keys
 *  `paint` (the cab), `body` (the box), `glass`, `tire`, `lamp`, `metal`); without a `paint` override
 *  the seed picks one of four pastels. Footprint 3.1 × 1.6 × 1.2. */
export function truck(d: Diorama, o: PropOptions = {}): DioramaObject {
  const r = root(d, o, TRUCK, "truck", 3.1, 1.6, 1.2), paint = (o.colors && o.colors.paint) || PAINTS[q(0) & 3]!;
  box(2.9, 0.16, 0.86, 0, 0.2, 0, "metal", 2);
  box(0.9, 0.86, 0.96, 1, 0.36, 0, paint, 3);
  box(0.04, 0.38, 0.8, 1.45, 0.74, 0, "glass", 4, 4);
  box(0.04, 0.1, 0.2, 1.45, 0.46, 0.32, "lamp", 4, 4);
  box(0.04, 0.1, 0.2, 1.45, 0.46, -0.32, "lamp", 4, 4);
  box(1.9, 1.2, 1.04, -0.45, 0.36, 0, "body", 3);
  axle(1, 0.3, 0.23);
  axle(-0.55, 0.3, 0.23);
  axle(-1.1, 0.3, 0.23);
  return r;
}

/** Every prop by name (importing this pulls in the whole kit; import single props to keep it small). */
export const PROPS = { pineTree, roundTree, bush, rocks, cactus, house, shop, lamppost, bench, fence, trafficCone, crates, lighthouse, dock, buoy, car, truck };
