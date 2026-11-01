// Size budgets, gzip, measured. The game (engine bricks, the Board UI kit CSS, the cast, the rules)
// ships as one file each way; the pages' glue is its own small file.
// 0.2.0 (v2, on Battlefield Blitz): measured 50,646 B (dom-crossfire.js) and 50,672 B (dom-crossfire.mjs),
// page.js 2,761 B; budgets are those plus a little headroom. The first cut was 39,980 / 39,773 B.
// 0.2.1 (click to fire; the scoreboard no longer drags; effects and damage staged in registers):
// 50,739 / 50,785 B, page.js 2,761 B.
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
let failed = false;
for (const [file, budget] of [["dist/dom-crossfire.js", 51200], ["dist/dom-crossfire.mjs", 51200], ["dist/page.js", 3072]]) {
  const gz = gzipSync(readFileSync(file)).length, ok = gz <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${file.padEnd(24)} ${gz} / ${budget} bytes gzip`);
}
if (failed) process.exit(1);
