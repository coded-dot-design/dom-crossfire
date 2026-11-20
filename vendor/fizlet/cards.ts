/**
 * @fzlt/core/cards: a deck of cards for tabletop games. Cards are numbers 0..size−1 (the game says
 * what each one is); every card is in exactly one pile, at one place in it, face up or down.
 * `shuffle(pile, seed)`, `draw`, `deal` to hands, `move`, `flip`, `gather` piles back.
 * - The shuffle is a Fisher-Yates over a 32-bit integer generator with rejection sampling (no
 *   modulo bias), so the same seed gives the same order in every browser: both online players see
 *   the same deck.
 * - Each change stamps the card with the deck's clock, so a drawing helper animates the moves in
 *   the order they were made.
 * - `dioramaCards` builds the deck into an `@fzlt/core/diorama` scene: each card a thin card-shaped
 *   prism with its face or back painted on the side that looks at the camera (by your callbacks:
 *   the game paints its own art), laid out per pile as a stack, a row on the table, or a hand fanned
 *   toward the camera; moves fly in arcs, flips turn over, staggered in move order. `pick` names
 *   the card under a point.
 * No allocation per deck operation, `show()` or draw in the steady state.
 */
import type { Diorama, DioramaObject } from "./diorama";

/** Options for `deck()`: how many cards and the piles. */
export interface DeckOptions {
  /** Cards (default 52). */
  size?: number;
  /** The piles: a count, or their names for `id` (default ["draw"]). Pile 0 holds the deck at first. */
  piles?: number | string[];
}

