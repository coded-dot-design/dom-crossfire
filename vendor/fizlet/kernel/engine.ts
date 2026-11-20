import { EventRing } from "./ring";
import { need } from "./need";
import { Ledger } from "./ledger";
import { Pool } from "./pool";
import { seeded, type Random } from "./random";

/** Frame phases. Read geometry only in READ, never in STEP; write the DOM only in RENDER. */
export const IDLE = 0, READ = 1, STEP = 2, RENDER = 3;
// Inside the kernel and the bricks, numbers like these are written as literals named in a comment
// (`2 /* STEP */`). esbuild keeps a top-level `const` as a variable in any file with imports, and a local
// one declared after other code; a `const enum` would inline but is not erasable syntax (games vendor
// this source with `erasableSyntaxOnly`). Literals ship the same bytes in the minified and dist builds.

/** A system: game logic or a harness. Every hook is optional; systems run in the order added. */
export interface System {
  /** Once per frame, before the steps: read cached geometry, sample input. */
  read?(e: Engine): void;
  /** Fixed step (dt = engine.dt): the simulation. No DOM reads or writes, no allocation. */
  step?(e: Engine, dt: number): void;
  /** Once per frame, after the steps: write the DOM (change-only), play sounds from the ring. */
  render?(e: Engine, alpha: number): void;
  /** When a running engine pauses (stop() or an auto-pause rule): drop held input, stop sounds. */
  pause?(e: Engine): void;
}

/** Options for `createEngine()`. Every field is optional. */
export interface EngineOptions {
  /** The element the engine lives in; it pauses while this is off screen. */
  root?: Element | null;
  /** Fixed step in seconds (default 1/60). */
  step?: number;
  /** Most steps per frame before dropping time instead of spiralling (default 4). */
  maxSteps?: number;
  /** Seed for `engine.random` (default 1). */
  seed?: number;
  /** Event ring capacity per frame (default 64). */
  events?: number;
  /** Aborting this destroys the engine (Recall included). */
  signal?: AbortSignal;
  /** A hook threw during a scheduled frame. The engine is already stopped (`start()` resumes it);
   *  other engines and the shared clock keep running. Default: `console.error(error)`. */
  onError?: (error: unknown, engine: Engine) => void;
  /** Settle (page interactions): after this many seconds in which no system called `busy()`, the
   *  engine sleeps (paused: "settled", no frames at all) until `wake()`, input or `start()`. Off by default.
   *  Counted in engine time (steps). Something scheduled for later (an intro delay, a beat, an
   *  autoplay timer) holds it awake with `busy(sec)`. */
  settle?: number;
  /** Frame-rate cap (e.g. 30 for an ambient hero): between frames the engine is off the shared clock
   *  and a timer brings it back, so it asks for ~fps requestAnimationFrame calls a second. */
  fps?: number;
  /** Auto-pause rules (all on by default; reducedMotion is opt-in: most games calm their effects). */
  pause?: { hidden?: boolean; offscreen?: boolean; editable?: boolean; reducedMotion?: boolean };
}

/** What `engine.stats()` reports: frame and step counts, frame time, the event ring and pool
 *  fill, the ledger's size and the auto-pause rules holding the engine right now. */
export interface EngineStats {
  frames: number;
  steps: number;
  dropped: number;
  time: number;
  frameMs: { avg: number; max: number };
  events: { size: number; cap: number; dropped: number };
  pools: Record<string, { used: number; cap: number }>;
  ledger: number;
  paused: string[];
}

/** The engine `createEngine()` returns: what every system and brick takes. */
export type Engine = ReturnType<typeof createEngine>;

