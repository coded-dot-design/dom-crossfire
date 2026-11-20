/**
 * @fzlt/core/aim: where bots and turrets point and when they may fire. Bound once to body arrays (a
 * @fzlt/core/actor's or a steer's `x`, `y`, heading `a`, velocity `vx`, `vy`) and, for line of sight, a
 * @fzlt/core/grid board; then everything takes rows:
 * - `lead(i, j, speed)`: where i must shoot a shot of `speed` px/s to meet j, moving at (vx, vy):
 *   the intercept of a straight shot and a straight mover, the earliest one ahead;
 * - `cone(i, j, half, range)`: j inside i's heading ± `half` radians and within `range`;
 * - `sees(i, j)`: no `mask` cell strictly between them on the board (Bresenham, symmetric), or
 *   the game's own `clear(i, j)`;
 * - `pick(i, list, n, half, range)`: the nearest `foe` of i among list[0..n) in its cone and in
 *   sight (an actor table's `list` and `n` as they are).
 * Results land in `out[0..3]` ([x, y, t, d]: aim point, seconds to impact or the off-heading angle, and
 * distance), so no call returns a double: doubles returned or passed across a call V8 doesn't
 * inline are boxed. Distances are @fzlt/core/steer's exact `hypot` (Math.hypot's bits, no heap
 * number). DOM-free, stateless between calls, zero allocation.
 */
import type { Board } from "./grid";
import { hypot } from "./steer";

/** Options for `aim()`: the body arrays, an optional board and sight mask, and who counts as a foe. */
export interface AimOptions {
  x: Float64Array;
  y: Float64Array;
  /** Headings in radians (for `cone`); without them every cone is a circle. */
  a?: Float64Array;
  /** Velocities in px/s (for `lead`); without them targets stand still. */
  vx?: Float64Array;
  vy?: Float64Array;
  /** Line of sight on this board (world px; its `cell` size); without one everything is in sight. */
  board?: Board;
  /** Cell flags that block sight (default 1: grid's BLOCKED; BLOCKED | COVER lets cover block). */
  mask?: number;
  /** Your own line of sight, used instead of `board` (a game whose tiles have their own rule). */
  clear?(i: number, j: number): boolean;
  /** May i shoot at j? (default: any j but i). With actors: `(i, j) => A.side[j] !== A.side[i]`. */
  foe?(i: number, j: number): boolean;
}

/** Aiming bound to body arrays: `lead`, `cone`, `sees` and `pick`, results in `out`, zero allocation. */
export function aim(o: AimOptions) {
  const { x, y, a, vx, vy, board, clear } = o, mask = o.mask ?? 1, foe = o.foe;
  // out, then the best distance so far in pick: a typed-array slot, never a local that starts an
  // integer (the range) and turns double, which V8 widens to a boxed number.
  const out = new Float64Array(5);
  const sees = (i: number, j: number) => (clear ? clear(i, j) : !board || board.los(board.cellOf(x, y, i), board.cellOf(x, y, j), mask));
  /** Where j is from i: out = [j's x, y, signed angle off i's heading, distance]. */
  const look = (i: number, j: number) => {
    const dx = x[j]! - x[i]!, dy = y[j]! - y[i]!, b = Math.atan2(dy, dx) - (a ? a[i]! : 0);
    out[0] = x[j]!;
    out[1] = y[j]!;
    out[2] = a ? Math.atan2(Math.sin(b), Math.cos(b)) : 0;
    out[3] = hypot(dx, dy);
  };
  return {
    out,
    /** out = [aim x, aim y, seconds to impact, distance to the aim point]. False when the shot can
     *  never catch j (out is then j where it stands, t = -1). */
    lead(i: number, j: number, speed: number) {
      const px = x[j]! - x[i]!, py = y[j]! - y[i]!, ux = vx ? vx[j]! : 0, uy = vy ? vy[j]! : 0;
      // |p + u t| = speed × t  →  (u·u − s²) t² + 2 (p·u) t + p·p = 0
      const qa = ux * ux + uy * uy - speed * speed, qb = 2 * (px * ux + py * uy), qc = px * px + py * py;
      let t = -1;
      if (qc === 0) t = 0;
      else if (Math.abs(qa) < 1e-9 * (speed * speed + 1)) t = qb < 0 ? -qc / qb : -1; // as fast as the shot
      else {
        const disc = qb * qb - 4 * qa * qc;
        if (disc >= 0) {
          // The stable pair of roots (no cancellation): q / qa and qc / q.
          const q = -0.5 * (qb + (qb < 0 ? -1 : 1) * Math.sqrt(disc)), t1 = q / qa, t2 = q !== 0 ? qc / q : -1;
          t = t1 > 0 && (t2 <= 0 || t1 < t2) ? t1 : t2 > 0 ? t2 : -1;
        }
      }
      const k = t > 0 ? t : 0;
      out[0] = x[j]! + ux * k;
      out[1] = y[j]! + uy * k;
      out[2] = t;
      out[3] = hypot(out[0]! - x[i]!, out[1]! - y[i]!);
      return t >= 0;
    },
    /** j within `range` px and inside i's heading ± `half` rad. out = [j's x, y, angle off heading
     *  (signed, -π..π: turn by it), distance]. */
    cone(i: number, j: number, half: number, range: number) {
      look(i, j);
      return out[3]! <= range && Math.abs(out[2]!) <= half;
    },
    sees,
    /** The nearest foe of i among rows list[0..n) inside its cone and range and in sight; -1 if none.
     *  Skip dead rows with `foe` (e.g. `A.alive[j] && …`). Sight is checked last, and only for a row
     *  closer than the best so far, so a long list costs a sight check per closer candidate, not per row. out is the pick's. */
    pick(i: number, list: Int32Array, n: number, half: number, range: number) {
      let best = -1;
      out[4] = range;
      for (let k = 0; k < n; k++) {
        const j = list[k]!;
        if (j === i || (foe && !foe(i, j))) continue;
        look(i, j);
        if (out[3]! > out[4]! || (best >= 0 && out[3] === out[4]) || Math.abs(out[2]!) > half || !sees(i, j)) continue;
        best = j;
        out[4] = out[3]!;
      }
      if (best >= 0) look(i, best);
      return best;
    },
  };
}
/** The aimer `aim()` returns. */
export type Aim = ReturnType<typeof aim>;
