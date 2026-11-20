/**
 * @fzlt/core/input: one controller for keys, pointer and a touch stick, mapped to named intents.
 * Listeners only record; the engine's read phase latches edges and measures the target, so a step
 * sees a stable snapshot. Keys typed into the host page's fields (or inside [data-fizlet-ignore])
 * never count. Keys, the pointer, `press()` and `steer()` wake a settled engine. Held state is
 * dropped on window blur, when the engine pauses, on dispose() and on destroy: nothing stays stuck.
 *
 * `hit` (an intent or the pointer): a press is seen by exactly one fixed step, the first step after
 * it, even when that comes frames later (0-step frames while catching up) and never again in the
 * same frame's later steps. Outside a step (read, render), `hit` is true for the one frame whose
 * read latched it. Presses between two steps count once.
 */
import type { Engine, System } from "./kernel/engine";

/** Options for `controls()`: the intents and their keys, the pointer target and the touch stick. */
export interface ControlsOptions {
  /** intent → key codes, e.g. { fire: ["Space"], up: ["KeyW", "ArrowUp"] } (KeyboardEvent.code). */
  keys?: Record<string, string[]>;
  /** Where the pointer is measured and the stick lives (default: the engine root, else window). */
  target?: HTMLElement;
  /** Touch: a drag that starts on the left half (or anywhere: "any") drives a virtual stick. */
  stick?: "left" | "any" | false;
  /** Stick radius in CSS px (default 60). */
  radius?: number;
}

const EDIT = "input,textarea,select,[contenteditable],[data-fizlet-ignore]";
/** An intent by name, or by the number `id(name)` gave. */
export type Intent = string | number;

/** One controller for keys, pointer and a touch stick on engine `e`, mapped to named intents:
 *  `down(intent)`, `hit(intent)` (one step per press), `pointer` and `stick`. It registers its
 *  own read-phase system; `dispose()` removes it. */
