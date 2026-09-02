/// <reference types="bun-types" />
// R52 -- re-runnable guard for R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01
// (Critical, product-wide).
//
// THE DEFECT: across 63 call sites in 33 client components, PROJEXA called
// its own /api routes, parsed the response body WITHOUT EVER CHECKING
// res.ok, and coerced the missing field with `?? []`:
//
//     const res  = await fetch("/api/vendors");
//     const data = await res.json();
//     setVendors(data.vendors ?? []);
//
// The API routes are correct -- they answer a failure with
// { error: "<real backend message>" } and a real HTTP status. The CLIENT
// turned that into an EMPTY LIST and rendered a calm, success-shaped empty
// screen. The surrounding try/catch could not help: catch fires on a network
// or JSON-parse failure, never on an HTTP error status.
//
// This test counts the shape, so the fix cannot silently erode. If it fails,
// the file it names has gone back to reading a body without reading the
// status first -- use fetchJson() from src/lib/fetch-json.ts instead.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS = join(process.cwd(), "src", "components");

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFilesUnder(full));
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

function clientComponents(): string[] {
  return tsxFilesUnder(COMPONENTS).filter((f) => {
    const s = readFileSync(f, "utf8");
    return s.includes('"use client"') || s.includes("'use client'");
  });
}

/**
 * Finds `const res = await fetch(<url>)` where, within the following few
 * lines, the body is parsed but `res.ok` is never read.
 *
 * A fetch carrying an options object (a POST/PATCH/DELETE) is skipped -- the
 * write paths in this codebase already check the status, and they are not
 * what this fault is about.
 */
function unguardedSites(source: string): string[] {
  const lines = source.split("\n");
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:const|let)\s+(\w+)\s*=\s*await\s+fetch\((.+)\);\s*$/.exec(lines[i]);
    if (!m) continue;
    const [, varName, args] = m;
    if (args.trimEnd().endsWith("}") || args.includes(", {")) continue; // a write call
    const window = lines.slice(i, i + 12).join("\n");
    if (!new RegExp(`await\\s+${varName}\\.json\\(\\)`).test(window)) continue;
    if (window.includes(`${varName}.ok`)) continue;
    found.push(`line ${i + 1}: ${lines[i].trim()}`);
  }
  return found;
}

/**
 * The `Promise.all([fetch(a), fetch(b)])` variant of the same defect.
 *
 * Window = the `Promise.all([ ... ])` array literal itself (tracked by `[`/`]`
 * depth from the opening line, to find where the batch actually ends) PLUS a
 * further 8 lines past it, long enough to cover the immediate
 * `.json()`-parse-and-assign that follows a real batch fetch, but short
 * enough not to reach into a later, unrelated handler.
 *
 * An earlier version used a flat 20-line window from the opening line, which
 * produced a real false positive on JournalEntryObjectClient.tsx: its
 * Promise.all block correctly uses fetchJson() (safe -- throws on a non-2xx
 * internally), but an unrelated fetch()+res.ok POST call ~15 lines further
 * down in the SAME function fell inside the 20-line window, and that call's
 * own `.ok` check landed just outside it by one line -- so the flat window
 * saw a stray `fetch(` and `.json()` with no `.ok` in range and flagged a
 * component that was already written correctly.
 *
 * A first fix (closing the window at the array literal's own end, no extra
 * lines) removed the false positive but also broke real detection: the
 * actual defect shape this test exists to catch is
 * `const [a,b] = await Promise.all([fetch(x), fetch(y)]); const da =
 * await a.json();` -- the vulnerable `.json()` calls come AFTER the array
 * literal closes, not inside it, so a window that stops exactly at `]);`
 * never sees them. Verified with a synthetic bad case (both defect shapes)
 * before landing on the "array literal + 8 lines" window: it catches the
 * synthetic defect and does not re-flag JournalEntryObjectClient.tsx.
 */
function unguardedBatchFiles(source: string): boolean {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!(lines[i].includes("Promise.all([") && lines[i].includes("await"))) continue;
    let depth = 0;
    let arrayEnd = i;
    for (; arrayEnd < lines.length; arrayEnd++) {
      for (const ch of lines[arrayEnd]) {
        if (ch === "[") depth++;
        else if (ch === "]") { depth--; if (depth === 0) break; }
      }
      if (depth === 0) break;
    }
    const end = Math.min(lines.length, arrayEnd + 8);
    const block = lines.slice(i, end).join("\n");
    if (/\bfetch\(/.test(block) && /await\s+\w+\.json\(\)/.test(block) && !/\.ok\b/.test(block)) {
      return true;
    }
  }
  return false;
}

