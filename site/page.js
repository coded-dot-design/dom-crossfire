// The pages' glue (bundled to dist/page.js; the game itself is ./dom-crossfire.mjs beside it):
// Board UI page keys, the shared light/dark switch, the phone game mode, and each page's game:
//   #cf-demo          the landing's hero: a live attract match (both rides AI), paused when away
//   [data-launch-link] PLAY keys: the kit's launch burst, then the play page
//   [data-drop]       drop the game onto the landing itself (the page becomes the arena)
//   #cf               the play page's board match
import { launch } from "../vendor/fizlet/ui/board-ui";
import { chrome, gameMode } from "./chrome.js";
import { createCrossfire, install } from "./dom-crossfire.mjs";

chrome();
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// The landing's hero: a live co-op battle behind the copy (none with reduced motion).
const demoHost = document.getElementById("cf-demo");
if (demoHost && !reduced()) {
  const demo = createCrossfire(demoHost, { demo: true });
  window.crossfireDemo = demo;
  // Off screen, it rests (the engine settles; nothing runs a frame).
  new IntersectionObserver(([e]) => (e.isIntersecting ? demo.engine.start() : demo.engine.stop())).observe(demoHost);
  document.querySelector("[data-drop]")?.addEventListener("click", () => demo.destroy(), { once: true });
}
for (const a of document.querySelectorAll("[data-launch-link]"))
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    launch(a, () => {}, { reduced: reduced(), done: () => (location.href = a.href) });
  });
// Try the drop-in right here: the page itself becomes the arena; Escape gives it back.
let dropped = null;
document.querySelector("[data-drop]")?.addEventListener("click", () => {
  dropped ??= install({});
  void dropped.open();
});

// The play page: the board match. On a phone it is game mode (site.css): the board is the screen
// you can see (the visual viewport), the page never scrolls, a one-finger drag never drags it.
const host = document.getElementById("cf");
if (host) {
  window.crossfire = createCrossfire(host, { mode: "board" });
  gameMode();
}
