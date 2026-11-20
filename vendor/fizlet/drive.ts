/**
 * @fzlt/core/drive: vehicle feel on a heightfield, for diorama racing and trail games. One small,
 * fixed-step model for two wheels (a dirt bike) and four (a Jeep, a truck, a buggy, a car):
 * throttle, brake (and reverse), steering that tightens less at speed, grip and drift (the tyres
 * hold a sideways slide only up to `grip`, a handbrake input lets the rear go), a spring and damper
 * per wheel so the body pitches, rolls, squats and dives with the ground under each wheel, airtime
 * off a lip, and a landing that is judged: a bike that lands nose or tail too far off the slope, or a
 * car that rolls past `crashRoll`, crashes.
 * - The ground is anything with `sample(x, z, out)` (out = [height, nx, ny, nz], returns a surface
 *   kind): `@fzlt/core/terrain` is one, and its painted kinds can change the grip (`surfaces`).
 * - Deterministic: the same inputs from the same start give the same path, bit for bit. The model
 *   uses only + − × ÷, square roots and its own polynomial sine and arctangent (the builtins may
 *   differ in the last bit between browsers), so two players replaying the same inputs agree.
 * - Suspension: each wheel samples the ground on its own and has its own spring (`stiffness` or `hz`,
 *   `progressive`), damper (`damping` compressing, `rebound` extending), `travel` and a `bump` stop; the
 *   body heaves, pitches and rolls on the sum of the spring loads with its own `inertia`, so a big drop
 *   compresses the springs, rebounds and settles (a long-travel buggy: `travel` 0.5 or more, soft and
 *   progressive, more rebound than compression damping).
 * - Outputs for drawing: `pos` and `rot` (diorama's order: [roll, yaw, pitch]) for the body, per
 *   wheel `comp` (how far its spring is pushed in) and `press` (the same, 0..1 of the travel), `spin`
 *   (radians) and `contact`, `bodyPitch` and `bodyRoll` (the lean on the springs), `stroke` (the most any
 *   spring is in: 1 is the bump stop), the front wheels' `steerAngle`, and `dust` (0..1: how hard the
 *   tyres throw dirt, spray or sand) for an emitter.
 * - Drift: the handbrake input lets the rear go (the grip drops to `drift`, the tail swings out by
 *   `swing`, the slide is held under `slide` radians and counter-steer catches it; letting go hands
 *   `recover` of the sideways speed back as forward speed). `drift` (0..1) says how hard it is
 *   drifting right now, `slide` the body's angle to its travel, `chain` the drift score so far
 *   (∫ drift dt); a chain that ends banks as `drive:drift` (v: its score; b: 1 when a crash or a
 *   spin-out broke it). `spinOut(rate, secs)` spins it round with no control for a moment.
 * - Contact between vehicles: `touch(a, b, opts)` (or `touchAll(list, opts)`, every pair in order)
 *   pushes two hulls apart (a box from `hull` [half length, half width], or a circle: one radius) by
 *   their `mass` and bounces their velocities along the contact normal; `onHit(a, b, hit)` gets the
 *   impulse in `hit` (`touchHit`: [impulse, nx, nz, depth, x, z], the normal from a to b), so a game
 *   can spin out a drifting car it rams.
 * - `chase(cam, target, opts, dt)` eases a diorama camera behind and above anything with `pos` and
 *   `yaw` (cosmetic: it uses the builtin maths; pass `snap` for reduced motion).
 * - Rollback: `state` is every byte the model carries from step to step (one buffer); `save(dst)` and
 *   `load(src)` copy it out and back, so a game can rewind and replay a car bit for bit.
 * Zero allocation per step, also with several vehicles in one process (typed arrays; locals; one class
 * for every vehicle, its model in module functions, so a loop over cars keeps one call target). Speeds
 * are world units per second, angles radians.
 */
import { hypot } from "./steer";

/** What drive needs from the ground: height and normal under (x, z); the return is a surface kind. */
export interface DriveGround {
  sample(x: number, z: number, out: { [i: number]: number }): number;
}

/** Something that takes events: an engine's ring (`engine.events`). */
export interface DriveEvents {
  emit(type: string, a?: number, b?: number, x?: number, y?: number, v?: number): unknown;
}

