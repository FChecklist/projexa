/// <reference types="bun-types" />
// Live bug 2026-10-22: /share/report/<token> for a fresh Project Status link was
// HTTP 500 (app-error screen, React #441). Cause: the page read
// `data.totals.budget`, but VERIDIAN redacts public shares to schedule/progress/
// scope (D91), so `totals` no longer exists -> TypeError inside the Server
// Component. These tests render the REAL pages with the REAL live payload shape
// (captured from the backend) and with every unknown shape, and assert none of
// them throws.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/share/report/tok",
}));
mock.module("@/lib/local-first/client-error-report", () => ({ reportClientError: () => {} }));

const { default: ReportPage } = await import("../app/share/report/[token]/page");
const { default: AttendancePage } = await import("../app/share/attendance/[token]/page");
const { interpretSharedReport } = await import("./shared-report");

// Verbatim shape of the live response (ids shortened, entries trimmed).
const LIVE_PROJECT_STATUS = {
  reportType: "project_status", projectId: "p1", from: "2026-09-22", to: "2026-10-21", boqTitle: "audit rev2",
  dashboard: {
    projectId: "p1", projectName: "AUDIT Project", progressPercent: 70, progressByActivityLogPct: 70,
    delayedTaskCount: 0, photoCount: 0, taskCount: 1, generatedAt: "2026-10-21T21:49:35.577Z",
    permitsExpiringCount: 0, permitsExpiredCount: 0,
    categories: [{ categoryId: "c1", name: "General", percentComplete: 70 }],
    recentEntries: [{ id: "e1", activityId: "a1", activityName: "AUDIT Tiling", entryDate: "2026-10-23", quantityDone: "3", percentComplete: "70" }],
  },
  lines: [
    { lineItemId: "l1", boqId: "b1", sNo: 1, serialNumber: 1, isRootLine: true, parentLineItemId: null, code: "2", category: null, description: "AUDIT2 Ceiling paint", unit: "sqm", quantity: 200 },
  ],
};

const realFetch = globalThis.fetch;
function serve(status: number, body: unknown, raw?: string) {
  globalThis.fetch = (async () => new Response(raw ?? JSON.stringify(body), { status })) as typeof fetch;
}
async function html(Page: typeof ReportPage) {
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ token: "tok" }) }));
}
beforeEach(() => serve(200, LIVE_PROJECT_STATUS));
afterEach(() => { globalThis.fetch = realFetch; });

describe("/share/report/[token]", () => {
  test("the live Project Status payload renders (was a 500) -- progress and scope, no cost", async () => {
    const out = await html(ReportPage);
    expect(out).toContain("AUDIT Project");
    expect(out).toContain("70.0%");
    expect(out).toContain("AUDIT2 Ceiling paint");
    expect(out).not.toContain("shared-report-unavailable");
    expect(out).not.toMatch(/Budget|Revenue|Expenses|Contract Value|Vendor/);
  });

  test("a payload with no dashboard lines / odd fields still renders", async () => {
    serve(200, { reportType: "project_status", dashboard: { projectName: "X", categories: "nope", recentEntries: [null, 3] }, lines: [null] });
    expect(await html(ReportPage)).toContain("X");
  });

  test("a project_status with no dashboard is a guided notice, not a throw", async () => {
    serve(200, { reportType: "project_status" });
    expect(await html(ReportPage)).toContain('data-reason="unreadable"');
  });

  test("work progress: missing arrays are a notice, malformed rows never throw", async () => {
    serve(200, { reportType: "work_progress", from: "2026-01-01", to: "2026-01-31" });
    expect(await html(ReportPage)).toContain('data-reason="unreadable"');
    serve(200, { from: "2026-01-01", to: "2026-01-31", boqTitle: "B", lineItems: [null, 5], entries: [{}], activities: [], categories: [] });
    expect(await html(ReportPage)).toContain("shared-report-unavailable");
  });

  test("an attendance token opened here points at the attendance page", async () => {
    serve(200, { reportType: "attendance_summary", rows: [], totals: {} });
    const out = await html(ReportPage);
    expect(out).toContain('data-reason="wrong-page"');
    expect(out).toContain("/share/attendance/tok");
  });

  test("an unknown report type, a network failure, a 500 and non-JSON are notices, never throws", async () => {
    serve(200, { reportType: "payroll" });
    expect(await html(ReportPage)).toContain('data-reason="unsupported"');
    globalThis.fetch = (async () => { throw new Error("ECONNRESET"); }) as typeof fetch;
    expect(await html(ReportPage)).toContain('data-reason="unreachable"');
    serve(503, { error: "x" });
    expect(await html(ReportPage)).toContain('data-reason="unreachable"');
    serve(200, null, "<html>not json</html>");
    expect(await html(ReportPage)).toContain('data-reason="unreadable"');
  });

  test("404 / 410 is the expired-or-revoked guide", async () => {
    serve(404, { error: "gone" });
    expect(await html(ReportPage)).toContain("report-share-expired");
    serve(410, {});
    expect(await html(ReportPage)).toContain("report-share-expired");
  });
});

describe("/share/attendance/[token]", () => {
  test("renders the redacted (no cost) payload", async () => {
    serve(200, {
      reportType: "attendance_summary", projectId: "p", from: "2026-10-01", to: "2026-10-02",
      rows: [{ trade: "Mason", present: 3, halfDay: 1, absent: 0, workerDays: 3.5 }],
      totals: { present: 3, halfDay: 1, absent: 0, workerDays: 3.5 }, headcount: 4,
      reconciliation: { ties: true, rowCountFromStatuses: 4, rowCountFromTrades: 4 },
    });
    const out = await html(AttendancePage);
    expect(out).toContain("Mason");
    expect(out).not.toContain("Cost");
  });

  test("a project_status token or a malformed body is a notice, never a throw", async () => {
    expect(await html(AttendancePage)).toContain('data-reason="wrong-page"');
    serve(200, { reportType: "attendance_summary", rows: "x" });
    expect(await html(AttendancePage)).toContain('data-reason="unreadable"');
    globalThis.fetch = (async () => { throw new Error("down"); }) as typeof fetch;
    expect(await html(AttendancePage)).toContain('data-reason="unreachable"');
  });
});

describe("interpretSharedReport", () => {
  test("never throws for hostile bodies", () => {
    for (const body of [undefined, null, 5, "s", [], {}, { reportType: 3 }, { reportType: "project_status", dashboard: [] }]) {
      expect(() => interpretSharedReport(200, body)).not.toThrow();
    }
  });
});