/**
 * R67 D-55 / D-71 -- THE THIRD SHAPE, and the one that let the defect
 * survive this guard for a whole release.
 *
 *     fetch(`/api/work-progress?projectId=${id}`)
 *       .then((r) => r.json())
 *       .then((data) => setEntries(data.entries ?? []))
 *
 * Identical fault, invisible to both checks above: there is no
 * `const res = await fetch(...)` to anchor on, and no `Promise.all([`
 * either when the chain stands alone. /work-progress, its analytics tab and
 * /documents all carried it, and all three printed a confident empty state
 * over a 500 while this file's other two tests passed.
 *
 * The window is the whole promise CHAIN, found by BRACKET DEPTH rather than
 * by looking for a terminating semicolon. The first version of this detector
 * used "the first line ending in `;`" and produced a false positive on
 * ScheduleLogTimeClient.tsx, which is written correctly:
 *
 *     fetch(url)
 *       .then(async (res) => {
 *         const data = await res.json().catch(() => null);   <- ends in ';'
 *         if (!res.ok) throw new Error(...);                 <- the .ok is HERE
 *       })
 *
 * The semicolon that closed the window was an inner statement inside the
 * callback body, so the window stopped one line before the status check it
 * was looking for. Counting `(`/`)` and `{`/`}` from the `fetch(` line, and
 * then continuing over any following `.then`/`.catch`/`.finally`, covers the
 * callback bodies too. A `.ok` anywhere in that chain clears the site, which
 * is the correct signal: reading the status is exactly what the chain has to
 * do, wherever in it that happens.
 *
 * Writes are skipped for the same reason as unguardedSites(): a fetch
 * carrying an options object is a POST/PATCH/DELETE, and those already read
 * their status in this codebase.
 */
function unguardedChainSites(source: string): string[] {
  const lines = source.split("\n");
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bfetch\(/.test(line)) continue;
    if (/^\s*(\/\/|\*)/.test(line)) continue; // a comment describing the defect, not the defect
    if (line.includes(", {") || /,\s*$/.test(line)) continue; // a write, or a multi-line call with options

    let depth = 0;
    let chain = "";
    let started = false;
    const hardStop = Math.min(lines.length, i + 40);
    for (let j = i; j < hardStop; j++) {
      chain += lines[j] + "\n";
      for (const ch of lines[j]) {
        if (ch === "(" || ch === "{") { depth++; started = true; }
        else if (ch === ")" || ch === "}") depth--;
      }
      if (!started || depth > 0) continue;
      // Depth is balanced. Keep going only while the chain literally
      // continues onto the next line.
      if (/^\s*\.(then|catch|finally)\b/.test(lines[j + 1] ?? "")) continue;
      break;
    }

    if (!/\.json\(\)/.test(chain)) continue;
    if (/\.ok\b/.test(chain)) continue;
    found.push(`line ${i + 1}: ${line.trim()}`);
  }
  return found;
}

/**
 * Files that still carry the chain shape, each named with the module it
 * belongs to. THIS LIST MAY ONLY SHRINK. It is not a suppression: the guard
 * above is what stops a NEW one being written, and every entry here is a
 * screen whose own WS-D item owns the conversion (each of these is an ERP
 * module -- sales, purchasing, accounting, settings -- outside the
 * construction surfaces R-184 and R-293 measured).
 *
 * Removed by R67 D-55: WorkProgressPageClient, WorkProgressAnalyticalClient,
 * WorkProgressFormClient, DocumentsClient.
 * Removed by R67 D-67: ScheduleTaskCreateClient (migrated to CreateScreen,
 * which reads through fetchJson).
 */
const CHAIN_SHAPE_NOT_YET_CONVERTED = new Set([
  "CompanyCreateClient.tsx",
  "CostVarianceAnalyticalClient.tsx",
  "JournalEntryCreateClient.tsx",
  "OpportunitiesClient.tsx",
  "OpportunityCreateClient.tsx",
  "PurchaseOrderCreateClient.tsx",
  "PurchaseOrdersClient.tsx",
  "SalesDashboardClient.tsx",
  "SalesOrderCreateClient.tsx",
  "SalesQuotationCreateClient.tsx",
  "SettingsClient.tsx",
]);

