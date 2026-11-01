// A real page for the browser gates: copy, a link and a button (the board), and dist/ served from
// one origin (plus the repo's board page, index.html). `open(browser, opts)` returns the page with window.domCrossfireModule loaded.
import { readFileSync } from "node:fs";

const ORIGIN = "https://game.test";
export const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>host</title>
<main style="max-width:720px;margin:40px auto;font:16px/1.5 system-ui"><h1>A perfectly normal page</h1><p>Some copy, with <a href="#more">a link</a>.</p>
<p>More copy for the board to stand on.</p><button type="button">A button</button></main>`;

export const launch = async (chromium) => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/** `url`: "/" (the host page above) or "/index.html" (the board page; it loads the game itself: entry null).
 *  `reducedMotion`: "reduce" plays the round as a visitor who asked for less motion. */
export async function open(browser, { width = 1280, height = 800, touch = false, entry = "dom-crossfire.mjs", url = "/", reducedMotion = "no-preference", init } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  if (init) await page.addInitScript(init);
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: PAGE });
    // The repo's own board page (index.html) and dist/ beside it.
    if (path.endsWith(".html")) return route.fulfill({ contentType: "text/html", body: readFileSync(path.slice(1)) });
    return route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path.replace(/^\/dist\//, "/")}`) });
  });
  await page.goto(`${ORIGIN}${url}`);
  if (entry) await page.evaluate(async (entry) => (window.mod = await import(`/${entry}`)), entry);
  return { page, errors, close: () => ctx.close() };
}

/** Text and parts of the game's overlay (its shadow root), read in the page. */
export const overlay = (page) => page.evaluate(() => {
  const root = document.querySelector("[data-fizlet-host]")?.shadowRoot;
  if (!root) return null;
  const vis = (el) => !!el && getComputedStyle(el).display !== "none" && !el.closest("[hidden]");
  const sticker = root.querySelector(".bui-overlay");
  return {
    bui: !!root.querySelector(".bui"),
    bar: !!root.querySelector(".bui > section"),
    readouts: root.querySelectorAll(".bui > section .bui-readout").length,
    keys: [...root.querySelectorAll(".bui > section button")].map((b) => b.getAttribute("aria-label") || b.textContent.trim()),
    pad: !!root.querySelector(".bui-pad"),
    stick: !!root.querySelector(".bui-stick"),
    dpad: !!root.querySelector(".bui-dpad"),
    sticker: vis(sticker) ? sticker.textContent.replace(/\s+/g, " ").trim() : "",
    result: [...root.querySelectorAll(".sk-res dt")].map((d) => d.textContent),
  };
});
