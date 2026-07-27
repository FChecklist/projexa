/// <reference types="bun-types" />
// Proves the Company -> Department -> Project drill-down's actual data
// scoping: picking a different Company (companyId) must hit VERIDIAN with
// that company's own organizationId (and therefore its own VERIDIAN API
// key -- see veridian-client.ts's resolveApiKey()), never another
// company's, and picking a Department must filter the project list to
// just that department.
import { describe, expect, test, mock } from "bun:test";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type Scope = { userId: string | null; companyId: string | null; role: string | null; response: NextResponse | null };
let mockScope: Scope;
let lastOrganizationId: string | null = null;
let lastPath: string | null = null;

// Per-company canned VERIDIAN datasets -- proves scoping isn't just
// "the code compiles", but that org-a's request really only ever sees
// org-a's projects, org-b's only ever sees org-b's.
const DASHBOARDS_BY_ORG: Record<string, unknown> = {
  "org-a": { totalProjects: 1, totalBudget: 100, totalRevenue: 50, totalExpenses: 20, projects: [{ id: "p-a1", name: "UAE Villa", revenue: 50, expenses: 20, taskCount: 3, delayedTaskCount: 0 }] },
  "org-b": { totalProjects: 1, totalBudget: 200, totalRevenue: 90, totalExpenses: 40, projects: [{ id: "p-b1", name: "India Tower", revenue: 90, expenses: 40, taskCount: 5, delayedTaskCount: 1 }] },
};

mock.module("@/lib/company-scope", () => ({
  requireCompanyScope: async (companyId: string | null) => mockScope,
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string, options: { organizationId: string }) => {
    lastPath = path;
    lastOrganizationId = options.organizationId;
    return DASHBOARDS_BY_ORG[options.organizationId];
  },
  VeridianApiError: class VeridianApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

const { GET } = await import("./route");

function scopedTo(companyId: string): Scope {
  return { userId: "user-1", companyId, role: "member", response: null };
}

describe("GET /api/dashboard-hierarchy/companies/[companyId]/dashboard", () => {
  test("Company A's request is scoped to Company A's own VERIDIAN org and returns only Company A's projects", async () => {
    mockScope = scopedTo("org-a");
    const res = await GET(new NextRequest("http://test/x"), { params: Promise.resolve({ companyId: "org-a" }) });
    const body = await res.json();
    expect(lastOrganizationId).toBe("org-a");
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].id).toBe("p-a1");
    expect(body.projects.some((p: { id: string }) => p.id === "p-b1")).toBe(false);
  });

  test("Company B's request is scoped independently and never returns Company A's projects", async () => {
    mockScope = scopedTo("org-b");
    const res = await GET(new NextRequest("http://test/x"), { params: Promise.resolve({ companyId: "org-b" }) });
    const body = await res.json();
    expect(lastOrganizationId).toBe("org-b");
    expect(body.projects[0].id).toBe("p-b1");
    expect(body.projects.some((p: { id: string }) => p.id === "p-a1")).toBe(false);
  });

  test("a departmentId query param is forwarded to VERIDIAN's own department filter (the Department level)", async () => {
    mockScope = scopedTo("org-a");
    await GET(new NextRequest("http://test/x?departmentId=dept-eng"), { params: Promise.resolve({ companyId: "org-a" }) });
    expect(lastPath).toBe("/dashboard?departmentId=dept-eng");
  });

  test("no departmentId means no department filter is applied", async () => {
    mockScope = scopedTo("org-a");
    await GET(new NextRequest("http://test/x"), { params: Promise.resolve({ companyId: "org-a" }) });
    expect(lastPath).toBe("/dashboard");
  });

  test("a caller with no real membership in the requested company never reaches VERIDIAN", async () => {
    mockScope = { userId: null, companyId: null, role: null, response: NextResponse.json({ error: "Not a member of this company" }, { status: 403 }) };
    lastOrganizationId = null;
    const res = await GET(new NextRequest("http://test/x"), { params: Promise.resolve({ companyId: "org-not-mine" }) });
    expect(res.status).toBe(403);
    expect(lastOrganizationId).toBeNull();
  });
});
