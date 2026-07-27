/// <reference types="bun-types" />
// PR #53 audit finding: merging the new pm/site_engineer/client_viewer role
// model with no in-product way to assign those roles would 403-lock every
// existing 'member'-role user out of all 6 newly-gated routes, with only a
// manual Supabase edit as a way out. This is the recovery path: an
// owner/admin can reassign any member's role; nobody else can.
import { describe, expect, test, mock } from "bun:test";
import { requireRole, ROLE_GROUPS, ALL_ORG_ROLES, type AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let updateEqCalls: Array<{ column: string; value: string }> = [];
let mockUpdateResult: { data: unknown; error: { message: string } | null } = { data: { user_id: "target1", role: "pm" }, error: null };

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
  requireRole,
  ROLE_GROUPS,
  ALL_ORG_ROLES,
}));

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: () => ({
        eq: (column: string, value: string) => {
          updateEqCalls.push({ column, value });
          return {
            eq: (column2: string, value2: string) => {
              updateEqCalls.push({ column: column2, value: value2 });
              return {
                select: () => ({
                  maybeSingle: async () => mockUpdateResult,
                }),
              };
            },
          };
        },
      }),
    }),
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
    const res = await PATCH(patchRequest({ role: "superuser" }), { params: Promise.resolve({ id: "target1" }) });
    expect(res.status).toBe(400);
  });
});
