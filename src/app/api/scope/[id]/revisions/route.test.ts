/// <reference types="bun-types" />
// Proxies createBoqRevision on VERIDIAN. The one behavior worth locking down
// here (the rest is VERIDIAN's own service-layer responsibility, tested
// there): a 409 from VERIDIAN's scope-reduction guard must reach the caller
// as a real 409 with VERIDIAN's own message, not get flattened into a
// generic 502 -- that message is what the ScopeClient revision dialog
// surfaces so a user can choose to override.
import { describe, expect, test, mock } from "bun:test";
import { NextResponse } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let lastCall: { path: string; options: unknown } | null = null;
let mockResult: unknown = { id: "boq-2", version: 2 };
let mockError: { message: string; status: number } | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

class MockVeridianApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string, options: unknown) => {
    lastCall = { path, options };
    if (mockError) throw new MockVeridianApiError(mockError.message, mockError.status);
    return mockResult;
  },
  VeridianApiError: MockVeridianApiError,
}));

const { POST } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "member", response: null };
}

function request(body: unknown) {
  return new Request("http://test/api/scope/boq-1/revisions", {
    method: "POST", body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("POST /api/scope/[id]/revisions", () => {
  test("forwards the body to VERIDIAN's /scope/[id]/revisions and returns 201 on success", async () => {
    mockCtx = ctx();
    mockError = null;
    mockResult = { id: "boq-2", version: 2 };
    const res = await POST(request({ title: "Rev 1", lineItems: [] }), { params: Promise.resolve({ id: "boq-1" }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "boq-2", version: 2 });
    expect(lastCall?.path).toBe("/scope/boq-1/revisions");
    expect((lastCall?.options as { method: string }).method).toBe("POST");
  });

  test("a 409 scope-reduction block from VERIDIAN reaches the caller as a real 409 with the original message", async () => {
    mockCtx = ctx();
    mockError = { message: "Scope reduction blocked -- already 40% complete", status: 409 };
    const res = await POST(request({ title: "Rev 1", lineItems: [] }), { params: Promise.resolve({ id: "boq-1" }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Scope reduction blocked -- already 40% complete");
  });

  test("an unauthenticated caller never reaches VERIDIAN", async () => {
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await POST(request({ title: "x", lineItems: [] }), { params: Promise.resolve({ id: "boq-1" }) });
    expect(res.status).toBe(401);
  });
});
