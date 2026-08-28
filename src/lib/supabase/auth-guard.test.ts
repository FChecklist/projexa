/// <reference types="bun-types" />
// requireRole()/ROLE_GROUPS are pure functions over an already-resolved
// AuthContext -- per this repo's convention (see notification-service.test.ts),
// tested directly without a live Supabase session. This is the server-side
// enforcement PM/Site-Engineer route gating actually depends on: a
// site_engineer must be able to hit a progress-entry route (ROLE_GROUPS.FIELD)
// but be rejected from a budget-mutating route (ROLE_GROUPS.PM_OR_ABOVE),
// while a pm can hit both.
import { describe, expect, test, mock } from "bun:test";
import { requireRole, ROLE_GROUPS, type AuthContext } from "./auth-guard";

function ctxWithRole(role: string | null): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role, response: null };
}

describe("requireRole", () => {
  test("site_engineer is rejected from a PM_OR_ABOVE (budget-mutating) route", () => {
    const result = requireRole(ctxWithRole("site_engineer"), ROLE_GROUPS.PM_OR_ABOVE);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  test("site_engineer is allowed on a FIELD (progress-entry) route", () => {
    const result = requireRole(ctxWithRole("site_engineer"), ROLE_GROUPS.FIELD);
    expect(result).toBeNull();
  });

  test("pm is allowed on both a PM_OR_ABOVE route and a FIELD route", () => {
    expect(requireRole(ctxWithRole("pm"), ROLE_GROUPS.PM_OR_ABOVE)).toBeNull();
    expect(requireRole(ctxWithRole("pm"), ROLE_GROUPS.FIELD)).toBeNull();
  });

  test("client_viewer is rejected from both PM_OR_ABOVE and FIELD routes", () => {
    expect(requireRole(ctxWithRole("client_viewer"), ROLE_GROUPS.PM_OR_ABOVE)!.status).toBe(403);
    expect(requireRole(ctxWithRole("client_viewer"), ROLE_GROUPS.FIELD)!.status).toBe(403);
  });

  test("owner and admin are allowed on both role groups", () => {
    for (const role of ["owner", "admin"]) {
      expect(requireRole(ctxWithRole(role), ROLE_GROUPS.PM_OR_ABOVE)).toBeNull();
      expect(requireRole(ctxWithRole(role), ROLE_GROUPS.FIELD)).toBeNull();
    }
  });

  test("a null role (no resolved membership) is rejected from every gated route", () => {
    expect(requireRole(ctxWithRole(null), ROLE_GROUPS.PM_OR_ABOVE)!.status).toBe(403);
    expect(requireRole(ctxWithRole(null), ROLE_GROUPS.FIELD)!.status).toBe(403);
  });
})

// R43_EXEC_01 (Critical, closed as a false positive by R52/R56/R60 on
// platform.r43_faults -- see that row's justification). No code fix landed.
// requireAuth() itself had zero direct test coverage before this suite --
// every other test file that touches it mocks it away entirely (see
// company-scope.test.ts, the route.test.ts files, etc.). This is the FIRST
// hop of the whole chain R52/R56/R60 hand-verified by direct SQL query each
// time rather than a test: organizationId must come ONLY from the row in
// `memberships` filtered by `user_id = <the calling session's own,
// JWT-verified user id>` -- never from any other user's row, even when one
// exists for the same requested organization. If that scoping ever broke
// (e.g. a query that dropped the `.eq("user_id", ...)` filter, or picked
// the wrong id), a caller could resolve a DIFFERENT user's role/org pairing
// for their own session -- the actual cross-tenant risk this fault row was
// worried about, even though this row's own evidence didn't show a break.
describe("requireAuth: organizationId resolves only from the caller's OWN membership row (R43_EXEC_01 regression guard)", () => {
  function fakeSupabase(opts: {
    claims: { sub: string; email?: string } | null;
    membershipsByUserId: Record<string, { organization_id: string; role: string }>;
  }) {
    return {
      auth: {
        getClaims: async () =>
          opts.claims
            ? { data: { claims: opts.claims }, error: null }
            : { data: null, error: { message: "no session" } },
      },
      from: (table: string) => ({
        select: () => ({
          eq: (column: string, value: string) => ({
            limit: () => ({
              maybeSingle: async () => {
                if (table !== "memberships" || column !== "user_id") {
                  return { data: null, error: null };
                }
                // Only ever look up the row keyed by the EXACT value this
                // was called with -- proving the real code's own
                // `.eq("user_id", user.id)` filter, not a hand-substituted
                // stand-in, is what's under test.
                return { data: opts.membershipsByUserId[value] ?? null, error: null };
              },
            }),
          }),
        }),
      }),
    };
  }

  test("resolves organizationId/role from the authenticated user's own membership row", async () => {
    mock.module("./server", () => ({
      createClient: async () =>
        fakeSupabase({
          claims: { sub: "user-mine", email: "me@example.com" },
          membershipsByUserId: {
            "user-mine": { organization_id: "org-mine", role: "pm" },
            "user-other": { organization_id: "org-other", role: "owner" },
          },
        }),
    }));

    const { requireAuth } = await import("./auth-guard");
    const ctx = await requireAuth();

    expect(ctx.response).toBeNull();
    expect(ctx.user?.id).toBe("user-mine");
    expect(ctx.organizationId).toBe("org-mine");
    expect(ctx.role).toBe("pm");
    // Never the OTHER user's org/role, even though a row for them exists.
    expect(ctx.organizationId).not.toBe("org-other");
  });

  test("a different authenticated user resolves to their OWN org, not the first/other row in the table", async () => {
    mock.module("./server", () => ({
      createClient: async () =>
        fakeSupabase({
          claims: { sub: "user-other", email: "other@example.com" },
          membershipsByUserId: {
            "user-mine": { organization_id: "org-mine", role: "pm" },
            "user-other": { organization_id: "org-other", role: "owner" },
          },
        }),
    }));

    const { requireAuth } = await import("./auth-guard");
    const ctx = await requireAuth();

    expect(ctx.organizationId).toBe("org-other");
    expect(ctx.role).toBe("owner");
  });

  test("an authenticated user with no membership row at all gets no organizationId (never a stray/other org)", async () => {
    mock.module("./server", () => ({
      createClient: async () =>
        fakeSupabase({
          claims: { sub: "user-with-no-org", email: "orphan@example.com" },
          membershipsByUserId: {
            "user-mine": { organization_id: "org-mine", role: "pm" },
          },
        }),
    }));

    const { requireAuth } = await import("./auth-guard");
    const ctx = await requireAuth();

    expect(ctx.organizationId).toBeNull();
    expect(ctx.response?.status).toBe(400);
  });

  test("an unauthenticated caller (no claims) resolves no organizationId, regardless of what rows exist", async () => {
    mock.module("./server", () => ({
      createClient: async () =>
        fakeSupabase({
          claims: null,
          membershipsByUserId: { "user-mine": { organization_id: "org-mine", role: "pm" } },
        }),
    }));

    const { requireAuth } = await import("./auth-guard");
    const ctx = await requireAuth();

    expect(ctx.user).toBeNull();
    expect(ctx.organizationId).toBeNull();
    expect(ctx.response?.status).toBe(401);
  });
});
