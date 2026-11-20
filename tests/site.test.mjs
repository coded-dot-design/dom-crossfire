// The assembled site (scripts/site.mjs, after npm run check): its not-found page.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the site build has 404.html at the root: noindex, linking home", () => {
  const out = mkdtempSync(join(tmpdir(), "crossfire-site-"));
  try {
    execFileSync("node", ["scripts/site.mjs"], { env: { ...process.env, SITE_OUT: out, PUBLIC_DEPLOY_TARGET: "" }, stdio: "pipe" });
    const nf = readFileSync(join(out, "404.html"), "utf8");
    assert.ok(/<meta name="robots" content="noindex/.test(nf) && nf.includes('href="/"'), "404.html is noindex and links home");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