/** Options for `drive()`: the vehicle's shape, its feel and its limits. Defaults by `kind`. */
export interface DriveOptions {
  /** "car" (four wheels, default) or "bike" (two in line, leans into turns, rear-wheel drive). */
  kind?: "car" | "bike";
  /** Wheel offsets from the body's centre, [forward, right, …] (car: ±0.75 × ±0.5; bike: ±0.6 × 0). */
  wheels?: ArrayLike<number>;
  /** Wheel radius (car 0.28, bike 0.32). */
  radius?: number;
  /** Spring length at full stretch, from the body's origin to the wheel centre (car 0.3, bike 0.35). */
  rest?: number;
  /** Spring travel before the bump stop (car 0.24, bike 0.3; a long-travel buggy or trophy truck 0.5 or more). */
  travel?: number;
  /** Bounce frequency of the springs, Hz (default 2.2). */
  hz?: number;
  /** The spring rate instead of `hz`: the whole vehicle's, per unit mass, 1/s² (the sag is gravity / stiffness;
   *  default (2π · 2.2)² ≈ 191). */
  stiffness?: number;
  /** Progressive springs: the rate grows by this share times (compression / travel)² (default 0: linear; 1 is
   *  twice as stiff at full travel, soft over small bumps and firm on a big landing). */
  progressive?: number;
  /** Damping ratio of the springs while they compress (default 0.75). */
  damping?: number;
  /** Damping ratio while they extend (default `damping`): more holds the body down after a landing instead of a bounce. */
  rebound?: number;
  /** The bump stop past `travel`: its rate as a multiple of the spring's (default 10). */
  bump?: number;
  /** Body inertia for pitch and roll, a multiple of the springs' match (same bounce as heave): one number, or
   *  [pitch, roll] (default 1; more pitches and rolls slower and further). */
  inertia?: number | ArrayLike<number>;
  /** How fast a wheel off the ground drops to full droop, units / s (default Infinity: at once; drawing only). */
  droop?: number;
  /** Gravity, units / s² (default 20). */
  gravity?: number;
  /** Acceleration at full throttle from a standstill (car 10, bike 12). */
  accel?: number;
  /** Top speed on the flat (car 16, bike 18): throttle's pull fades to 0 there. */
  top?: number;
  /** Braking deceleration (default 22). */
  brake?: number;
  /** Top speed backwards (brake held at a stop; default 5). */
  reverse?: number;
  /** Rolling drag with no pedal, units / s² (default 2.5). */
  coast?: number;
  /** Sideways grip, in g (car 1, bike 1.15): the most sideways acceleration the tyres hold. */
  grip?: number;
  /** Rear grip left at the full handbrake / drift input (default 0.4). */
  drift?: number;
  /** How far the tail swings out on the handbrake: the turn tightens by 1 + swing (default 1). */
  swing?: number;
  /** Most slide angle (body to travel) a drift holds before the swing stops, radians (default 0.8). */
  slide?: number;
  /** Share of the sideways speed the tyres hand back as forward speed coming out of a drift (default 0.35). */
  recover?: number;
  /** For `touch`: mass (car 1, bike 0.5). */
  mass?: number;
  /** For `touch`: the hull, [half length, half width] (a box; default the wheels plus their radius), or one radius (a circle). */
  hull?: number | ArrayLike<number>;
  /** Most steering, as a wheel angle (car 0.6, bike 0.7). */
  steer?: number;
  /** Speed at which steering is down to half (default 12). */
  steerFall?: number;
  /** Centre of mass height over the springs: squat, dive and body roll (car 0.35, bike 0.3). */
  cg?: number;
  /** Bike: most lean into a turn (default 0.9). */
  lean?: number;
  /** Pitch control in the air, rad / s² at full throttle (nose up) or brake (nose down) (car 2, bike 6). */
  airPitch?: number;
  /** A landing (or a moment on the ground) this far off the slope's pitch crashes (car 1, bike 0.65). */
  crashPitch?: number;
  /** Off the slope's roll by this much crashes: a rollover (car 1.1; bikes do not check). */
  crashRoll?: number;
  /** Landing faster than this downward crashes (default 30). */
  crashDrop?: number;
  /** Grip multiplier per ground kind: surfaces[k] for kind k (default 1). */
  surfaces?: ArrayLike<number>;
  /** Steps per `step()` (default 2: the springs stay stable at 60 Hz). */
  substeps?: number;
  /** An event ring: `drive:air`, `drive:land` (v: how far off the slope), `drive:crash`, `drive:drift`
   *  (v: the chain's score; b: 1 when broken), with `id` as a. */
  events?: DriveEvents;
  /** The id events carry (default 0). */
  id?: number;
}

/** What `drive` returns. */
export type Drive = Ride;

const PI = 3.141592653589793, TAU = 6.283185307179586;
/** Arctangent from a polynomial (within 1e-5 rad; identical in every browser). */
function atan(s: number) {
  const a = Math.abs(s), t = a > 1 ? 1 / a : a, q = t * t, r = t * (0.999866 + q * (-0.3302995 + q * (0.180141 + q * (-0.085133 + q * 0.0208351)))), v = a > 1 ? PI / 2 - r : r;
  return s < 0 ? -v : v;
}

/** A vehicle: its state in typed arrays, its read-outs as getters, its model in module functions that
 *  take it (one call target for every vehicle: per-vehicle closures made a loop over several cars
 *  deoptimise on "wrong call target" and box doubles, 10 to 15 young GCs per 200,000 rounds of 4 cars). */
