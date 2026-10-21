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
            // R81_F03: order() added between eq() and limit() -- the real
            // fetchMembership() now asks for created_at ASC (see auth-guard.ts)
            // so a multi-org user's row choice is deterministic. This
            // fixture only ever has one candidate row per test, so there is
            // nothing to actually sort -- it only has to exist in the chain
            // without throwing, same reasoning as the sibling fake in
            // auth-guard.test.ts.
            order: () => ({
              limit: () => ({
                maybeSingle: async () => membershipResult,
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

type AutoResult = { ok: true } | { ok: false; reason: "invite_pending" | "failed" };
let autoResult: AutoResult = { ok: false, reason: "invite_pending" };
let autoCalls = 0;
mock.module("@/lib/org/auto-provision", () => ({
  PROVISION_FAILED_MESSAGE: "We couldn't set up your workspace just now. Please try again.",
  PROVISION_FAILED_CODE: "ORG_PROVISION_FAILED",
  autoProvisionOrganization: async () => {
    autoCalls++;
    // A successful provision writes the membership row, so the re-read finds it.
    if (autoResult.ok) membershipResult = { data: { organization_id: "new-org", role: "owner" }, error: null };
    return autoResult;
  },
}));

const { requireAuth } = await import("./auth-guard");

afterEach(() => {
  fromCalls = [];
  autoCalls = 0;
  autoResult = { ok: false, reason: "invite_pending" };
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

  test("no membership row and a live invitation (so no auto-provisioning) -> organizationId is null and a 400 is returned, never a fabricated id", async () => {
    claimsResult = { data: { claims: { sub: "user-2", email: "orphan@example.com" } }, error: null };
    membershipResult = { data: null, error: null };
    const ctx = await requireAuth();
    expect(ctx.organizationId).toBeNull();
    expect(ctx.response).not.toBeNull();
    expect(ctx.response!.status).toBe(400);
    const body = await ctx.response!.json();
    expect(body.error).toBe("No organization");
  });

  test("no membership row -> the person is set up silently and carried on, not blocked with 'No organization'", async () => {
    claimsResult = { data: { claims: { sub: "user-3", email: "sumeetds@gmail.com" } }, error: null };
    membershipResult = { data: null, error: null };
    autoResult = { ok: true };
    const ctx = await requireAuth();
    expect(autoCalls).toBe(1);
    expect(ctx.response).toBeNull();
    expect(ctx.organizationId).toBe("new-org");
    expect(ctx.role).toBe("owner");
  });

  test("provisioning failure -> a plain 503 with a code, never 'No organization'", async () => {
    claimsResult = { data: { claims: { sub: "user-4", email: "a@b.com" } }, error: null };
    membershipResult = { data: null, error: null };
    autoResult = { ok: false, reason: "failed" };
    const ctx = await requireAuth();
    expect(ctx.response!.status).toBe(503);
    const body = await ctx.response!.json();
    expect(body.code).toBe("ORG_PROVISION_FAILED");
    expect(body.error).not.toMatch(/No organization/);
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
