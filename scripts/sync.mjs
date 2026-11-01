// Snapshot the engine this game is built on (FIZLET_DIR, default the sibling checkout ../fizlet),
// with provenance. Never edit vendor/ by hand: change coded-dot-design/fizlet, then run node scripts/sync.mjs.
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const FIZLET = process.env.FIZLET_DIR || "../fizlet";

const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
rmSync("vendor/fizlet", { recursive: true, force: true });
cpSync(join(FIZLET, "src"), "vendor/fizlet", { recursive: true, filter: (p) => !p.endsWith(".md") });
const files = [];
const walk = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : files.push(join(d, n))));
walk("vendor/fizlet");
writeFileSync("vendor/fizlet/ORIGIN.json", JSON.stringify({
  note: "Generated snapshot. Edit coded-dot-design/fizlet, then run node scripts/sync.mjs.",
  repository: "https://github.com/coded-dot-design/fizlet",
  version: JSON.parse(readFileSync(join(FIZLET, "package.json"), "utf8")).version,
  commit: execFileSync("git", ["-C", FIZLET, "rev-parse", "HEAD"]).toString().trim(),
  files: files.sort().map((f) => ({ path: relative("vendor/fizlet", f), sha256: sha(f) })),
}, null, 2) + "\n");
console.log("synced vendor/fizlet");
