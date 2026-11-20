/**
 * @fzlt/core/announce: game events read out to screen readers through one polite live region,
 * rate-limited. The game says what happened on the event ring (in its steps, as it already does for
 * sound and effects); `words` turns an event into a sentence in render; the region speaks at most
 * once per `gap` seconds.
 *
 *   const a = announce(engine, {
 *     words: (e) => e.type === "score" ? `Score ${e.a}` : e.type === "over" ? "Game over" : null,
 *   });
 *   a.say("lives", "2 lives left"); // or directly, from a HUD or a menu
 *
 * - One region per page, shared by every engine: `[data-fz-announce]`, role status, polite, atomic,
 *   visually hidden. Made on the first word, never before; destroy() removes it if this one made it.
 * - Coalesced by key (an event's `type`): a newer sentence for the same key replaces the waiting one,
 *   so a score that ticks ten times a second is read once, as its latest value. Waiting sentences
 *   are read together, in the order their keys first came, joined with ". ".
 * - The same sentence twice is read twice (a trailing no-break space alternates).
 * - Nothing in step; in render it reads the ring only. One timer while something waits, none after.
 * - Recall: destroy() (or the engine's) removes the system, the timer and the region it made.
 */
import type { Engine } from "./kernel/engine";
import type { FizEvent } from "./kernel/ring";

/** Options for `announce()`: `words(event)` turns ring events into sentences, `gap` is the least time between writes, `doc` the document. */
export interface AnnounceOptions {
  /** An event in words, or nothing (null, undefined, "" or false) to stay quiet. Runs in render. */
  words?: (e: FizEvent) => string | null | undefined | false | void;
  /** Seconds between two writes to the region (default 1). */
  gap?: number;
  /** The page (default: the engine root's document, else `document`). */
  doc?: Document;
}

/** Game events read out to screen readers through one polite live region per page, coalesced by key and rate-limited; `destroy()` removes the region. */
export function announce(engine: Engine, o: AnnounceOptions = {}) {
  const ms = (o.gap ?? 1) * 1000, words = o.words, keys: string[] = [], said: string[] = [];
  const doc = o.doc ?? engine.root?.ownerDocument ?? document;
  let el: HTMLElement | null = null, mine = false, flip = false, last = -1e9;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;

  const region = () => {
    if (el?.isConnected) return el;
    el = doc.querySelector<HTMLElement>("[data-fz-announce]");
    if (!el) {
      el = doc.createElement("div");
      el.setAttribute("data-fz-announce", "");
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-atomic", "true");
      el.style.cssText = "position:fixed;clip-path:inset(50%);white-space:nowrap";
      doc.body.append(el);
      mine = true;
    }
    return el;
  };
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!keys.length) return;
    last = Date.now();
    region().textContent = said.join(". ") + ((flip = !flip) ? " " : "");
    keys.length = said.length = 0;
  };
  const say = (key: string, text: string) => {
    if (!text) return;
    const i = keys.indexOf(key);
    if (i < 0) keys.push(key), said.push(text);
    else said[i] = text;
    // Clamped: a browser reads the delay as a 32-bit int, so a large negative one wraps to days.
    timer ||= setTimeout(flush, Math.max(0, last + ms - Date.now()));
  };
  const system = engine.add({
    render(e) {
      if (!words) return;
      for (let i = 0, ev; (ev = e.events.at(i)); i++) {
        const text = words(ev);
        if (text) say(ev.type, text);
      }
    },
  });
  const destroy = () => {
    clearTimeout(timer);
    timer = 0;
    keys.length = said.length = 0;
    engine.remove(system);
    if (mine) el?.remove();
  };
  engine.signal.addEventListener("abort", destroy, { once: true });
  return {
    /** Queue a sentence under a key (coalesced with what waits under that key). */
    say,
    /** Read what waits now, ignoring the gap (a result screen that must not wait). */
    flush,
    /** Remove the system, the timer and the region this one made. */
    destroy,
  };
}
/** What `announce()` returns: `say`, `flush`, `destroy`. */
export type Announcer = ReturnType<typeof announce>;
