// dist/dom-crossfire.mjs (module), dist/dom-crossfire.js (one script for any page, global domCrossfire).
import { build, transform } from "esbuild";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
// The Board UI kit (Fizlet's ui brick), minified and baked in for the game's shadow root.
const kit = (await transform(readFileSync("vendor/fizlet/ui/board-ui.css", "utf8"), { loader: "css", minify: true })).code;
const common = { define: { __KIT_CSS__: JSON.stringify(kit) }, bundle: true, minify: true, target: "es2022", legalComments: "none", logLevel: "warning", banner: { js: `/* DOM Crossfire ${version} · MIT © Chris Cooley · built on Fizlet */` } };
await build({ ...common, entryPoints: ["src/index.ts"], format: "esm", outfile: "dist/dom-crossfire.mjs" });
await build({ ...common, entryPoints: ["src/index.ts"], format: "iife", globalName: "domCrossfire", outfile: "dist/dom-crossfire.js" });
// Multiplayer: the module plus fizlet/presence and the room card; the solo builds never ship them.
if (existsSync("src/net.ts")) await build({ ...common, entryPoints: ["src/net.ts"], format: "esm", outfile: "dist/dom-crossfire-net.mjs" });
console.log(`Built DOM Crossfire ${version}: ${["dom-crossfire.mjs", "dom-crossfire.js", ...(existsSync("src/net.ts") ? ["dom-crossfire-net.mjs"] : [])].map((f) => "dist/" + f).join(", ")}`);
