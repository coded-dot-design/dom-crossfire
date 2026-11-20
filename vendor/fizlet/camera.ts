/**
 * @fzlt/core/camera: the page is the camera. Pan and zoom a DOM stage (any element) with one
 * `transform` written through the engine's ledger, so Recall gives it back exactly. Moves ease and
 * settle (the engine sleeps when they end); with reduced motion they jump. `contain` (default on)
 * keeps the stage covering its own box, so no edge shows and the page never scrolls sideways.
 *
 * Coordinates: world = the stage's own untransformed CSS px (0,0 is its top-left corner); screen =
 * the same box after the camera (what the visitor sees, in the stage's untransformed layout box).
 */
import type { Engine } from "./kernel/engine";
import { need } from "./kernel/need";

/** Options for `camera()`: easing rate, zoom limits, containment and reduced-motion handling. */
export interface CameraOptions {
  /** Easing rate per second (default 7; higher is snappier). A move settles in about 6 / ease s. */
  ease?: number;
  /** Zoom limits (default 1 and 4). */
  min?: number;
  max?: number;
  /** Keep the stage covering its own box and clip its parent (default true). */
  contain?: boolean;
  /** Ease moves (default: yes, unless the visitor prefers reduced motion; then every move jumps). */
  motion?: boolean;
}

// Slots of the camera state `s`, as literals named in a comment (src/kernel/engine.ts says why): 0 FX,
// 1 FY, 2 Z, 3 GX, 4 GY, 5 GZ, 6 PX, 7 PY, 8 W, 9 H, 10 RX, 11 RY, 12 RZ, 13 MOVE, 14 MEASURE, 15 CLIP, 16 JUMP.

/** A camera on stage `el`: pan and zoom it with one `transform` written through the engine's ledger
 *  (so Recall gives it back). Moves ease and settle; `to()`, `pan()` and `home()` drive it. */
