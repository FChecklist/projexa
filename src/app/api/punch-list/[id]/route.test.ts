/// <reference types="bun-types" />
// PR #53 audit finding: this PATCH handler used to call callVeridian() with
// no requireRole() gate at all, while the sibling POST on
// src/app/api/punch-list/route.ts was correctly gated to ROLE_GROUPS.FIELD --
// meaning a read-only client_viewer (or anyone) could update/resolve punch
// list items even though they couldn't create one. Proves the fix: PATCH now
// enforces the same FIELD gate as its sibling POST.
import { describe, expect, test, mock } from "bun:test";
import { requireRole, ROLE_GROUPS, type AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
  requireRole,
  ROLE_GROUPS,
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async () => ({ id: "pl1", status: "resolved" }),
  VeridianApiError: class VeridianApiError extends Error {
    status = 502;
  },
}));

const { PATCH } = await import("./route");

function ctxWithRole(role: string | null): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role, response: null };
}

function patchRequest() {
  return new Request("http://test/api/punch-list/pl1", {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved" }),
  }) as unknown as import("next/server").NextRequest;
}

describe("PATCH /api/punch-list/[id]", () => {
  test("rejects a client_viewer caller with 403", async () => {
    mockCtx = ctxWithRole("client_viewer");
    const res = await PATCH(patchRequest(), { params: Promise.resolve({ id: "pl1" }) });
    expect(res.status).toBe(403);
  });

  test("accepts a site_engineer caller", async () => {
    mockCtx = ctxWithRole("site_engineer");
    const res = await PATCH(patchRequest(), { params: Promise.resolve({ id: "pl1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: "pl1", status: "resolved" });
  });

  test("rejects a plain member caller with 403 (consistent with sibling POST)", async () => {
    mockCtx = ctxWithRole("member");
    const res = await PATCH(patchRequest(), { params: Promise.resolve({ id: "pl1" }) });
    expect(res.status).toBe(403);
  });
});
