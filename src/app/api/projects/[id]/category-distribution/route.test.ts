/// <reference types="bun-types" />
// The project-scoped twin of the company-scoped category-distribution route.
//
// WHY THIS FILE EXISTS AT ALL. R67 E-32 flipped the DEFAULT body of VERIDIAN's
// /reports/{name} from each handler's own payload to the generic
// { columns, rows, totals, currency } table, keeping the old shape behind
// ?format=legacy. This route reads `categories[].categoryId`, `.totalAmount`
// and `.percentComplete` -- fields the table does not carry -- so without the
// flag it produces a 502 (or, if the mapping were defensive, an empty chart)
// and nothing in the suite noticed, because every other test in this repo
// stubs fetch with hand-written legacy payloads. The callVeridian mock below
// therefore behaves like the REAL upstream: table unless asked otherwise.
import { describe, expect, test, mock } from "bun:test";
import { NextResponse } from "next/server";

type Ctx = { user: { id: string } | null; organizationId: string | null; role: string | null; response: NextResponse | null };
let mockCtx: Ctx;

// The same realistic seeded interiors project the company-scoped route test
// uses, so the two screens are proven to derive one chart from one set of
// numbers.
const CATEGORY_BOQ_AMOUNTS = {
  categories: [
    { categoryId: "cat-gypsum", name: "Gypsum", totalAmount: 400_000 },
    { categoryId: "cat-civil", name: "Civil", totalAmount: 300_000 },
    { categoryId: "cat-joinery", name: "Joinery", totalAmount: 200_000 },
  ],
  uncategorizedAmount: 100_000,
  totalAmount: 1_000_000,
};
const CATEGORY_PROGRESS = {
  categories: [
    { categoryId: "cat-gypsum", name: "Gypsum", percentComplete: 80 },
    { categoryId: "cat-civil", name: "Civil", percentComplete: 50 },
    { categoryId: "cat-joinery", name: "Joinery", percentComplete: 0 },
  ],
};

// What the SAME two reports look like after E-32, when nobody asks for legacy.
const CATEGORY_BOQ_AMOUNTS_AS_TABLE = {
  columns: [
    { key: "name", label: "Category", unit: "text", align: "left" },
    { key: "totalAmount", label: "BOQ amount", unit: "currency", align: "right" },
  ],
  rows: CATEGORY_BOQ_AMOUNTS.categories.map((c) => ({ name: c.name, totalAmount: c.totalAmount })),
  totals: { totalAmount: CATEGORY_BOQ_AMOUNTS.totalAmount },
  currency: "AED",
};
const CATEGORY_PROGRESS_AS_TABLE = {
  columns: [
    { key: "name", label: "Category", unit: "text", align: "left" },
    { key: "percentComplete", label: "% complete", unit: "percent", align: "right" },
  ],
  rows: CATEGORY_PROGRESS.categories.map((c) => ({ name: c.name, percentComplete: c.percentComplete })),
  currency: "AED",
};

const askedPaths: string[] = [];
let failWith: { message: string; status: number } | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

class FakeVeridianApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string) => {
    askedPaths.push(path);
    if (failWith) throw new FakeVeridianApiError(failWith.message, failWith.status);
    const legacy = path.includes("format=legacy");
    if (path.includes("category-boq-amounts")) return legacy ? CATEGORY_BOQ_AMOUNTS : CATEGORY_BOQ_AMOUNTS_AS_TABLE;
    if (path.includes("category-progress")) return legacy ? CATEGORY_PROGRESS : CATEGORY_PROGRESS_AS_TABLE;
    throw new Error(`unexpected path in test: ${path}`);
  },
  VeridianApiError: FakeVeridianApiError,
}));

const { GET } = await import("./route");

function call(projectId: string) {
  return GET(new Request("http://test/x"), { params: Promise.resolve({ id: projectId }) });
}

describe("GET /api/projects/[id]/category-distribution", () => {
  test("asks both reports for the legacy shape and returns a usable chart", async () => {
    mockCtx = { user: { id: "user-1" }, organizationId: "org-a", role: "member", response: null };
    failWith = null;
    askedPaths.length = 0;

    const res = await call("proj-1");
    expect(res.status).toBe(200);

    // The flag is the whole point: without it the upstream answers a table and
    // `progress.categories.map(...)` throws.
    expect(askedPaths).toHaveLength(2);
    for (const path of askedPaths) expect(path).toContain("format=legacy");
    expect(askedPaths.some((p) => p.includes("category-boq-amounts"))).toBe(true);
    expect(askedPaths.some((p) => p.includes("category-progress"))).toBe(true);

    const body = await res.json();
    expect(body.totalAmount).toBe(1_000_000);
    // 3 real categories + Uncategorized.
    expect(body.categories).toHaveLength(4);
    const gypsum = body.categories.find((c: { name: string }) => c.name === "Gypsum");
    expect(gypsum.categoryId).toBe("cat-gypsum");
    expect(gypsum.sharePercent).toBeCloseTo(40, 5);
    expect(gypsum.completedAmount).toBeCloseTo(320_000, 5);
  });

  test("the project id is passed through url-encoded", async () => {
    mockCtx = { user: { id: "user-1" }, organizationId: "org-a", role: "member", response: null };
    failWith = null;
    askedPaths.length = 0;
    await call("proj 1/2");
    for (const path of askedPaths) expect(path).toContain("projectId=proj%201%2F2");
  });

  test("an unauthenticated caller is rejected before any VERIDIAN call", async () => {
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    askedPaths.length = 0;
    const res = await call("proj-1");
    expect(res.status).toBe(401);
    expect(askedPaths).toHaveLength(0);
  });

  test("a VERIDIAN error keeps its own status and message rather than becoming a blanket 502", async () => {
    mockCtx = { user: { id: "user-1" }, organizationId: "org-a", role: "member", response: null };
    failWith = { message: "Project not found", status: 404 };
    const res = await call("proj-gone");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Project not found");
  });
});