export function camera(engine: Engine, el: HTMLElement | SVGElement, o: CameraOptions = {}) {
  const rate = need(o.ease ?? 7, "ease", 1), lo = need(o.min ?? 1, "min", 1), hi = need(o.max ?? 4, "max", 1), box = o.contain !== false;
  // The focus (world point) shows at the pin (screen point): translate = pin - focus * zoom.
  // FX FY Z current; GX GY GZ target; PX PY pin; W H stage size; RX RY RZ last written; flags; JUMP:
  // reduced motion, latched in read while moving (a step never calls into the DOM).
  const s = new Float64Array(17);
  s[2 /* Z */] = s[5 /* GZ */] = s[12 /* RZ */] = 1;
  s[14 /* MEASURE */] = 1;
  const mq = o.motion == null && typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const still = () => (mq ? mq.matches : o.motion === false);
  const parent = el.parentElement;

  const clampZ = (z: number) => Math.min(hi, Math.max(lo, z));
  // Contain: the translate t (one axis) keeps the stage over its box: between 0 and size * (1 - z).
  const fit = (f: number, p: number, z: number, size: number) => {
    if (!box || !size) return f;
    const t = p - f * z, a = size * (1 - z);
    return (p - Math.min(Math.max(a, 0), Math.max(Math.min(a, 0), t))) / z;
  };
  // Move the pin without moving the picture: re-express the current focus about the new pin.
  const pin = (px: number, py: number) => {
    const dx = px - s[6 /* PX */]!, dy = py - s[7 /* PY */]!;
    s[0 /* FX */] = s[0 /* FX */]! + dx / s[2 /* Z */]!;
    s[1 /* FY */] = s[1 /* FY */]! + dy / s[2 /* Z */]!;
    s[3 /* GX */] = s[3 /* GX */]! + dx / s[5 /* GZ */]!;
    s[4 /* GY */] = s[4 /* GY */]! + dy / s[5 /* GZ */]!;
    s[6 /* PX */] = px;
    s[7 /* PY */] = py;
  };

  const go = () => {
    s[3 /* GX */] = fit(s[3 /* GX */]!, s[6 /* PX */]!, s[5 /* GZ */]!, s[8 /* W */]!);
    s[4 /* GY */] = fit(s[4 /* GY */]!, s[7 /* PY */]!, s[5 /* GZ */]!, s[9 /* H */]!);
    s[13 /* MOVE */] = 1;
    // Size unknown (hidden at setup): measure in the next read. A known size is kept until the
    // stage resizes, so a drag pan reads no layout per frame.
    if (!s[8 /* W */]) s[14 /* MEASURE */] = 1;
    engine.wake();
  };

  // Layout reads happen here only: at setup, and in the read phase once the stage resized (or its
  // size is still unknown). A ResizeObserver says so; transforms never change a layout size.
  const measure = () => {
    s[14 /* MEASURE */] = 0;
    const r = el.getBoundingClientRect();
    s[8 /* W */] = r.width / s[12 /* RZ */]!;
    s[9 /* H */] = r.height / s[12 /* RZ */]!;
    s[3 /* GX */] = fit(s[3 /* GX */]!, s[6 /* PX */]!, s[5 /* GZ */]!, s[8 /* W */]!);
    s[4 /* GY */] = fit(s[4 /* GY */]!, s[7 /* PY */]!, s[5 /* GZ */]!, s[9 /* H */]!);
    if (box && parent && !s[15 /* CLIP */]) s[15 /* CLIP */] = getComputedStyle(parent).overflowX === "visible" ? 1 : 2;
  };
  measure();
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => (s[14 /* MEASURE */] = 1));
    ro.observe(el);
    engine.signal.addEventListener("abort", () => ro.disconnect());
  }

  const cam = {
    /** Show world point (x, y) at screen point (px, py) (default: the same point, a zoom about it). */
    to(x: number, y: number, zoom = s[5 /* GZ */]!, px = x, py = y) {
      if (!(x - x === 0 && y - y === 0 && zoom > 0 && px - px === 0 && py - py === 0)) return;
      pin(px, py);
      s[3 /* GX */] = x;
      s[4 /* GY */] = y;
      s[5 /* GZ */] = clampZ(zoom);
      go();
    },
    /** Stage size in px (untransformed), as last measured. */
    get width() {
      return s[8 /* W */]!;
    },
    get height() {
      return s[9 /* H */]!;
    },
    /** Drag by a screen delta (px): follows at once, no easing. */
    pan(dx: number, dy: number) {
      if (!(dx - dx === 0 && dy - dy === 0)) return;
      s[0 /* FX */] = s[0 /* FX */]! - dx / s[2 /* Z */]!;
      s[1 /* FY */] = s[1 /* FY */]! - dy / s[2 /* Z */]!;
      s[3 /* GX */] = s[3 /* GX */]! - dx / s[5 /* GZ */]!;
      s[4 /* GY */] = s[4 /* GY */]! - dy / s[5 /* GZ */]!;
      go();
    },
    /** Back to the page as it is (zoom 1, no offset), eased. */
    home() {
      s[3 /* GX */] = s[6 /* PX */]!;
      s[4 /* GY */] = s[7 /* PY */]!;
      s[5 /* GZ */] = 1;
      go();
    },
    /** Screen (stage box px) to world, into `out` (no allocation). */
    toWorld<T extends { [i: number]: number }>(x: number, y: number, out: T): T {
      out[0] = s[0 /* FX */]! + (x - s[6 /* PX */]!) / s[2 /* Z */]!;
      out[1] = s[1 /* FY */]! + (y - s[7 /* PY */]!) / s[2 /* Z */]!;
      return out;
    },
    get zoom() {
      return s[2 /* Z */]!;
    },
    /** Still easing toward the target. */
    get moving() {
      return s[13 /* MOVE */]! > 0;
    },
    read() {
      if (s[14 /* MEASURE */]) measure();
      if (s[13 /* MOVE */]) s[16 /* JUMP */] = +still();
    },
    step(e: Engine, dt: number) {
      if (!s[13 /* MOVE */]) return;
      const a = s[16 /* JUMP */] ? 1 : 1 - Math.exp(-rate * dt);
      s[2 /* Z */] = s[2 /* Z */]! + (s[5 /* GZ */]! - s[2 /* Z */]!) * a;
      s[0 /* FX */] = fit(s[0 /* FX */]! + (s[3 /* GX */]! - s[0 /* FX */]!) * a, s[6 /* PX */]!, s[2 /* Z */]!, s[8 /* W */]!);
      s[1 /* FY */] = fit(s[1 /* FY */]! + (s[4 /* GY */]! - s[1 /* FY */]!) * a, s[7 /* PY */]!, s[2 /* Z */]!, s[9 /* H */]!);
      // Settled: within a 50th of a pixel and a 10,000th of a zoom step; land exactly on the target.
      if (Math.abs(s[5 /* GZ */]! - s[2 /* Z */]!) < 1e-4 && Math.abs(s[3 /* GX */]! - s[0 /* FX */]!) * s[2 /* Z */]! < 0.02 && Math.abs(s[4 /* GY */]! - s[1 /* FY */]!) * s[2 /* Z */]! < 0.02)
        (s[0 /* FX */] = s[3 /* GX */]!), (s[1 /* FY */] = s[4 /* GY */]!), (s[2 /* Z */] = s[5 /* GZ */]!), (s[13 /* MOVE */] = 0);
      e.busy();
    },
    render() {
      const z = s[2 /* Z */]!, x = s[6 /* PX */]! - s[0 /* FX */]! * z, y = s[7 /* PY */]! - s[1 /* FY */]! * z;
      if (x === s[10 /* RX */] && y === s[11 /* RY */] && z === s[12 /* RZ */]) return;
      s[10 /* RX */] = x;
      s[11 /* RY */] = y;
      s[12 /* RZ */] = z;
      const L = engine.ledger, home = Math.abs(x) < 0.005 && Math.abs(y) < 0.005 && Math.abs(z - 1) < 1e-6;
      if (s[15 /* CLIP */] === 1 && !home) L.style(parent!, "overflow", "clip");
      L.style(el, "transform-origin", home ? "" : "0 0");
      L.style(el, "transform", home ? "" : `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) scale(${z.toFixed(4)})`);
      L.style(el, "will-change", home ? "" : "transform");
    },
  };
  engine.add(cam);
  return cam;
}
/** The camera `camera()` returns. */
export type Camera = ReturnType<typeof camera>;

