// What every page shares: Board UI page keys, no pinch on the game surfaces, the light/dark switch
// (shared with the game and the DOM VIRUS family), and the phone game mode for the play pages.
import { pressCue } from "../vendor/fizlet/ui/board-ui";
import { lockTouch } from "../vendor/fizlet/touch";

const html = document.documentElement;
export function chrome() {
  pressCue(document); // page keys: keyboard press and iOS :active (Fizlet BOARD-UI.md "Page keys")
  lockTouch(document); // a pinch on the hero battle or the game never zooms the page
  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    const next = html.dataset.theme === "light" ? "dark" : "light";
    html.dataset.theme = next;
    try {
      localStorage.setItem("dom-virus:theme", next);
    } catch {}
  });
}
/** A play page on a phone is game mode (site.css): the board is the screen you can see (the visual
 *  viewport), the page never scrolls, a one-finger drag never drags it (except a [data-scroll] panel). */
export function gameMode() {
  const game = matchMedia("(pointer: coarse) and (max-width: 900px), (pointer: coarse) and (max-height: 500px)"), vv = window.visualViewport;
  const fit = () => {
    if (!game.matches) return;
    if (vv) html.style.setProperty("--app-h", vv.height + "px"), html.style.setProperty("--app-top", vv.offsetTop + "px");
    if (scrollX || scrollY) scrollTo(0, 0);
  };
  if (vv) vv.addEventListener("resize", fit), vv.addEventListener("scroll", fit);
  addEventListener("scroll", fit, { passive: true });
  addEventListener("orientationchange", fit);
  fit();
  for (const t of ["gesturestart", "gesturechange", "dblclick"]) document.addEventListener(t, (e) => matchMedia("(pointer: coarse)").matches && e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (e) => {
    if (!game.matches || e.touches.length > 1) return;
    for (const n of e.composedPath()) if (n.matches?.("[data-scroll]") && n.scrollHeight > n.clientHeight) return;
    if (e.cancelable) e.preventDefault();
  }, { capture: true, passive: false });
}
