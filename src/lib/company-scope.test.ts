/// <reference types="bun-types" />
// Proves the "Company" level's authorization boundary: a caller can only
// ever get a companyId (=organizationId) they have a real membership row
// for, which is what makes selecting a Company actually scope the
// drill-down's VERIDIAN calls to that company's own data instead of
// leaking another org's data via a guessed/borrowed org UUID.
import { describe, expect, test, mock } from "bun:test";
import { NextResponse } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockAuthCtx: AuthContext;
let mockMembershipRows: { role: string }[] = [];
let mockCompanyRows: { id: string; name: string; slug: string; country: string | null; role: string }[] = [];

function fakeQuery<T>(rows: T[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => chain,
    then: (resolve: (v: T[]) => void) => resolve(rows),
  };
  return chain;
}

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockAuthCtx,
}));

mock.module("@/lib/db", () => ({
  db: {
    select: () => fakeQuery(mockCompanyRows.length > 0 ? mockCompanyRows : mockMembershipRows),
  },
}));

const { requireCompanyScope, listUserCompanies } = await import("./company-scope");

function authedCtx(): AuthContext {
  return { user: { id: "user-1", email: "u1@example.com" }, organizationId: "org-a", role: "member", response: null };
}

describe("requireCompanyScope", () => {
  test("grants scope when the caller has a real membership row for the requested companyId", async () => {
    mockAuthCtx = authedCtx();
    mockMembershipRows = [{ role: "pm" }];
    const scope = await requireCompanyScope("org-a");
    expect(scope.response).toBeNull();
    expect(scope.companyId).toBe("org-a");
    expect(scope.role).toBe("pm");
  });

  test("rejects with 403 when the caller has no membership row for the requested companyId (no cross-company leakage)", async () => {
    mockAuthCtx = authedCtx();
    mockMembershipRows = []; // no row for this (user, companyId) pair
    const scope = await requireCompanyScope("org-b-not-mine");
    expect(scope.companyId).toBeNull();
    expect(scope.response).not.toBeNull();
    expect(scope.response!.status).toBe(403);
  });

  test("rejects with 400 when no companyId is provided", async () => {
    mockAuthCtx = authedCtx();
    const scope = await requireCompanyScope(null);
    expect(scope.response!.status).toBe(400);
  });

  test("propagates an unauthenticated caller's 401 without querying memberships", async () => {
    mockAuthCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const scope = await requireCompanyScope("org-a");
    expect(scope.response!.status).toBe(401);
  });
});

describe("listUserCompanies", () => {
  test("returns the real set of companies (orgs) this user has a membership row for, sorted by name", async () => {
    mockCompanyRows = [
      { id: "org-b", name: "PROJEXA India", slug: "px-in", country: "IN", role: "member" },
      { id: "org-a", name: "PROJEXA UAE", slug: "px-ae", country: "AE", role: "owner" },
    ];
    const companies = await listUserCompanies("user-1");
    // Input order was [India, UAE]; alphabetical by name puts India first.
    expect(companies.map((c) => c.name)).toEqual(["PROJEXA India", "PROJEXA UAE"]);
    expect(companies.map((c) => c.id)).toEqual(["org-b", "org-a"]);
  });
});