// ---------- The shared scheduler: one requestAnimationFrame for every engine on the page ----------
// While a tick runs, `cur` is the engine being framed and `end` the last one this frame covers:
// engines removed mid-frame shift both back (no one is skipped), engines added mid-frame wait for
// the next frame (no one runs twice), and only the tick itself asks for the next frame.
// An fps-capped engine leaves the clock after each frame and a timer brings it back at its next
// slot, so a 30 fps hero costs ~30 requestAnimationFrame calls a second, not one per vsync.
const live: Engine[] = [];
let raf = 0, requests = 0, cur = 0, end = -1;
function tick(now: number) {
  raf = 0;
  for (cur = 0, end = live.length; cur < end; cur++)
    try {
      live[cur]!.frame(now);
    } catch (err) {
      console.error(err); // a throwing onError: still never stops the shared clock
    }
  end = -1;
  schedule(null, false);
}
function schedule(e: Engine | null, on: boolean) {
  const i = live.indexOf(e!);
  if (on && i < 0) live.push(e!);
  if (!on && i >= 0) {
    live.splice(i, 1);
    if (i < end) end--;
    if (i <= cur) cur--;
  }
  if (end < 0 && live.length && !raf && typeof requestAnimationFrame === "function") (requests++, (raf = requestAnimationFrame(tick)));
  if (!live.length && raf) (cancelAnimationFrame(raf), (raf = 0));
}
/** Scheduler facts for tests and the debug HUD. */
export const scheduler = {
  get engines() {
    return live.length;
  },
  get requests() {
    return requests;
  },
};

const REASONS = ["stopped", "hidden", "offscreen", "editable", "reduced-motion", "settled"];

/** Systems removed mid-frame are swapped for this until the frame ends. */
const GONE: System = {};
// The engine's running numbers `n`: 0 ACC, 1 LAST, 2 TIME, 3 FRAMES, 4 STEPS, 5 DROPPED, 6 MS, 7 MAX,
// 8 QUIET, 9 DELTA, 10 WORK. Pause bits (`held`, in REASONS order): 1 STOPPED, 2 HIDDEN, 4 OFFSCREEN,
// 8 EDITABLE, 16 MOTION, 32 SETTLED.

/** Make an engine: a fixed-step loop on the page's shared clock, with its own pools, event ring,
 *  seeded random and ledger. Add systems with `add()`, then `start()`; `destroy()` (or aborting
 *  `o.signal`) stops it and gives the page back. */
