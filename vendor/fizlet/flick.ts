/**
 * @fzlt/core/flick: light tabletop physics for diorama pieces. Discs and boxes slide on a table
 * (and on ramps, and on each other), take a flick as an impulse, slow down with friction, bounce off
 * each other and off fixed walls, fall off the table's edges and topple off stacks. It is a game's
 * physics, not a rigid-body engine:
 * - The table is the plane y = 0 inside `table` ([width, depth], centred on the origin): the frame of
 *   a diorama table's top centre, so a pose goes straight into an object that is `on` the table.
 *   Past an edge a piece falls to `floor` and is flagged `off`.
 * - Pieces move in the plane: discs as circles, boxes as turned rectangles (they spin from
 *   off-centre hits), ramps and walls as fixed rectangles. Contacts are frictionless impulses with
 *   restitution (`bounce`); sliding friction is μ·g against what a piece rests on, so a piece
 *   resting on another is dragged along by it.
 * - Falling and toppling: a piece whose centre of mass (with everything stacked on it) leaves what
 *   holds it tips about that edge, the pieces on it with it, then falls; a fast one flies off. It
 *   lands flat, on a side or on an end (the nearest quarter turn), never balanced on an edge.
 * - Fixed step and deterministic: `step(dt)` runs `sub` sub-steps of arithmetic only (no Math.sin,
 *   Math.cos or Math.atan2 inside a step; steer's exact `hypot`), so two players who start from the
 *   same pieces and send the same shots (`sling`'s integer angle and power) see the same result bit
 *   for bit. Poses (`pose`, `apply`) are output only and never feed back.
 * - `busy` is false once everything rests; `step` returns it for the engine's `busy()`. `run()`
 *   plays the shot to rest at once (reduced motion, a server, a replay check): the same steps.
 * No allocation per step, pose or sling in the steady state (typed arrays, fixed capacity).
 */
import { hypot } from "./steer";
import { need } from "./kernel/need";

/** Something that takes events: an engine's ring (`engine.events`). */
export interface FlickEvents {
  emit(type: string, a?: number, b?: number, x?: number, y?: number, v?: number): unknown;
}

/** Options for `flick()`: capacity, the table, gravity and the step. */
export interface FlickOptions {
  /** The most pieces, ramps and walls (default 32). */
  cap?: number;
  /** The table top, [width, depth] centred on the origin (default [10, 6]). */
  table?: ArrayLike<number>;
  /** Where a piece that falls off lands and rests (default −2). */
  floor?: number;
  /** Sliding friction μ on the floor (default 0.8: what falls off stops soon). */
  floorFriction?: number;
  /** Gravity, world units per s² (default 9.8). */
  gravity?: number;
  /** Sub-steps per `step(dt)` (default 4). */
  sub?: number;
  /** Faster than this (units per s) a piece flies off an edge instead of tipping over it (default 0.6). */
  tip?: number;
  /** The highest lip a sliding piece rides up onto a ramp (default 0.08). */
  lip?: number;
  /** Events: `flick:hit` (a, b, x, z, speed), `flick:topple` (a), `flick:fall` (a), `flick:rest`. */
  events?: FlickEvents;
}

/** One piece, ramp or wall for `add`. */
export interface FlickBodyDef {
  /** `disc` (a puck, a coin), `box` (a block, a crate) or `ramp` (fixed, tall at its −x end like
   *  diorama's `wedge`; default `disc`). */
  shape?: "disc" | "box" | "ramp";
  /** [width (x), height (y), depth (z)]; a disc's width is its diameter (default [1, 0.3, 1]). */
  size?: ArrayLike<number>;
  /** [x, z]: on the highest surface under it; [x, y, z]: from that height (it falls if above). */
  pos?: ArrayLike<number>;
  /** Turn about y, radians (diorama's `rot[1]`). */
  yaw?: number;
  /** Mass (default 1). */
  mass?: number;
  /** Sliding friction μ (default 0.25). */
  friction?: number;
  /** Restitution, 0..1, averaged with what it hits (default 0.8). */
  bounce?: number;
  /** Never moves (a wall, a rail, a post); ramps always are. */
  fixed?: boolean;
}

/** A piece's state: `STATE.rest`, `slide`, `air` (falling) or `tip` (tipping over an edge). */
export const STATE = { rest: 0, slide: 1, air: 2, tip: 3 } as const;

const REST = 0, SLIDE = 1, AIR = 2, TIP = 3, HP = 1.5707963267948966, TAU = 6.283185307179586;
const HY = new Float64Array(3);
/** HY[2] = steer's exact hypot(HY[0], HY[1]), with no double crossing the call: a step function V8
 *  does not inline hypot into would box its arguments and result on every call. */
function len() {
  HY[2] = hypot(HY[0]!, HY[1]!);
}
// Scratch for numbers between calls: V8 boxes a double passed to or returned from a call it does
// not inline (a young-generation allocation each time), so steps pass them through typed arrays.
const SC = new Float64Array(2);
/** sin and cos of the angle in SC[0] into SC[0] and SC[1], from + − × ÷ only (a range reduction and
 *  two short series), so every engine gets the same bits: Math.sin and Math.cos may differ in the
 *  last bit between browsers. */
