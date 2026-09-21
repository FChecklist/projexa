/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";
import { NextResponse } from "next/server";

let mockCtx: AuthContext;
let setCall: { organizationId: string; userId: string; projectId: string | null } | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/services/project-preference-service", () => ({
  setLastProjectId: async (organizationId: string, userId: string, projectId: string | null) => {
    setCall = { organizationId, userId, projectId };
  },
}));

const { PATCH } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "member", response: null };
}

function req(body: unknown) {
  return { json: async () => body } as never;
}

describe("PATCH /api/user-preference/last-project", () => {
  test("persists the given projectId for the caller's own org and user", async () => {
    setCall = null;
    mockCtx = ctx();
    const res = await PATCH(req({ projectId: "p1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(setCall).toEqual({ organizationId: "org1", userId: "u1", projectId: "p1" });
  });

  test("null clears the stored preference -- a valid, distinct request, not an error", async () => {
    setCall = null;
    mockCtx = ctx();
    const res = await PATCH(req({ projectId: null }));
    expect(res.status).toBe(200);
    expect(setCall).toEqual({ organizationId: "org1", userId: "u1", projectId: null });
  });

  test("an unauthenticated caller never reaches the write", async () => {
    setCall = null;
    mockCtx = {
      user: null,
      organizationId: null,
      role: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
    const res = await PATCH(req({ projectId: "p1" }));
    expect(res.status).toBe(401);
    expect(setCall).toBeNull();
  });

  test("a malformed body (not a string or null) is rejected before any write", async () => {
    setCall = null;
    mockCtx = ctx();
    const res = await PATCH(req({ projectId: 42 }));
    expect(res.status).toBe(400);
    expect(setCall).toBeNull();
  });
});
