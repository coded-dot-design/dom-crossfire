// Build what the site serves (dist/ is built in CI, not committed):
//   dist/dom-crossfire.mjs  the module: createCrossfire, install (the landing and play pages use it)
//   dist/dom-crossfire.js   the drop-in: one self-contained script for any website (IIFE)
//   dist/page.js            the pages' glue (site/page.js)
//   dist/site.css           the pages' styles: the Board UI kit (Fizlet's ui brick) + site/site.css
//   dist/art/*.svg          the cast as pixel SVGs (the landing's cards), from src/art.ts
import { build, transform } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/art", { recursive: true });
// The Board UI kit, minified and baked in for the game's shadow root.
const kitSrc = readFileSync("vendor/fizlet/ui/board-ui.css", "utf8");
const kit = (await transform(kitSrc, { loader: "css", minify: true })).code;
const common = { define: { __KIT_CSS__: JSON.stringify(kit) }, bundle: true, minify: true, target: "es2022", legalComments: "none", logLevel: "warning", banner: { js: `/* DOM Crossfire ${version} · MIT © Chris Cooley · built on Fizlet */` } };
await build({ ...common, entryPoints: ["src/index.ts"], format: "esm", outfile: "dist/dom-crossfire.mjs" });
await build({ ...common, entryPoints: ["src/embed.ts"], format: "iife", outfile: "dist/dom-crossfire.js" });
// The pages' glue (site/page.js): page keys, the theme switch, the hero battle, the play page. It
// imports the module beside it, so the pages load the game once.
await build({ entryPoints: ["site/page.js"], bundle: true, minify: true, format: "esm", target: "es2022", outfile: "dist/page.js", logLevel: "warning", plugins: [{ name: "game", setup: (b) => b.onResolve({ filter: /dom-crossfire\.mjs$/ }, () => ({ path: "./dom-crossfire.mjs", external: true })) }] });
// The pages wear the kit too (<html class="bui">), with the site's furniture on top.
const css = (await transform(kitSrc + "\n" + readFileSync("site/site.css", "utf8"), { loader: "css", minify: true })).code;
writeFileSync("dist/site.css", `/* DOM Crossfire ${version} site · Board UI kit (Fizlet) */\n${css}`);
// The cast, drawn from the same pixel data as the game.
await build({ entryPoints: ["src/art.ts"], bundle: true, format: "esm", platform: "neutral", outfile: "dist/.art.mjs", logLevel: "warning" });
const art = await import(pathToFileURL("dist/.art.mjs").href);
rmSync("dist/.art.mjs");
// Static files the pages use (icon, shots) ride along in dist/.
for (const f of readdirSync("site/public", { recursive: true }).map(String)) if (!statSync(`site/public/${f}`).isDirectory()) mkdirSync(dirname(`dist/${f}`), { recursive: true }), copyFileSync(`site/public/${f}`, `dist/${f}`);
const files = { plane: art.shipSvg(4), tank: art.tankSvg("#39ffb0"), bug: art.bugSvg(3), "bug-1": art.bugSvg(1), "bug-2": art.bugSvg(2), squid: art.alienSvg(2), crab: art.alienSvg(1), drone: art.alienSvg(0), sherman: art.tankSvg("#ff8a1f"), fly: art.flySvg(1), "fly-0": art.flySvg(0), "fly-2": art.flySvg(2), crossfire: art.factionSvg(4) };
for (const [name, svg] of Object.entries(files)) writeFileSync(`dist/art/${name}.svg`, svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace(' aria-hidden="true"', ""));
console.log(`Built DOM Crossfire ${version}: dist/dom-crossfire.mjs, dist/dom-crossfire.js, dist/site.css, dist/art/ (${Object.keys(files).length} SVGs)`);
