/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-10. The proxy of VERIDIAN's /projects/{id}/approvals: the list, the approve action, and that only the two fields
// VERIDIAN reads are relayed. VERIDIAN is a fake; the route and the shared error classifier are the real ones.
import { describe, expect, test, mock } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let calls: Array<{ path: string; options: Record<string, unknown> }> = [];
let answer: unknown = {};
let failure: MockVeridianApiError | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({ requireAuth: async () => mockCtx }));

class MockVeridianApiError extends Error {
  status: number;
  code: string | null = null;
  durationMs = 0;
  ruleCode?: string;
  body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string, options: Record<string, unknown>) => {
    calls.push({ path, options });
    if (failure) throw failure;
    return answer;
  },
  VeridianApiError: MockVeridianApiError,
}));

const { GET, POST } = await import("./route");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const reset = () => {
  mockCtx = { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "pm", response: null } as AuthContext;
  calls = [];
  answer = {};
  failure = null;
};
function post(body: unknown) {
  return new Request("http://test/api/projects/p1/approvals", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }) as unknown as import("next/server").NextRequest;
}
const getReq = () => new Request("http://test/api/projects/p1/approvals") as unknown as import("next/server").NextRequest;

describe("GET /api/projects/[id]/approvals", () => {
  test("reads the proposals of the project for this organisation", async () => {
    reset();
    answer = { projectId: "p 1", count: 0, proposals: [] };
    const res = await GET(getReq(), params("p 1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projectId: "p 1", count: 0, proposals: [] });
    expect(calls).toEqual([{ path: "/projects/p%201/approvals", options: { organizationId: "org1" } }]);
  });

  test("a project of another organisation is the 404 of VERIDIAN, passed on", async () => {
    reset();
    failure = new MockVeridianApiError("Project not found", 404);
    const res = await GET(getReq(), params("other"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Project not found");
  });
});

describe("POST /api/projects/[id]/approvals", () => {
  test("relays only the submission id and the added values, and answers 201 when the proposal was written", async () => {
    reset();
    answer = { approved: true, submissionId: "sub-1", boqId: "boq-1", lineItemIds: ["l1"] };
    const res = await POST(post({ submissionId: " sub-1 ", params: { note: "ok" }, organizationId: "someone-else", actorEmail: "x@y.z", approved: true }), params("p1"));
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/projects/p1/approvals");
    expect(calls[0].options).toEqual({ organizationId: "org1", method: "POST", body: { submissionId: "sub-1", params: { note: "ok" } } });
  });

  test("a question (needs_input) is 200 and writes nothing", async () => {
    reset();
    answer = { approved: false, status: "needs_input", missing: [{ name: "unit", label: "Unit" }] };
    const res = await POST(post({ submissionId: "sub-1" }), params("p1"));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("needs_input");
  });

  test("refuses a body that is not an object, has no submission id, or has bad params, before VERIDIAN is called", async () => {
    reset();
    expect((await POST(post("not json"), params("p1"))).status).toBe(400);
    expect((await POST(post([1, 2]), params("p1"))).status).toBe(400);
    expect((await POST(post({}), params("p1"))).status).toBe(400);
    expect((await POST(post({ submissionId: "../x" }), params("p1"))).status).toBe(400);
    expect((await POST(post({ submissionId: "sub-1", params: [1] }), params("p1"))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("a proposal already decided is the 409 of VERIDIAN with its sentence and its decision status", async () => {
    reset();
    failure = new MockVeridianApiError("That proposal has already been decided", 409, { status: "done" });
    const res = await POST(post({ submissionId: "sub-1" }), params("p1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("That proposal has already been decided");
    expect(body.upstreamStatus).toBe("done");
  });
});