function sc() {
  const a = SC[0]!;
  let q = Math.round(a / HP);
  const r = a - q * HP, r2 = r * r;
  const s = r * (1 - (r2 / 6) * (1 - (r2 / 20) * (1 - (r2 / 42) * (1 - (r2 / 72) * (1 - (r2 / 110) * (1 - (r2 / 156) * (1 - r2 / 210)))))));
  const c = 1 - (r2 / 2) * (1 - (r2 / 12) * (1 - (r2 / 30) * (1 - (r2 / 56) * (1 - (r2 / 90) * (1 - (r2 / 132) * (1 - r2 / 182))))));
  q &= 3;
  SC[0] = q === 0 ? s : q === 1 ? c : q === 2 ? -s : -c;
  SC[1] = q === 0 ? c : q === 1 ? -s : q === 2 ? -c : s;
}

/** A tabletop world: `add` pieces, `flick` one, `step` it from the engine, `apply` the poses. */
export function flick(o: FlickOptions = {}) {
  const cap = need(o.cap ?? 32, "cap", 2), g = need(o.gravity ?? 9.8, "gravity", 1), sub = need(o.sub ?? 4, "sub", 2);
  const floor = need(o.floor ?? -2, "floor"), ffl = need(o.floorFriction ?? 0.8, "floorFriction"), vtip = need(o.tip ?? 0.6, "tip"), lip = need(o.lip ?? 0.08, "lip");
  const tw = need(o.table?.[0] ?? 10, "table width", 1) / 2, td = need(o.table?.[1] ?? 6, "table depth", 1) / 2, ev = o.events;
  const f = () => new Float64Array(cap), u8 = () => new Uint8Array(cap), i32 = () => new Int32Array(cap);
  // Kind (0 disc, 1 box, 2 ramp), fixed, state, off the table; support (−1 table, −2 floor, −3 none) and tip base.
  const K = u8(), FX = u8(), ST = u8(), OFF = u8(), SUP = i32(), TB = i32();
  // Bottom centre and velocity, yaw as a unit vector (local x in the world) and its rate.
  const X = f(), Y = f(), Z = f(), VX = f(), VY = f(), VZ = f(), UX = f(), UZ = f(), W = f();
  // Half extents as made, the footprint and height now (after a topple), mass, inverses, μ, bounce.
  const HX = f(), HH = f(), HZ = f(), FU = f(), FV = f(), FH = f(), M = f(), IM = f(), II = f(), MU = f(), E = f();
  // Orientation in the yaw frame (3 × 3 rows), the tumble axis and rate in the air.
  const Q = new Float64Array(cap * 9), KX = f(), KZ = f(), TW = f();
  // Tipping: per member the offset from the pivot along the tip and up; per base the pivot, the
  // direction, the group's centre-of-mass offset, its spin, inertia per mass and the angle so far.
  const DH = f(), DV = f(), PX = f(), PY = f(), PZ = f(), PDX = f(), PDZ = f(), GH = f(), GV = f(), OM = f(), K2 = f(), TH = f();
  // Mass and mass-weighted centre of each piece with everything stacked on it.
  const MM = f(), MX = f(), MZ = f();
  // Contact scratch: normal (i → j), depth, point; interval scratch.
  const CT = new Float64Array(5), IV = new Float64Array(5);
  // Scratch: the support `under` found and its height, a top, the step, a turn's or tip's numbers.
  const S = new Int32Array(1), UY = new Float64Array(1), TOP = new Float64Array(1), H = new Float64Array(1), TA = new Float64Array(3);
  let n = 0, wasBusy = false, nb = 0;

  /** Footprint, height and spin inertia from the orientation (exact on quarter turns). */
  function dims(i: number) {
    const q = i * 9, a = HX[i]!, b = HH[i]!, c = HZ[i]!;
    FU[i] = Math.abs(Q[q]!) * a + Math.abs(Q[q + 1]!) * b + Math.abs(Q[q + 2]!) * c;
    FH[i] = 2 * (Math.abs(Q[q + 3]!) * a + Math.abs(Q[q + 4]!) * b + Math.abs(Q[q + 5]!) * c);
    FV[i] = Math.abs(Q[q + 6]!) * a + Math.abs(Q[q + 7]!) * b + Math.abs(Q[q + 8]!) * c;
    II[i] = K[i] === 1 && !FX[i] ? 3 / (M[i]! * (FU[i]! * FU[i]! + FV[i]! * FV[i]!)) : 0;
  }
  /** Turn piece i's orientation by TA[2] about the horizontal world axis (TA[0], 0, TA[1]) (Rodrigues). */
  function turn(i: number) {
    const kx = TA[0]!, kz = TA[1]!;
    SC[0] = TA[2]!;
    sc();
    const s = SC[0]!, c = SC[1]!, d = 1 - c, ux = UX[i]!, uz = UZ[i]!, ax = kx * ux + kz * uz, az = kz * ux - kx * uz, q = i * 9;
    const r00 = c + d * ax * ax, r01 = -s * az, r02 = d * ax * az, r10 = s * az, r12 = -s * ax, r22 = c + d * az * az, r21 = s * ax;
    for (let k = 0; k < 3; k++) {
      const a = Q[q + k]!, b = Q[q + 3 + k]!, e = Q[q + 6 + k]!;
      Q[q + k] = r00 * a + r01 * b + r02 * e;
      Q[q + 3 + k] = r10 * a + c * b + r12 * e;
      Q[q + 6 + k] = r02 * a + r21 * b + r22 * e;
    }
  }
  /** Snap the orientation to the nearest quarter turn (a disc: flat, either face up). */
  function snap(i: number) {
    const q = i * 9;
    // Local y's world axis: the biggest of column 1; local x's: the biggest other one of column 0.
    let ay = 1, sy = Q[q + 4]! < 0 ? -1 : 1, ax = 0, sx = 1;
    if (K[i]) {
      for (let r = 0; r < 3; r++) if (Math.abs(Q[q + r * 3 + 1]!) > Math.abs(Q[q + ay * 3 + 1]!)) ay = r;
      sy = Q[q + ay * 3 + 1]! < 0 ? -1 : 1;
      ax = ay ? 0 : 1;
      for (let r = 0; r < 3; r++) if (r !== ay && Math.abs(Q[q + r * 3]!) > Math.abs(Q[q + ax * 3]!)) ax = r;
      sx = Q[q + ax * 3]! < 0 ? -1 : 1;
    }
    Q.fill(0, q, q + 9);
    Q[q + ax * 3] = sx;
    Q[q + ay * 3 + 1] = sy;
    // Column 2 = column 0 × column 1.
    for (let r = 0; r < 3; r++) {
      const r1 = (r + 1) % 3, r2 = (r + 2) % 3;
      Q[q + r * 3 + 2] = Q[q + r1 * 3]! * Q[q + r2 * 3 + 1]! - Q[q + r2 * 3]! * Q[q + r1 * 3 + 1]!;
    }
    dims(i);
  }
  /** Is piece i's centre over piece j's footprint? */
  function over(j: number, i: number) {
    const dx = X[i]! - X[j]!, dz = Z[i]! - Z[j]!;
    if (!K[j]) return (HY[0] = dx), (HY[1] = dz), len(), HY[2]! <= FU[j]!;
    const lu = dx * UX[j]! + dz * UZ[j]!, lv = dz * UX[j]! - dx * UZ[j]!;
    return Math.abs(lu) <= FU[j]! && Math.abs(lv) <= FV[j]!;
  }
  /** The top of piece j under piece i's centre into TOP[0]: a ramp's slope, else its top face. */
  function top(j: number, i: number) {
    const lu = (X[i]! - X[j]!) * UX[j]! + (Z[i]! - Z[j]!) * UZ[j]!, u = FU[j]!;
    TOP[0] = K[j] !== 2 ? Y[j]! + FH[j]! : Y[j]! + (FH[j]! * (u - (lu < -u ? -u : lu > u ? u : lu))) / (2 * u);
  }
  /** The highest surface under piece i's centre (`foot`: under any of its footprint) at or below
   *  UY[0]: its height back in UY[0], and S[0]: −1 the table, −3 none, else the piece. */
  function under(i: number, foot: boolean) {
    const x = X[i]!, z = Z[i]!, y = UY[0]!;
    let best = -Infinity;
    S[0] = -3;
    if (Math.abs(x) <= tw && Math.abs(z) <= td && y >= -1e-9) (best = 0), (S[0] = -1);
    for (let j = 0; j < n; j++) {
      if (j === i || ST[j]! >= AIR || SUP[j] === i || !(over(j, i) || (foot && K[j] !== 2 && contact(i, j)))) continue;
      // top(j, i), written out: this loop is hot and V8 may not inline it here.
      const lu = (x - X[j]!) * UX[j]! + (z - Z[j]!) * UZ[j]!, u = FU[j]!;
      const t = K[j] !== 2 ? Y[j]! + FH[j]! : Y[j]! + (FH[j]! * (u - (lu < -u ? -u : lu > u ? u : lu))) / (2 * u);
      if (t <= y + 1e-9 && t > best) (best = t), (S[0] = j);
    }
    UY[0] = best;
  }
  /** Does piece m rest (through a chain) on piece i? */
  function onTop(m: number, i: number) {
    for (let j = SUP[m]!, k = 0; j >= 0 && k < n; j = SUP[j]!, k++) if (j === i) return true;
    return false;
  }
  /** Support interval along the unit axis (IV[2], IV[3]) of piece i, from its centre, clipped to its
   *  own half extent IV[4]: IV[0..1] = [lo, hi] (lo > hi: nothing holds it there). */
  function interval(i: number, j: number) {
    const ax = IV[2]!, az = IV[3]!, e = IV[4]!;
    let d: number, r: number;
    if (j === -1) (d = -X[i]! * ax - Z[i]! * az), (r = tw * Math.abs(ax) + td * Math.abs(az));
    else {
      d = (X[j]! - X[i]!) * ax + (Z[j]! - Z[i]!) * az;
      r = K[j] ? FU[j]! * Math.abs(UX[j]! * ax + UZ[j]! * az) + FV[j]! * Math.abs(UX[j]! * az - UZ[j]! * ax) : FU[j]!;
    }
    IV[0] = d - r > -e ? d - r : -e;
    IV[1] = d + r < e ? d + r : e;
  }
  /** Piece i falls from here (`keep`: with its upward speed, off a ramp's end). */
  function toAir(i: number, keep = false) {
    ST[i] = AIR;
    SUP[i] = -3;
    if (!keep) VY[i] = 0;
    TW[i] = 0;
  }

  /** Start piece i (and everything on it) tipping toward (TA[0], TA[1]) about the edge TA[2] along it. */
  function startTip(i: number) {
    const dx = TA[0]!, dz = TA[1]!, pd = TA[2]!, px = X[i]! + dx * pd, py = Y[i]!, pz = Z[i]! + dz * pd;
    let m = 0, sh = 0, sv = 0;
    for (let k = 0; k < n; k++) {
      if (k !== i && !onTop(k, i)) continue;
      DH[k] = (X[k]! - px) * dx + (Z[k]! - pz) * dz;
      DV[k] = Y[k]! + FH[k]! / 2 - py;
      m += M[k]!;
      sh += M[k]! * DH[k]!;
      sv += M[k]! * DV[k]!;
    }
    sh /= m;
    sv /= m;
    if (sv <= 0) return toAir(i);
    // The base's width along the tip and its height: its inertia about its centre, per mass.
    const w = 2 * (Math.abs(dx * UX[i]! + dz * UZ[i]!) * FU[i]! + Math.abs(dz * UX[i]! - dx * UZ[i]!) * FV[i]!);
    PX[i] = px; PY[i] = py; PZ[i] = pz; PDX[i] = dx; PDZ[i] = dz; GH[i] = sh; GV[i] = sv;
    OM[i] = 0; TH[i] = 0; K2[i] = (w * w + FH[i]! * FH[i]!) / 12 + sh * sh + sv * sv;
    for (let k = 0; k < n; k++) if (k === i || onTop(k, i)) (ST[k] = TIP), (TB[k] = i), (VX[k] = VZ[k] = VY[k] = W[k] = 0);
    ev && ev.emit("flick:topple", i);
  }
  /** One sub-step of the tip about base i's edge: g pulls the group's centre of mass over it. */
  function tipStep(i: number) {
    const h = H[0]!;
    OM[i] = OM[i]! + ((g * GH[i]!) / K2[i]!) * h;
    const t = OM[i]! * h, dx = PDX[i]!, dz = PDZ[i]!;
    SC[0] = t;
    sc();
    const s = SC[0]!, c = SC[1]!, gh = GH[i]!;
    GH[i] = gh * c + GV[i]! * s;
    GV[i] = GV[i]! * c - gh * s;
    TH[i] = TH[i]! + t;
    const free = GV[i]! <= 0 || TH[i]! > 1.2;
    for (let k = 0; k < n; k++) {
      if (TB[k] !== i) continue;
      const a = DH[k]!, b = DV[k]!, a2 = a * c + b * s, b2 = b * c - a * s;
      X[k] = X[k]! + dx * (a2 - a);
      Z[k] = Z[k]! + dz * (a2 - a);
      Y[k] = PY[i]! + b2 - FH[k]! / 2;
      DH[k] = a2;
      DV[k] = b2;
      TA[0] = dz;
      TA[1] = -dx;
      TA[2] = t;
      turn(k);
      if (free) {
        // Let go: each piece falls on with its velocity in the tip (ω × r), still turning.
        const om = OM[i]!;
        toAir(k);
        VY[k] = -om * a2;
        VX[k] = dx * om * b2;
        VZ[k] = dz * om * b2;
        KX[k] = dz;
        KZ[k] = -dx;
        TW[k] = om;
        TB[k] = -1;
      }
    }
  }

  /** One sub-step of falling piece i: gravity, a tumble, then a landing on what is under it. */
  function airStep(i: number) {
    const h = H[0]!, y0 = Y[i]!;
    VY[i] = VY[i]! - g * h;
    X[i] = X[i]! + VX[i]! * h;
    Z[i] = Z[i]! + VZ[i]! * h;
    Y[i] = y0 + VY[i]! * h;
    if (TW[i]) (TA[0] = KX[i]!), (TA[1] = KZ[i]!), (TA[2] = TW[i]! * h), turn(i);
    UY[0] = y0;
    under(i, false);
    let t = UY[0]!, j = S[0]!;
    if (j === -3) (t = floor), (j = -2);
    if (Y[i]! > t) return;
    Y[i] = t;
    if (TW[i] || Q[i * 9 + 4] !== 1) snap(i);
    TW[i] = 0;
    if (j === -2 && !OFF[i]) (OFF[i] = 1), ev && ev.emit("flick:fall", i);
    if (VY[i]! < -2.5) VY[i] = -VY[i]! * E[i]! * 0.3; // a small bounce; it lands next time
    else (VY[i] = 0), (ST[i] = SLIDE), (SUP[i] = j);
  }

  /** One sub-step of supported piece i: still held? tip or fly off; slope, friction, slide, rest. */
  function slideStep(i: number) {
    const h = H[0]!, j = SUP[i]!;
    if (j >= 0 && ST[j]! >= AIR) return toAir(i);
    if (ST[i] === REST) {
      if (j < 0 || ST[j] === REST) return;
      ST[i] = SLIDE; // what it rests on moves: friction drags it
    }
    const ramp = j >= 0 && K[j] === 2;
    if (ramp) {
      if (!over(j, i)) return toAir(i, true);
    } else if (j !== -2) {
      // Is the centre of mass (with what is stacked on it) over what holds it, along each axis?
      const ux = K[i] ? UX[i]! : 1, uz = K[i] ? UZ[i]! : 0, cx = MX[i]! / MM[i]! - X[i]!, cz = MZ[i]! / MM[i]! - Z[i]!;
      let best = 0, bx = 0, bz = 0, bp = 0;
      for (let a = 0; a < 2; a++) {
        const ax = a ? -uz : ux, az = a ? ux : uz, e = a ? FV[i]! : FU[i]!, cu = cx * ax + cz * az;
        IV[2] = ax;
        IV[3] = az;
        IV[4] = e;
        interval(i, j);
        if (IV[0]! > IV[1]!) return toAir(i);
        if (cu - IV[1]! > best) (best = cu - IV[1]!), (bx = ax), (bz = az), (bp = IV[1]!);
        if (IV[0]! - cu > best) (best = IV[0]! - cu), (bx = -ax), (bz = -az), (bp = -IV[0]!);
      }
      if (best > 0) {
        const sx = VX[i]! - (j >= 0 ? VX[j]! : 0), sz = VZ[i]! - (j >= 0 ? VZ[j]! : 0);
        HY[0] = sx;
        HY[1] = sz;
        len();
        if (HY[2]! > vtip) return toAir(i);
        TA[0] = bx;
        TA[1] = bz;
        TA[2] = bp;
        return startTip(i);
      }
    }
    // Ride up onto a ramp from the table.
    if (j === -1 && nb)
      for (let r = 0; r < n; r++)
        if (K[r] === 2 && over(r, i) && (top(r, i), TOP[0]! <= Y[i]! + lip)) {
          SUP[i] = r;
          return;
        }
    const vsx = j >= 0 ? VX[j]! : 0, vsz = j >= 0 ? VZ[j]! : 0, dec = (j === -2 ? ffl : MU[i]!) * g * h;
    let slope = 0;
    if (ramp) {
      // Down the slope (+x of the ramp): g sinθ cosθ across the plane.
      const k = FH[j]! / (2 * FU[j]!);
      slope = (g * k) / (1 + k * k);
    }
    let rx = VX[i]! - vsx, rz = VZ[i]! - vsz;
    HY[0] = rx;
    HY[1] = rz;
    len();
    let s = HY[2]!;
    if (s <= dec && slope <= MU[i]! * g && Math.abs(W[i]!) < 0.02 && (j < 0 || ST[j] === REST)) {
      VX[i] = vsx; VZ[i] = vsz; VY[i] = 0; W[i] = 0; ST[i] = REST;
      return;
    }
    if (slope) (rx += UX[j]! * slope * h), (rz += UZ[j]! * slope * h), (HY[0] = rx), (HY[1] = rz), len(), (s = HY[2]!);
    if (s <= dec) (rx = 0), (rz = 0);
    else (rx -= (rx / s) * dec), (rz -= (rz / s) * dec);
    VX[i] = vsx + rx;
    VZ[i] = vsz + rz;
    X[i] = X[i]! + VX[i]! * h;
    Z[i] = Z[i]! + VZ[i]! * h;
    if (W[i]) {
      // Spin: friction slows it; the yaw vector turns (renormalised: no drift in its length).
      const sd = (3 * MU[i]! * g * h) / (FU[i]! + FV[i]!), w = W[i]!;
      W[i] = w > sd ? w - sd : w < -sd ? w + sd : 0;
      SC[0] = W[i]! * h;
      sc();
      const ux = UX[i]!, uz = UZ[i]!, a = ux * SC[1]! + uz * SC[0]!, b = uz * SC[1]! - ux * SC[0]!;
      HY[0] = a;
      HY[1] = b;
      len();
      const l = HY[2]!;
      UX[i] = a / l;
      UZ[i] = b / l;
    }
    if (ramp) {
      top(j, i);
      const y = TOP[0]!;
      VY[i] = (y - Y[i]!) / h;
      Y[i] = y;
    } else Y[i] = j === -1 ? 0 : j === -2 ? floor : Y[j]! + FH[j]!;
  }

  /** Contact between i and j into CT ([nx, nz] from i to j, depth, point); false: apart. */
  function contact(i: number, j: number): boolean {
    const ci = !K[i], cj = !K[j];
    if (ci && cj) {
      const dx = X[j]! - X[i]!, dz = Z[j]! - Z[i]!;
      HY[0] = dx;
      HY[1] = dz;
      len();
      const d = HY[2]!, p = FU[i]! + FU[j]! - d;
      if (p <= 0) return false;
      CT[0] = d ? dx / d : 1; CT[1] = d ? dz / d : 0; CT[2] = p;
      CT[3] = X[i]! + CT[0]! * FU[i]!; CT[4] = Z[i]! + CT[1]! * FU[i]!;
      return true;
    }
    if (ci || cj) {
      // A circle against a turned rectangle: the closest point, or out along the shallow axis.
      const c = ci ? i : j, b = ci ? j : i, sg = ci ? 1 : -1, ux = UX[b]!, uz = UZ[b]!, r = FU[c]!;
      const dx = X[c]! - X[b]!, dz = Z[c]! - Z[b]!, lu = dx * ux + dz * uz, lv = dz * ux - dx * uz, fu = FU[b]!, fv = FV[b]!;
      const qu = lu < -fu ? -fu : lu > fu ? fu : lu, qv = lv < -fv ? -fv : lv > fv ? fv : lv;
      const qx = X[b]! + qu * ux - qv * uz, qz = Z[b]! + qu * uz + qv * ux, ex = qx - X[c]!, ez = qz - Z[c]!;
      HY[0] = ex;
      HY[1] = ez;
      len();
      const d = HY[2]!;
      if (qu !== lu || qv !== lv) {
        if (d >= r) return false;
        CT[0] = (sg * ex) / d; CT[1] = (sg * ez) / d; CT[2] = r - d;
      } else {
        const ou = fu - Math.abs(lu), ov = fv - Math.abs(lv), su = lu < 0 ? 1 : -1, sv = lv < 0 ? 1 : -1;
        // Normal from the circle into the box: against the nearer face's outward direction.
        if (ou < ov) (CT[0] = sg * su * ux), (CT[1] = sg * su * uz), (CT[2] = r + ou);
        else (CT[0] = -sg * sv * uz), (CT[1] = sg * sv * ux), (CT[2] = r + ov);
      }
      CT[3] = qx; CT[4] = qz;
      return true;
    }
    // Two turned rectangles: separating axes (each one's x and z), the shallowest overlap wins.
    const dx = X[j]! - X[i]!, dz = Z[j]! - Z[i]!;
    let p = Infinity, nx = 0, nz = 0;
    for (let a = 0; a < 4; a++) {
      const b = a < 2 ? i : j, ax = a & 1 ? -UZ[b]! : UX[b]!, az = a & 1 ? UX[b]! : UZ[b]!;
      const ri = FU[i]! * Math.abs(UX[i]! * ax + UZ[i]! * az) + FV[i]! * Math.abs(UX[i]! * az - UZ[i]! * ax);
      const rj = FU[j]! * Math.abs(UX[j]! * ax + UZ[j]! * az) + FV[j]! * Math.abs(UX[j]! * az - UZ[j]! * ax);
      const dd = dx * ax + dz * az, o = ri + rj - Math.abs(dd);
      if (o <= 0) return false;
      if (o < p) (p = o), (nx = dd < 0 ? -ax : ax), (nz = dd < 0 ? -az : az);
    }
    // The point: halfway between each one's corner furthest into the other.
    const si = (UX[i]! * nx + UZ[i]! * nz < 0 ? -1 : 1) * FU[i]!, ti = (UX[i]! * nz - UZ[i]! * nx < 0 ? -1 : 1) * FV[i]!;
    const sj = (UX[j]! * nx + UZ[j]! * nz < 0 ? 1 : -1) * FU[j]!, tj = (UX[j]! * nz - UZ[j]! * nx < 0 ? 1 : -1) * FV[j]!;
    CT[0] = nx; CT[1] = nz; CT[2] = p;
    CT[3] = (X[i]! + si * UX[i]! - ti * UZ[i]! + X[j]! + sj * UX[j]! - tj * UZ[j]!) / 2;
    CT[4] = (Z[i]! + si * UZ[i]! + ti * UX[i]! + Z[j]! + sj * UZ[j]! + tj * UX[j]!) / 2;
    return true;
  }
  /** Push i and j apart and exchange the impulse (with spin for boxes); wake them. */
  function resolve(i: number, j: number) {
    const nx = CT[0]!, nz = CT[1]!, p = CT[2]!, mi = IM[i]!, mj = IM[j]!, tot = mi + mj;
    if (!tot) return;
    X[i] = X[i]! - (nx * p * mi) / tot; Z[i] = Z[i]! - (nz * p * mi) / tot;
    X[j] = X[j]! + (nx * p * mj) / tot; Z[j] = Z[j]! + (nz * p * mj) / tot;
    const ax = CT[3]! - X[i]!, az = CT[4]! - Z[i]!, bx = CT[3]! - X[j]!, bz = CT[4]! - Z[j]!;
    const vn = (VX[j]! + W[j]! * bz - VX[i]! - W[i]! * az) * nx + (VZ[j]! - W[j]! * bx - VZ[i]! + W[i]! * ax) * nz;
    if (ST[i] === REST && !FX[i]) ST[i] = SLIDE;
    if (ST[j] === REST && !FX[j]) ST[j] = SLIDE;
    if (vn >= 0) return;
    const ca = az * nx - ax * nz, cb = bz * nx - bx * nz, jn = (-(1 + (E[i]! + E[j]!) / 2) * vn) / (tot + II[i]! * ca * ca + II[j]! * cb * cb);
    VX[i] = VX[i]! - nx * jn * mi; VZ[i] = VZ[i]! - nz * jn * mi; W[i] = W[i]! - II[i]! * ca * jn;
    VX[j] = VX[j]! + nx * jn * mj; VZ[j] = VZ[j]! + nz * jn * mj; W[j] = W[j]! + II[j]! * cb * jn;
    if (vn < -0.3) ev && ev.emit("flick:hit", i, j, CT[3], CT[4], -vn);
  }
  /** Every pair that overlaps in height and could move, in index order (deterministic). */
  function collide() {
    for (let i = 0; i < n; i++) {
      if (ST[i] === TIP) continue;
      for (let j = i + 1; j < n; j++) {
        if (ST[j] === TIP || ((FX[i] || ST[i] === REST) && (FX[j] || ST[j] === REST))) continue;
        if (Y[i]! >= Y[j]! + FH[j]! - 1e-9 || Y[j]! >= Y[i]! + FH[i]! - 1e-9) continue;
        // A ramp is a wall only where its slope is above the piece's lip; a piece on it rides it.
        const r = K[i] === 2 ? i : K[j] === 2 ? j : -1, b = r === i ? j : i;
        if (r >= 0) {
          if (SUP[b] === r) continue;
          top(r, b);
          if (TOP[0]! <= Y[b]! + lip) continue;
        }
        if (contact(i, j)) resolve(i, j);
      }
    }
  }

  /** One sub-step of H[0] seconds. */
  function substep() {
    // Mass and centre of mass with everything stacked on each piece.
    for (let i = 0; i < n; i++) (MM[i] = M[i]!), (MX[i] = M[i]! * X[i]!), (MZ[i] = M[i]! * Z[i]!);
    for (let i = 0; i < n; i++)
      if (!FX[i] && ST[i]! < AIR)
        for (let j = SUP[i]!, k = 0; j >= 0 && k < n; j = SUP[j]!, k++) (MM[j] = MM[j]! + M[i]!), (MX[j] = MX[j]! + M[i]! * X[i]!), (MZ[j] = MZ[j]! + M[i]! * Z[i]!);
    for (let i = 0; i < n; i++) if (ST[i] === TIP && TB[i] === i) tipStep(i);
    for (let i = 0; i < n; i++) {
      if (FX[i] || ST[i] === TIP) continue;
      if (ST[i] === AIR) airStep(i);
      else slideStep(i);
    }
    collide();
  }

  const api = {
    /** Pieces added. */
    get n() {
      return n;
    },
    /** Anything moving, falling or tipping (false: everything rests). */
    get busy() {
      return wasBusy;
    },
    /** Bottom centre x, y, z (the table top's frame) and velocity, per piece. */
    x: X, y: Y, z: Z, vx: VX, vy: VY, vz: VZ,
    /** Spin about y (rad/s), mass and inverse spin inertia (0: a disc, a fixed piece). */
    spin: W, mass: M, ii: II,
    /** `STATE` per piece; `off`: 1 once it fell off the table; `on`: what it rests on (−1 the
     *  table, −2 the floor, −3 nothing: in the air) or another piece's index. */
    state: ST, off: OFF, on: SUP,
    /** Add a piece, ramp or wall (`FlickBodyDef`); returns its index. Add what holds a piece first. */
    add(d: FlickBodyDef = {}): number {
      if (n === cap) throw new RangeError(`fizlet: flick holds ${cap} pieces (cap)`);
      const i = n++, s = d.size || [1, 0.3, 1], k = d.shape === "ramp" ? 2 : d.shape === "box" ? 1 : 0;
      K[i] = k;
      FX[i] = k === 2 || d.fixed ? 1 : 0;
      HX[i] = need(s[0], "size", 1) / 2; HH[i] = need(s[1], "size", 1) / 2; HZ[i] = k ? need(s[2] ?? s[0], "size", 1) / 2 : HX[i]!;
      M[i] = need(d.mass ?? 1, "mass", 1);
      IM[i] = FX[i] ? 0 : 1 / M[i]!;
      MU[i] = need(d.friction ?? 0.25, "friction");
      E[i] = need(d.bounce ?? 0.8, "bounce");
      SC[0] = k ? need(d.yaw ?? 0, "yaw") : 0;
      sc();
      UX[i] = SC[1]!; UZ[i] = -SC[0]!;
      Q.fill(0, i * 9, i * 9 + 9);
      Q[i * 9] = Q[i * 9 + 4] = Q[i * 9 + 8] = 1;
      dims(i);
      if (k === 2) nb++;
      api.place(i, d.pos?.[0] ?? 0, d.pos && d.pos.length > 2 ? d.pos[2]! : (d.pos?.[1] ?? 0), d.pos && d.pos.length > 2 ? d.pos[1] : undefined);
      return i;
    },
    /** Put piece i at (x, z) upright and still: on the highest surface under it, or from height y. */
    place(i: number, x: number, z: number, y?: number) {
      X[i] = x; Z[i] = z; VX[i] = VY[i] = VZ[i] = W[i] = TW[i] = 0; OFF[i] = 0; TB[i] = -1;
      if (FX[i]) return (Y[i] = y ?? 0), (ST[i] = REST), (SUP[i] = -3);
      UY[0] = y ?? Infinity;
      under(i, true);
      const t = UY[0]!, j = S[0]!;
      wasBusy = true;
      if (y != null && y > t + 1e-9) return (Y[i] = y), toAir(i);
      Y[i] = j === -3 ? floor : t;
      SUP[i] = j === -3 ? -2 : j;
      ST[i] = SLIDE; // checked on the next step: an unstable stack topples
    },
    /** Flick piece i with impulse (jx, jz) (velocity change: impulse ÷ mass). */
    flick(i: number, jx: number, jz: number) {
      if (FX[i]) return;
      VX[i] = VX[i]! + jx * IM[i]!;
      VZ[i] = VZ[i]! + jz * IM[i]!;
      if (ST[i] === REST) ST[i] = SLIDE;
      wasBusy = true;
    },
    /** Advance dt seconds (`sub` fixed sub-steps); returns `busy`. Call it from the engine's step. */
    step(dt: number): boolean {
      if (!wasBusy) return false;
      H[0] = dt / sub;
      for (let s = 0; s < sub; s++) substep();
      let b = false;
      for (let i = 0; i < n; i++) if (ST[i] !== REST) b = true;
      if (wasBusy && !b) ev && ev.emit("flick:rest");
      wasBusy = b;
      return b;
    },
    /** Step at `dt` until everything rests or `max` steps pass; returns the steps taken. */
    run(dt = 1 / 60, max = 3600): number {
      let k = 0;
      for (; k < max && wasBusy; k++) api.step(dt);
      return k;
    },
    /** How far a piece sliding at `speed` on a flat goes before friction stops it: v² ÷ 2μg. */
    reach: (i: number, speed: number) => (speed * speed) / (2 * MU[i]! * g),
    /** Piece i's pose for a diorama object: out = [x, y, z, rx, ry, rz] (its bottom-centre origin and
     *  `rot`, through a topple too). */
    pose(i: number, out: { [k: number]: number }) {
      const q = i * 9, ux = UX[i]!, uz = UZ[i]!, hh = HH[i]!;
      // M = Ry(yaw) · Q; diorama's rot is R = Ry Rx Rz.
      const m01 = ux * Q[q + 1]! - uz * Q[q + 7]!, m21 = uz * Q[q + 1]! + ux * Q[q + 7]!, m02 = ux * Q[q + 2]! - uz * Q[q + 8]!, m22 = uz * Q[q + 2]! + ux * Q[q + 8]!;
      const m12 = Q[q + 5]!, m10 = Q[q + 3]!, m11 = Q[q + 4]!;
      out[0] = X[i]! - hh * m01;
      out[1] = Y[i]! + FH[i]! / 2 - hh * m11;
      out[2] = Z[i]! - hh * m21;
      out[3] = Math.asin(m12 > 1 ? -1 : m12 < -1 ? 1 : -m12);
      if (Math.abs(m12) < 0.999999) (out[4] = Math.atan2(m02, m22)), (out[5] = Math.atan2(m10, m11));
      else (out[4] = Math.atan2(-(uz * Q[q]! + ux * Q[q + 6]!), ux * Q[q]! - uz * Q[q + 6]!)), (out[5] = 0);
      return out;
    },
    /** Write piece i's pose into a diorama object (`pos`, `rot`) resting on the table (or on a parent
     *  whose top is at height `y0` in the table's frame: −2 for a floor at `floor` −2, so its shadow
     *  falls on the floor). */
    apply(i: number, ob: { pos: { [k: number]: number }; rot: { [k: number]: number } }, y0 = 0) {
      api.pose(i, P6);
      ob.pos[0] = P6[0]!; ob.pos[1] = P6[1]! - y0; ob.pos[2] = P6[2]!;
      ob.rot[0] = P6[3]!; ob.rot[1] = P6[4]!; ob.rot[2] = P6[5]!;
    },
  };
  const P6 = new Float64Array(6);
  return api;
}
/** What `flick` returns. */
export type Flick = ReturnType<typeof flick>;

