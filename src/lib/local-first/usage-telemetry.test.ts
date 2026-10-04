import { describe, expect, test } from "bun:test";
import { USAGE_INTERVAL_MS, buildUsageSnapshot, startUsageTelemetry, summariseResources, usageReportDue } from "./usage-telemetry";

describe("usage telemetry", () => {
  test("splits network from locally served and counts sync runs", () => {
    const s = summariseResources([
      { name: "https://x.supabase.co/functions/v1/projexa-sync/manifest", transferSize: 2048, decodedBodySize: 4000 },
      { name: "https://app/_next/a.js", transferSize: 0, decodedBodySize: 10240 },
      { name: "https://app/_next/b.js", transferSize: 0, decodedBodySize: 2048 },
      { name: "https://app/c.png", transferSize: 1024, decodedBodySize: 1024 },
    ]);
    expect(s).toEqual({ syncRuns: 1, networkRequests: 2, networkKb: 3, localServed: 2, localServedKb: 12 });
  });

  test("snapshot tolerates missing browser APIs and carries no urls", () => {
    const snap = buildUsageSnapshot({ entries: [] });
    expect(snap.deviceMemoryGb).toBeNull();
    expect(snap.jsHeapMb).toBeNull();
    const full = buildUsageSnapshot({ deviceMemory: 8, usedJSHeapSize: 52_428_800, storage: { usage: 10_485_760, quota: 1_073_741_824 }, entries: [] });
    expect(full).toMatchObject({ deviceMemoryGb: 8, jsHeapMb: 50, storageUsedMb: 10, storageQuotaMb: 1024 });
    expect(JSON.stringify(full).length).toBeLessThan(300);
  });

  test("due: first immediately, then not before 10 minutes, never while hidden", () => {
    expect(usageReportDue(null, 0, true)).toBe(true);
    expect(usageReportDue(null, 0, false)).toBe(false);
    expect(usageReportDue(0, USAGE_INTERVAL_MS - 1, true)).toBe(false);
    expect(usageReportDue(0, USAGE_INTERVAL_MS, true)).toBe(true);
  });

  test("reports kind usage once at start", async () => {
    const calls: Array<[string, string]> = [];
    const stop = startUsageTelemetry({
      report: (k, m) => calls.push([k, m]),
      now: () => 1,
      isVisible: () => true,
      collect: async () => buildUsageSnapshot({ deviceMemory: 4, entries: [] }),
    });
    await new Promise((r) => setTimeout(r, 10));
    stop();
    expect(calls.length).toBe(1);
    expect(calls[0]![0]).toBe("usage");
    expect(JSON.parse(calls[0]![1]).deviceMemoryGb).toBe(4);
  });
});
