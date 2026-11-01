// The browser gates' page server: the repo as the site serves it (index.html, play/, dist/), on one
// origin through Playwright's route(), so the landing and the play page load the built game.
// `open(browser, opts)` returns { page, errors, close }; `opts.entry` also imports the module as window.mod.
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export const ORIGIN = "https://crossfire.test";
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
/** A plain page for the drop-in: copy, a link, a button. */
export const HOST = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>host</title>
<main style="max-width:720px;margin:40px auto;font:16px/1.5 system-ui"><h1>A perfectly normal page</h1><p>Some copy, with <a href="#more">a link</a>.</p>
<p>More copy for the board to stand on.</p><button type="button">A button</button></main>`;

export const launch = (chromium) => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/** url: "/" the landing, "/play/" the game page, "/host" the plain page above. */
export async function open(browser, { url = "/play/", width = 1280, height = 800, touch = false, theme, reduced = "no-preference", init, entry } = {}) {
  if (!existsSync("dist/dom-crossfire.mjs")) throw Error("Build first: npm run check");
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: reduced });
  if (theme) await ctx.addInitScript((t) => localStorage.setItem("dom-virus:theme", t), theme);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path === "/host") return route.fulfill({ contentType: "text/html", body: HOST });
    let file = join(".", path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ contentType: TYPES[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
  });
  await page.goto(ORIGIN + url);
  if (entry) await page.evaluate(async () => (window.mod = await import("/dist/dom-crossfire.mjs")));
  return { page, errors, close: () => ctx.close() };
}

/** The game's shadow root on the page (the play page's #cf, or the drop-in's host). */
export const shadow = (sel = "#cf") => `document.querySelector(${JSON.stringify(sel)}).shadowRoot`;
