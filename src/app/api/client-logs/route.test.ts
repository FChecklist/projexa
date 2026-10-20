/// <reference types="bun-types" />
// DEVICE LOG proxy routes. Who may do what, pinned in both directions:
//   POST /api/client-logs                 every signed-in member, a read-only client_viewer included (their errors matter just as much)
//   GET  /api/client-logs/issues          owner / admin only
//   GET  /api/client-logs/issues/[id]     owner / admin only
//   GET  /api/client-logs/timeline        owner / admin only
// plus the write-policy table (src/lib/authz/api-write-policy.ts) that the middleware enforces for the POST.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ALL_ORG_ROLES, ROLE_GROUPS } from "@/lib/authz/roles";
import { checkApiWriteAccess, resolveWriteTier } from "@/lib/authz/api-write-policy";
import type { AuthContext } from "@/lib/supabase/auth-guard";
import { requireRole } from "@/lib/supabase/auth-guard";
import { VeridianApiError } from "@/lib/veridian-client";

let mockCtx: AuthContext;
let upstream: (path: string, opts: { method?: string; body?: unknown }) => Promise<unknown>;
let calls: { path: string; method?: string; body?: unknown }[] = [];

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
  requireRole,
  ROLE_GROUPS,
  ALL_ORG_ROLES,
}));
mock.module("@/lib/veridian-client", () => ({
  VeridianApiError,
  callVeridian: async (path: string, opts: { method?: string; body?: unknown }) => {
    calls.push({ path, method: opts.method, body: opts.body });
    return upstream(path, opts);
  },
}));

const post = (await import("./route")).POST;
const listIssues = (await import("./issues/route")).GET;
const oneIssue = (await import("./issues/[id]/route")).GET;
const timeline = (await import("./timeline/route")).GET;

const as = (role: string | null): AuthContext => ({ user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role, response: null });
const getReq = (path: string) => {
  const u = new URL(`https://projexa.test${path}`);
  return { url: u.href, nextUrl: u } as never;
};
const postReq = (body: unknown) => new Request("https://projexa.test/api/client-logs", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }) as never;
const event = { id: "e1", kind: "error", severity: "error", message: "boom", occurredAt: "2026-10-20T00:00:00.000Z" };
const idParams = { params: Promise.resolve({ id: "iss 1/2" }) };

beforeEach(() => {
  calls = [];
  upstream = async () => ({ accepted: 1, rejected: [], issues: [], events: [] });
  mockCtx = as("owner");
});

describe("POST /api/client-logs (any member may report)", () => {
  test("every role, including client_viewer, may send; the batch is forwarded as is", async () => {
    for (const role of ALL_ORG_ROLES) {
      mockCtx = as(role);
      calls = [];
      const res = await post(postReq({ events: [event] }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ accepted: 1, rejected: [], issues: [], events: [] });
      expect(calls).toEqual([{ path: "/client-logs", method: "POST", body: { events: [event] } }]);
    }
  });

  test("bad shapes are refused before VERIDIAN is called", async () => {
    expect((await post(postReq("not json"))).status).toBe(400);
    expect((await post(postReq({ events: [] }))).status).toBe(400);
    expect((await post(postReq({ events: "x" }))).status).toBe(400);
    expect((await post(postReq({ events: Array.from({ length: 51 }, () => event) }))).status).toBe(400);
    expect((await post(postReq({ events: [{ message: "x".repeat(450_000) }] }))).status).toBe(413);
    expect(calls).toEqual([]);
    expect((await post(postReq({ events: Array.from({ length: 50 }, () => event) }))).status).toBe(200);
  });

  test("a rate limit upstream stays a 429 the device can back off on", async () => {
    upstream = async () => {
      throw new VeridianApiError("Rate limit: slow down", 429);
    };
    const res = await post(postReq({ events: [event] }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  test("the middleware's write policy lets every role through for this path", () => {
    expect(resolveWriteTier("/client-logs")).toBe("ANY_ROLE");
    for (const role of ALL_ORG_ROLES) expect(checkApiWriteAccess("POST", "/client-logs", role).allowed).toBe(true);
    // sanity: the check really can say no (a read-only viewer may not write a budget), so the line above is not vacuous
    expect(checkApiWriteAccess("POST", "/change-orders", "client_viewer").allowed).toBe(false);
  });
});

describe("owner-only reads", () => {
  const reads: [string, () => Promise<Response>][] = [
    ["issues", () => listIssues(getReq("/api/client-logs/issues?status=open"))],
    ["issues/[id]", () => oneIssue(getReq("/api/client-logs/issues/x"), idParams)],
    ["timeline", () => timeline(getReq("/api/client-logs/timeline?projectId=p1"))],
  ];

  for (const [name, call] of reads) {
    test(`${name}: owner and admin may read; every other role gets 403 and VERIDIAN is not called`, async () => {
      for (const role of ALL_ORG_ROLES) {
        mockCtx = as(role);
        calls = [];
        const res = await call();
        if (role === "owner" || role === "admin") {
          expect(res.status).toBe(200);
          expect(calls.length).toBe(1);
        } else {
          expect(res.status).toBe(403);
          expect(calls).toEqual([]);
        }
      }
    });
    test(`${name}: a person with no role is refused`, async () => {
      mockCtx = as(null);
      expect((await call()).status).toBe(403);
    });
  }

  test("query strings are validated and forwarded; the id is encoded", async () => {
    await listIssues(getReq("/api/client-logs/issues?status=fixed&projectId=p-1&limit=500&junk=1"));
    expect(calls[0]!.path).toBe("/client-logs/issues?status=fixed&projectId=p-1&limit=200");
    expect((await listIssues(getReq("/api/client-logs/issues?status=open%27%3Bdrop"))).status).toBe(400);
    calls = [];
    await oneIssue(getReq("/api/client-logs/issues/x"), idParams);
    expect(calls[0]!.path).toBe("/client-logs/issues/iss%201%2F2");
    expect((await timeline(getReq("/api/client-logs/timeline"))).status).toBe(400);
    calls = [];
    await timeline(getReq("/api/client-logs/timeline?projectId=p%201&order=desc&limit=5000&after=2026-10-20T00:00:00Z"));
    expect(calls[0]!.path).toBe("/client-logs/timeline?projectId=p+1&order=desc&after=2026-10-20T00%3A00%3A00Z&limit=1000");
    expect((await timeline(getReq("/api/client-logs/timeline?projectId=p&after=nope"))).status).toBe(400);
  });
});
