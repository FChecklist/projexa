/// <reference types="bun-types" />
// R67 E-37 (R-269 / R-298). The Company -> Department -> Project drill-down
// starts at a company, and R-269's finding was that it dead-ended before the
// first level: the page said "No company memberships found for this account."
// and there was nothing below it.
//
// resolveHierarchyCompanies is the decision that fixes it, and it is pure on
// purpose -- the two reads (memberships, organisation) stay in the route, so
// the branching, which is the part with a wrong answer in each direction, is
// testable without a database.
import { describe, expect, test } from "bun:test";
import { resolveHierarchyCompanies, type CompanyMembership, type OrganizationSummary } from "./company-scope";

const MEMBERSHIP: CompanyMembership = {
  id: "org_demo",
  name: "Demo Organization",
  slug: "demo",
  country: "AE",
  role: "owner",
};

const ORGANISATION: OrganizationSummary = {
  id: "org_demo",
  name: "Demo Organization",
  slug: "demo",
  country: "AE",
};

describe("resolveHierarchyCompanies", () => {
  test("a real membership always wins -- nothing is synthesised over it", () => {
    const result = resolveHierarchyCompanies([MEMBERSHIP], ORGANISATION, "org_demo", "owner");
    expect(result.companies).toEqual([MEMBERSHIP]);
    expect(result.synthesized).toBe(false);
    expect(result.emptyReason).toBe("none");
  });

  test("no membership but a real organisation: ONE company synthesised from it, so the hierarchy has a root", () => {
    const result = resolveHierarchyCompanies([], ORGANISATION, "org_demo", "admin");
    expect(result.synthesized).toBe(true);
    expect(result.emptyReason).toBe("none");
    expect(result.companies).toHaveLength(1);
    // Named after the ORGANISATION, and carrying its own id -- the id is what
    // every level below (departments, projects, the category charts) scopes
    // by, so a made-up id would produce a company that loads nothing.
    expect(result.companies[0].id).toBe("org_demo");
    expect(result.companies[0].name).toBe("Demo Organization");
    // The caller's real role, not an invented one.
    expect(result.companies[0].role).toBe("admin");
  });

  test("an organisation id that no row answers to is 'not set up as a company yet', not 'not a member'", () => {
    // Reachable through an orphaned membership: listUserCompanies INNER JOINs
    // organizations, so a membership whose organisation row is gone returns
    // nothing at all -- which is how this screen dead-ended in the first place.
    const result = resolveHierarchyCompanies([], null, "org_gone", "owner");
    expect(result.companies).toEqual([]);
    expect(result.synthesized).toBe(false);
    expect(result.emptyReason).toBe("no-company");
  });

  test("no organisation at all is 'not a member' -- a different fact, with a different fix", () => {
    const result = resolveHierarchyCompanies([], null, null, null);
    expect(result.emptyReason).toBe("not-a-member");
    expect(result.companies).toEqual([]);
  });

  test("a synthesised company defaults to 'member' when the caller has no role on file", () => {
    const result = resolveHierarchyCompanies([], ORGANISATION, "org_demo", null);
    expect(result.companies[0].role).toBe("member");
  });
});
