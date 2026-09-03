/// <reference types="bun-types" />
// R67 F-08 (R-112) -- sibling test for budget-lookups.ts.
//
// The behaviour that matters here is the one distinction the old client-side
// version could not make: an EMPTY list and a FAILED lookup are different
// facts. /budgets/new used to render "No fiscal years found in VERIDIAN"
// whichever it was, so a transient 502 was shown to the user as a
// configuration problem they were expected to go and fix.
//
// @/lib/veridian-client is mocked at the createCachedVeridianGet seam. That is
// deliberately where the boundary is drawn: the real client resolves a per-org
// bearer token out of the database (AR-04 -- an org-scoped call may never fall
// back to the shared key), and unstable_cache throws an invariant outside a
// Next request scope, so exercising either here would be testing Next and the
// database rather than this module's own failure posture and TTL.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

class FakeVeridianApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const registrations: { cacheKey: string; path: string; ttl: number }[] = [];
let requestedPaths: string[] = [];
let respond: (path: string) => Promise<unknown> = async () => ({});

mock.module("@/lib/veridian-client", () => ({
  VeridianApiError: FakeVeridianApiError,
  createCachedVeridianGet: (cacheKey: string, path: string, ttl: number) => {
    registrations.push({ cacheKey, path, ttl });
    return async (_organizationId: string) => {
      requestedPaths.push(path);
      return respond(path);
    };
  },
}));

const { resolveBudgetLookups, resolveBudgetCompanies, EMPTY_BUDGET_LOOKUPS, BUDGET_LOOKUPS_TTL_SECONDS } =
  await import("./budget-lookups");

const OK = async (path: string): Promise<unknown> => {
  if (path === "/fiscal-years") return { fiscalYears: [{ id: "fy1", yearName: "FY 2026", startDate: "2026-01-01", endDate: "2026-12-31", isClosed: false }] };
  if (path === "/cost-centers") return { costCenters: [{ id: "cc1", name: "Site", projectId: null }] };
  if (path === "/accounts") return { accounts: [{ id: "a1", accountName: "Direct Costs", accountNumber: "5000" }] };
  if (path === "/companies") return { companies: [] };
  return {};
};

beforeEach(() => {
  requestedPaths = [];
  respond = OK;
});

afterEach(() => {
  respond = OK;
});

describe("resolveBudgetLookups", () => {
  test("issues the four lookups and returns them with no error", async () => {
    const lookups = await resolveBudgetLookups("org-1");

    expect(requestedPaths.sort()).toEqual(["/accounts", "/companies", "/cost-centers", "/fiscal-years"]);
    expect(lookups.fiscalYears.map((f) => f.yearName)).toEqual(["FY 2026"]);
    expect(lookups.costCenters).toHaveLength(1);
    expect(lookups.accounts).toHaveLength(1);
    expect(lookups.errorMessage).toBeNull();
  });

  test("an org that genuinely has no fiscal years gets empty lists and NO error message", async () => {
    respond = async (path) => (path === "/fiscal-years" ? { fiscalYears: [] } : OK(path));

    const lookups = await resolveBudgetLookups("org-1");

    expect(lookups.fiscalYears).toEqual([]);
    // The distinction the old client-side version could not make: nothing
    // failed, so there is nothing to retry -- this is a setup task.
    expect(lookups.errorMessage).toBeNull();
  });

  test("a failed lookup names what failed, in the backend's own words, and still returns the ones that worked", async () => {
    respond = async (path) => {
      if (path === "/fiscal-years") throw new FakeVeridianApiError("VERIDIAN did not respond in time", 504);
      return OK(path);
    };

    const lookups = await resolveBudgetLookups("org-1");

    expect(lookups.fiscalYears).toEqual([]);
    expect(lookups.errorMessage).toContain("fiscal years");
    expect(lookups.errorMessage).toContain("VERIDIAN did not respond in time");
    // The three that answered are still usable.
    expect(lookups.accounts).toHaveLength(1);
  });

  test("every lookup failing is still four named reasons, never a thrown error", async () => {
    respond = async () => {
      throw new FakeVeridianApiError("upstream down", 502);
    };

    const lookups = await resolveBudgetLookups("org-1");

    expect(lookups.errorMessage).toContain("fiscal years");
    expect(lookups.errorMessage).toContain("cost centres");
    expect(lookups.errorMessage).toContain("the chart of accounts");
    expect(lookups.errorMessage).toContain("companies");
  });

  test("no organisation resolved yet means no request at all", async () => {
    expect(await resolveBudgetLookups(null)).toEqual(EMPTY_BUDGET_LOOKUPS);
    expect(requestedPaths).toHaveLength(0);
  });

  test("all four cached getters share the 300 s reference-data TTL and are created once at module scope", () => {
    expect(registrations).toHaveLength(4);
    for (const registration of registrations) {
      expect(registration.ttl).toBe(BUDGET_LOOKUPS_TTL_SECONDS);
    }
    expect(registrations.map((r) => r.path)).toEqual(["/fiscal-years", "/cost-centers", "/accounts", "/companies"]);
  });
});

describe("resolveBudgetCompanies", () => {
  test("returns the list for the Budgets list filter", async () => {
    respond = async (path) => (path === "/companies" ? { companies: [{ id: "c1", companyName: "Skyline" }] } : OK(path));

    expect(await resolveBudgetCompanies("org-1")).toHaveLength(1);
  });

  test("a failure is an empty filter, never a broken budgets list", async () => {
    respond = async () => {
      throw new FakeVeridianApiError("upstream down", 502);
    };

    expect(await resolveBudgetCompanies("org-1")).toEqual([]);
  });
});
