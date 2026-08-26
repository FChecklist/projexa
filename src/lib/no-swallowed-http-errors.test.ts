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

/** The `Promise.all([fetch(a), fetch(b)])` variant of the same defect. */
function unguardedBatchFiles(source: string): boolean {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!(lines[i].includes("Promise.all([") && lines[i].includes("await"))) continue;
    const block = lines.slice(i, i + 20).join("\n");
    if (/\bfetch\(/.test(block) && /await\s+\w+\.json\(\)/.test(block) && !/\.ok\b/.test(block)) {
      return true;
    }
  }
  return false;
}

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