class Ride {
  /** Everything the model carries from one step to the next (and its read-outs), as bytes over one
   *  buffer: copy it out and back in to roll back and replay bit for bit (`save` / `load`). */
  state: Uint8Array;
  /** @internal The model's state (see `S` below), first in `state`'s buffer. */
  _s: Float64Array;
  /** @internal Flags: crashed, air, rest. */
  _f: Uint8Array;
  /** @internal The options, resolved (see `P` below). */
  _p = new Float64Array(35);
  /** @internal Scratch: slope (pitch, roll), substep; trig; spring sums; one ground sample. */
  _sl = new Float64Array(3);
  _tr = new Float64Array(4);
  _ac = new Float64Array(12);
  _g4 = new Float64Array(4);
  /** @internal The ground, the event ring, wheel count, bike (1) or not (0), driven wheels, kinds' grip. */
  _g: DriveGround;
  _ev: DriveEvents | undefined;
  _n: number;
  _bike: number;
  _drv: Uint8Array;
  _surf: ArrayLike<number>;
  /** @internal Per wheel: ground height, raw compression, spin rate. */
  _gh: Float64Array;
  _raw: Float64Array;
  _sr: Float64Array;
  /** World velocity. */
  vel: Float64Array;
  /** Inputs, each step: [throttle 0..1, brake 0..1 (reverse at a stop), steer −1..1 (+1 right), drift (handbrake) 0..1]. */
  input: Float64Array;
  /** The body's origin (at the spring tops), world. */
  pos: Float64Array;
  /** Body rotation in diorama's order, [roll about x, yaw about y, pitch about z (nose up +)]. */
  rot: Float64Array;
  /** Wheel offsets [forward, right, …] as given. */
  wheels: Float64Array;
  /** Per wheel: spring compression, 0..travel (the wheel centre sits rest − comp under the body origin). */
  comp: Float64Array;
  /** Per wheel: compression as a share of the travel, 0..1 (draw the arm's angle from it). */
  press: Float64Array;
  /** Per wheel: rolling angle, radians. */
  spin: Float64Array;
  /** Per wheel: 1 on the ground. */
  contact: Uint8Array;
  /** Per wheel: centre in world [x, y, z, …] (dust emitters, skid marks). */
  wheel: Float64Array;
  /** Wheel radius, spring rest length and travel. */
  radius: number;
  rest: number;
  travel: number;
  /** The last landing: [downward speed, how far off the slope it was (radians)]. */
  landing: Float64Array;
  /** For `touch`: mass. */
  mass: number;
  /** For `touch`: [half length, half width] (a box), or [radius, 0] (a circle). */
  hull = new Float64Array(2);
  constructor(ground: DriveGround, o: DriveOptions) {
    const bike = o.kind === "bike", W = Float64Array.from(o.wheels || (bike ? [0.6, 0, -0.6, 0] : [0.75, -0.5, 0.75, 0.5, -0.75, -0.5, -0.75, 0.5]));
    const n = W.length >> 1, R = o.radius ?? (bike ? 0.32 : 0.28), rest = o.rest ?? (bike ? 0.35 : 0.3), travel = o.travel ?? (bike ? 0.3 : 0.24), g = o.gravity ?? 20;
    const w0 = o.stiffness ? Math.sqrt(o.stiffness) : TAU * (o.hz ?? 2.2), k = o.stiffness || w0 * w0, z = o.damping ?? 0.75, prog = o.progressive ?? 0;
    this._g = ground; this._ev = o.events; this._n = n; this._bike = bike ? 1 : 0; this._surf = o.surfaces || [];
    this.wheels = W; this.radius = R; this.rest = rest; this.travel = travel; this.mass = o.mass ?? (bike ? 0.5 : 1);
    // The state: one buffer, the doubles first (S at 0: a game may read it as a Float64Array), then the
    // flags and contacts, padded to whole doubles.
    const nd = 38 + 8 * n, buf = new ArrayBuffer(nd * 8 + (((3 + n + 7) >> 3) << 3));
    let at = 0;
    const f = (k: number) => ((at += k), new Float64Array(buf, (at - k) * 8, k));
    this._s = f(25); this.vel = f(3); this.input = f(4); this.pos = f(3); this.rot = f(3);
    this.comp = f(n); this.press = f(n); this.spin = f(n); this.wheel = f(n * 3); this._raw = f(n); this._sr = f(n);
    this._f = new Uint8Array(buf, nd * 8, 3); this.contact = new Uint8Array(buf, nd * 8 + 3, n);
    this.state = new Uint8Array(buf);
    this._gh = new Float64Array(n); this._drv = new Uint8Array(n);
    this.landing = this._s.subarray(11, 13);
    // Pitch and roll inertia per unit mass matched to the springs (same bounce as heave), times `inertia`; wheelbase.
    let ip = 0, ir = 0, fmax = -Infinity, fmin = Infinity, side = 0, nDrv = 0;
    for (let i = 0; i < n; i++) (ip += (W[i * 2]! * W[i * 2]!) / n), (ir += (W[i * 2 + 1]! * W[i * 2 + 1]!) / n), (fmax = Math.max(fmax, W[i * 2]!)), (fmin = Math.min(fmin, W[i * 2]!)), (side = Math.max(side, Math.abs(W[i * 2 + 1]!)));
    const iv = o.inertia ?? 1, ia = typeof iv === "number" ? iv : iv[0]!, ib = typeof iv === "number" ? iv : iv[1]!;
    ip = (ip || 0.25) * ia; ir = (ir || 0.25) * ib;
    // The sag: where the (progressive) springs hold the weight.
    let sag = g / k;
    for (let i = 0; i < 8; i++) sag = g / k / (1 + prog * (sag / travel) * (sag / travel));
    const hl = o.hull, HU = this.hull;
    if (typeof hl === "number") HU[0] = hl;
    else if (hl) HU.set([hl[0]!, hl[1]!]);
    else (HU[0] = Math.max(fmax, -fmin) + R), (HU[1] = side + R * 0.5);
    /** Driven wheels: all on a car, the rear on a bike. */
    for (let i = 0; i < n; i++) nDrv += this._drv[i] = !bike || W[i * 2]! < 0 ? 1 : 0;
    // P: radius, rest, travel, gravity, spring rate per wheel, damping (compress, extend) per wheel, accel, top, brake, reverse,
    // coast, grip, drift grip, steer, steer fall, cg, lean, air pitch, crash pitch, crash roll, crash drop, swing, slide, recover,
    // pitch and roll inertia, wheelbase, sag, bump, progressive, droop, substeps, id, driven wheels.
    this._p.set([R, rest, travel, g, k / n, (2 * z * w0) / n, (2 * (o.rebound ?? z) * w0) / n, o.accel ?? (bike ? 12 : 10), o.top ?? (bike ? 18 : 16), o.brake ?? 22, o.reverse ?? 5,
      o.coast ?? 2.5, o.grip ?? (bike ? 1.15 : 1), o.drift ?? 0.4, o.steer ?? (bike ? 0.7 : 0.6), o.steerFall ?? 12, o.cg ?? (bike ? 0.3 : 0.35), o.lean ?? 0.9, o.airPitch ?? (bike ? 6 : 2),
      o.crashPitch ?? (bike ? 0.65 : 1), o.crashRoll ?? 1.1, o.crashDrop ?? 30, o.swing ?? 1, o.slide ?? 0.8, o.recover ?? 0.35,
      ip, ir, fmax - fmin || 1, sag, o.bump ?? 10, prog, o.droop ?? Infinity, o.substeps ?? 2, o.id ?? 0, nDrv]);
    this.reset(0, 0, 0);
  }
  /** Copy the whole state into `dst` (at least `state.length` bytes); allocates nothing. */
  save(dst: Uint8Array) {
    dst.set(this.state);
  }
  /** Put back a state `save` copied (from this vehicle or one made with the same options); allocates nothing. */
  load(src: Uint8Array) {
    this.state.set(src.length === this.state.length ? src : src.subarray(0, this.state.length));
  }
  /** Set the inputs (the same as writing `input`). */
  set(throttle: number, brake: number, steer: number, drift = 0) {
    const i = this.input;
    i[0] = throttle; i[1] = brake; i[2] = steer; i[3] = drift;
  }
  /** Advance dt seconds (the engine's fixed step) in `substeps`; returns true while anything moves. */
  step(dt: number) {
    const S = this._s, sub = this._p[32]!;
    this._sl[2] = dt / sub;
    for (let i = 0; i < sub; i++) sub1(this);
    this.rot[0] = -S[4]!; this.rot[1] = S[0]!; this.rot[2] = S[2]!;
    trig(this);
    S[20] = this._tr[0]!; S[21] = this._tr[1]!;
    // The body against the ground under its wheels: what the springs lean it by.
    slope(this);
    S[23] = S[2]! - this._sl[0]!; S[24] = S[4]! - (this._bike ? 0 : this._sl[1]!);
    return !this._f[2];
  }
  /** Put it down at (x, z) facing `yaw`, on the ground at the springs' sag, still and not crashed; also after a crash. */
  reset(x: number, z: number, yaw = 0) {
    const S = this._s, P = this._p, W = this.wheels, n = this._n, G = this._g4, TR = this._tr, GH = this._gh, sag = P[28]!;
    this.vel.fill(0); S.fill(0); this._sr.fill(0); this.spin.fill(0); this._f.fill(0); this.contact.fill(1);
    this._raw.fill(sag); this.comp.fill(sag); this.press.fill(sag / P[2]!);
    S[0] = yaw;
    trig(this);
    let m = 0;
    for (let i = 0; i < n; i++) {
      this._g.sample(x + TR[0]! * W[i * 2]! + TR[1]! * W[i * 2 + 1]!, z - TR[1]! * W[i * 2]! + TR[0]! * W[i * 2 + 1]!, G);
      GH[i] = G[0]!;
      m += G[0]! / n;
    }
    slope(this);
    S[2] = this._sl[0]!;
    S[4] = this._bike ? 0 : this._sl[1]!;
    this.pos[0] = x; this.pos[1] = m + P[0]! + P[1]! - sag; this.pos[2] = z;
    this.rot[0] = -S[4]!; this.rot[1] = yaw; this.rot[2] = S[2]!;
    S[20] = TR[0]!; S[21] = TR[1]!;
  }
  /** Spin it round at `rate` rad/s (+ left) for `secs` with no control (the handbrake's grip, the spin dying
   *  away): a rammed drifter. Breaks the drift chain. */
  spinOut(rate: number, secs = 1) {
    const S = this._s;
    if (this._f[0]) return;
    S[1] = rate; S[13] = secs; S[14] = 0;
    if (S[16]! > 0) bank(this, 1, this.pos[0]!, this.pos[2]!);
  }
  /** Heading, radians (forward is (cos yaw, 0, −sin yaw), diorama's rot y). */
  get yaw() { return this._s[0]!; }
  /** Speed along the heading (negative backwards). */
  get speed() { return this._s[8]!; }
  /** Ground speed, any direction. */
  get groundSpeed() { return hypot(this.vel[0]!, this.vel[2]!); }
  /** Sideways slide speed: drifting when it is over a unit or so. */
  get slip() { return this._s[7]!; }
  /** 0..1: how hard the tyres throw dust or spray (scale an emitter by it). */
  get dust() { return this._s[9]!; }
  /** The front wheels' steering angle (draw them turned). */
  get steerAngle() { return this._s[10]!; }
  /** Seconds in the air (0 on the ground). */
  get air() { return this._s[6]!; }
  /** 0..1: how hard it is drifting now (the slide angle past a small slip, scaled by speed; 0 in the air,
   *  crashed or spun out): score it per second. */
  get drift() { return this._s[14]!; }
  /** The body's angle to its travel, radians (+: the nose points left of where it is going). */
  get slide() { return this._s[15]!; }
  /** The current drift chain's score so far (∫ drift dt; banked by `drive:drift` half a second after it ends). */
  get chain() { return this._s[16]!; }
  /** The last chain banked (or broken). */
  get lastChain() { return this._s[19]!; }
  /** Seconds of a spin-out left (no control while it lasts). */
  get spinning() { return this._s[13]!; }
  /** The most any spring is pushed in now, as a share of the travel (1 and over: on the bump stop). */
  get stroke() { return this._s[22]!; }
  /** The body's pitch against the ground under its wheels, radians (nose up +): squat, dive, a landing's nod. */
  get bodyPitch() { return this._s[23]!; }
  /** The body's roll against the ground under its wheels, radians (diorama's sign: −rot[0]; a bike's lean). */
  get bodyRoll() { return this._s[24]!; }
  /** Crashed (inputs ignored until `reset`). */
  get crashed() { return this._f[0] === 1; }
  /** At rest: nothing moves (the engine may settle). */
  get resting() { return this._f[2] === 1; }
}

