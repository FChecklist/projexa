/// <reference types="bun-types" />
// Proves revenueForProjectInRange's MAX_INVOICE_PAGES cap is surfaced to the
// caller as `revenueTruncated` rather than silently under-counting: a
// date-ranged request whose org has more sales-invoice pages than the cap
// must come back with revenueTruncated: true, and a request within the cap
// must come back with revenueTruncated: false.
import { describe, expect, test, mock } from "bun:test";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type Scope = { userId: string | null; companyId: string | null; role: string | null; response: NextResponse | null };
const mockScope: Scope = { userId: "user-1", companyId: "org-a", role: "member", response: null };

// 5 total pages of 200 invoices each (1000 invoices) -- one more page than
// MAX_INVOICE_PAGES (4) covers, so the 5th page's invoices for this project
// must be excluded and the response must disclose that.
const TOTAL_PAGES_OVER_CAP = 5;
// 2 total pages -- comfortably under the cap, so nothing should be dropped.
const TOTAL_PAGES_UNDER_CAP = 2;

let totalPagesForThisTest = TOTAL_PAGES_UNDER_CAP;

mock.module("@/lib/company-scope", () => ({
  requireCompanyScope: async () => mockScope,
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string) => {
    if (path.startsWith("/dashboard/")) {
      return { projectId: "p-1", projectName: "Test Project", budget: 1000, revenue: 0, expenses: 0, progressPercent: 0, delayedTaskCount: 0, photoCount: 0, taskCount: 0, projectValue: 750000 };
    }
    if (path.startsWith("/expenses")) return { expenses: [] };
    if (path.startsWith("/work-progress")) return { entries: [] };
    const url = new URL(`http://x${path}`);
    const page = Number(url.searchParams.get("page"));
    return {
      salesInvoices: [{ id: `inv-${page}`, projectId: "p-1", postingDate: "2026-01-01", grandTotal: "100", status: "paid" }],
      totalPages: totalPagesForThisTest,
    };
  },
  VeridianApiError: class VeridianApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

const { GET } = await import("./route");

describe("GET .../projects/[projectId] revenue truncation", () => {
  test("date-ranged revenue with invoice pages within the cap returns revenueTruncated: false", async () => {
    totalPagesForThisTest = TOTAL_PAGES_UNDER_CAP;
    const res = await GET(new NextRequest("http://test/x?from=2026-01-01&to=2026-01-31"), { params: Promise.resolve({ companyId: "org-a", projectId: "p-1" }) });
    const body = await res.json();
    expect(body.revenueTruncated).toBe(false);
    expect(body.revenue).toBe(200); // 2 pages * one 100-value invoice each
  });

  test("date-ranged revenue with invoice pages beyond MAX_INVOICE_PAGES returns revenueTruncated: true", async () => {
    totalPagesForThisTest = TOTAL_PAGES_OVER_CAP;
    const res = await GET(new NextRequest("http://test/x?from=2026-01-01&to=2026-01-31"), { params: Promise.resolve({ companyId: "org-a", projectId: "p-1" }) });
    const body = await res.json();
    expect(body.revenueTruncated).toBe(true);
    expect(body.revenue).toBe(400); // only 4 (capped) pages counted, not the 5th
  });

  test("a request with no date range never computes revenue pages, so it is never truncated", async () => {
    totalPagesForThisTest = TOTAL_PAGES_OVER_CAP;
    const res = await GET(new NextRequest("http://test/x"), { params: Promise.resolve({ companyId: "org-a", projectId: "p-1" }) });
    const body = await res.json();
    expect(body.revenueTruncated).toBe(false);
  });
});

// Point 121: projectValue is passed through from VERIDIAN's baseline
// unchanged (this route computes nothing about it -- COALESCE(user-entered,
// linked-PO-sum) happens entirely in construction-dashboard-service.ts).
describe("GET .../projects[projectId] projectValue passthrough", () => {
  test("projectValue from the VERIDIAN baseline is forwarded unchanged", async () => {
    totalPagesForThisTest = TOTAL_PAGES_UNDER_CAP;
    const res = await GET(new NextRequest("http://test/x"), { params: Promise.resolve({ companyId: "org-a", projectId: "p-1" }) });
    const body = await res.json();
    expect(body.projectValue).toBe(750000);
  });
});
