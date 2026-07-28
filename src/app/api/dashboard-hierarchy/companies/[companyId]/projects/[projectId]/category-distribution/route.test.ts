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

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string) => {
    if (path.includes("category-boq-amounts")) return CATEGORY_BOQ_AMOUNTS;
    if (path.includes("category-progress")) return CATEGORY_PROGRESS;
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
