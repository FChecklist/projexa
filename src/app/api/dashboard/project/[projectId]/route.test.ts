/// <reference types="bun-types" />
// R-50 REOPENED (platform.sumeet_requirements): live-confirmed gap. This
// route used to call VERIDIAN's /dashboard/[projectId] with only
// `organizationId` -- no actingUserId/actingUserEmail -- so VERIDIAN's
// financial-visibility gate (compliance-tracker's
// src/app/api/v1/projexa/dashboard/[projectId]/route.ts) had no real
// internal role to resolve for this shared-per-org-API-key caller. The real
// fix lives on VERIDIAN's side (its `ctx.dbUser && !hasRole(...)` check
// never fired for an API-key caller, so it never redacted for ANY role,
// including client_viewer) -- but that fix only produces a correct answer
// for a real manager/CEO if THIS proxy forwards who is actually asking, the
// same way /api/scope/[id]/route.ts already does for the BOQ dual-view read
// path. This test proves the forwarding half of the fix.
import { describe, expect, test, mock } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let lastPath: string | null = null;
let lastOptions: Record<string, unknown> | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string, options: Record<string, unknown>) => {
    lastPath = path;
    lastOptions = options;
    return { projectId: "proj_cedar", projectName: "Cedar Heights Villa - Phase 1", budget: 900000, revenue: 450000 };
  },
  VeridianApiError: class VeridianApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

const { GET } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "karan.malhotra@example.com" }, organizationId: "org1", role: "member", response: null };
}

describe("GET /api/dashboard/project/[projectId]", () => {
  test("R-50: forwards the real logged-in user's id AND email as actingUserId/actingUserEmail, so VERIDIAN's financial-visibility gate has a real role to resolve for this shared-API-key caller", async () => {
    mockCtx = ctx();
    const res = await GET(new NextRequest("http://test/api/dashboard/project/proj_cedar"), { params: Promise.resolve({ projectId: "proj_cedar" }) });

    expect(res.status).toBe(200);
    expect(lastPath).toBe("/dashboard/proj_cedar");
    expect(lastOptions?.organizationId).toBe("org1");
    expect(lastOptions?.actingUserId).toBe("u1");
    expect(lastOptions?.actingUserEmail).toBe("karan.malhotra@example.com");
  });

  test("a caller with no email on their session still forwards actingUserId alone (undefined, not a crash, for actingUserEmail)", async () => {
    mockCtx = { user: { id: "u2", email: null }, organizationId: "org1", role: "member", response: null };
    await GET(new NextRequest("http://test/api/dashboard/project/proj_cedar"), { params: Promise.resolve({ projectId: "proj_cedar" }) });

    expect(lastOptions?.actingUserId).toBe("u2");
    expect(lastOptions?.actingUserEmail).toBeUndefined();
  });

  test("an unauthenticated caller never reaches VERIDIAN", async () => {
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await GET(new NextRequest("http://test/api/dashboard/project/proj_cedar"), { params: Promise.resolve({ projectId: "proj_cedar" }) });
    expect(res.status).toBe(401);
  });
});
