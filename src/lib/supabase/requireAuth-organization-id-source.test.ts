/// <reference types="bun-types" />
// R62 B7 regression test for F_024 (Critical), requireAuth() half. See
// src/app/api/organization/route.test.ts for the route-level half.
//
// THE RECORDED (and disproven) CLAIM was that a session with no linked
// profile row gets handed a phantom organizationId that resolves to
// nothing. R56/R60 traced requireAuth()'s actual organizationId resolution
// and found exactly one source: the `memberships` table, in PROJEXA's own
// Supabase project -- never `compliance.users` (a different application's
// database entirely), and never any fabricated/default value.
//
// WHAT THIS GUARDS: that ctx.organizationId can only ever be (a) exactly
// what a real memberships row says, or (b) null with a 400 "No organization"
// -- never anything invented in between. If someone reintroduces a fallback
// that hands out an organizationId when no membership row exists, this
// fails.
import { afterEach, describe, expect, test, mock } from "bun:test";

let claimsResult: { data: { claims: { sub: string; email?: string } } | null; error: { message: string } | null };
let membershipResult: { data: { organization_id: string; role: string } | null; error: { message: string } | null };
let fromCalls: string[] = [];

mock.module("./server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => claimsResult },
    from: (table: string) => {
      fromCalls.push(table);
      // requireAuth() must resolve organizationId from `memberships` alone.
      // Any other table name here would mean a second, undocumented
      // resolution path was reintroduced -- exactly the "phantom org"
      // shape the original (disproven) fault described.
      if (table !== "memberships") throw new Error(`requireAuth queried an unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: async () => membershipResult,
            }),
          }),
        }),
      };
    },
  }),
}));

const { requireAuth } = await import("./auth-guard");

afterEach(() => {
  fromCalls = [];
});

describe("requireAuth() organizationId resolution (F_024)", () => {
  test("a real membership row is the ONLY source of organizationId -- it is passed through verbatim, never altered or invented", async () => {
    claimsResult = { data: { claims: { sub: "user-1", email: "ceo@example.com" } }, error: null };
    membershipResult = { data: { organization_id: "real-org-1", role: "owner" }, error: null };
    const ctx = await requireAuth();
    expect(ctx.organizationId).toBe("real-org-1");
    expect(ctx.role).toBe("owner");
    expect(ctx.response).toBeNull();
    // Only ever queried `memberships` to get there -- no fallback table.
    expect(fromCalls).toEqual(["memberships"]);
  });

  test("no membership row -> organizationId is null and a 400 is returned, never a fabricated id", async () => {
    claimsResult = { data: { claims: { sub: "user-2", email: "orphan@example.com" } }, error: null };
    membershipResult = { data: null, error: null };
    const ctx = await requireAuth();
    expect(ctx.organizationId).toBeNull();
    expect(ctx.response).not.toBeNull();
    expect(ctx.response!.status).toBe(400);
    const body = await ctx.response!.json();
    expect(body.error).toBe("No organization");
  });

  test("an unauthenticated caller never gets an organizationId at all", async () => {
    claimsResult = { data: null, error: { message: "invalid token" } };
    membershipResult = { data: null, error: null };
    const ctx = await requireAuth();
    expect(ctx.organizationId).toBeNull();
    expect(ctx.response!.status).toBe(401);
    // Unauthenticated must short-circuit before ever touching memberships.
    expect(fromCalls).toEqual([]);
  });
});
