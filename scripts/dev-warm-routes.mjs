// Pre-compiles PROJEXA's API routes on a running `next dev` server, so the first save a person makes is not the one that pays for compiling.
//
// WHY. `next dev` compiles each API route the first time anything calls it: measured 2 to 4 s for a small route, minutes for a large one, and the
// compile is paid even when the answer is 401. The screens give a write 10 s (src/lib/use-submit.ts, R-277), so on a fresh dev server the first
// "Save" of a BOQ, revision, permit and so on can answer "The server did not answer in 10 s - nothing was saved" while the second press works.
// A production build compiles up front, but a freshly started `next start` still loads each route's code on its first call (measured 2 to 4 s here), so the
// same warm-up helps there too. Vercel keeps functions warm and never shows this.
//
// HOW. Walks src/app/api/**/route.ts, turns each folder into a URL ([id] becomes "x"), and sends one unauthenticated GET to each, one at a time.
// It sends no credentials and changes no data: a route that needs a session answers 401, which is exactly enough to make Next compile it.
//
// ONLY THE CORE ROUTES BY DEFAULT. `next dev` keeps every route it compiles in memory; warming all 312 on the 8 GB laptop took it down (measured
// 2026-10-10: free RAM fell to 0.4 GB and the dev server restarted). The default list is the project screens people save from first (scope, work
// progress, permits, documents, drawings, minutes, change orders, billing, manpower, materials and the shell). WARM_ALL=1 warms everything
// (use it on a machine with the memory), WARM_ONLY=a,b warms just those first path segments.
//
//   bun run dev:warm                      (server on http://localhost:3110 by default)
//   BASE_URL=http://localhost:3100 bun run dev:warm
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3110").replace(/\/+$/, "");
const ROOT = join(process.cwd(), "src", "app", "api");
const CONCURRENCY = Number(process.env.WARM_CONCURRENCY ?? 1);
export const CORE_SEGMENTS = [
  "shell", "projects", "scope", "work-progress", "permits", "documents", "drawings", "moms", "change-orders", "billing-claims", "labour-roster",
  "attendance", "construction-materials", "materials",
];
const PER_ROUTE_TIMEOUT_MS = 120_000;

/** Every route.ts under src/app/api, as a URL path. Route groups "(x)" vanish; dynamic segments become "x". */
export function routePaths(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) routePaths(full, out);
    else if (/^route\.(t|j)sx?$/.test(name)) {
      const segments = relative(ROOT, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s)).map((s) => (/^\[.*\]$/.test(s) ? "x" : s));
      out.push("/api/" + segments.join("/"));
    }
  }
  return out;
}

async function warm(path) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(PER_ROUTE_TIMEOUT_MS), redirect: "manual" });
    return { path, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { path, status: "ERR", ms: Date.now() - started, error: String(e?.message ?? e).slice(0, 80) };
  }
}

async function main() {
  try {
    await fetch(BASE + "/login", { signal: AbortSignal.timeout(15_000) });
  } catch {
    console.error(`No server answering at ${BASE}. Start it first (next dev), or set BASE_URL.`);
    process.exit(1);
  }
  const only = process.env.WARM_ONLY ? process.env.WARM_ONLY.split(",").map((x) => x.trim()).filter(Boolean) : CORE_SEGMENTS;
  const all = [...new Set(routePaths())].sort();
  const paths = process.env.WARM_ALL === "1" ? all : all.filter((p) => only.includes(p.split("/")[2]));
  console.log(`Warming ${paths.length} API routes on ${BASE}, ${CONCURRENCY} at a time...`);
  const queue = [...paths];
  let done = 0;
  let slowest = { ms: 0, path: "" };
  const failures = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const r = await warm(queue.shift());
        done += 1;
        if (r.ms > slowest.ms) slowest = r;
        if (r.status === "ERR") failures.push(r);
        if (done % 25 === 0 || done === paths.length) console.log(`  ${done}/${paths.length}`);
      }
    })
  );
  console.log(`Done. Slowest first compile: ${slowest.path} (${slowest.ms} ms). ${failures.length} route(s) did not answer.`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f.path}: ${f.error}`);
}

if (process.argv[1]?.endsWith("dev-warm-routes.mjs")) await main();