/** Options for `sling()`: how far a full pull is, the impulse it gives and how fine the shot is. */
export interface SlingOptions {
  /** Drag length (world units) for full power (default 3). */
  pull?: number;
  /** The impulse at full power (default 12). */
  max?: number;
  /** Power under this (0..1) is no shot: `end()` returns false (default 0.05). */
  min?: number;
  /** Power levels (default 100): `level` is an integer 0..steps. */
  steps?: number;
  /** Directions per turn (default 4096): `angle` is an integer 0..turns − 1. */
  turns?: number;
}

/**
 * A slingshot drag that turns a pointer into an aimed flick: press on a piece (`begin` with its
 * centre and the pointer's point on the table, from diorama's `ground`), pull back (`move`), let go
 * (`end`). The shot points from the pointer to the piece; `power` (0..1) is the pull over `pull`, the
 * meter to draw. The shot is two integers, `angle` and `level`, so a game sends them as they are and
 * the other player's `set(angle, level)` gives the same `jx`, `jz` bit for bit (no Math.sin).
 */
export function sling(o: SlingOptions = {}) {
  const pull = need(o.pull ?? 3, "pull", 1), max = need(o.max ?? 12, "max"), min = need(o.min ?? 0.05, "min");
  const steps = need(o.steps ?? 100, "steps", 2), turns = need(o.turns ?? 4096, "turns", 2);
  const a = {
    /** A drag is on. */
    active: false,
    /** The piece's centre the drag pulls from. */
    ax: 0, az: 0,
    /** The shot: direction index (0..turns − 1, from +x toward +z) and power level (0..steps). */
    angle: 0, level: 0,
    /** level ÷ steps. */
    power: 0,
    /** The unit direction and the impulse for `flick`. */
    dx: 1, dz: 0, jx: 0, jz: 0,
    /** Start a drag on the piece at (x, z), the pointer at (px, pz). */
    begin(x: number, z: number, px: number, pz: number) {
      a.active = true;
      a.ax = x;
      a.az = z;
      a.move(px, pz);
    },
    /** The pointer moved to (px, pz): the shot points from it to the piece. */
    move(px: number, pz: number) {
      if (!a.active) return;
      const lx = a.ax - px, lz = a.az - pz, l = hypot(lx, lz), p = l / pull;
      a.set(l ? Math.round((Math.atan2(lz, lx) / TAU) * turns) : a.angle, Math.round((p > 1 ? 1 : p) * steps));
    },
    /** Set the shot from its two integers (a remote player's): the same impulse everywhere. */
    set(angle: number, level: number) {
      a.angle = ((angle % turns) + turns) % turns;
      a.level = level < 0 ? 0 : level > steps ? steps : level;
      a.power = a.level / steps;
      SC[0] = (a.angle / turns) * TAU;
      sc();
      a.dx = SC[1]!;
      a.dz = SC[0]!;
      a.jx = a.dx * a.power * max;
      a.jz = a.dz * a.power * max;
    },
    /** Let go: true if it is a shot (power ≥ `min`); then `jx`, `jz`, `angle`, `level` hold it. */
    end(): boolean {
      const was = a.active;
      a.active = false;
      return was && a.power >= min;
    },
    /** Drop the drag without a shot. */
    cancel() {
      a.active = false;
      a.level = 0;
      a.power = a.jx = a.jz = 0;
    },
  };
  return a;
}
/** What `sling` returns. */
export type Sling = ReturnType<typeof sling>;
