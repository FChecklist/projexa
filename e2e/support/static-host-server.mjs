// AUDIT-100 B60: a local stand-in for the free Cloudflare Pages project that serves PROJEXA's static files
// (ai-os/audit37/STATIC_ON_CLOUDFLARE_PAGES.md), for e2e/lf-static-host.spec.ts. It serves the folder scripts/stage-static-pages.mjs
// writes, the way Pages does: each file at its path, the CORS and cache headers of the folder's _headers rules (the subset that file
// uses), the query string ignored, a missing file a 404. It runs on its own port, so it is a DIFFERENT ORIGIN from the app.
//
// Fault injection (what a broken static host does), for the spec to prove the laptop refuses it:
//   POST /__ctl {"drop":["/_release/px-....tar.gz"], "corrupt":["/_next/static/chunks/x.js"]}   ({} restores)
//   GET  /__log   every GET served since the last POST /__ctl {"resetLog":true}: [{path, status}]
// Env: STATIC_HOST_PORT (default 3198), STATIC_HOST_DIR (default .static-pages).

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const PORT = Number(process.env.STATIC_HOST_PORT ?? 3198);
const DIR = resolve(process.env.STATIC_HOST_DIR ?? ".static-pages");

const TYPES = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".gz": "application/gzip", ".html": "text/html; charset=utf-8",
  ".csv": "text/csv", ".txt": "text/plain; charset=utf-8", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const faults = { drop: new Set(), corrupt: new Set() };
let log = [];

/** The headers the folder's _headers file gives `path` (Pages semantics for the rules it uses: "/*" splats, "! Name" detaches). */
function headersFor(path) {
  const file = join(DIR, "_headers");
  const out = new Map();
  if (!existsSync(file)) return out;
  let applies = false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const pattern = line.trim();
      applies = pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern;
      continue;
    }
    if (!applies) continue;
    const t = line.trim();
    if (t.startsWith("!")) {
      out.delete(t.slice(1).trim().toLowerCase());
      continue;
    }
    const i = t.indexOf(":");
    const name = t.slice(0, i).trim().toLowerCase();
    const value = t.slice(i + 1).trim();
    out.set(name, out.has(name) ? `${out.get(name)}, ${value}` : value);
  }
  return out;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (path === "/__health") return res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  if (path === "/__log") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(log));
  if (path === "/__ctl" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const ctl = body ? JSON.parse(body) : {};
      faults.drop = new Set(ctl.drop ?? []);
      faults.corrupt = new Set(ctl.corrupt ?? []);
      if (ctl.resetLog) log = [];
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
  const headers = Object.fromEntries(headersFor(path));
  const full = normalize(join(DIR, ...path.split("/").filter(Boolean).map(decodeURIComponent)));
  const inside = full.startsWith(DIR) && !path.split("/").some((s) => s === "_headers");
  if (!inside || faults.drop.has(path) || !existsSync(full) || !statSync(full).isFile()) {
    log.push({ path, status: 404 });
    const notFound = join(DIR, "404.html");
    return res.writeHead(404, { ...headers, "content-type": "text/html; charset=utf-8" }).end(existsSync(notFound) ? readFileSync(notFound) : "Not found");
  }
  let bytes = readFileSync(full);
  if (faults.corrupt.has(path)) {
    bytes = Buffer.from(bytes);
    bytes[Math.max(0, bytes.length - 20)] ^= 0xff; // ONE wrong byte
  }
  log.push({ path, status: 200 });
  res.writeHead(200, { ...headers, "content-type": TYPES[extname(full)] ?? "application/octet-stream", "content-length": String(bytes.length) });
  res.end(req.method === "HEAD" ? undefined : bytes);
});

server.listen(PORT, () => console.log(`static host stand-in on http://127.0.0.1:${PORT} serving ${DIR}`));
