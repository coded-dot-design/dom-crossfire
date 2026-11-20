// The site as a static host serves it, in artifacts/pages (npm run site:build: npm run check, then this):
//   /            the landing (index.html)
//   /play/       the game and /play/squad/ (play/)
//   /dist/       what the pages load (the game, the drop-in, the styles, the art, the shots)
//   /shots/      the shots again (the OG image's address)
//   /404.html    the not-found page the host serves for a missing path (404.html; noindex)
// .github/workflows/cloudflare.yml builds it for each target. Two variables, both optional:
//   SITE_URL (+ SITE_BASE)  where the site is served: the pages' own address (canonical, share tags,
//                           JSON-LD, the drop-in snippet) follows it. Unset: the address in the pages.
//   PUBLIC_DEPLOY_TARGET    staging (Cloudflare staging and PR previews): every page is noindex, nofollow.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOME = "https://crossfire.fzlt.games/";
const out = process.env.SITE_OUT || "artifacts/pages"; // SITE_OUT: tests build elsewhere
if (!existsSync("dist/dom-crossfire.js")) throw Error("Build the game first (npm run check).");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const page of ["index.html", "404.html"]) cpSync(page, join(out, page));
for (const dir of ["play", "dist"]) cpSync(dir, join(out, dir), { recursive: true });
cpSync("dist/shots", join(out, "shots"), { recursive: true });

const home = process.env.SITE_URL ? new URL((process.env.SITE_BASE || "/").replace(/\/?$/, "/"), process.env.SITE_URL).href : HOME;
const staging = process.env.PUBLIC_DEPLOY_TARGET === "staging";
const pages = [];
const walk = (dir) => readdirSync(dir).forEach((n) => { const f = join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (f.endsWith(".html")) pages.push(f); });
walk(out);
for (const page of pages) {
  let html = readFileSync(page, "utf8").replaceAll(HOME, home);
  if (staging) {
    if (!html.includes("</head>")) throw Error(`${page}: no </head>`);
    html = html.replace(/<meta name="robots"[^>]*>\n?/, "").replace("</head>", '<meta name="robots" content="noindex, nofollow">\n</head>');
  }
  writeFileSync(page, html);
}
console.log(`Site ready: ${pages.length} pages for ${home}${staging ? " (staging: noindex, nofollow)" : ""} in ${out}.`);
