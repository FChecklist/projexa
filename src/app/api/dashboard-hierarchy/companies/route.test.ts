/// <reference types="bun-types" />
// R67 E-37 follow-up. The three empty answers this route can give have to be
// REACHABLE, not merely representable.
//
// resolveHierarchyCompanies' own unit tests already prove the classification.
// What they cannot see is the route around it -- and the route was the problem:
// requireAuth() answers 400 "No organization" for a caller with no membership
// row, this handler returned that verbatim, the client's getJson() turns any
// !res.ok into null, and the screen therefore rendered "Couldn't load your
// companies" with a Retry that could never succeed. The item's own quoted
// sentence about asking an administrator was unreachable from the server.
//
// So these tests are about STATUS CODES and which branch answers, not about
// arithmetic.
import { describe, expect, test, mock } from "bun:test";
import { NextResponse } from "next/server";

type Ctx = { user: { id: string } | null; organizationId: string | null; role: string | null; response: NextResponse | null };
let mockCtx: Ctx;
let mockMemberships: { id: string; name: string; slug: string; country: string | null; role: string }[] = [];
let mockOrganisation: { id: string; name: string; slug: string; country: string | null } | null = null;
const organisationLookups: string[] = [];

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

// The pure resolver is deliberately NOT mocked -- these tests assert the route
// and the rule agree, which is the seam that broke.
const { resolveHierarchyCompanies } = await import("@/lib/company-scope");

mock.module("@/lib/company-scope", () => ({
  listUserCompanies: async () => mockMemberships,
  getOrganizationSummary: async (orgId: string) => {
    organisationLookups.push(orgId);
    return mockOrganisation;
  },
  resolveHierarchyCompanies,
}));

const { GET } = await import("./route");

describe("GET /api/dashboard-hierarchy/companies", () => {
  test("a caller with real memberships gets them, and no organisation lookup is made", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-a", role: "admin", response: null };
    mockMemberships = [{ id: "org-a", name: "PROJEXA UAE", slug: "projexa-uae", country: "AE", role: "admin" }];
    mockOrganisation = null;
    organisationLookups.length = 0;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.companies).toHaveLength(1);
    expect(body.companies[0].name).toBe("PROJEXA UAE");
    expect(body.synthesized).toBe(false);
    expect(body.emptyReason).toBe("none");
    // The happy path keeps its single query.
    expect(organisationLookups).toHaveLength(0);
  });

  test("a member-less caller gets a 200 carrying emptyReason 'not-a-member', NOT requireAuth's 400", async () => {
    // Exactly what auth-guard returns for a user with no memberships row.
    mockCtx = {
      user: { id: "u1" },
      organizationId: null,
      role: null,
      response: NextResponse.json({ error: "No organization" }, { status: 400 }),
    };
    mockMemberships = [];
    mockOrganisation = null;

    const res = await GET();
    // A 400 here is what made the screen say "Couldn't load your companies".
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.companies).toEqual([]);
    expect(body.synthesized).toBe(false);
    expect(body.emptyReason).toBe("not-a-member");
  });

  test("an orphaned membership -- an organisation id no row answers to -- reads 'no-company'", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-gone", role: "member", response: null };
    mockMemberships = [];
    mockOrganisation = null;
    organisationLookups.length = 0;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.emptyReason).toBe("no-company");
    expect(body.synthesized).toBe(false);
    expect(organisationLookups).toEqual(["org-gone"]);
  });

  test("when the two reads disagree, the organisation's real name is used rather than an empty screen", async () => {
    mockCtx = { user: { id: "u1" }, organizationId: "org-a", role: "manager", response: null };
    mockMemberships = [];
    mockOrganisation = { id: "org-a", name: "Skyline Builders", slug: "skyline", country: "AE" };

    const res = await GET();
    const body = await res.json();
    expect(body.synthesized).toBe(true);
    expect(body.companies).toHaveLength(1);
    // Real id (every level below scopes by it), real name, the caller's real role.
    expect(body.companies[0]).toMatchObject({ id: "org-a", name: "Skyline Builders", role: "manager" });
    expect(body.emptyReason).toBe("none");
  });

  test("a real failure is still a failure: 401 and 503 propagate untouched", async () => {
    mockMemberships = [];
    mockOrganisation = null;

    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    expect((await GET()).status).toBe(401);

    // "We could not ask" must never render as "you belong to nothing".
    mockCtx = {
      user: { id: "u1" },
      organizationId: null,
      role: null,
      response: NextResponse.json({ error: "Could not verify organization membership, please retry" }, { status: 503 }),
    };
    expect((await GET()).status).toBe(503);
  });
});
