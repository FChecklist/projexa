/// <reference types="bun-types" />
// PR #53 audit finding: merging the new pm/site_engineer/client_viewer role
// model with no in-product way to assign those roles would 403-lock every
// existing 'member'-role user out of all 6 newly-gated routes, with only a
// manual Supabase edit as a way out. This is the recovery path: an
// owner/admin can reassign any member's role; nobody else can.
//
// Second audit-fix round: that recovery path itself had no guard against
// demoting an org's last remaining owner/admin, which would strand the org
// with zero owners/admins and no in-product way back -- the same lockout
// class this whole feature exists to close, just relocated to this route.
import { describe, expect, test, mock } from "bun:test";
import { requireRole, ROLE_GROUPS, ALL_ORG_ROLES, type AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let updateEqCalls: Array<{ column: string; value: string }> = [];
let mockUpdateResult: { data: unknown; error: { message: string } | null } = { data: { user_id: "target1", role: "pm" }, error: null };
// Current stored role of the target membership (the row PATCH is about to change).
let mockTargetResult: { data: { role: string } | null; error: { message: string } | null } = { data: { role: "member" }, error: null };
// Count of OTHER owner/admin memberships in the org (i.e. excluding the target row).
let mockOtherAdminCount: { count: number | null; error: { message: string } | null } = { count: 1, error: null };

type Mode = "select-role" | "select-count" | "update" | null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
  requireRole,
  ROLE_GROUPS,
  ALL_ORG_ROLES,
}));

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      let mode: Mode = null;
      const chain: Record<string, unknown> = {
        select: (_cols: string, opts?: { count?: string }) => {
          // A trailing .select() after .update() (to shape the return value)
          // must not clobber "update" mode back to a select-only mode.
          if (mode !== "update") mode = opts?.count ? "select-count" : "select-role";
          return chain;
        },
        update: () => {
          mode = "update";
          return chain;
        },
        eq: (column: string, value: string) => {
          if (mode === "update") updateEqCalls.push({ column, value });
          return chain;
        },
        neq: () => chain,
        in: () => chain,
        maybeSingle: async () => (mode === "update" ? mockUpdateResult : mockTargetResult),
        then: (resolve: (v: unknown) => void) => resolve(mockOtherAdminCount),
      };
      return chain;
    },
  }),
}));

const { PATCH } = await import("./route");

function ctxWithRole(role: string | null): AuthContext {
  return { user: { id: "caller1", email: "caller1@example.com" }, organizationId: "org1", role, response: null };
}

function patchRequest(body: unknown) {
  return new Request("http://test/api/org-members/target1", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("PATCH /api/org-members/[id]", () => {
  test("owner can reassign another member's role", async () => {
    mockCtx = ctxWithRole("owner");
    updateEqCalls = [];
    mockTargetResult = { data: { role: "member" }, error: null };
    mockUpdateResult = { data: { user_id: "target1", role: "pm" }, error: null };
    const res = await PATCH(patchRequest({ role: "pm" }), { params: Promise.resolve({ id: "target1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.member).toEqual({ user_id: "target1", role: "pm" });
    expect(updateEqCalls).toEqual([
      { column: "organization_id", value: "org1" },
      { column: "user_id", value: "target1" },
    ]);
  });

  test("admin can reassign another member's role", async () => {
    mockCtx = ctxWithRole("admin");
    mockTargetResult = { data: { role: "member" }, error: null };
    mockUpdateResult = { data: { user_id: "target1", role: "site_engineer" }, error: null };
    const res = await PATCH(patchRequest({ role: "site_engineer" }), { params: Promise.resolve({ id: "target1" }) });
    expect(res.status).toBe(200);
  });

  test("a plain member cannot reassign roles", async () => {
    mockCtx = ctxWithRole("member");
    const res = await PATCH(patchRequest({ role: "pm" }), { params: Promise.resolve({ id: "target1" }) });
    expect(res.status).toBe(403);
  });

  test("a site_engineer cannot reassign roles", async () => {
    mockCtx = ctxWithRole("site_engineer");
    const res = await PATCH(patchRequest({ role: "pm" }), { params: Promise.resolve({ id: "target1" }) });
    expect(res.status).toBe(403);
  });

  test("rejects an invalid role value with 400", async () => {
    mockCtx = ctxWithRole("owner");
    mockTargetResult = { data: { role: "member" }, error: null };
    const res = await PATCH(patchRequest({ role: "superuser" }), { params: Promise.resolve({ id: "target1" }) });
    expect(res.status).toBe(400);
  });

  describe("last-owner/admin guard", () => {
    test("cannot demote the org's sole owner/admin to a lower role", async () => {
      mockCtx = ctxWithRole("owner");
      mockTargetResult = { data: { role: "owner" }, error: null };
      mockOtherAdminCount = { count: 0, error: null }; // no OTHER owner/admin left
      const res = await PATCH(patchRequest({ role: "member" }), { params: Promise.resolve({ id: "target1" }) });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toMatch(/at least one owner or admin/i);
    });

    test("cannot remove the org's sole admin down to client_viewer", async () => {
      mockCtx = ctxWithRole("owner");
      mockTargetResult = { data: { role: "admin" }, error: null };
      mockOtherAdminCount = { count: 0, error: null };
      const res = await PATCH(patchRequest({ role: "client_viewer" }), { params: Promise.resolve({ id: "target1" }) });
      expect(res.status).toBe(409);
    });

    test("CAN demote one of several owners/admins -- guard only blocks the last-one-out case", async () => {
      mockCtx = ctxWithRole("owner");
      updateEqCalls = [];
      mockTargetResult = { data: { role: "admin" }, error: null };
      mockOtherAdminCount = { count: 1, error: null }; // another owner/admin remains
      mockUpdateResult = { data: { user_id: "target1", role: "member" }, error: null };
      const res = await PATCH(patchRequest({ role: "member" }), { params: Promise.resolve({ id: "target1" }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.member).toEqual({ user_id: "target1", role: "member" });
    });

    test("reassigning between owner and admin (still admin-group) is never blocked, even as the sole one", async () => {
      mockCtx = ctxWithRole("owner");
      mockTargetResult = { data: { role: "owner" }, error: null };
      mockOtherAdminCount = { count: 0, error: null };
      mockUpdateResult = { data: { user_id: "target1", role: "admin" }, error: null };
      const res = await PATCH(patchRequest({ role: "admin" }), { params: Promise.resolve({ id: "target1" }) });
      expect(res.status).toBe(200);
    });

    test("does not guard a non-owner/admin member being reassigned to another non-owner/admin role", async () => {
      mockCtx = ctxWithRole("owner");
      mockTargetResult = { data: { role: "site_engineer" }, error: null };
      mockOtherAdminCount = { count: 0, error: null }; // irrelevant here, should never even be checked meaningfully
      mockUpdateResult = { data: { user_id: "target1", role: "pm" }, error: null };
      const res = await PATCH(patchRequest({ role: "pm" }), { params: Promise.resolve({ id: "target1" }) });
      expect(res.status).toBe(200);
    });
  });
});
