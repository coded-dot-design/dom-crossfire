/**
 * @fzlt/core/debug: development-only checks. `guardLayout(engine)` counts every layout read (rects,
 * offset/client/scroll sizes, computed style) made while the engine is in its STEP phase, the
 * contract's "no layout reads in the tick". `touchLog()` puts an on-screen log of pointer and touch
 * events on a real phone. Never ship this in a production build.
 */
import { type Engine } from "./kernel/engine";

const guarded = new Set<Engine & { violations?: number }>();
let patched = false;
function hit() {
  for (const e of guarded) if (e.phase === 2 /* STEP */) e.violations = (e.violations ?? 0) + 1;
}
function patch() {
  if (patched || typeof Element !== "function") return;
  patched = true;
  const P = Element.prototype, H = HTMLElement.prototype;
  for (const name of ["getBoundingClientRect", "getClientRects"] as const) {
    const f = P[name] as (...a: unknown[]) => unknown;
    (P as unknown as Record<string, unknown>)[name] = function (this: Element, ...a: unknown[]) {
      hit();
      return f.apply(this, a);
    };
  }
  for (const [proto, props] of [
    [P, ["clientWidth", "clientHeight", "clientTop", "clientLeft", "scrollWidth", "scrollHeight", "scrollTop", "scrollLeft"]],
    [H, ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft"]],
  ] as const)
    for (const prop of props) {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (d?.get) Object.defineProperty(proto, prop, { ...d, get() { hit(); return d.get!.call(this); } });
    }
  const gcs = getComputedStyle;
  globalThis.getComputedStyle = (el: Element, pseudo?: string | null) => (hit(), gcs(el, pseudo));
}
/** Count layout reads made during a step; the number shows as `engine.violations`. */
export function guardLayout(engine: Engine) {
  patch();
  const e = engine as Engine & { violations?: number };
  e.violations = 0;
  guarded.add(e);
  engine.signal.addEventListener("abort", () => guarded.delete(e));
  return () => guarded.delete(e);
}

/** Options for `touchLog()`. */
export interface TouchLogOptions {
  /** Lines kept on screen, newest last (default 14). */
  lines?: number;
  /** Also log pointermove and touchmove (default false: they flood the log). */
  moves?: boolean;
  /** Where the overlay goes (default document.body). */
  host?: HTMLElement;
}
const TOUCH = "pointerdown pointerup pointercancel gotpointercapture lostpointercapture touchstart touchend touchcancel click";
/** `tag#id.class`, and the shadow host it sits in. */
const named = (t: unknown): string => {
  if (!(t instanceof Element)) return String(t);
  const id = t.getAttribute("id"), cls = t.getAttribute("class")?.trim().replace(/\s+/g, ".");
  const host = (t.getRootNode?.() as ShadowRoot | undefined)?.host;
  return t.tagName.toLowerCase() + (id ? "#" + id : "") + (cls ? "." + cls : "") + (host ? " in " + named(host) : "");
};
/** An on-screen log of the last pointer and touch events on the page (type, pointer type and id or
 *  the touch count, x, y, and the element hit; each line starts with ms since start, inside open shadow roots too), for finding why a
 *  control doesn't answer on a real phone. A fixed box that never takes a touch itself; listeners
 *  are passive and capture on window, so nothing is cancelled or stopped. Nothing is saved or sent.
 *  Dev only: wire it to your own query flag. `stop()` removes the box and every listener. */
export function touchLog(o: TouchLogOptions = {}) {
  const N = o.lines ?? 14, ctl = new AbortController(), lines: string[] = [], t0 = performance.now();
  const el = document.createElement("pre");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;left:0;bottom:0;z-index:99999;margin:0;padding:4px;pointer-events:none;font:11px monospace;white-space:pre;background:#000c;color:#9f9";
  (o.host ?? document.body).append(el);
  const log = (ev: Event) => {
    const p = ev as PointerEvent & TouchEvent, at = p.changedTouches?.[0] ?? p;
    const who = p.pointerType ? p.pointerType + " " + p.pointerId : p.touches ? "touches " + p.touches.length : "";
    lines.push(Math.round(performance.now() - t0) + " " + ev.type + " " + who + " " + Math.round(at.clientX) + "," + Math.round(at.clientY) + " " + named(ev.composedPath?.()[0] ?? ev.target));
    if (lines.length > N) lines.shift();
    el.textContent = lines.join("\n");
  };
  for (const t of (TOUCH + (o.moves ? " pointermove touchmove" : "")).split(" ")) addEventListener(t, log, { capture: true, passive: true, signal: ctl.signal });
  return {
    /** The overlay (a fixed `<pre>`). */
    el,
    /** The lines on screen, oldest first. */
    lines: lines as readonly string[],
    /** Remove the box and every listener. */
    stop() {
      ctl.abort();
      el.remove();
    },
  };
}
