/**
 * @fzlt/core/math: trig that gives the same bits on every engine, for anything that steps a sim.
 * `sin`, `cos`, `atan`, `atan2` and `hypot` from + − × ÷, `Math.sqrt`, `Math.abs`, `Math.trunc` and
 * `%` (all exact, so the same everywhere) and bit reads only. The builtins may differ between engines
 * in the last bit (WebKit calls the system's libm), and one bit in a heading is a different game
 * online: a desync. These are fdlibm 5.3's algorithms (k_sin.c, k_cos.c, s_sin.c, s_cos.c, the
 * medium path of e_rem_pio2.c, s_atan.c, e_atan2.c), the ones V8 ports for its Math.sin, cos, atan
 * and atan2: in Node they return what the builtins return, bit for bit (tests/math.test.mjs), so a
 * sim tested headless keeps its numbers; in Chromium and WebKit they return the same bits as in Node
 * (tests/math-engines.mjs), while those browsers' own builtins differ from them (measured on
 * Chromium 153 and WebKit 26: about 3% of sin and cos results and 18% of atan2's). `hypot` is V8's
 * two-argument Math.hypot, written out (moved here from `@fzlt/core/steer`, which re-exports it).
 *
 * One limit: past |x| = 2^20·π/2 (about 1.6 million radians) fdlibm's exact reduction needs a big
 * table; here such an x is first taken mod 2π (`%` is exact), so every engine still agrees, but V8's
 * builtin may differ there. No game needs an angle that large.
 *
 * Rendering may keep the builtins (a pixel off is fine). Allocation-free wherever they are called
 * from: a double returned from a call the JIT does not inline is boxed (a heap number each call), and
 * so are its double arguments, and fdlibm's bodies are past V8's inlining limit: so the bodies take
 * their arguments from one shared buffer and leave their result in another, and each export is a
 * tiny wrapper (write, call, read) that always inlines. Shared buffers for the bit reads and the
 * reduced argument too; every export tree-shakes on its own.
 */

// (One ArrayBuffer by name, not `F.buffer`: a property read would keep these in a bundle that only takes hypot.)
const AB = /* @__PURE__ */ new ArrayBuffer(8), F = /* @__PURE__ */ new Float64Array(AB), I = /* @__PURE__ */ new Int32Array(AB);
/** High 32 bits of a double (little-endian, as every browser is). */
const hi = (x: number) => ((F[0] = x), I[1]!);
/** Low 32 bits. */
const lo = (x: number) => ((F[0] = x), I[0]!);
/** Where the bodies take their arguments (A) and leave their result (O). */
const A = /* @__PURE__ */ new Float64Array(2), O = /* @__PURE__ */ new Float64Array(1);
/** The reduced argument: x = n·π/2 + (Y[0] + Y[1]). */
const Y = /* @__PURE__ */ new Float64Array(2);

// ---- the kernels on [−π/4, π/4]: x + y in Y (y the tail of the reduced argument), into O[0] ----
function ksin(iy: number) {
  const x = Y[0]!, y = Y[1]!;
  if ((hi(x) & 0x7fffffff) < 0x3e400000 && (x | 0) === 0) return void (O[0] = x);
  const z = x * x, v = z * x;
  const r = 8.33333333332248946124e-3 + z * (-1.98412698298579493134e-4 + z * (2.75573137070700676789e-6 + z * (-2.50507602534068634195e-8 + z * 1.58969099521155010221e-10)));
  if (iy === 0) O[0] = x + v * (-1.66666666666666324348e-1 + z * r);
  else O[0] = x - (z * (0.5 * y - v * r) - y - v * -1.66666666666666324348e-1);
}
function kcos() {
  const x = Y[0]!, y = Y[1]!, ix = hi(x) & 0x7fffffff;
  const z = x * x;
  const r = z * (4.16666666666666019037e-2 + z * (-1.38888888888741095749e-3 + z * (2.48015872894767294178e-5 + z * (-2.75573143513906633035e-7 + z * (2.08757232129817482790e-9 + z * -1.13596475577881948265e-11)))));
  if (ix < 0x3fd33333) return void (O[0] = 1 - (0.5 * z - (z * r - x * y)));
  // qx = x/4 with its low word cleared (0.28125 past 0.78125).
  if (ix > 0x3fe90000) return void (O[0] = 1 - 0.28125 - (0.5 * z - 0.28125 - (z * r - x * y)));
  (I[1] = ix - 0x00200000), (I[0] = 0);
  const qx = F[0]!;
  O[0] = 1 - qx - (0.5 * z - qx - (z * r - x * y));
}