/** S[0] steps a 32-bit generator (mulberry32): integer maths only, the same in every engine. */
function next(S: Int32Array) {
  let t = (S[0] = (S[0]! + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
/** A uniform integer in [0, n) from the generator, without modulo bias. */
function below(S: Int32Array, n: number) {
  const lim = 4294967296 - (4294967296 % n);
  for (;;) {
    const u = next(S);
    if (u < lim) return u % n;
  }
}

/** A deck of `size` cards in piles. Read `pile`, `pos`, `up` per card and `count`/`at` per pile. */
export function deck(o: DeckOptions = {}) {
  const N = o.size ?? 52, pl = o.piles ?? 1, names = typeof pl === "number" ? null : pl, P = typeof pl === "number" ? pl : pl.length;
  const pile = new Uint8Array(N), pos = new Uint16Array(N), up = new Uint8Array(N), stamp = new Uint32Array(N);
  const slots = new Int16Array(P * N), len = new Uint16Array(P), S = new Int32Array(1);

  /** Take card c out of its pile (the cards above it move down one). */
  function lift(c: number) {
    const p = pile[c]!, b = p * N, n = len[p]! - 1;
    for (let i = pos[c]!; i < n; i++) (slots[b + i] = slots[b + i + 1]!), (pos[slots[b + i]!] = i);
    len[p] = n;
  }
  /** Put card c into pile p at index i (clamped; < 0 or past the end: on top). */
  function put(c: number, p: number, i: number) {
    const b = p * N, n = len[p]!;
    if (i < 0 || i > n) i = n;
    for (let k = n; k > i; k--) (slots[b + k] = slots[b + k - 1]!), (pos[slots[b + k]!] = k);
    slots[b + i] = c;
    pile[c] = p;
    pos[c] = i;
    len[p] = n + 1;
  }
  const touch = (c: number) => (stamp[c] = ++api.clock);
  function move(c: number, to: number, at = -1, face = -1) {
    lift(c);
    put(c, to, at);
    if (face >= 0) up[c] = face;
    touch(c);
    api.ver++;
    return c;
  }
  function reset(face = 0) {
    len.fill(0);
    for (let c = 0; c < N; c++) (slots[c] = c), (pile[c] = 0), (pos[c] = c), (up[c] = face), touch(c);
    len[0] = N;
    api.ver++;
  }

  const api = {
    /** Cards. */
    size: N,
    /** Piles. */
    piles: P,
    /** Per card: its pile. */
    pile,
    /** Per card: its index in the pile (0 is the bottom). */
    pos,
    /** Per card: 1 face up. */
    up,
    /** Per card: the clock when it last moved or flipped. */
    stamp,
    /** Moves and flips so far (each one stamps its card with the next tick). */
    clock: 0,
    /** Changes so far (a shuffle counts one): a drawing helper re-lays the piles when it changes. */
    ver: 0,
    /** A pile's index by name (−1 if none). */
    id: (name: string) => (names ? names.indexOf(name) : -1),
    /** Cards in pile p. */
    count: (p: number) => len[p]!,
    /** The card at index i of pile p (0 the bottom; −1 the top, −2 under it, …), or −1. */
    at(p: number, i: number) {
      const n = len[p]!;
      if (i < 0) i += n;
      return i >= 0 && i < n ? slots[p * N + i]! : -1;
    },
    /** The top card of pile p, or −1. */
    top: (p: number) => (len[p] ? slots[p * N + len[p]! - 1]! : -1),
    /** Every card back in pile 0, in order 0..size−1, face down (or up: `face` 1). */
    reset,
    /** Move card c to pile `to` at index `at` (default: on top), face up (1), down (0) or as it is (−1). */
    move,
    /** Move the top `n` cards of `from` to `to`, one by one (the top first), face as given; returns
     *  the last card moved, or −1 if `from` ran out first. */
    draw(from: number, to: number, n = 1, face = -1) {
      let c = -1;
      for (let i = 0; i < n; i++) {
        const t = len[from] ? slots[from * N + len[from]! - 1]! : -1;
        if (t < 0) return -1;
        c = move(t, to, -1, face);
      }
      return c;
    },
    /** Deal `each` cards from `from` to each pile in `to`, round by round, face as given; returns the
     *  cards dealt (fewer if `from` ran out). */
    deal(from: number, to: ArrayLike<number>, each = 1, face = 0) {
      let k = 0;
      for (let r = 0; r < each; r++)
        for (let j = 0; j < to.length; j++) {
          if (!len[from]) return k;
          move(slots[from * N + len[from]! - 1]!, to[j]!, -1, face);
          k++;
        }
      return k;
    },
    /** Move every card of `from` onto `to` (keeping their order), face as given. */
    gather(from: number, to: number, face = -1) {
      while (len[from]) move(slots[from * N]!, to, -1, face);
    },
    /** Turn card c over (or set it: 1 up, 0 down). */
    flip(c: number, face = -1) {
      up[c] = face < 0 ? up[c]! ^ 1 : face;
      touch(c);
      api.ver++;
    },
    /** Shuffle pile p from `seed` (any 32-bit integer): the same seed, the same order, everywhere. */
    shuffle(p: number, seed: number) {
      S[0] = seed | 0;
      const b = p * N;
      for (let i = len[p]! - 1; i > 0; i--) {
        const j = below(S, i + 1), t = slots[b + i]!;
        slots[b + i] = slots[b + j]!;
        slots[b + j] = t;
      }
      for (let i = 0; i < len[p]!; i++) pos[slots[b + i]!] = i;
      api.ver++;
    },
  };
  reset();
  return api;
}
/** What `deck` returns. */
export type Deck = ReturnType<typeof deck>;

/** How one pile lies on the table: a `stack`, a `row`, or a `fan` (a hand held up to the camera). */
export interface PileLayout {
  /** `stack` (default): squared up, one on another; `row`: side by side; `fan`: a hand. */
  type?: "stack" | "row" | "fan";
  /** Centre on the board, x. */
  x?: number;
  /** Centre on the board, z. */
  z?: number;
  /** Turn (diorama `rot[1]`, radians); a fan's default is the camera's yaw, so it faces the camera. */
  a?: number;
  /** row: centre to centre (default 1.15 × the card's width). */
  gap?: number;
  /** fan: how far the hand leans up toward the camera (radians, default 0.9). */
  tilt?: number;
  /** fan: the angle between cards (radians, default 0.13; the whole fan stays within 1.3). */
  spread?: number;
  /** fan: the fan's radius (default 2.2 × the card's height). */
  radius?: number;
  /** fan: how high its centre is held (default: just clear of the table). */
  lift?: number;
}

/** Options for `dioramaCards`: the table, sizes, art callbacks, layouts and timing. */
export interface DioramaCardsOptions {
  /** The id of the object the cards lie on (the table): layouts are from its top centre. */
  on: string;
  /** Card width and height, world units (default [1, 1.4]). */
  size?: ArrayLike<number>;
  /** Thickness (default 0.012). */
  thick?: number;
  /** One layout per pile (missing: a stack at the centre). */
  piles?: PileLayout[];
  /** Paint card c's face into the box (0, 0)–(art[0], art[1]), its top edge at y = 0. */
  face: (ctx: CanvasRenderingContext2D, card: number) => void;
  /** Paint its back (default: a plain back in `back`). */
  back?: ((ctx: CanvasRenderingContext2D, card: number) => void) | null;
  /** The art box (default [100, 140]). */
  art?: ArrayLike<number>;
  /** The card's edge colour (default `#f4efe4`). */
  color?: string;
  /** The default back's colour (default `#2d4f8f`). */
  backColor?: string;
  /** Seconds per move (default 0.42); a flip in place takes 0.8 of it. */
  dur?: number;
  /** Seconds between moves made at once (a deal) (default 0.09). */
  stagger?: number;
  /** How high a moving card arcs (default 0.9). */
  arc?: number;
  /** Blob shadow strength (default 0.22). */
  shadow?: number;
  /** Ids start with this: card c is `${id}${c}` (its group, tagged { card: c }) and `${id}${c}b` (default "card"). */
  id?: string;
  /** false (reduced motion): cards jump to where they go. */
  motion?: boolean;
}

const PI = Math.PI, TAU = 2 * PI;

/** Build deck `k` into diorama `d`. `show(t)` (t: a running clock in seconds) before each `d.draw()`;
 *  true while any card still moves. */
export function dioramaCards(d: Diorama, k: Deck, o: DioramaCardsOptions) {
  const N = k.size, w = o.size ? o.size[0]! : 1, hh = o.size ? o.size[1]! : 1.4, th = o.thick ?? 0.012, AW = o.art ? o.art[0]! : 100, AH = o.art ? o.art[1]! : 140;
  const dur = o.motion === false ? 0 : o.dur ?? 0.42, stg = o.motion === false ? 0 : o.stagger ?? 0.09, arc = o.arc ?? 0.9, id = o.id ?? "card", lay = o.piles || [];
  const backColor = o.backColor || "#2d4f8f", shadow = o.shadow ?? 0.22, f = (n: number) => new Float64Array(n);
  // Per card pose [x, y, z, tilt, yaw, fan, flip]: now, from, to; start, length, arc; its sort anchor.
  const CUR = f(N * 7), FR = f(N * 7), TO = f(N * 7), T0 = f(N), TD = f(N), TA = f(N), AT = f(N * 3), seen = new Uint32Array(N);
  const NT = f(7), B = f(15), X = f(3), Y = f(6), LP = f(18), TS = f(1);
  const groups: DioramaObject[] = [], bodies: DioramaObject[] = [];
  let ver = -1, busy = false;
  const c8 = 0.08 * w, x2 = w / 2, z2 = hh / 2;
  const outline = [[-x2, -z2 + c8], [-x2 + c8, -z2], [x2 - c8, -z2], [x2, -z2 + c8], [x2, z2 - c8], [x2 - c8, z2], [-x2 + c8, z2], [-x2, z2 - c8]];
  // The painted sides in the body's frame: top (the face) origin, +u, +v; bottom (the back) the same.
  LP.set([-x2, th, -z2, x2, th, -z2, -x2, th, z2, x2, 0, -z2, -x2, 0, -z2, x2, 0, z2]);

  function defaultBack(ctx: CanvasRenderingContext2D) {
    const m = AW * 0.07, r = AW * 0.08;
    ctx.fillStyle = backColor;
    rr(ctx, 0, 0, AW, AH, AW * 0.1);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = AW * 0.025;
    rr(ctx, m, m, AW - 2 * m, AH - 2 * m, r);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(AW / 2, AH * 0.3);
    ctx.lineTo(AW * 0.72, AH / 2);
    ctx.lineTo(AW / 2, AH * 0.7);
    ctx.lineTo(AW * 0.28, AH / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const back = o.back || defaultBack;
  /** X = board point X through the table's last matrix (typed arrays in and out: nothing boxed). */
  let par: DioramaObject | null = null;
  function toWorld() {
    const p = par || (par = d.get(o.on) || null);
    if (!p) return;
    const px = X[0]!, py = X[1]!, pz = X[2]!, m = p.M, ly = py + (p.shape === "group" ? 0 : p.size[1]!);
    X[0] = m[0]! * px + m[1]! * ly + m[2]! * pz + m[9]!;
    X[1] = m[3]! * px + m[4]! * ly + m[5]! * pz + m[10]!;
    X[2] = m[6]! * px + m[7]! * ly + m[8]! * pz + m[11]!;
  }
  /** Paint card c's side that looks at the camera, through that side's screen axes. */
  function paintCard(ctx: CanvasRenderingContext2D, c: number) {
    const m = bodies[c]!.M, r = d.dpr;
    basis(d, B);
    for (let s = 0; s < 2; s++) {
      for (let e = 0; e < 3; e++) {
        const j = s * 9 + e * 3, lx = LP[j]!, ly = LP[j + 1]!, lz = LP[j + 2]!;
        X[0] = m[0]! * lx + m[1]! * ly + m[2]! * lz + m[9]!;
        X[1] = m[3]! * lx + m[4]! * ly + m[5]! * lz + m[10]!;
        X[2] = m[6]! * lx + m[7]! * ly + m[8]! * lz + m[11]!;
        proj(B, X, Y, e * 2);
      }
      const ux = Y[2]! - Y[0]!, uy = Y[3]! - Y[1]!, vx = Y[4]! - Y[0]!, vy = Y[5]! - Y[1]!;
      if (ux * vy - uy * vx <= 0.5) continue; // turned away (or edge on)
      ctx.setTransform((r * ux) / AW, (r * uy) / AW, (r * vx) / AH, (r * vy) / AH, r * Y[0]!, r * Y[1]!);
      // Clipped to the card's cut corners, so the art can fill its box.
      ctx.save();
      rr(ctx, 0, 0, AW, AH, AW * 0.08);
      ctx.clip();
      s ? back(ctx, c) : o.face(ctx, c);
      ctx.restore();
      ctx.setTransform(r, 0, 0, r, 0, 0);
      ctx.globalAlpha = 1;
      return;
    }
  }
  for (let c = 0; c < N; c++) {
    const cl = id + c;
    d.cluster(cl, { at: AT.subarray(c * 3, c * 3 + 3) });
    const g = d.add({ id: cl, shape: "group", size: [w, 0, hh], on: o.on, shadow, tag: { card: c }, cluster: cl });
    const b = d.add({ id: cl + "b", shape: "prism", outline, size: [w, th, hh], on: cl, color: o.color || "#f4efe4" });
    groups.push(g);
    bodies.push(b);
    d.decal(cl, b.layer + 0.5, (ctx) => paintCard(ctx, c));
  }

  /** NT = where card c rests: its pile's layout, its index, its face. */
  function target(c: number) {
    const p = k.pile[c]!, L = lay[p] || {}, i = k.pos[c]!, n = k.count(p), type = L.type || "stack", lx = L.x ?? 0, lz = L.z ?? 0;
    const flip = k.up[c] ? 0 : PI;
    if (type === "fan") {
      const yaw = L.a ?? d.cam.yaw, tilt = L.tilt ?? 0.9, R = L.radius ?? 2.2 * hh, sp = Math.min(L.spread ?? 0.13, n > 1 ? 1.3 / (n - 1) : 1);
      const q = (i - (n - 1) / 2) * sp, ox = R * Math.sin(q), oy = i * th * 1.6, oz = R - R * Math.cos(q);
      // Rx(tilt), then Ry(yaw): the hand's frame to the board.
      const ct = Math.cos(tilt), st = Math.sin(tilt), cy = Math.cos(yaw), sy = Math.sin(yaw);
      const y1 = ct * oy - st * oz, z1 = st * oy + ct * oz;
      NT[0] = lx + cy * ox + sy * z1; NT[1] = (L.lift ?? z2 * st + th * 2) + y1; NT[2] = lz - sy * ox + cy * z1;
      NT[3] = tilt; NT[4] = yaw; NT[5] = -q; NT[6] = flip;
    } else {
      const a = L.a ?? 0;
      let dx = 0;
      if (type === "row") dx = (i - (n - 1) / 2) * (L.gap ?? w * 1.15);
      // A stack: squared up, each card a hair turned (from its number, so it is the same every time).
      const jit = type === "stack" ? ((((c * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 0.07 : 0;
      NT[0] = lx + Math.cos(a) * dx; NT[1] = th / 2 + (type === "stack" ? i * th * 1.1 : 0); NT[2] = lz - Math.sin(a) * dx;
      NT[3] = 0; NT[4] = a + jit; NT[5] = 0; NT[6] = flip;
    }
  }
  /** After a deck change: new targets; moved cards start in move order, `stagger` apart. */
  function retarget() {
    const t = TS[0]!;
    for (let c = 0; c < N; c++) {
      const moved = seen[c] !== k.stamp[c];
      let rank = 0;
      if (moved) for (let e = 0; e < N; e++) if (seen[e] !== k.stamp[e] && k.stamp[e]! < k.stamp[c]!) rank++;
      target(c);
      let diff = false, place = false;
      for (let j = 0; j < 7; j++) if (Math.abs(NT[j]! - TO[c * 7 + j]!) > 1e-9) (diff = true), j < 3 && Math.abs(NT[j]! - TO[c * 7 + j]!) > 0.3 && (place = true);
      if (ver < 0 || dur <= 0) {
        for (let j = 0; j < 7; j++) CUR[c * 7 + j] = FR[c * 7 + j] = TO[c * 7 + j] = NT[j]!;
        TD[c] = 0;
      } else if (diff) {
        for (let j = 0; j < 7; j++) (FR[c * 7 + j] = CUR[c * 7 + j]!), (TO[c * 7 + j] = NT[j]!);
        // The shorter way round for the yaw.
        const dy = TO[c * 7 + 4]! - FR[c * 7 + 4]!;
        FR[c * 7 + 4] = FR[c * 7 + 4]! + Math.round(dy / TAU) * TAU;
        const flipOnly = !place && Math.abs(NT[6]! - FR[c * 7 + 6]!) > 1;
        T0[c] = t + (moved ? rank * stg : 0);
        TD[c] = moved ? (flipOnly ? dur * 0.8 : dur) : dur * 0.7;
        TA[c] = place && moved ? arc : flipOnly ? arc * 0.6 : 0;
      }
      seen[c] = k.stamp[c]!;
    }
    ver = k.ver;
  }
  /** Pose every card at TS[0]: groups, bodies and sort anchors. */
  function showAt() {
    const t = TS[0]!;
    if (ver !== k.ver) retarget();
    busy = false;
    basis(d, B);
    for (let c = 0; c < N; c++) {
      const j = c * 7, u = TD[c]! > 0 ? Math.min(1, Math.max(0, (t - T0[c]!) / TD[c]!)) : 1, e = u * u * (3 - 2 * u);
      if (u < 1) busy = true;
      for (let q = 0; q < 7; q++) CUR[j + q] = u < 1 ? FR[j + q]! + (TO[j + q]! - FR[j + q]!) * e : TO[j + q]!;
      CUR[j + 1] = CUR[j + 1]! + TA[c]! * Math.sin(PI * u);
      const p = k.pile[c]!, L = lay[p] || {}, moving = u < 1, g = groups[c]!, b = bodies[c]!, fan = CUR[j + 5]!, fl = CUR[j + 6]!, h2 = th / 2;
      g.pos[0] = CUR[j]!; g.pos[1] = CUR[j + 1]!; g.pos[2] = CUR[j + 2]!;
      g.rot[0] = CUR[j + 3]!; g.rot[1] = CUR[j + 4]!;
      b.rot[1] = fan; b.rot[2] = fl;
      // The body turns about its bottom centre: shift it so it turns about its middle.
      const sf = Math.sin(fl);
      b.pos[0] = h2 * sf * Math.cos(fan); b.pos[1] = -h2 * Math.cos(fl); b.pos[2] = -h2 * sf * Math.sin(fan);
      // Sort anchor: a resting card sorts by its pile's centre and its index in the pile, a moving one
      // by where it is, a little toward the eye (so it passes over what it lands on).
      // One shadow under a resting stack (its bottom card's), not one per card.
      g.shadow = !moving && (L.type || "stack") === "stack" && k.pos[c]! > 0 ? 0 : shadow;
      X[0] = moving ? CUR[j]! : L.x ?? 0; X[1] = moving ? CUR[j + 1]! : 0; X[2] = moving ? CUR[j + 2]! : L.z ?? 0;
      toWorld();
      const ex = B[0]! - X[0]!, ey = B[1]! - X[1]!, ez = B[2]! - X[2]!, el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1, pull = (k.pos[c]! * 0.01 + (moving ? 0.6 : 0)) / el;
      AT[c * 3] = X[0]! + ex * pull; AT[c * 3 + 1] = X[1]! + ey * pull; AT[c * 3 + 2] = X[2]! + ez * pull;
    }
    return busy;
  }
  return {
    /** Each card's group (moved by `show`; tagged { card }). */
    groups,
    /** Each card's body (recolour its edge). */
    bodies,
    /** Pose every card at t (seconds, a running clock); true while any card still moves. */
    show(t: number) {
      TS[0] = t;
      return showAt();
    },
    /** The card under (x, y) (CSS px) as of the last draw, or −1. */
    pick(x: number, y: number) {
      const ob = d.root(d.pick(x, y)), tg = ob && (ob.tag as { card?: number } | null);
      return tg && tg.card != null ? tg.card : -1;
    },
    /** Lay every pile out again now (after turning the camera: fans face it). */
    relayout() {
      ver = k.ver - 1;
    },
    /** Card c's pose now: [x, y, z, tilt, yaw, fan, flip] in `out`. */
    pose(c: number, out: { [i: number]: number }) {
      for (let j = 0; j < 7; j++) out[j] = CUR[c * 7 + j]!;
      return out;
    },
  };
}
/** What `dioramaCards` returns. */
export type DioramaCards = ReturnType<typeof dioramaCards>;

/** A rounded rectangle path. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
/** B = diorama `d`'s camera as it draws: eye (0–2), right (3–5), up (6–8), forward (9–11), focal
 *  (12) and the screen centre (13, 14). */
function basis(d: Diorama, B: Float64Array) {
  const c = d.cam, cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), h = d.height;
  B[0] = c.tx + c.dist * sy * cp; B[1] = c.ty + c.dist * sp; B[2] = c.tz + c.dist * cy * cp;
  B[3] = cy; B[4] = 0; B[5] = -sy;
  B[6] = -sy * sp; B[7] = cp; B[8] = -cy * sp;
  B[9] = -sy * cp; B[10] = -sp; B[11] = -cy * cp;
  B[12] = h / 2 / Math.tan(c.fov / 2); B[13] = d.width / 2 + c.ox; B[14] = h / 2 + c.oy;
}
/** Y[yi], Y[yi + 1] = world point X on screen under B (CSS px). */
function proj(B: Float64Array, X: Float64Array, Y: Float64Array, yi: number) {
  const dx = X[0]! - B[0]!, dy = X[1]! - B[1]!, dz = X[2]! - B[2]!, k = B[12]! / Math.max(dx * B[9]! + dy * B[10]! + dz * B[11]!, 0.05);
  Y[yi] = B[13]! + (dx * B[3]! + dy * B[4]! + dz * B[5]!) * k;
  Y[yi + 1] = B[14]! - (dx * B[6]! + dy * B[7]! + dz * B[8]!) * k;
}
