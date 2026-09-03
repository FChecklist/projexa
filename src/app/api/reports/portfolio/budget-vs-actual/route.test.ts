/// <reference types="bun-types" />
// The portfolio relay behind Sumeet 5.png's first graph.
//
// Two properties are load-bearing and neither is visible from the component
// that consumes it. First, the query string is forwarded UNEXAMINED -- the
// filters (departmentId, from, to) are understood by VERIDIAN's route, not by
// this one, and a relay that quietly dropped one would show a chart filtered
// differently from its own controls. Second, this path sits two segments deep
// on purpose so it cannot shadow /api/reports/[reportName]; a static
// `budget-vs-actual` segment there would have silently swallowed the
// per-project report of the same name.
import { describe, expect, test, mock } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { user: { id: string } | null; organizationId: string | null; role: string | null; response: NextResponse | null };
let mockCtx: Ctx;

class FakeVeridianApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const askedPaths: string[] = [];
let failWith: { message: string; status: number } | null = null;

const PORTFOLIO = {
  columns: [
    { key: "projectName", label: "Project", unit: "text", align: "left" },
    { key: "revenue", label: "Revenue", unit: "currency", align: "right" },
  ],
  rows: [{ projectId: "proj-1", projectName: "Cedar Heights Villa", revenue: 475_000, budgetSource: "boq" }],
  currency: "AED",
};

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string) => {
    askedPaths.push(path);
    if (failWith) throw new FakeVeridianApiError(failWith.message, failWith.status);
    return PORTFOLIO;
  },
  VeridianApiError: FakeVeridianApiError,
}));

const { GET } = await import("./route");

function call(query = "") {
  return GET(new NextRequest(`http://test/api/reports/portfolio/budget-vs-actual${query ? `?${query}` : ""}`));
}

describe("GET /api/reports/portfolio/budget-vs-actual", () => {
  test("relays the report body through unchanged", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-a", role: "manager", response: null };
    failWith = null;
    askedPaths.length = 0;

    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PORTFOLIO);
    expect(askedPaths).toEqual(["/reports/portfolio/budget-vs-actual"]);
  });

  test("every filter reaches VERIDIAN, including ones this route does not know about", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-a", role: "manager", response: null };
    failWith = null;
    askedPaths.length = 0;

    await call("departmentId=dep-1&from=2026-08-01&to=2026-08-31");
    expect(askedPaths[0]).toContain("departmentId=dep-1");
    expect(askedPaths[0]).toContain("from=2026-08-01");
    expect(askedPaths[0]).toContain("to=2026-08-31");
  });

  test("the manager gate upstream keeps its own 403 -- it is not flattened into a 502", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-a", role: "member", response: null };
    failWith = { message: "This report requires manager role or higher", status: 403 };

    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("This report requires manager role or higher");
  });

  test("an unauthenticated caller never reaches VERIDIAN", async () => {
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    askedPaths.length = 0;
    const res = await call();
    expect(res.status).toBe(401);
    expect(askedPaths).toHaveLength(0);
  });
});