// ---- argument reduction: x = n·π/2 + (Y[0] + Y[1]) ----
const P1 = 1.57079632673412561417, P1T = 6.07710050650619224932e-11, P2 = 6.07710050630396597660e-11, P2T = 2.02226624879595063154e-21, P3 = 2.02226624871116645580e-21, P3T = 8.47842766036889956997e-32;
/** n for x = A[0] (an integer: mod 4 is what matters) and the remainder in Y: Cody–Waite in up to
 *  three steps (fdlibm's medium path). */
function rem() {
  let x = A[0]!;
  // Past 2^20·π/2: x mod 2π first (exact), so it stays defined and the same everywhere.
  if ((hi(x) & 0x7fffffff) > 0x413921fb) x %= 6.283185307179586;
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix < 0x4002d97c) {
    // |x| < 3π/4: one step (two near π/2). No branch a run may never take: an operation the JIT has
    // seen no numbers for makes the values it merges into boxed.
    const s = hx > 0 ? 1 : -1, near = ix === 0x3ff921fb, z = x - s * P1 - (near ? s * P2 : 0), tail = s * (near ? P2T : P1T);
    return (Y[0] = z - tail), (Y[1] = z - Y[0]! - tail), s;
  }
  const n = Math.trunc(Math.abs(x) * 6.36619772367581382433e-1 + 0.5), j = ix >> 20;
  let r = Math.abs(x) - n * P1, w = n * P1T, t = 0;
  Y[0] = r - w;
  // A second step when the first cancelled more than 16 bits, a third past 49 (fdlibm skips the
  // check for small n off its table of near-multiples; it is a no-op there). One loop body for both,
  // so the third step's operations are the second's: the JIT has numbers for them however rare it is.
  for (let k = 0; k < 2 && j - ((hi(Y[0]!) >> 20) & 0x7ff) > (k ? 49 : 16); k++) {
    t = r;
    w = n * (k ? P3 : P2);
    r = t - w;
    w = n * (k ? P3T : P2T) - (t - r - w);
    Y[0] = r - w;
  }
  Y[1] = r - Y[0]! - w;
  // (`| 0`: an int32 comes back as a small integer; a double would be boxed.)
  if (hx < 0) return (Y[0] = -Y[0]!), (Y[1] = -Y[1]!), -n | 0;
  return n | 0;
}
/** sin(A[0]) into O[0], or cos with c = 1 (cos x = sin(x + π/2): one quadrant on). */
function sc(c: number) {
  const x = A[0]!, ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return (Y[0] = x), (Y[1] = 0), void (c ? kcos() : ksin(0));
  if (ix >= 0x7ff00000) return void (O[0] = NaN);
  const n = (rem() + c) & 3;
  n & 1 ? kcos() : ksin(1);
  if (n & 2) O[0] = -O[0]!;
}

/** sin(x), the same bits on every engine (Math.sin's on V8). */
export const sin = (x: number) => ((A[0] = x), sc(0), O[0]!);
/** cos(x), the same bits on every engine (Math.cos's on V8). */
export const cos = (x: number) => ((A[0] = x), sc(1), O[0]!);

const AHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800];
const ALO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2];
/** atan(A[0]) into O[0]. */
function at() {
  let x = A[0]!;
  const hx = hi(x), ix = hx & 0x7fffffff;
  let id = -1;
  if (ix >= 0x44100000) {
    // |x| ≥ 2^66 (or NaN).
    return void (O[0] = x !== x ? x : hx > 0 ? AHI[3]! + ALO[3]! : -AHI[3]! - ALO[3]!);
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e200000) return void (O[0] = x);
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) (id = 0), (x = (2 * x - 1) / (2 + x));
      else (id = 1), (x = (x - 1) / (x + 1));
    } else if (ix < 0x40038000) (id = 2), (x = (x - 1.5) / (1 + 1.5 * x));
    else (id = 3), (x = -1 / x);
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  if (id < 0) return void (O[0] = x - x * (s1 + s2));
  const r = AHI[id]! - (x * (s1 + s2) - ALO[id]! - x);
  O[0] = r;
  if (hx < 0) O[0] = -r;
}
const PI = 3.1415926535897931160, PI_LO = 1.2246467991473531772e-16, PI_2 = 1.5707963267948965580, PI_4 = 7.8539816339744827900e-1;
/** atan2(A[0], A[1]) into O[0]. */
function at2() {
  const y = A[0]!, x = A[1]!;
  if (x !== x || y !== y) return void (O[0] = NaN);
  const hx = hi(x), lx = lo(x), ix = hx & 0x7fffffff, hy = hi(y), iy = hy & 0x7fffffff;
  if (hx === 0x3ff00000 && lx === 0) return at();
  // m: bit 0 the sign of y, bit 1 the sign of x.
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2), k = (iy - ix) >> 20;
  // The edges first, each straight into O (no merged value: see rem).
  if ((iy | lo(y)) === 0) return void (O[0] = m < 2 ? y : m === 2 ? PI : -PI);
  if ((ix | lx) === 0 || (iy === 0x7ff00000 && ix !== 0x7ff00000)) return void (O[0] = hy < 0 ? -PI_2 : PI_2);
  if (ix === 0x7ff00000) return void (O[0] = (iy === 0x7ff00000 ? (m & 2 ? 3 * PI_4 : PI_4) : m & 2 ? PI : 0) * (m & 1 ? -1 : 1));
  // |y/x| > 2^60: ±π/2 whatever the sign of x (V8's `m &= 1`, as in later fdlibm).
  if (k > 60) return void (O[0] = hy < 0 ? -PI_2 - 0.5 * PI_LO : PI_2 + 0.5 * PI_LO);
  if (hx < 0 && k < -60) return void (O[0] = m & 1 ? -PI : PI);
  (A[0] = Math.abs(y / x)), at();
  const z = O[0]!;
  if (m === 1) O[0] = -z;
  else if (m === 2) O[0] = PI - (z - PI_LO);
  else if (m === 3) O[0] = z - PI_LO - PI;
}

/** atan(x), the same bits on every engine (Math.atan's on V8). */
export const atan = (x: number) => ((A[0] = x), at(), O[0]!);
/** atan2(y, x), the same bits on every engine (Math.atan2's on V8). */
export const atan2 = (y: number, x: number) => ((A[0] = y), (A[1] = x), at2(), O[0]!);

/**
 * Math.hypot of two numbers, without the builtin call: V8 boxes Math.hypot's arguments, a heap
 * number per call in a hot loop. Same steps as V8's own (Infinity wins over NaN, scale by the
 * larger, sum, sqrt), so it returns the same bits (tested against Math.hypot).
 */
export const hypot = (dx: number, dy: number) => {
  // One expression, no early return: a return of 0 beside a double makes V8 box the result.
  const ax = Math.abs(dx), ay = Math.abs(dy), max = ax > ay ? ax : ay, z = max === 0 ? 1 : max, p = ax / z, q = ay / z;
  return ax === Infinity || ay === Infinity ? Infinity : Math.sqrt(p * p + q * q) * max;
};