export function controls(e: Engine, o: ControlsOptions = {}) {
  const ctl = new AbortController(), on = { signal: ctl.signal };
  const names = Object.keys(o.keys ?? {}), N = names.length;
  // A key code can drive several intents; an intent can have several keys. Each intent resolves
  // once, here, by its name and by its number (`id()`): a lookup is one Map read, never a scan.
  const byCode = new Map<string, number[]>(), ids = new Map<Intent, number>();
  names.forEach((n, i) => (ids.set(n, i).set(i, i), o.keys![n]!.forEach((c) => (byCode.get(c) ?? byCode.set(c, []).get(c)!).push(i))));
  const keys = new Set<string>(); // physical keys down
  const cnt = new Uint8Array(N), btn = new Uint8Array(N); // keys down per intent, press() per intent
  // Edges for each intent plus the pointer (slot N): pending, latched this frame, the step it is for.
  const pend = new Uint8Array(N + 1), fresh = new Uint8Array(N + 1), at = new Float64Array(N + 1).fill(-1);
  const index = (n: Intent) => ids.get(n) ?? -1;
  const isDown = (i: number) => cnt[i]! + btn[i]! > 0;
  const hit = (i: number) => (e.phase === 2 /* STEP */ ? at[i] === e.steps : fresh[i] === 1);
  const target = o.target ?? (e.root as HTMLElement | null) ?? null;
  const R = o.radius ?? 60;
  // Pointer: x, y (relative to target), down, client x, client y, owner pointer id,
  // target left, top, width (measured in read), needs measuring.
  // Stick: x, y in -1..1, active, origin x, origin y, pointer id.
  const p = new Float64Array(10), s = new Float64Array(6);
  p[5] = s[5] = -1;
  const measure = () => {
    const r = target?.getBoundingClientRect();
    p[6] = r?.left ?? 0;
    p[7] = r?.top ?? 0;
    p[8] = r?.width ?? innerWidth;
    p[9] = 0;
  };
  const editing = (t: EventTarget | null) => t instanceof Element && !!t.closest(EDIT);
  const clear = () => {
    keys.clear();
    cnt.fill(0);
    btn.fill(0);
    pend.fill(0);
    fresh.fill(0);
    at.fill(-1);
    p[2] = s[0] = s[1] = s[2] = 0;
    p[5] = s[5] = -1;
  };

  addEventListener("keydown", (ev) => {
    const list = byCode.get(ev.code);
    if (!list || editing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    e.wake(); // a settled engine (page interactions) wakes on its own keys
    if (e.running) ev.preventDefault();
    if (keys.has(ev.code)) return;
    keys.add(ev.code);
    for (const i of list) {
      if (!ev.repeat && !isDown(i)) pend[i] = 1;
      cnt[i]!++;
    }
  }, on);
  addEventListener("keyup", (ev) => {
    if (keys.delete(ev.code)) for (const i of byCode.get(ev.code)!) cnt[i]!--;
  }, on);
  addEventListener("blur", clear, on);

  const el: EventTarget = target ?? window;
  el.addEventListener("pointermove", (ev) => {
    const pe = ev as PointerEvent;
    e.wake();
    if (pe.pointerId === s[5]) {
      let dx = pe.clientX - s[3]!, dy = pe.clientY - s[4]!;
      const d = Math.hypot(dx, dy);
      if (d > R) (dx *= R / d), (dy *= R / d);
      s[0] = dx / R;
      s[1] = dy / R;
      return;
    }
    // No layout read here: the read phase measures the target once per frame.
    p[3] = pe.clientX;
    p[4] = pe.clientY;
    p[9] = 1;
  }, on);
  el.addEventListener("pointerdown", (ev) => {
    const pe = ev as PointerEvent;
    if (editing(pe.target)) return;
    e.wake();
    measure(); // a press is rare and decides the stick side: measure it fresh
    // A touch on the stick side takes a free stick, and a held one too when it is the primary
    // pointer: no other finger is down, so the old one is stale (iOS can end a touch with no
    // pointerup). A second finger while the stick is held stays a pointer (multi-touch).
    if (pe.pointerType === "touch" && o.stick && (s[5]! < 0 || pe.isPrimary) && (o.stick === "any" || pe.clientX - p[6]! < p[8]! / 2)) {
      s[2] = 1;
      s[3] = pe.clientX;
      s[4] = pe.clientY;
      s[5] = pe.pointerId;
      s[0] = s[1] = 0;
      return;
    }
    p[3] = pe.clientX;
    p[4] = pe.clientY;
    p[2] = 1;
    p[5] = pe.pointerId;
    pend[N] = 1;
  }, on);
  // Released anywhere (outside the target too), cancelled, or capture lost: only its owner lets go.
  const up = (ev: Event) => {
    const id = (ev as PointerEvent).pointerId;
    if (id === s[5]) (s[0] = s[1] = s[2] = 0), (s[5] = -1);
    if (id === p[5]) (p[2] = 0), (p[5] = -1);
  };
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) addEventListener(t, up, { signal: ctl.signal, capture: true });

  const system: System = {
    read() {
      const t = e.steps;
      for (let i = 0; i <= N; i++) {
        fresh[i] = pend[i]!;
        if (pend[i]) (at[i] = t), (pend[i] = 0);
      }
      if (p[9]) measure();
      p[0] = p[3]! - p[6]!;
      p[1] = p[4]! - p[7]!;
    },
    pause: clear,
  };
  e.add(system);
  /** Remove this controller only (listeners, system, held state); the engine keeps running. */
  const dispose = () => {
    ctl.abort();
    e.remove(system);
    clear();
  };
  e.signal.addEventListener("abort", dispose, on);

  return {
    /** An intent's number, for a hot path: `const FIRE = c.id("fire")`, then `c.hit(FIRE)` in a step.
     *  A name that is not an intent throws here, at setup (a typo is never a silent `false`). */
    id(intent: string) {
      const i = index(intent);
      if (i < 0) throw Error("fizlet/input: no " + intent);
      return i;
    },
    /** Held right now (any of its keys, or press()). */
    down: (intent: Intent) => isDown(index(intent)),
    /** Pressed: true in the first step after the press; outside steps, for the frame it latched. */
    hit: (intent: Intent) => hit(index(intent)),
    /** -1..1 from two intents (keys), plus the stick when it's active. */
    axis(neg: Intent, pos: Intent, stickAxis?: 0 | 1) {
      const k = +isDown(index(pos)) - +isDown(index(neg));
      return k || (stickAxis === undefined ? 0 : s[stickAxis]!);
    },
    pointer: {
      get x() { return p[0]!; },
      get y() { return p[1]!; },
      get down() { return p[2] === 1; },
      get hit() { return hit(N); },
    },
    stick: {
      get x() { return s[0]!; },
      get y() { return s[1]!; },
      get active() { return s[2] === 1; },
    },
    /** Press an intent from code (on-screen keys): `press("strike")`. */
    press(intent: string, down = true) {
      const i = index(intent);
      if (i < 0) return;
      e.wake(); // like a real key: a settled engine (page interactions) wakes for an on-screen one
      if (down && !isDown(i)) pend[i] = 1;
      btn[i] = +down;
    },
    /** Drive the stick from code (an on-screen stick, @fzlt/core/pad): x, y in -1..1; `on = false` lets go. */
    steer(x: number, y: number, on = true) {
      e.wake();
      s[0] = on ? x : 0;
      s[1] = on ? y : 0;
      s[2] = on ? 1 : 0;
    },
    dispose,
    system,
  };
}
/** The controller `controls()` returns. */
export type Controls = ReturnType<typeof controls>;

