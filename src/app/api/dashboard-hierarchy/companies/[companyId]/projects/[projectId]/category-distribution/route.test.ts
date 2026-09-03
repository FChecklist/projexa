/// <reference types="bun-types" />
// Proves the category-distribution chart's numbers are real and internally
// consistent for a realistic seeded project: the pie chart's shares sum to
// 100%, each category's totalAmount matches VERIDIAN's real BOQ-line-item
// grouping (category-boq-amounts), and each category's completedAmount is
// genuinely derived from real WPR completion % (category-progress) --
// never fabricated.
import { describe, expect, test, mock } from "bun:test";
import { NextResponse } from "next/server";

type Scope = { userId: string | null; companyId: string | null; role: string | null; response: NextResponse | null };
let mockScope: Scope;

// A realistic seeded interiors project: Gypsum/Civil/Joinery/Paint BOQ
// categories with real line-item amounts, plus one line item with no
// activityId (falls into "Uncategorized"), and real WPR completion % per
// category from the already-landed Work Progress Report feature.
const CATEGORY_BOQ_AMOUNTS = {
  categories: [
    { categoryId: "cat-gypsum", name: "Gypsum", totalAmount: 400_000 },
    { categoryId: "cat-civil", name: "Civil", totalAmount: 300_000 },
    { categoryId: "cat-joinery", name: "Joinery", totalAmount: 200_000 },
    { categoryId: "cat-paint", name: "Paint", totalAmount: 0 }, // category exists but has no line items yet
  ],
  uncategorizedAmount: 100_000,
  totalAmount: 1_000_000,
};
const CATEGORY_PROGRESS = {
  categories: [
    { categoryId: "cat-gypsum", name: "Gypsum", percentComplete: 80 },
    { categoryId: "cat-civil", name: "Civil", percentComplete: 50 },
    { categoryId: "cat-joinery", name: "Joinery", percentComplete: 0 },
    { categoryId: "cat-paint", name: "Paint", percentComplete: 0 },
  ],
};

mock.module("@/lib/company-scope", () => ({
  requireCompanyScope: async () => mockScope,
}));

// R67 E-32 REGRESSION GUARD. VERIDIAN's /reports/{name} now answers with the
// generic { columns, rows, totals, currency } TABLE by default and only serves
// the handler's own payload under ?format=legacy. This mock behaves like the
// real upstream does -- table unless the flag is present -- so a caller that
// forgets the flag gets a body with no `categories` and this file fails, rather
// than the chart silently emptying in a browser.
const askedPaths: string[] = [];
const CATEGORY_PROGRESS_AS_TABLE = {
  columns: [
    { key: "name", label: "Category", unit: "text", align: "left" },
    { key: "percentComplete", label: "% complete", unit: "percent", align: "right" },
  ],
  rows: CATEGORY_PROGRESS.categories.map((c) => ({ name: c.name, percentComplete: c.percentComplete })),
  currency: "AED",
};
const CATEGORY_BOQ_AMOUNTS_AS_TABLE = {
  columns: [
    { key: "name", label: "Category", unit: "text", align: "left" },
    { key: "totalAmount", label: "BOQ amount", unit: "currency", align: "right" },
  ],
  rows: CATEGORY_BOQ_AMOUNTS.categories.map((c) => ({ name: c.name, totalAmount: c.totalAmount })),
  totals: { totalAmount: CATEGORY_BOQ_AMOUNTS.totalAmount },
  currency: "AED",
};

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string) => {
    askedPaths.push(path);
    const legacy = path.includes("format=legacy");
    if (path.includes("category-boq-amounts")) return legacy ? CATEGORY_BOQ_AMOUNTS : CATEGORY_BOQ_AMOUNTS_AS_TABLE;
    if (path.includes("category-progress")) return legacy ? CATEGORY_PROGRESS : CATEGORY_PROGRESS_AS_TABLE;
    throw new Error(`unexpected path in test: ${path}`);
  },
  VeridianApiError: class VeridianApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

const { GET } = await import("./route");

describe("GET .../category-distribution", () => {
  test("percentages sum to 100% and each category's totalAmount matches the real BOQ grouping", async () => {
    mockScope = { userId: "user-1", companyId: "org-a", role: "member", response: null };
    const res = await GET(new NextRequest2("http://test/x"), { params: Promise.resolve({ companyId: "org-a", projectId: "proj-1" }) });
    const body = await res.json();

    // Paint has totalAmount 0 -- filtered out of the pie/bar (a zero-value
    // slice isn't a real share of anything), so 3 real categories + Uncategorized.
    expect(body.categories).toHaveLength(4);

    const shareSum = body.categories.reduce((s: number, c: { sharePercent: number }) => s + c.sharePercent, 0);
    expect(shareSum).toBeCloseTo(100, 5);

    const gypsum = body.categories.find((c: { name: string }) => c.name === "Gypsum");
    expect(gypsum.totalAmount).toBe(400_000);
    expect(gypsum.sharePercent).toBeCloseTo(40, 5); // 400k / 1,000,000
    expect(gypsum.percentComplete).toBe(80);
    expect(gypsum.completedAmount).toBeCloseTo(320_000, 5); // 400k * 80%

    const civil = body.categories.find((c: { name: string }) => c.name === "Civil");
    expect(civil.completedAmount).toBeCloseTo(150_000, 5); // 300k * 50%

    const joinery = body.categories.find((c: { name: string }) => c.name === "Joinery");
    expect(joinery.completedAmount).toBe(0); // real WPR data says 0% complete -- not fabricated as partial

    const uncategorized = body.categories.find((c: { name: string }) => c.name === "Uncategorized");
    expect(uncategorized.totalAmount).toBe(100_000);
    expect(uncategorized.sharePercent).toBeCloseTo(10, 5);
    expect(uncategorized.completedAmount).toBe(0); // no activity link -- no WPR data to attribute completion to

    expect(body.totalAmount).toBe(1_000_000);
  });

  test("both reports are asked for in the legacy shape -- the table has no categoryId to chart", async () => {
    mockScope = { userId: "user-1", companyId: "org-a", role: "member", response: null };
    askedPaths.length = 0;
    const res = await GET(new NextRequest2("http://test/x"), { params: Promise.resolve({ companyId: "org-a", projectId: "proj-1" }) });
    expect(res.status).toBe(200);
    expect(askedPaths).toHaveLength(2);
    for (const path of askedPaths) expect(path).toContain("format=legacy");
    // And the chart really is usable -- not an empty array quietly produced
    // from a table body.
    const body = await res.json();
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.categories[0].categoryId).toBeTruthy();
  });

  test("a caller with no real membership in the requested company is rejected before any VERIDIAN call", async () => {
    mockScope = { userId: null, companyId: null, role: null, response: NextResponse.json({ error: "Not a member of this company" }, { status: 403 }) };
    const res = await GET(new NextRequest2("http://test/x"), { params: Promise.resolve({ companyId: "org-not-mine", projectId: "proj-1" }) });
    expect(res.status).toBe(403);
  });
});

// Minimal Request stand-in -- this route only reads params, never
// request.url/searchParams, so a plain Request is enough (unlike the
// dashboard route test, which needs NextRequest for its searchParams).
function NextRequest2(url: string): Request {
  return new Request(url);
}