// S: yaw, yaw rate, pitch, pitch rate, roll, roll rate, air time, slip, forward speed, dust, steer angle, impact, landing error,
// spin-out left, drift, slide angle, chain, chain gap, drift memory, last chain, cos yaw, sin yaw, stroke, body pitch, body roll.

/** Ground slope along the body (pitch) or across it (roll) under the wheels, by least squares, as an angle,
 *  into SL (never returned: a double crossing a call the JIT does not inline is boxed). */
function slope(r: Ride) {
  const n = r._n, W = r.wheels, GH = r._gh, SL = r._sl;
  for (let axis = 0; axis < 2; axis++) {
    let num = 0, den = 0, m = 0;
    for (let i = 0; i < n; i++) m += GH[i]! / n;
    for (let i = 0; i < n; i++) (num += W[i * 2 + axis]! * (GH[i]! - m)), (den += W[i * 2 + axis]! * W[i * 2 + axis]!);
    SL[axis] = den ? atan(num / den) : 0;
  }
}
/** TR = [cos yaw, sin yaw, sin pitch, sin roll]: in a small function of its own, so the polynomials
 *  inline (a double returned from a call that is not inlined is boxed). */
function trig(r: Ride) {
  const S = r._s, TR = r._tr;
  // Sine from a polynomial (identical in every browser): reduced to ±π/2, odd terms to x¹⁵; cos x = sin(x + π/2).
  for (let k = 0; k < 4; k++) {
    let x = k === 0 ? S[0]! + PI / 2 : S[(k - 1) * 2]!;
    x -= TAU * Math.floor(x / TAU + 0.5); // (floor, not round: round(−0.2) is −0, a boxed number)
    x = x > PI / 2 ? PI - x : x < -PI / 2 ? -PI - x : x;
    const q = x * x;
    TR[k] = x * (1 - (q / 6) * (1 - (q / 20) * (1 - (q / 42) * (1 - (q / 72) * (1 - (q / 110) * (1 - (q / 156) * (1 - q / 210)))))));
  }
}
/** Springs: each wheel's attach point, the ground under it, its compression and force, summed into
 *  AC = [contacts, driven contacts, force, pitch torque, roll torque, normal x, y, z, grip, deepest,
 *  cos yaw, sin yaw]. Its own small function, so the ground's `sample` inlines into it. */
