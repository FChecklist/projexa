// Pre-compiles PROJEXA's API routes on a running `next dev` server, so the first save a person makes is not the one that pays for compiling.
//
// WHY. `next dev` compiles each API route the first time anything calls it: measured 2 to 4 s for a small route, minutes for a large one, and the
// compile is paid even when the answer is 401. The screens give a write 10 s (src/lib/use-submit.ts, R-277), so on a fresh dev server the first
// "Save" of a BOQ, revision, permit and so on can answer "The server did not answer in 10 s - nothing was saved" while the second press works.
// A production build compiles up front, but a freshly started `next start` still loads each route's code on its first call (measured 2 to 4 s here), so the
// same warm-up helps there too. Vercel keeps functions warm and never shows this.
//
// HOW. Walks src/app/api/**/route.ts, turns each folder into a URL ([id] becomes "x"), and sends one unauthenticated GET to each, two at a time
// (this laptop has 8 GB; compiling many routes at once is what runs it out of memory). It sends no credentials and changes no data: a route that
// needs a session answers 401, which is exactly enough to make Next compile it.
//
//   bun run dev:warm                      (server on http://localhost:3110 by default)
//   BASE_URL=http://localhost:3100 bun run dev:warm
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3110").replace(/\/+$/, "");
const ROOT = join(process.cwd(), "src", "app", "api");
const CONCURRENCY = Number(process.env.WARM_CONCURRENCY ?? 2);
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
  const paths = [...new Set(routePaths())].sort();
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
