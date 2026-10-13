/// <reference types="bun-types" />
// Sumeet R-C11 / R-C15 offline: every report of the open project is kept on the laptop while it is online.
import { describe, expect, test } from "bun:test";
import { prefetchReportSnapshots } from "./reports-prefetch";
import type { ReportEntry } from "./reports-adapter";
import type { SnapshotCache } from "../snapshot-cache";

function fakeCache() {
  const written: string[] = [];
  const cache = {
    read: async () => null,
    write: async (name: { route: string }, body: unknown) => {
      written.push(name.route);
      return { fetchedAt: 1, body } as never;
    },
    remove: async () => {},
    list: async () => [],
    clear: async () => {},
  } as unknown as SnapshotCache;
  return { cache, written };
}

const entry = (value: string, over: Partial<ReportEntry> = {}): ReportEntry => ({ value, label: value, kind: "fetch", target: `/api/reports/${value}?projectId=p1&format=legacy`, savedAt: null, ...over });
const ok = () => new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { "content-type": "application/json" } });

describe("prefetchReportSnapshots", () => {
  test("keeps every fetch report one after the other, skipping screens that are their own page and the weekly report with no week chosen", async () => {
    const { cache, written } = fakeCache();
    const urls: string[] = [];
    const fetchImpl = (async (u: RequestInfo | URL) => { urls.push(String(u)); return ok(); }) as typeof fetch;
    const result = await prefetchReportSnapshots({
      cache, projectId: "p1", fetchImpl,
      reports: [entry("attendance"), entry("work-progress", { kind: "navigate", target: "/work-progress" }), entry("weekly-project"), entry("revenue")],
    });
    expect(result).toEqual({ refreshed: 2, skippedFresh: 0, skippedNeedsInput: 1, stoppedBecause: "none" });
    expect(urls).toEqual(["/api/reports/attendance?projectId=p1&format=legacy", "/api/reports/revenue?projectId=p1&format=legacy"]);
    expect(written).toHaveLength(2);
  });

  test("a report saved less than ten minutes ago is not asked for again", async () => {
    const { cache } = fakeCache();
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return ok(); }) as typeof fetch;
    const now = 1_000_000;
    const result = await prefetchReportSnapshots({ cache, projectId: "p1", fetchImpl, now, reports: [entry("kpi", { savedAt: now - 60_000 }), entry("expense", { savedAt: now - 11 * 60_000 })] });
    expect(result.skippedFresh).toBe(1);
    expect(result.refreshed).toBe(1);
    expect(calls).toBe(1);
  });

  test("a struggling server or no network stops the run at once: no hammering with the rest", async () => {
    const { cache } = fakeCache();
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return new Response("", { status: 503 }); }) as typeof fetch;
    const result = await prefetchReportSnapshots({ cache, projectId: "p1", fetchImpl, reports: [entry("a"), entry("b"), entry("c")] });
    expect(result.stoppedBecause).toBe("server");
    expect(calls).toBe(1);
    const offline = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    expect((await prefetchReportSnapshots({ cache, projectId: "p1", fetchImpl: offline, reports: [entry("a"), entry("b")] })).stoppedBecause).toBe("offline");
  });

  test("an aborted run asks for nothing more", async () => {
    const { cache } = fakeCache();
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return ok(); }) as typeof fetch;
    await prefetchReportSnapshots({ cache, projectId: "p1", fetchImpl, signal: controller.signal, reports: [entry("a")] });
    expect(calls).toBe(0);
  });
});