/** Options for `gamepad()`: which buttons press which intents, the dead zone, which pad. */
export interface GamepadOptions {
  /** intent → standard-layout button indices, e.g. { fire: [0], jump: [1, 7] } (0 is A / cross). */
  map?: Record<string, number[]>;
  /** Dead zone, 0..1, for the left stick and analog buttons (default 0.15). */
  dead?: number;
  /** Read only the pad at this `navigator.getGamepads()` index (local multiplayer: a controller per
   *  seat); default: every pad, merged. */
  index?: number;
}

/** Gamepads into a `controls()` controller: mapped buttons `press` their intents (down from half
 *  a pull), the left stick `steer`s the controller's stick, both past the dead zone. It polls in
 *  the controller's read phase, before the edges latch, and only while a pad is connected: a page
 *  without one never calls `getGamepads()` per frame. Pads have no events for buttons, so a
 *  settled engine is not polled: a pad connecting wakes it, and a game that settles between rounds
 *  wakes it from its own start key. Zero allocation per read. `stop()` removes it (listeners,
 *  polling, held intents and the stick). */
export function gamepad(c: Controls, o: GamepadOptions = {}) {
  const ctl = new AbortController(), on = { signal: ctl.signal };
  const map = o.map ?? {}, names = Object.keys(map), N = names.length, D = o.dead ?? 0.15, only = o.index ?? -1;
  const held = new Uint8Array(N), val = new Float64Array(N);
  const sys = c.system, read = sys.read!;
  let count = 0, steering = 0;
  const poll = () => {
    const pads = navigator.getGamepads();
    let x = 0, y = 0, m = D * D;
    val.fill(0);
    for (let k = 0; k < pads.length; k++) {
      const g = pads[k];
      if (!g || !g.connected || (only >= 0 && g.index !== only)) continue;
      for (let i = 0; i < N; i++) {
        const b = map[names[i]!]!;
        for (let j = 0; j < b.length; j++) {
          const btn = g.buttons[b[j]!];
          const v = btn ? btn.value || +btn.pressed : 0;
          if (v > val[i]!) val[i] = v;
        }
      }
      // The stick tilted furthest, by its squared length (a pad with no axes reads NaN: never past).
      const ax = g.axes[0]!, ay = g.axes[1]!, d = ax * ax + ay * ay;
      if (d > m) (m = d), (x = ax), (y = ay);
    }
    for (let i = 0; i < N; i++) {
      const v = val[i]!, d = +(v >= 0.5);
      val[i] = v > D ? (v - D) / (1 - D) : 0;
      if (d !== held[i]) (held[i] = d), c.press(names[i]!, d > 0);
    }
    if (m > D * D) {
      // Rescaled past the dead zone, so the stick starts at 0 at its edge and reaches 1. Input
      // side, never the sim: a plain square root is fine here (steer's exact hypot is for steps).
      m = Math.sqrt(m);
      const k = Math.min(1, (m - D) / (1 - D)) / m;
      c.steer(x * k, y * k);
      steering = 1;
    } else if (steering) (steering = 0), c.steer(0, 0, false);
  };
  const free = () => {
    for (let i = 0; i < N; i++) if (held[i]) (held[i] = 0), c.press(names[i]!, false);
    val.fill(0);
    if (steering) (steering = 0), c.steer(0, 0, false);
  };
  const seen = () => {
    count = 0;
    try {
      for (const g of navigator.getGamepads()) if (g && (only < 0 || g.index === only)) count++;
    } catch {} // no Gamepad API, or a frame whose permissions policy blocks it: none
    if (!count) free(); // the last one left: let go of what it held
  };
  sys.read = (e) => {
    if (count) poll();
    read(e);
  };
  addEventListener("gamepadconnected", () => (seen(), c.stick.active || c.steer(0, 0, false)), on);
  addEventListener("gamepaddisconnected", seen, on);
  seen();
  return {
    /** A pad is connected (the one at `index`, when given). */
    get connected() { return count > 0; },
    /** Pads connected (the one at `index` counts as at most 1). */
    get count() { return count; },
    /** An intent's analog value, 0..1 past the dead zone (a trigger's pull), as of the last read. */
    value: (intent: string) => val[names.indexOf(intent)] ?? 0,
    /** Stop reading pads: listeners off, polling off, its held intents and the stick let go. */
    stop() {
      ctl.abort();
      sys.read = read;
      count = 0;
      free();
    },
  };
}
