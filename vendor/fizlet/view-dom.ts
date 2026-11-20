/**
 * @fzlt/core/view-dom: a @fzlt/core/actor table drawn as DOM nodes, one per row, pooled. A row's node is
 * made the first time it shows (`make(i)`, default an empty `<i>`), put in `host` through the
 * ledger, and kept for good: when the actor dies the node hides (`hidden`), and when the row lives
 * again (a new actor) the same node comes back. So the page holds at most `cap` nodes, and
 * `engine.destroy()` (Recall) takes every one away and leaves the host as it was.
 *
 * Each render it writes, change-only through the ledger: `transform` (the body's `x`, `y` times
 * `scale`, to 0.01 px, centred on the node unless `center: false`, turned by the heading `a` unless
 * `turn: false`), `--hp` (hp / max, to 0.01), and `data-side` / `data-kind` when a row shows. The
 * look is the page's CSS (`[data-side="1"] { … }`, `width: calc(var(--hp) * 100%)`); give `hidden`
 * the last word if a rule sets `display`. `paint(i, el)` runs after for a row's own change-only
 * writes (through engine.ledger). A board that holds still writes nothing and calls no `busy()`,
 * so an engine with `settle` sleeps. A death can `linger` (seconds, with `data-dead` set, for a CSS
 * fade) and holds the engine awake that long; with reduced motion the node hides at once. The step
 * only counts lingering deaths down: no DOM, no allocation. A moved row costs one transform string
 * in render; a still one costs nothing.
 */
import type { Engine } from "./kernel/engine";
import type { Actors } from "./actor";

type El = HTMLElement | SVGElement;
/** Options for `viewDom()`: node factory, scale, turn, centring, linger, motion and paint. */
export interface ViewOptions {
  /** A node for row i, made once, the first time row i shows (default: an empty `<i>`). */
  make?(i: number): El;
  /** Pixels per world unit (default 1): a board whose units live in cells passes its tile size. */
  scale?: number;
  /** Turn by the heading `a` (default true). */
  turn?: boolean;
  /** Centre the node on (x, y) (default true: `translate(-50%, -50%)`). */
  center?: boolean;
  /** Seconds a dead actor's node stays, with `data-dead`, before it hides (default 0). */
  linger?: number;
  /** Animate deaths (default: yes, unless the visitor prefers reduced motion). */
  motion?: boolean;
  /** After the view's writes for a showing row, each render: the game's own (change-only) writes. */
  paint?(i: number, el: El): void;
}

// Labels for data-side / data-kind (a row's side and kind are bytes): made once, never per frame.
const NUM = Array.from({ length: 256 }, (_, k) => `${k}`);

/** An actor table as pooled DOM nodes, written change-only through the ledger; settles when still, `destroy()` removes every node. */
export function viewDom(engine: Engine, A: Actors, host: El, o: ViewOptions = {}) {
  const cap = A.cap, L = engine.ledger, px = (o.scale ?? 1) * 100, linger = o.linger ?? 0, turn = o.turn !== false, mid = o.center === false ? "" : " translate(-50%,-50%)";
  const nodes: (El | undefined)[] = Array(cap).fill(undefined);
  // Per row: last x, y, a, hp written (×100, rounded) and the linger clock; the generation shown; state.
  const last = new Float64Array(cap * 4), left = new Float64Array(cap), gen = new Uint32Array(cap);
  const state = new Uint8Array(cap), HIDDEN = 0, SHOWN = 1, DYING = 2, GONE = 3;
  const mq = o.motion == null && typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const still = () => (mq ? mq.matches : o.motion === false);
  const hide = (el: El, i: number) => {
    L.attr(el, "hidden", "");
    state[i] = HIDDEN;
  };
  const sys = {
    step(_: Engine, dt: number) {
      for (let i = 0; i < cap; i++) if (state[i] === DYING && (left[i] = left[i]! - dt) <= 0) state[i] = GONE;
    },
    render() {
      let wrote = false;
      for (let i = 0; i < cap; i++) {
        let el = nodes[i];
        if (A.alive[i]) {
          if (!el) {
            el = nodes[i] = o.make?.(i) ?? host.ownerDocument.createElement("i");
            el.setAttribute("hidden", ""); // ours from birth: Recall removes the node itself
            host.appendChild(L.add(el));
          }
          if (state[i] !== SHOWN || gen[i] !== A.gen[i]) {
            L.attr(el, "hidden", null);
            L.attr(el, "data-dead", null);
            L.attr(el, "data-side", NUM[A.side[i]!]!);
            L.attr(el, "data-kind", NUM[A.kind[i]!]!);
            state[i] = SHOWN;
            gen[i] = A.gen[i]!;
            last[i * 4] = NaN; // write the body afresh
            wrote = true;
          }
          const k = i * 4, x = Math.round(A.x[i]! * px), y = Math.round(A.y[i]! * px), a = turn ? Math.round(A.a[i]! * 100) : 0;
          if (x !== last[k] || y !== last[k + 1] || a !== last[k + 2]) {
            last[k] = x;
            last[k + 1] = y;
            last[k + 2] = a;
            L.style(el, "transform", `translate(${x / 100}px,${y / 100}px)${mid}${turn ? ` rotate(${a / 100}rad)` : ""}`);
            wrote = true;
          }
          const m = A.max[i]!, hp = m > 0 ? Math.round((Math.max(0, A.hp[i]!) / m) * 100) : 100;
          if (hp !== last[k + 3]) {
            last[k + 3] = hp;
            L.style(el, "--hp", `${hp / 100}`);
            wrote = true;
          }
          o.paint?.(i, el);
        } else if (el && state[i] === SHOWN) {
          if (linger > 0 && !still()) {
            L.attr(el, "data-dead", "");
            state[i] = DYING;
            left[i] = linger;
            engine.busy(linger);
          } else hide(el, i);
          wrote = true;
        } else if (el && state[i] === GONE) (hide(el, i), (wrote = true));
      }
      if (wrote) engine.busy();
    },
  };
  engine.add(sys);
  return {
    /** Row i's node (undefined until it first shows). */
    node: (i: number) => nodes[i],
    /** Stop drawing (the nodes stay until Recall: engine.destroy()). */
    remove: () => engine.remove(sys),
  };
}
/** The view `viewDom()` returns. */
export type ViewDom = ReturnType<typeof viewDom>;
