// Serve the repo on localhost so the board page (index.html) can load dist/: npm run check, then
// npm run play and open the URL. A dev tool only (Node's own http; no dependencies). PORT sets the port.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT || 5173);
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(process.cwd(), path.endsWith("/") ? join(path, "index.html") : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`DOM Crossfire: http://localhost:${port}/ (Ctrl+C stops)`));
