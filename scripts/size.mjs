// Budget from the game's spec: 40,960 bytes gzip for the first cut, + 731 measured for the move from
// Fizlet 0.20.0 to @fzlt/core 0.21.2 (Board UI tokens and CSS; game code unchanged). The whole game
// (engine, HUD preset, kit CSS, rules, art) stays under it. Every build in dist/ counts.
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync } from "node:fs";
const BUDGET = 41691;
let failed = false;
for (const file of readdirSync("dist").filter((f) => /\.m?js$/.test(f)).sort().map((f) => `dist/${f}`)) {
  const gz = gzipSync(readFileSync(file)).length, ok = gz <= BUDGET;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${file} ${gz} / ${BUDGET} bytes gzip`);
}
if (failed) process.exit(1);