function springs(r: Ride) {
  const P = r._p, SL = r._sl, TR = r._tr, G = r._g4, W = r.wheels, n = r._n, pos = r.pos, RAW = r._raw, GH = r._gh, comp = r.comp, press = r.press, contact = r.contact, wheel = r.wheel, DRV = r._drv, surf = r._surf, ground = r._g;
  const h = SL[2]!, R = P[0]!, rest = P[1]!, travel = P[2]!, kw = P[4]!, cw = P[5]!, cr = P[6]!, bump = P[29]!, prog = P[30]!, droop = P[31]!;
  trig(r);
  const x = pos[0]!, y = pos[1]!, z = pos[2]!, cy = TR[0]!, sy = TR[1]!, fx = cy, fz = -sy, rx = sy, rz = cy, sp = TR[2]!, sr = TR[3]!;
  let nc = 0, nd = 0, fs = 0, tp = 0, tr = 0, gx = 0, gz = 0, gy = 0, gr = 0, deep = 0, most = 0;
  for (let i = 0; i < n; i++) {
    const ax = W[i * 2]!, az = W[i * 2 + 1]!, wx = x + fx * ax + rx * az, wz = z + fz * ax + rz * az, ya = y + ax * sp + az * sr;
    const kind = ground.sample(wx, wz, G), c = rest - (ya - G[0]! - R);
    GH[i] = G[0]!;
    let f = 0;
    if (c > 0) {
      // Spring (progressive past the start of its travel), damper (compress or rebound), bump stop past the travel.
      const cc = Math.min(c, travel), q = (cc / travel) * (cc / travel), dc = (c - RAW[i]!) / h;
      f = kw * (1 + prog * q) * cc + (dc < 0 ? cr : cw) * dc + (c > travel ? bump * kw * (c - travel) : 0);
      f = f > 0 ? f : 0;
      nc++;
      nd += DRV[i]!;
      gx += G[1]!; gy += G[2]!; gz += G[3]!;
      gr += kind < surf.length ? surf[kind]! : 1;
      deep = Math.max(deep, c - travel - R);
      most = Math.max(most, c / travel);
    }
    RAW[i] = c > 0 ? c : 0;
    contact[i] = c > 0 ? 1 : 0;
    // Off the ground the wheel drops to full droop at `droop` (drawing only).
    comp[i] = c > 0 ? Math.min(c, travel) : Math.max(0, comp[i]! - droop * h);
    press[i] = comp[i]! / travel;
    fs += f; tp += f * ax; tr += f * az;
    wheel[i * 3] = wx; wheel[i * 3 + 1] = ya - rest + comp[i]!; wheel[i * 3 + 2] = wz;
  }
  const AC = r._ac;
  AC[0] = nc; AC[1] = nd; AC[2] = fs; AC[3] = tp; AC[4] = tr; AC[5] = gx; AC[6] = gy; AC[7] = gz; AC[8] = gr; AC[9] = deep; AC[10] = cy; AC[11] = sy;
  r._s[22] = most;
}
/** One substep of SL[2] seconds. */
function sub1(r: Ride) {
  const S = r._s, F = r._f, P = r._p, SL = r._sl, AC = r._ac, pos = r.pos, vel = r.vel, input = r.input, contact = r.contact, spin = r.spin, SR = r._sr, DRV = r._drv, n = r._n, bike = r._bike, ev = r._ev;
  const h = SL[2]!, R = P[0]!, g = P[3]!, accel = P[7]!, top = P[8]!, brake = P[9]!, rev = P[10]!, coast = P[11]!, grip = P[12]!, driftK = P[13]!, maxSteer = P[14]!, fall = P[15]!, cg = P[16]!;
  const maxLean = P[17]!, airP = P[18]!, crashP = P[19]!, crashR = P[20]!, crashV = P[21]!, swing = P[22]!, maxSlide = P[23]!, recover = P[24]!, ip = P[25]!, ir = P[26]!, base = P[27]!, nDrv = P[34]!;
  springs(r);
  const crashed = F[0]!, sp = S[13]! > 0, off = crashed || sp, t = off ? 0 : Math.min(1, Math.max(0, input[0]!)), b = off ? 0 : Math.min(1, Math.max(0, input[1]!));
  const st = off ? 0 : Math.min(1, Math.max(-1, input[2]!)), dr = crashed ? 0 : sp ? 1 : Math.min(1, Math.max(0, input[3]!));
  let x = pos[0]!, y = pos[1]!, z = pos[2]!, vx = vel[0]!, vy = vel[1]!, vz = vel[2]!;
  let yaw = S[0]!, yr = S[1]!, p = S[2]!, pr = S[3]!, rl = S[4]!, rr = S[5]!;
  const nc = AC[0]!, nd = AC[1]!, fs = AC[2]!, tp = AC[3]!, tr = AC[4]!, gx = AC[5]!, gy = AC[6]!, gz = AC[7]!, gr = AC[8]!, deep = AC[9]!;
  const fx = AC[10]!, fz = -AC[11]!, rx = AC[11]!, rz = AC[10]!;
  // Along and across the heading.
  let vf = vx * fx + vz * fz, vs = vx * rx + vz * rz, af = 0, as = 0, slip = 0, da = 0;
  const frac = nc / n, beta = atan(vs / (Math.abs(vf) + 0.5));
  if (nc) {
    const gf = frac * (gr / nc), dfr = nd / (nDrv || 1);
    // Pedals: throttle pulls up to top speed; brake slows, then reverses up to `reverse`; no pedal coasts.
    if (t > 0) af += accel * t * (1 - vf / top) * dfr;
    if (b > 0) af += vf > 0.3 ? -brake * b * frac : accel * 0.6 * b * (-1 - vf / rev) * dfr;
    // Drag that stops at 0 (Math.sign would give −0, a boxed number).
    const drag = crashed ? 8 : t === 0 && b === 0 ? coast * frac : 0;
    af -= Math.max(-drag, Math.min(drag, vf / h));
    // Gravity along the slope (the springs push straight up only).
    const nx = gx / nc, ny = gy / nc, nz = gz / nc;
    af += g * (nx * fx + nz * fz) * ny * frac;
    as += g * (nx * rx + nz * rz) * ny * frac;
    // Sideways: the tyres cancel the slide up to their grip, less with the drift input (the rear lets go).
    const most = grip * g * gf * (1 - (1 - driftK) * dr) * (crashed ? 0.4 : 1), want = -vs / h, fix = want > most ? most : want < -most ? -most : want;
    as += fix;
    slip = Math.abs(vs + as * h);
    // Out of a drift the tyres hand part of the slide back as forward speed (its share of the speed, so never more energy).
    if (S[18]! > 0) af += Math.abs(fix) * recover * S[18]! * (Math.abs(vs) / (Math.abs(vs) + Math.abs(vf) + 0.01)) * (vf < 0 ? -1 : 1);
    // Steering: a curvature that tightens less at speed; the heading follows it as the tyres allow, the
    // tail swinging out on the handbrake until the slide reaches `slide`. Spun out, the spin dies away.
    const goal = -vf * ((st * maxSteer) / base / (1 + Math.abs(vf) / fall)) * (1 + swing * dr);
    if (sp) yr -= yr * Math.min(1, 1.5 * h);
    else {
      yr += (goal - yr) * Math.min(1, 10 * gf * h);
      if (dr > 0 && beta * yr > 0 && Math.abs(beta) > maxSlide) yr -= yr * Math.min(1, 60 * dr * h);
    }
    if (!off) da = Math.min(1, Math.max(0, (Math.abs(beta) - 0.15) / (maxSlide * 0.6))) * Math.min(1, hypot(vf, vs) / (0.35 * top));
  } else yr += st * -1.5 * h - yr * 0.5 * h;
  vf += af * h;
  vs += as * h;
  // Body: heave, pitch (with squat and dive) and roll (with body roll in a turn) from the springs.
  vy += (fs - g) * h;
  if (nc) pr += (tp / ip + ((af * cg) / ip) * 0.25) * h;
  else pr += (t - b) * airP * h;
  if (bike) {
    // A bike leans into the turn instead of rolling on springs.
    const lean = Math.max(-maxLean, Math.min(maxLean, nc ? atan((vf * yr) / g) : rl));
    rr = (lean - rl) * Math.min(1 / h, 8);
  } else if (nc) rr += (tr / ir + (as * cg) / ir * 0.25) * h;
  vx = fx * vf + rx * vs;
  vz = fz * vf + rz * vs;
  x += vx * h; y += vy * h; z += vz * h;
  if (deep > 0) (y += deep), (vy = vy > 0 ? vy : 0);
  yaw += yr * h; p += pr * h; rl += rr * h;
  // Crashed: it lies where it fell (on its side at most), the tumble dying out.
  if (crashed) (pr -= pr * 4 * h), (rr -= rr * 4 * h), (p = Math.max(-PI / 2, Math.min(PI / 2, p))), (rl = Math.max(-PI / 2, Math.min(PI / 2, rl)));
  // Air, landing, crash.
  if (!nc) {
    if (S[6]! === 0 && ev && !crashed) ev.emit("drive:air", P[33]!, 0, x, z);
    S[6] = S[6]! + h;
    F[1] = 1;
  } else {
    if (F[1] && S[6]! > 0.25 && !crashed) {
      slope(r);
      const ep = Math.abs(p - SL[0]!), er = bike ? 0 : Math.abs(rl - SL[1]!), drop = -vel[1]!;
      S[11] = drop; S[12] = Math.max(ep, er);
      ev && ev.emit("drive:land", P[33]!, 0, x, z, S[12]!);
      if (ep > crashP || er > crashR || drop > crashV) crash(r, x, z);
    }
    S[6] = 0;
    F[1] = 0;
    // A rollover; all wheels down, a loop over backwards (a wheelie too far) or forwards.
    slope(r);
    if (!F[0] && ((!bike && Math.abs(rl - SL[1]!) > crashR) || (nc === n && Math.abs(p - SL[0]!) > crashP + 0.35))) crash(r, x, z);
  }
  if (!F[0] && (Math.abs(p) > PI / 2 || Math.abs(rl) > PI / 2)) crash(r, x, z);
  // At rest it stays exactly where it was (no creep down a gentle slope), so the engine can settle.
  // A car with a wheel or two hanging (over a dip, on a rim, teetering on a diagonal) rests on the others: its rocking damped out.
  const three = !crashed && n > 3 && nc >= n - 2 && nc < n, still = (nc === n || three || crashed) && t === 0 && b === 0 && Math.abs(vf) < 0.05 && Math.abs(vs) < 0.05;
  if (still) (vx = vz = vf = slip = yr = 0), (x = pos[0]!), (z = pos[2]!), (yaw = S[0]!);
  if (still && three) (vy *= 0.8), (pr *= 0.8), (rr *= 0.8);
  F[2] = still && Math.abs(vy) < 0.004 && Math.abs(pr) < 0.004 && Math.abs(rr) < 0.004 ? 1 : 0;
  if (F[2]) (vy = pr = rr = 0), (y = pos[1]!), (p = S[2]!), (rl = S[4]!);
  // Wheels spin with the ground under them; in the air the driven ones run up on throttle.
  for (let i = 0; i < n; i++) {
    SR[i] = contact[i] ? vf / R : SR[i]! * (1 - 0.5 * h) + (DRV[i] ? t * 40 * h : 0);
    const a = spin[i]! + SR[i]! * h;
    spin[i] = a - TAU * Math.floor(a / TAU);
  }
  // Drift: the amount now, the chain (banked half a second after the drift ends), the memory that recovers speed.
  S[14] = da; S[15] = beta; S[18] = Math.max(dr, S[18]! - 2 * h);
  if (sp) S[13] = Math.max(0, S[13]! - h);
  if (da > 0.05) (S[16] = S[16]! + da * h), (S[17] = 0);
  else if (S[16]! > 0 && (S[17] = S[17]! + h) > 0.5) bank(r, 0, x, z);
  pos[0] = x; pos[1] = y; pos[2] = z; vel[0] = vx; vel[1] = vy; vel[2] = vz;
  S[0] = yaw - TAU * Math.floor(yaw / TAU + 0.5); S[1] = yr; S[2] = p; S[3] = pr; S[4] = rl; S[5] = rr; S[7] = slip; S[8] = vf;
  S[9] = frac * Math.min(1, (Math.abs(vf) / top) * 0.8 + slip * 0.15 + (t * (1 - Math.abs(vf) / top)) * 0.3);
  S[10] = st * maxSteer;
}
function crash(r: Ride, x: number, z: number) {
  r._f[0] = 1;
  r._ev && r._ev.emit("drive:crash", r._p[33]!, 0, x, z);
  if (r._s[16]! > 0) bank(r, 1, x, z);
}
/** End the drift chain: `drive:drift` with its score (b: 1 when broken). */
function bank(r: Ride, broken: number, x: number, z: number) {
  const S = r._s;
  S[19] = S[16]!; S[16] = S[17] = 0;
  r._ev && r._ev.emit("drive:drift", r._p[33]!, broken, x, z, S[19]!);
}