// Helpers stand alone, so a hero that only zooms never ships them.
/** Zoom about world point (x, y): it stays where it is on screen. The same as `cam.to(x, y, zoom)`. */
export function zoomAt(cam: Camera, x: number, y: number, zoom: number) {
  cam.to(x, y, zoom);
}
/** Centre world point (x, y) on the stage at `zoom`. */
export function flyTo(cam: Camera, x: number, y: number, zoom = cam.zoom) {
  cam.to(x, y, zoom, cam.width / 2, cam.height / 2);
}
/** World to screen (stage box px), into `out`: the inverse of `cam.toWorld`. */
export function toScreen<T extends { [i: number]: number }>(cam: Camera, x: number, y: number, out: T): T {
  cam.toWorld(0, 0, out); // the world point at the screen's 0,0
  out[0] = (x - out[0]!) * cam.zoom;
  out[1] = (y - out[1]!) * cam.zoom;
  return out;
}
/** Fit a world box (x, y, w, h) in the stage, with `pad` (fraction, default 0.1) around it. */
export function fit(cam: Camera, x: number, y: number, w: number, h: number, pad = 0.1) {
  if (w > 0 && h > 0 && cam.width) flyTo(cam, x + w / 2, y + h / 2, Math.min(cam.width / w, cam.height / h) * (1 - pad));
}