describe("R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01", () => {
  const files = clientComponents();

  test("the component tree is actually being walked", () => {
    // Without this, an empty walk would make every assertion below pass
    // vacuously -- exactly the kind of false green this fault register exists
    // to catch.
    expect(files.length).toBeGreaterThan(40);
  });

  test("no client component parses a fetch body without reading the status", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const sites = unguardedSites(readFileSync(f, "utf8"));
      if (sites.length > 0) offenders.push(`${f.replace(process.cwd(), "")}\n    ${sites.join("\n    ")}`);
    }
    expect(offenders).toEqual([]);
  });

  test("no client component fans out with Promise.all(fetch...) and parses without the status", () => {
    const offenders = files
      .filter((f) => unguardedBatchFiles(readFileSync(f, "utf8")))
      .map((f) => f.replace(process.cwd(), ""));
    expect(offenders).toEqual([]);
  });

  test("no client component chains .then(r => r.json()) without reading the status", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const base = f.split(/[\\/]/).pop() ?? f;
      if (CHAIN_SHAPE_NOT_YET_CONVERTED.has(base)) continue;
      const sites = unguardedChainSites(readFileSync(f, "utf8"));
      if (sites.length > 0) offenders.push(`${f.replace(process.cwd(), "")}\n    ${sites.join("\n    ")}`);
    }
    expect(offenders).toEqual([]);
  });

  test("the known-offender list may only shrink -- an entry that is clean must be removed", () => {
    // Without this, a file could be converted and left on the list, and the
    // list would stop describing reality. Every name here must still carry
    // the shape it is excusing.
    const byBase = new Map(files.map((f) => [f.split(/[\\/]/).pop() ?? f, f]));
    const stale: string[] = [];
    for (const base of CHAIN_SHAPE_NOT_YET_CONVERTED) {
      const full = byBase.get(base);
      if (!full) {
        stale.push(`${base} (no such component -- delete the entry)`);
        continue;
      }
      if (unguardedChainSites(readFileSync(full, "utf8")).length === 0) {
        stale.push(`${base} (already clean -- delete the entry)`);
      }
    }
    expect(stale).toEqual([]);
  });

  test("the chain detector actually detects -- proven on a synthetic bad case", () => {
    // A guard whose detector silently stopped matching would pass forever.
    const bad = `"use client";
      function load() {
        fetch("/api/permits?projectId=1")
          .then((r) => r.json())
          .then((data) => setPermits(data.permits ?? []));
      }`;
    expect(unguardedChainSites(bad)).toHaveLength(1);

    const good = `"use client";
      function load() {
        fetch("/api/permits?projectId=1")
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
          .then((data) => setPermits(data.permits));
      }`;
    expect(unguardedChainSites(good)).toEqual([]);

    const write = `"use client";
      async function save() {
        const res = await fetch("/api/permits", { method: "POST", body });
        const data = await res.json();
      }`;
    expect(unguardedChainSites(write)).toEqual([]);

    // The false positive the first version of this detector produced: the
    // status check sits AFTER an inner statement that ends in a semicolon,
    // inside the callback body.
    const okInsideCallback = `"use client";
      function load() {
        fetch(\`/api/schedule/tasks?projectId=\${id}\`)
          .then(async (res) => {
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error("failed");
            setTasks(data.tasks);
          })
          .catch(() => setTasksError(true));
      }`;
    expect(unguardedChainSites(okInsideCallback)).toEqual([]);
  });

  test("fetchJson actually throws on a non-2xx, carrying the backend's own message", async () => {
    // The guards above are structural. This one proves the replacement does
    // the thing the structure is there to guarantee.
    const { fetchJson, ApiError } = await import("./fetch-json");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "No VERIDIAN credentials configured (AR-04)" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      let thrown: unknown = null;
      try {
        await fetchJson("/api/vendors");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ApiError);
      expect((thrown as InstanceType<typeof ApiError>).status).toBe(500);
      expect((thrown as Error).message).toBe("No VERIDIAN credentials configured (AR-04)");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("fetchJson does NOT throw on a 2xx -- an empty list is still a legitimate answer", async () => {
    const { fetchJson } = await import("./fetch-json");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ vendors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      const data = await fetchJson<{ vendors: unknown[] }>("/api/vendors");
      expect(data.vendors).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a non-JSON error body still fails loudly rather than being mistaken for data", async () => {
    // A proxy 502 or an HTML error page must not parse as `null` and then
    // slide through as an empty result.
    const { fetchJson, ApiError } = await import("./fetch-json");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    try {
      let thrown: unknown = null;
      try {
        await fetchJson("/api/vendors");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ApiError);
      expect((thrown as Error).message).toBe("Request failed (HTTP 502)");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