/** A vehicle on `ground`: set `input` (or `set`), `step(dt)` from the engine's step, draw from `pos`, `rot`, `comp`. */
export function drive(ground: DriveGround, o: DriveOptions = {}): Drive {
  return new Ride(ground, o);
}

/** `touch`'s last contact: [impulse, normal x, normal z (from a to b), depth, contact x, contact z]. */
export const touchHit = new Float64Array(6);

/** Options for `touch` and `touchAll`. */
export interface TouchOptions {
  /** Bounce along the normal, 0 (dead) .. 1 (elastic) (default 0.3). */
  bounce?: number;
  /** Two bodies further apart than this in height pass (one in the air over the other; default 1). */
  height?: number;
  /** Called on each contact, after the push: `hit` is `touchHit`. */
  onHit?: (a: Drive, b: Drive, hit: Float64Array) => void;
}
const NO: TouchOptions = {};

/** Push vehicles `a` and `b` apart if their hulls overlap (box against box, box against circle, circle
 *  against circle, on the ground plane) by their masses, and bounce their velocities along the contact
 *  normal. Deterministic (no builtin trig: the headings' cosines come from the model). True on a contact. */
export function touch(a: Drive, b: Drive, o: TouchOptions = NO) {
  const pa = a.pos, pb = b.pos, A = a._s, B = b._s, ha = a.hull, hb = b.hull;
  if (Math.abs(pa[1]! - pb[1]!) > (o.height ?? 1)) return false;
  const dx = pb[0]! - pa[0]!, dz = pb[2]! - pa[2]!, H = touchHit;
  let depth = Infinity;
  if (!ha[1] && !hb[1]) {
    const d = hypot(dx, dz);
    depth = ha[0]! + hb[0]! - d; H[1] = d ? dx / d : 1; H[2] = d ? dz / d : 0;
  } else if (ha[1] && hb[1]) {
    // Separating axes: each body's forward (cos, −sin) and right (sin, cos).
    for (let k = 0; k < 4; k++) {
      const c = (k < 2 ? A : B)[20]!, s = (k < 2 ? A : B)[21]!, ux = k & 1 ? s : c, uz = k & 1 ? c : -s;
      const r = ha[0]! * Math.abs(A[20]! * ux - A[21]! * uz) + ha[1]! * Math.abs(A[21]! * ux + A[20]! * uz) + hb[0]! * Math.abs(B[20]! * ux - B[21]! * uz) + hb[1]! * Math.abs(B[21]! * ux + B[20]! * uz);
      const along = dx * ux + dz * uz, over = r - Math.abs(along);
      if (over < depth) (depth = over), (H[1] = along < 0 ? -ux : ux), (H[2] = along < 0 ? -uz : uz);
    }
  } else {
    // A box and a circle: the box's nearest point to the circle's centre, in the box's frame.
    const box = ha[1] ? A : B, bh = ha[1] ? ha : hb, r = ha[1] ? hb[0]! : ha[0]!, sg = ha[1] ? 1 : -1, c = box[20]!, s = box[21]!;
    const lx = (dx * c - dz * s) * sg, lz = (dx * s + dz * c) * sg, cx = Math.max(-bh[0]!, Math.min(bh[0]!, lx)), cz = Math.max(-bh[1]!, Math.min(bh[1]!, lz));
    let ex = lx - cx, ez = lz - cz;
    const d = hypot(ex, ez);
    if (d > 0) (depth = r - d), (ex /= d), (ez /= d);
    else if (bh[0]! - Math.abs(lx) < bh[1]! - Math.abs(lz)) (depth = r + bh[0]! - Math.abs(lx)), (ex = lx < 0 ? -1 : 1), (ez = 0);
    else (depth = r + bh[1]! - Math.abs(lz)), (ex = 0), (ez = lz < 0 ? -1 : 1);
    H[1] = (ex * c + ez * s) * sg; H[2] = (ez * c - ex * s) * sg;
  }
  if (!(depth > 1e-9)) return false;
  const ia = 1 / a.mass, ib = 1 / b.mass, im = ia + ib || 1, nx = H[1]!, nz = H[2]!, va = a.vel, vb = b.vel;
  pa[0] = pa[0]! - nx * depth * (ia / im); pa[2] = pa[2]! - nz * depth * (ia / im);
  pb[0] = pb[0]! + nx * depth * (ib / im); pb[2] = pb[2]! + nz * depth * (ib / im);
  const vn = (vb[0]! - va[0]!) * nx + (vb[2]! - va[2]!) * nz, j = vn < 0 ? (-(1 + (o.bounce ?? 0.3)) * vn) / im : 0;
  va[0] = va[0]! - nx * j * ia; va[2] = va[2]! - nz * j * ia;
  vb[0] = vb[0]! + nx * j * ib; vb[2] = vb[2]! + nz * j * ib;
  H[0] = j; H[3] = depth; H[4] = (pa[0]! + pb[0]!) / 2; H[5] = (pa[2]! + pb[2]!) / 2;
  o.onHit && o.onHit(a, b, H);
  return true;
}

