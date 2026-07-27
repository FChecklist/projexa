/// <reference types="bun-types" />
// Proxies compareBoq on VERIDIAN, including the ?against=<boqId> query param
// that lets the ScopeClient compare any two revisions in a project, not
// just adjacent ones.
import { describe, expect, test, mock } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let lastPath: string | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string) => {
    lastPath = path;
    return { added: [], removed: [], changed: [], warnings: [], totalVariation: 0 };
  },
  VeridianApiError: class VeridianApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

const { GET } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "member", response: null };
}

describe("GET /api/scope/[id]/compare", () => {
  test("with no ?against= query param, forwards to VERIDIAN's compare endpoint with no query string (compares vs. immediate parent)", async () => {
    mockCtx = ctx();
    const res = await GET(new NextRequest("http://test/api/scope/boq-2/compare"), { params: Promise.resolve({ id: "boq-2" }) });
    expect(res.status).toBe(200);
    expect(lastPath).toBe("/scope/boq-2/compare");
  });

  test("with ?against=<boqId>, forwards it to VERIDIAN so any two revisions can be compared", async () => {
    mockCtx = ctx();
    const res = await GET(new NextRequest("http://test/api/scope/boq-3/compare?against=boq-0"), { params: Promise.resolve({ id: "boq-3" }) });
    expect(res.status).toBe(200);
    expect(lastPath).toBe("/scope/boq-3/compare?against=boq-0");
  });

  test("an unauthenticated caller never reaches VERIDIAN", async () => {
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await GET(new NextRequest("http://test/api/scope/boq-2/compare"), { params: Promise.resolve({ id: "boq-2" }) });
    expect(res.status).toBe(401);
  });
});
