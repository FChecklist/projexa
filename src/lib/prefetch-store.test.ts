/// <reference types="bun-types" />
// R67 F-22 (audit recommendation R-247) -- speculation's four bounds.
//
// Speculation is only an improvement while it stays cheap. Each of these
// assertions guards one of the bounds that keeps it cheap; without them the
// feature degrades into "the app fetches everything you hover over, forever".

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  PREFETCH_MAX_CONCURRENCY,
  PREFETCH_MAX_ENTRIES,
  PREFETCH_TTL_MS,
  invalidatePrefetch,
  invalidatePrefetchMatching,
  prefetch,
  prefetchStats,
  readPrefetch,
  resetPrefetchStore,
} from "./prefetch-store";
import { DASHBOARD_SPECULATION_ROUTES, primaryListUrl } from "./module-prefetch";

const settle = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => resetPrefetchStore());
afterEach(() => resetPrefetchStore());

describe("the TTL", () => {
  test("a fresh entry is readable; an expired one is dropped, not shown", async () => {
    prefetch("/api/scope?projectId=p1", async () => ({ boqs: [{ id: "b1" }] }));
    await settle();

    const now = Date.now();
    expect(readPrefetch("/api/scope?projectId=p1", now)).not.toBeNull();
    // One millisecond past the window is past the window.
    expect(readPrefetch("/api/scope?projectId=p1", now + PREFETCH_TTL_MS)).toBeNull();
    // And the expired entry is gone, not merely hidden.
    expect(prefetchStats().entries).toBe(0);
  });

  test("the window is a minute", () => {
    expect(PREFETCH_TTL_MS).toBe(60_000);
  });
});

describe("the entry cap", () => {
  test("at most five entries survive, oldest evicted first", async () => {
    for (let i = 0; i < 9; i++) {
      const key = `/api/permits?projectId=p${i}`;
      prefetch(key, async () => ({ permits: [{ id: `x${i}` }] }));
      // Distinct timestamps so "oldest" is well defined.
      await new Promise((r) => setTimeout(r, 2));
    }
    await settle();

    expect(PREFETCH_MAX_ENTRIES).toBe(5);
    expect(prefetchStats().entries).toBe(PREFETCH_MAX_ENTRIES);
    // The first four are the oldest and are the ones gone.
    expect(readPrefetch("/api/permits?projectId=p0")).toBeNull();
    expect(readPrefetch("/api/permits?projectId=p8")).not.toBeNull();
  });
});

describe("the concurrency cap", () => {
  test("speculation never runs more than two requests at once", async () => {
    let live = 0;
    let peak = 0;
    const slow = () =>
      new Promise((resolve) => {
        live += 1;
        peak = Math.max(peak, live);
        setTimeout(() => {
          live -= 1;
          resolve({ ok: true });
        }, 20);
      });

    for (let i = 0; i < 6; i++) prefetch(`/api/moms?projectId=p${i}`, slow);
    expect(prefetchStats().inFlight).toBe(PREFETCH_MAX_CONCURRENCY);

    await new Promise((r) => setTimeout(r, 250));
    expect(peak).toBe(PREFETCH_MAX_CONCURRENCY);
    expect(PREFETCH_MAX_CONCURRENCY).toBe(2);
  });
});

describe("one flight per key", () => {
  test("hovering the same link repeatedly costs one request", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { drawings: [] };
    };
    prefetch("/api/drawings?projectId=p1", fetcher);
    prefetch("/api/drawings?projectId=p1", fetcher);
    prefetch("/api/drawings?projectId=p1", fetcher);
    await settle();
    expect(calls).toBe(1);

    // And a key that is already fresh is not fetched again either.
    prefetch("/api/drawings?projectId=p1", fetcher);
    await settle();
    expect(calls).toBe(1);
  });

  test("a failed speculation is forgotten, never surfaced", async () => {
    prefetch("/api/scope?projectId=p1", async () => {
      throw new Error("500");
    });
    await settle();
    expect(readPrefetch("/api/scope?projectId=p1")).toBeNull();
    expect(prefetchStats().inFlight).toBe(0);
  });
});

describe("invalidation", () => {
  test("a write drops the speculative copy it made wrong", async () => {
    prefetch("/api/moms?projectId=p1", async () => ({ meetings: [] }));
    await settle();
    expect(readPrefetch("/api/moms?projectId=p1")).not.toBeNull();

    invalidatePrefetch("/api/moms?projectId=p1");
    expect(readPrefetch("/api/moms?projectId=p1")).toBeNull();
  });

  test("a module-wide invalidation drops every project's copy of that list", async () => {
    prefetch("/api/moms?projectId=p1", async () => ({ meetings: [] }));
    prefetch("/api/moms?projectId=p2", async () => ({ meetings: [] }));
    prefetch("/api/scope?projectId=p1", async () => ({ boqs: [] }));
    await settle();

    invalidatePrefetchMatching("/api/moms");
    expect(readPrefetch("/api/moms?projectId=p1")).toBeNull();
    expect(readPrefetch("/api/moms?projectId=p2")).toBeNull();
    expect(readPrefetch("/api/scope?projectId=p1")).not.toBeNull();
  });
});

describe("primaryListUrl", () => {
  // A near-miss costs bytes and buys nothing, so these must be byte-identical
  // to the urls the module clients build.
  test("matches what each module client actually requests", () => {
    expect(primaryListUrl("/scope", "p1")).toBe("/api/scope?projectId=p1");
    expect(primaryListUrl("/work-progress", "p1")).toBe("/api/work-progress?projectId=p1");
    expect(primaryListUrl("/permits", "p1")).toBe("/api/permits?projectId=p1&all=true");
    expect(primaryListUrl("/moms", "p1")).toBe("/api/moms?projectId=p1");
    expect(primaryListUrl("/drawings", "p1")).toBe("/api/drawings?projectId=p1");
    expect(primaryListUrl("/documents", "p1")).toBe(
      "/api/documents?linkedEntityType=project&linkedEntityId=p1"
    );
    expect(primaryListUrl("/labour", "p1")).toBe("/api/labour-roster?projectId=p1");
    expect(primaryListUrl("/materials", "p1")).toBe("/api/materials/master?projectId=p1");
  });

  test("a query string on the route does not change which list it is", () => {
    expect(primaryListUrl("/permits?withinDays=30", "p1")).toBe("/api/permits?projectId=p1&all=true");
  });

  test("an unmapped module and a missing project are no-ops, never a wrong guess", () => {
    expect(primaryListUrl("/reports", "p1")).toBeNull();
    expect(primaryListUrl("/settings", "p1")).toBeNull();
    expect(primaryListUrl("/scope", null)).toBeNull();
  });

  test("the dashboard speculates on the two screens the audit named", () => {
    expect([...DASHBOARD_SPECULATION_ROUTES]).toEqual(["/scope", "/work-progress"]);
  });
});