/** `touch` every pair of `list`, in order (i < j: the same order on every machine); returns the contacts. */
export function touchAll(list: ArrayLike<Drive>, o: TouchOptions = NO) {
  let n = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (touch(list[i]!, list[j]!, o)) n++;
  return n;
}

/** Options for `chase`: where the camera sits behind its target and how fast it follows. */
export interface ChaseOptions {
  /** Distance from the target (default 9). */
  dist?: number;
  /** Look-down angle (default 0.45). */
  pitch?: number;
  /** Aim this far over the target (default 0.6). */
  lift?: number;
  /** Aim ahead by this many seconds of the target's velocity (default 0.25; needs `vel`). */
  ahead?: number;
  /** Turn from straight behind (radians; default 0). */
  side?: number;
  /** Follow rate, 1/s (default 4): higher is tighter. */
  rate?: number;
  /** Turn rate, 1/s (default 2.5). */
  turn?: number;
  /** Jump straight there (reduced motion, a respawn). */
  snap?: boolean;
}

/** Ease diorama camera `cam` behind and above `target` (`pos` [x, y, z], `yaw`, optional `vel`) over
 *  dt seconds; returns true while it still moves (settle-friendly). */
export function chase(cam: { yaw: number; pitch: number; dist: number; tx: number; ty: number; tz: number }, target: { pos: ArrayLike<number>; yaw: number; vel?: ArrayLike<number> }, o: ChaseOptions = {}, dt = 1 / 60) {
  const p = target.pos, v = target.vel, ah = v ? o.ahead ?? 0.25 : 0, k = o.snap ? 1 : 1 - Math.exp(-(o.rate ?? 4) * dt), kt = o.snap ? 1 : 1 - Math.exp(-(o.turn ?? 2.5) * dt);
  let dy = target.yaw - PI / 2 + (o.side ?? 0) - cam.yaw;
  dy -= TAU * Math.floor(dy / TAU + 0.5);
  const ex = p[0]! + (v ? v[0]! * ah : 0) - cam.tx, ey = p[1]! + (o.lift ?? 0.6) - cam.ty, ez = p[2]! + (v ? v[2]! * ah : 0) - cam.tz, ep = (o.pitch ?? 0.45) - cam.pitch, ed = (o.dist ?? 9) - cam.dist;
  const big = Math.max(Math.abs(ex), Math.abs(ey), Math.abs(ez), Math.abs(dy), Math.abs(ep), Math.abs(ed)) > 1e-3, f = big ? k : 1, ft = big ? kt : 1;
  cam.tx += ex * f; cam.ty += ey * f; cam.tz += ez * f; cam.yaw += dy * ft; cam.pitch += ep * f; cam.dist += ed * f;
  return big;
}
