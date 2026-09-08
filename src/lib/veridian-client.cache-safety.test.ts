/// <reference types="bun-types" />
// R81 G-05 / R81_F28 -- the cross-tenant cache leak that is one edit away.
//
// THE HAZARD, in the file's own words (veridian-client.ts:838-847): every
// VERIDIAN call in that file is per-tenant, and the SAME `path` (e.g.
// "/currencies") returns a DIFFERENT org's data depending solely on which
// per-org Bearer token was attached -- never on the URL. Next's `fetch()`
// caches on URL + method + body and NOT on headers. So a cached response for
// org A is indistinguishable, by cache key, from a request by org B.
//
// What holds that shut today is `cache: "no-store"`, written out by hand at
// four separate call sites. Nothing asserts it. A single ordinary performance
// edit -- adding `next: { revalidate: 60 }` to the shared fetch, or dropping
// the no-store from one call site while "cleaning up" -- silently serves one
// tenant's data to another. The blast radius is every proxied read for every
// tenant, and the trigger is a change that looks like an optimisation and
// reviews like one.
//
// The existing defence is a comment. A comment is advice; this is the same
// instruction expressed as a build failure. It is deliberately a SOURCE-READING
// test rather than a runtime one: the leak is a property of how the request is
// constructed, so it is decidable statically, and a runtime test would need two
// real orgs and a warm Next data cache to reproduce something this test catches
// on the commit that introduces it.
//
// If a future change legitimately needs caching here, the right move is the one
// already taken by createCachedVeridianGet(): cache at the `unstable_cache`
// layer where organizationId is an explicit key part, NOT at the fetch layer
// where headers are invisible to the key. Widening this test to allow
// `next: { revalidate }` on the shared fetch would be reintroducing the defect.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_PATH = path.join(import.meta.dir, "veridian-client.ts");
const source = readFileSync(SOURCE_PATH, "utf8");
const lines = source.split(/\r?\n/);

/** Collect the argument text of a call, from its opening line until the line
 *  whose nesting returns to zero. Brace-counting rather than a fixed lookahead,
 *  so reformatting the file cannot silently shrink what is checked. */
function callBody(startIndex: number): string {
  let depth = 0;
  let started = false;
  const out: string[] = [];
  for (let i = startIndex; i < lines.length && i < startIndex + 60; i++) {
    const line = lines[i];
    out.push(line);
    for (const ch of line) {
      if (ch === "(") { depth++; started = true; }
      else if (ch === ")") depth--;
    }
    if (started && depth <= 0) break;
  }
  return out.join("\n");
}

function callSitesOf(fnName: string): { line: number; body: string }[] {
  const sites: { line: number; body: string }[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // Prose mentions the helper by name -- including the very comment that
    // documents this hazard -- so comment lines must be excluded or the file's
    // own explanation is reported as a violation of itself.
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    // the call, not the declaration
    if (!isComment && line.includes(`${fnName}(`) && !line.includes(`function ${fnName}`)) {
      sites.push({ line: i + 1, body: callBody(i) });
    }
  });
  return sites;
}

describe("veridian-client: tenant data must never enter a shared HTTP cache", () => {
  test("every fetchWithTimeout call site opts out of caching with cache: \"no-store\"", () => {
    const sites = callSitesOf("fetchWithTimeout");

    // Guard the guard: if a refactor renames or inlines this helper, the test
    // must fail loudly rather than pass over an empty set. A check that
    // silently examines nothing is the failure mode this whole session has
    // been filing -- it reports green forever.
    expect(
      sites.length,
      "found no fetchWithTimeout call sites -- the helper was renamed or inlined, so this test is no longer checking anything. Re-point it before assuming the invariant still holds.",
    ).toBeGreaterThanOrEqual(4);

    const offenders = sites
      .filter((s) => !s.body.includes(`cache: "no-store"`))
      .map((s) => `veridian-client.ts:${s.line}`);

    expect(
      offenders,
      `these VERIDIAN call sites do not set cache: "no-store": ${offenders.join(", ")}. ` +
        `Every call in this file is per-tenant and Next caches on URL+method+body but NOT headers, ` +
        `so an uncached-opt-out here serves one org's response to another. If you need caching, ` +
        `use createCachedVeridianGet() where organizationId is an explicit cache key part.`,
    ).toEqual([]);
  });

  test("the shared fetch() never opts INTO Next's data cache", () => {
    // The single fetch() inside fetchWithTimeout is the chokepoint: anything
    // added there applies to every tenant call in the file at once.
    const fetchLine = lines.findIndex((l) => l.includes("await fetch(url,"));
    expect(
      fetchLine,
      "the shared `await fetch(url, ...)` inside fetchWithTimeout was not found -- re-point this test",
    ).toBeGreaterThan(-1);

    const body = callBody(fetchLine);
    expect(
      body.includes("revalidate"),
      `the shared fetch inside fetchWithTimeout now mentions "revalidate". Adding next: { revalidate } ` +
        `here caches per-tenant responses under a key that ignores the Bearer token, which serves org A's ` +
        `data to org B (R81_F28 / fault class E-45). Cache at the unstable_cache layer instead.`,
    ).toBe(false);
  });

  test("the documented cached helper still keys on organizationId, two independent ways", () => {
    // createCachedVeridianGet is the SANCTIONED way to cache here, and it is
    // only safe while organizationId is both an explicit keyPart and the
    // wrapped function's argument. If either disappears, the safe path stops
    // being safe and this file's whole caching story changes.
    const idx = lines.findIndex((l) => l.includes("export function createCachedVeridianGet"));
    expect(idx, "createCachedVeridianGet not found -- re-point this test").toBeGreaterThan(-1);

    const helper = lines.slice(idx, idx + 25).join("\n");
    expect(helper).toContain("organizationId");
    expect(
      helper.includes("unstable_cache"),
      "createCachedVeridianGet no longer uses unstable_cache -- the org-scoped cache key may be gone",
    ).toBe(true);
  });
});
