/// <reference types="bun-types" />
// R67 F-10 (R-134) -- sibling test for report-result-cache.ts.
//
// The properties worth pinning are the ones that make a stale-while-revalidate
// cache honest rather than merely fast:
//   * a key that ignores param ORDER, so two callers building the same query
//     differently share one entry instead of silently missing;
//   * different reports / projects / params never collide;
//   * an entry older than the max age is DISCARDED, not painted -- nobody
//     should read a figure from a previous working session as current;
//   * every storage failure degrades to "no cache", never a throw on a render
//     path.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

const { reportCacheKey, readCachedReport, writeCachedReport, clearCachedReports, REPORT_CACHE_MAX_AGE_MS } =
  await import("./report-result-cache");

beforeEach(() => clearCachedReports());
afterEach(() => clearCachedReports());

describe("reportCacheKey", () => {
  test("param order does not change the key -- two callers building the same query share one entry", () => {
    expect(reportCacheKey("weekly-project", "p1", { weekStart: "2026-09-01", view: "scope" })).toBe(
      reportCacheKey("weekly-project", "p1", { view: "scope", weekStart: "2026-09-01" })
    );
  });

  test("report, project and params each change the key", () => {
    const base = reportCacheKey("project-status", "p1");
    expect(reportCacheKey("attendance", "p1")).not.toBe(base);
    expect(reportCacheKey("project-status", "p2")).not.toBe(base);
    expect(reportCacheKey("project-status", "p1", { weekStart: "2026-09-01" })).not.toBe(base);
  });
});

describe("readCachedReport / writeCachedReport", () => {
  test("a written result comes back", () => {
    const key = reportCacheKey("project-status", "p1");
    writeCachedReport(key, { percentByValue: 42 });

    expect(readCachedReport(key)).toEqual({ percentByValue: 42 });
  });

  test("a miss is null, not undefined or a throw", () => {
    expect(readCachedReport(reportCacheKey("attendance", "p-never-run"))).toBeNull();
  });

  test("an entry older than the max age is discarded, not painted", () => {
    const key = reportCacheKey("project-status", "p1");
    // Written by hand with an old timestamp -- the same shape writeCachedReport
    // produces, so this exercises the real expiry branch.
    sessionStorage.setItem(key, JSON.stringify({ data: { stale: true }, at: Date.now() - REPORT_CACHE_MAX_AGE_MS - 1 }));

    expect(readCachedReport(key)).toBeNull();
    // And it is removed, so it cannot be read by a later call with a longer
    // max age either.
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  test("an entry inside the max age is kept", () => {
    const key = reportCacheKey("project-status", "p1");
    sessionStorage.setItem(key, JSON.stringify({ data: { fresh: true }, at: Date.now() - 1_000 }));

    expect(readCachedReport(key)).toEqual({ fresh: true });
  });

  test("a corrupt entry reads as a miss rather than throwing on a render path", () => {
    const key = reportCacheKey("project-status", "p1");
    sessionStorage.setItem(key, "{not json");

    expect(readCachedReport(key)).toBeNull();
  });

  test("an entry with no timestamp is a miss -- it cannot be aged, so it is not trusted", () => {
    const key = reportCacheKey("project-status", "p1");
    sessionStorage.setItem(key, JSON.stringify({ data: { x: 1 } }));

    expect(readCachedReport(key)).toBeNull();
  });

  test("clearCachedReports removes report entries and leaves everything else alone", () => {
    writeCachedReport(reportCacheKey("project-status", "p1"), { a: 1 });
    writeCachedReport(reportCacheKey("attendance", "p1"), { b: 2 });
    sessionStorage.setItem("px.currencies", "[]");

    clearCachedReports();

    expect(readCachedReport(reportCacheKey("project-status", "p1"))).toBeNull();
    expect(readCachedReport(reportCacheKey("attendance", "p1"))).toBeNull();
    expect(sessionStorage.getItem("px.currencies")).toBe("[]");
  });
});
