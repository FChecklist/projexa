/// <reference types="bun-types" />
// BUILD-001 U-01c: the assistant proxy used to call VERIDIAN's /assistant with
// only `organizationId`. VERIDIAN shows construction budget, margin and cost
// figures only when the acting person's role is known and manager rank or
// above (compliance-tracker's resolveActingUser / resolveFinancialRole), and a
// shared per-org API key names no person -- so every PROJEXA assistant user
// was treated as unknown-role and got redacted figures. This file proves the
// forwarding half of the fix on both paths the route has: the rawInput
// pipeline and the codeReference dispatch. The mocked callVeridian records the
// options it receives, which is what veridian-client turns into the
// X-Acting-User / X-Acting-User-Email headers.
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let calls: Array<{ path: string; options: Record<string, unknown> }>;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "assistant_queries") throw new Error(`unexpected table: ${table}`);
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({ single: async () => ({ data: { id: "q1", ...row }, error: null }) }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            select: () => ({ single: async () => ({ data: { id: "q1", ...patch }, error: null }) }),
          }),
        }),
      };
    },
  }),
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string, options: Record<string, unknown>) => {
    calls.push({ path, options });
    return { codeReference: "get_construction_project_dashboard", result: { budget: 900000 } };
  },
  VeridianApiError: class VeridianApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

const { POST } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "karan.malhotra@example.com" }, organizationId: "org1", role: "member", response: null };
}

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/assistant", () => {
  beforeEach(() => {
    calls = [];
    mockCtx = ctx();
  });

  test("U-01c rawInput path: the signed-in person's id and email reach VERIDIAN as actingUserId / actingUserEmail", async () => {
    const res = await POST(post({ rawInput: "What is the budget for Cedar Heights?", mode: "ask" }));

    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/assistant");
    expect(calls[0].options.organizationId).toBe("org1");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.actingUserId).toBe("u1");
    expect(calls[0].options.actingUserEmail).toBe("karan.malhotra@example.com");
  });

  test("U-01c codeReference path: the signed-in person's id and email reach VERIDIAN as actingUserId / actingUserEmail", async () => {
    const res = await POST(post({ codeReference: "get_construction_project_dashboard", inputs: { projectId: "proj_cedar" } }));

    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/assistant");
    expect(calls[0].options.organizationId).toBe("org1");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.actingUserId).toBe("u1");
    expect(calls[0].options.actingUserEmail).toBe("karan.malhotra@example.com");
    expect(calls[0].options.body).toEqual({ codeReference: "get_construction_project_dashboard", inputs: { projectId: "proj_cedar" } });
  });

  test("a session with no email still forwards actingUserId alone, on both paths (actingUserEmail undefined, no crash)", async () => {
    mockCtx = { user: { id: "u2", email: null }, organizationId: "org1", role: "member", response: null };

    await POST(post({ rawInput: "status?" }));
    await POST(post({ codeReference: "list_delayed_activities", inputs: {} }));

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.options.actingUserId).toBe("u2");
      expect(call.options.actingUserEmail).toBeUndefined();
    }
  });

  test("an unauthenticated caller never reaches VERIDIAN", async () => {
    const { NextResponse } = await import("next/server");
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

    const res = await POST(post({ rawInput: "hello" }));

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
