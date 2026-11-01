// Size budgets, gzip, measured. The game (engine bricks, the Board UI kit CSS, the cast, the rules)
// ships as one file each way; the pages' glue is its own small file.
// 0.2.0 (v2, on Battlefield Blitz): measured 50,646 B (dom-crossfire.js) and 50,672 B (dom-crossfire.mjs),
// page.js 2,761 B; budgets are those plus a little headroom. The first cut was 39,980 / 39,773 B.
// 0.2.1 (click to fire; the scoreboard no longer drags; effects and damage staged in registers):
// 50,748 / 50,794 B, page.js 2,761 B.
// 0.3.0 (four waves a section, mini-bosses, Byte Runner flipped: the frog, pellets on blocks): measured
// 52,035 / 52,071 B (+1,287 / +1,277); budgets 51,200 → 52,480.
// 0.4.0 (squad play): the solo builds carry the squad seats, the input word and the match hash (as
// Blitz's do): 53,572 / 53,635 B (+1,537 / +1,564), budgets 53,760. dom-crossfire-net.mjs (the module
// plus @fzlt/core/presence and the room join) 55,186 B, budget 55,424. squad.js (the room card) 3,255 B.
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
let failed = false;
for (const [file, budget] of [["dist/dom-crossfire.js", 53760], ["dist/dom-crossfire.mjs", 53760], ["dist/dom-crossfire-net.mjs", 55424], ["dist/page.js", 3072], ["dist/squad.js", 3584]]) {
  const gz = gzipSync(readFileSync(file)).length, ok = gz <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${file.padEnd(24)} ${gz} / ${budget} bytes gzip`);
}
if (failed) process.exit(1);