export function createEngine(o: EngineOptions = {}) {
  const dt = need(o.step ?? 1 / 60, "step", 1), maxSteps = need(o.maxSteps ?? 4, "maxSteps", 2), root = o.root ?? null;
  const settle = o.settle == null ? 0 : need(o.settle, "settle", 1), gap = o.fps == null ? 0 : 1000 / need(o.fps, "fps", 1) - 4;
  const ctl = new AbortController(), signal = ctl.signal;
  const systems: System[] = [], pools: [string, Pool<unknown>][] = [];
  const events = new EventRing(o.events ?? 64), ledger = new Ledger(), random: Random = seeded(need(o.seed ?? 1, "seed"));
  let held: number = 1 /* STOPPED */, phase: number = 0 /* IDLE */, dead = false, gone = false;
  let napT: ReturnType<typeof setTimeout> | undefined; // the fps cap's timer
  // Running numbers live in one typed array: updating it never allocates (a captured `let` holding
  // a double would box a new number on every write). QUIET is the engine time settle counts from (the
  // last busy(), pushed later by busy(sec)): engine time, counted in steps, so a slow frame that drops
  // steps can't make a settling engine sleep before its own time has run.
  const n = new Float64Array(11);
  n[1 /* LAST */] = -1;

  const set = (bit: number, on: boolean) => {
    const was = !held && !dead;
    held = on ? held | bit : held & ~bit;
    if (held) n[1 /* LAST */] = -1;
    schedule(engine, !held && !dead);
    // Settling is not a pause for the game: held input and sounds stay as they are.
    if (was && held && bit !== 32 /* SETTLED */) for (let i = 0; i < systems.length; i++) systems[i]!.pause?.(engine);
  };

  const engine = {
    signal,
    events,
    ledger,
    random,
    root,
    /**
     * The current (or last) frame, as a typed-array view (reading a slot never boxes a number):
     * `[0]` seconds this frame advances on the shared clock (0 after a pause or a settle), `[1]` ms
     * the last finished frame's hooks took (read, steps, render). Read-only by convention.
     */
    timing: n.subarray(9 /* DELTA */, 10 /* WORK */ + 1),
    /** Fixed step length in seconds. */
    dt,
    get time() {
      return n[2 /* TIME */]!;
    },
    /** Fixed steps run so far: an integer, so reading it in a hot path never boxes a number. */
    get steps() {
      return n[4 /* STEPS */]!;
    },
    get phase() {
      return phase;
    },
    /** Pooled things in use right now, summed over every `engine.pool` (no allocation). */
    get live() {
      let k = 0;
      for (let i = 0; i < pools.length; i++) k += pools[i]![1].size;
      return k;
    },
    get running() {
      return !held && !dead;
    },
    /** Why it's paused right now (empty when running). */
    get paused() {
      return REASONS.filter((_, i) => held & (1 << i));
    },
    add<S extends System>(s: S): S {
      if (!dead) systems.push(s);
      return s;
    },
    /** Safe from inside a hook: the rest of the frame still runs every other system. */
    remove(s: System) {
      const i = systems.indexOf(s);
      if (i < 0) return;
      if (phase) (systems[i] = GONE), (gone = true);
      else systems.splice(i, 1);
    },
    /** A named, bounded pool, listed in stats(). */
    pool<T>(name: string, cap: number, create: () => T): Pool<T> {
      const p = new Pool(cap, create);
      pools.push([name, p as Pool<unknown>]);
      return p;
    },
    /** Run (again). On a settled engine this is wake() too: the quiet time starts over, so it runs a
     *  full settle window instead of going back to sleep on its first frame. Inert once destroyed. */
    start() {
      engine.wake(), dead || set(1 /* STOPPED */, false);
    },
    /**
     * Something moved this frame: keeps a settling engine awake (no-op without `settle`). With
     * `sec`, something is scheduled that far ahead (an intro delay, a pause between beats): the
     * engine stays awake for `sec` of its own time (steps, so a slow frame can't outrun it), and
     * settle counts from then. A later, shorter hold never cuts a longer one; 0 or NaN is busy().
     */
    busy(sec?: number) {
      n[8 /* QUIET */] = Math.max(n[8 /* QUIET */]!, n[2 /* TIME */]! + (sec || 0));
    },
    /** Wake a settled engine (input does this for you); the quiet time starts again. */
    wake() {
      engine.busy(); // the quiet time starts again; a hold still ahead stays
      if (held & 32 /* SETTLED */) set(32 /* SETTLED */, false);
    },
    stop() {
      set(1 /* STOPPED */, true);
    },
    /** Called by the scheduler with the rAF timestamp. */
    frame(now: number) {
      const sec = n[1 /* LAST */]! < 0 ? 0 : (now - n[1 /* LAST */]!) / 1000;
      n[1 /* LAST */] = now;
      try {
        engine.advance(sec);
      } catch (err) {
        // Isolate the failure: this engine stops, every other engine keeps its frame.
        phase = 0 /* IDLE */;
        engine.stop();
        if (!o.onError) throw err;
        o.onError(err, engine);
      }
      // fps cap: off the shared clock until its next slot (one timer, not a frame every vsync). Put
      // back early (a resume, a focus change), it frames at once and the timer starts over.
      // set(0) changes no bit: it puts the engine back on the clock unless it was paused or destroyed.
      // The slot counts from the frame's start: the nap is shortened by the work this frame took, so
      // a slow frame (a throttled phone) still meets its next slot instead of missing a vsync. A
      // negative delay is fine: setTimeout clamps it to 0 (no Math.max: page build ≤ 7,168 B gz).
      if (gap) clearTimeout(napT), schedule(engine, false), (napT = setTimeout(set, gap - n[10 /* WORK */]!, 0, false));
    },
    /** Run one frame's worth of time by hand (tests, headless, a server). A hook's error throws here.
     *  `sec` must be a finite number (0 or less runs a frame with no steps); anything else throws a
     *  RangeError before the frame starts, instead of stalling the clock for good (S6 P2-04). */
    advance(sec: number) {
      if (dead) return;
      need(sec, "sec");
      const t0 = performance.now();
      events.clear();
      phase = 1 /* READ */;
      for (let i = 0; i < systems.length; i++) systems[i]!.read?.(engine);
      phase = 2 /* STEP */;
      n[9 /* DELTA */] = sec;
      if (sec > 0) n[0 /* ACC */]! += sec;
      for (let k = 0; n[0 /* ACC */]! >= dt; k++) {
        if (k === maxSteps) {
          n[5 /* DROPPED */]! += Math.floor(n[0 /* ACC */]! / dt);
          n[0 /* ACC */]! %= dt;
          break;
        }
        for (let i = 0; i < systems.length; i++) systems[i]!.step?.(engine, dt);
        n[0 /* ACC */]! -= dt;
        n[2 /* TIME */]! += dt;
        n[4 /* STEPS */]!++;
      }
      phase = 3 /* RENDER */;
      const alpha = n[0 /* ACC */]! / dt;
      for (let i = 0; i < systems.length; i++) systems[i]!.render?.(engine, alpha);
      phase = 0 /* IDLE */;
      if (gone) {
        gone = false;
        for (let i = systems.length; i--; ) if (systems[i] === GONE) systems.splice(i, 1);
      }
      if (settle && n[2 /* TIME */]! - n[8 /* QUIET */]! >= settle) set(32 /* SETTLED */, true);
      const ms = (n[10 /* WORK */] = performance.now() - t0);
      n[3 /* FRAMES */]!++;
      n[6 /* MS */]! += ms;
      // Written every frame: a store that runs only on a new maximum would deopt this hot function each time.
      n[7 /* MAX */] = ms > n[7 /* MAX */]! ? ms : n[7 /* MAX */]!;
    },
    stats(): EngineStats {
      const p: EngineStats["pools"] = {};
      for (const [name, pool] of pools) p[name] = { used: pool.size, cap: pool.cap };
      const frames = n[3 /* FRAMES */]!;
      return {
        frames,
        steps: n[4 /* STEPS */]!,
        dropped: n[5 /* DROPPED */]!,
        time: n[2 /* TIME */]!,
        frameMs: { avg: frames ? n[6 /* MS */]! / frames : 0, max: n[7 /* MAX */]! },
        events: { size: events.size, cap: events.cap, dropped: events.dropped },
        pools: p,
        ledger: ledger.size,
        paused: engine.paused,
      };
    },
    /** Stop for good: every listener and observer goes (one signal), the page is restored.
     *  Idempotent; afterwards the engine is inert (start, add and advance do nothing). */
    destroy() {
      if (dead) return;
      dead = true;
      n[0 /* ACC */] = 0; // destroyed from inside a step: no more steps this frame
      clearTimeout(napT); // the fps cap's pending wake-up: nothing of ours outlives destroy()
      set(1 /* STOPPED */, true);
      ctl.abort();
      ledger.restore(true); // and closed: a late write through engine.ledger is refused (S6 P2-03)
      for (const [, pool] of pools) pool.clear();
      systems.length = 0;
    },
  };

  // ---------- Auto-pause: hidden tab, page leaving, off screen, typing, reduced motion ----------
  const rule = o.pause ?? {};
  if (typeof document === "object") {
    const on = { signal };
    if (rule.hidden !== false) {
      const vis = () => set(2 /* HIDDEN */, document.visibilityState === "hidden");
      document.addEventListener("visibilitychange", vis, on);
      addEventListener("pagehide", () => set(2 /* HIDDEN */, true), on);
      addEventListener("pageshow", vis, on);
      vis();
    }
    if (rule.offscreen !== false && root && typeof IntersectionObserver === "function") {
      const io = new IntersectionObserver((list) => set(4 /* OFFSCREEN */, !list[list.length - 1]!.isIntersecting));
      io.observe(root);
      // Not `on`: a listener tied to this same signal is removed before its abort event fires.
      signal.addEventListener("abort", () => io.disconnect(), { once: true });
    }
    if (rule.editable !== false) {
      // Typing in the host page's own fields pauses the game (keys belong to the field).
      const edit = (t: EventTarget | null) =>
        t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !root?.contains(t);
      document.addEventListener("focusin", (ev) => set(8 /* EDITABLE */, !!edit(ev.target)), on);
      document.addEventListener("focusout", () => set(8 /* EDITABLE */, false), on);
    }
    if (rule.reducedMotion && typeof matchMedia === "function") {
      const mq = matchMedia("(prefers-reduced-motion: reduce)");
      set(16 /* MOTION */, mq.matches);
      mq.addEventListener("change", () => set(16 /* MOTION */, mq.matches), on);
    }
  }
  if (o.signal) {
    if (o.signal.aborted) engine.destroy();
    else o.signal.addEventListener("abort", () => engine.destroy(), { signal });
  }
  return engine;
}
