/// <reference types="bun-types" />
import { describe, expect, test, mock } from "bun:test";

let resolvedLink: { organizationId: string; userId: string } | null;
let projectionResult: (() => Promise<string>) | null;
let dashResult: () => Promise<unknown>;
let lastResolveCall: string | null = null;
let lastProjectionCall: { organizationId: string; userId: string } | null = null;
let lastDashCall: { path: string; options: Record<string, unknown> } | null = null;

mock.module("@/lib/services/ai-link-service", () => ({
  resolveAiLinkToken: async (token: string) => {
    lastResolveCall = token;
    return resolvedLink;
  },
  getAiLinkProjection: async (organizationId: string, userId: string) => {
    lastProjectionCall = { organizationId, userId };
    if (!projectionResult) throw new Error("db unreachable");
    return projectionResult();
  },
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridianResult: async (path: string, options: Record<string, unknown>) => {
    lastDashCall = { path, options };
    return dashResult();
  },
}));

const { GET } = await import("./route");

function params(token: string) {
  return { params: Promise.resolve({ token }) };
}

describe("GET /api/ai/[token]", () => {
  test("an unknown/revoked/expired token refuses with a plain-text 404, and never reaches the projection", async () => {
    resolvedLink = null;
    lastProjectionCall = null;

    const res = await GET(new Request("http://x") as never, params("dead-token"));
    const text = await res.text();

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(text).toBe("This link is no longer valid. Ask the person who shared it for a fresh one.");
    expect(lastResolveCall).toBe("dead-token");
    // resolveAiLinkToken() returning null means there is no (org, user) to
    // build a snapshot for -- getAiLinkProjection must never be called.
    expect(lastProjectionCall).toBeNull();
  });

  test("a valid token returns the projection and the allowlisted-verbs instructions", async () => {
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = async () => "TODOS:\n- [t1] Pour foundation (assigned: nobody)";
    dashResult = async () => ({ ok: false, status: 502, code: "NETWORK", message: "down", durationMs: 5, data: null });

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(text).toContain("TODOS:\n- [t1] Pour foundation (assigned: nobody)");
    expect(text).toContain("Allowed verbs, nothing else: ASSIGN, SET_DUE, NOTE, MARK_STATUS, DRAFT.");
    expect(lastProjectionCall).toEqual({ organizationId: "org1", userId: "u1" });
  });

  test("getAiLinkProjection throwing answers a plain-text 500, not a stack trace or JSON", async () => {
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = null;
    dashResult = async () => ({ ok: false, status: 502, code: "NETWORK", message: "down", durationMs: 5, data: null });

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(text).toBe("Could not build the snapshot right now. Try again in a moment.");
    expect(text).not.toContain("db unreachable");
  });

  test("callVeridianResult throwing still yields a 200 snapshot -- best-effort, degrades not fails", async () => {
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = async () => "TODOS:\n- [t1] Pour foundation";
    dashResult = async () => {
      throw new Error("timeout");
    };

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("TODOS:\n- [t1] Pour foundation");
    expect(text).not.toContain("CONSTRUCTION DASHBOARD");
  });

  test("callVeridianResult resolving ok:true includes the dashboard JSON under its heading", async () => {
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = async () => "TODOS:\n- [t1] Pour foundation";
    dashResult = async () => ({
      ok: true,
      status: 200,
      code: null,
      message: null,
      durationMs: 12,
      data: { delayedActivities: 3, overBudgetProjects: 1 },
    });

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("CONSTRUCTION DASHBOARD (read-only, via VERIDIAN):");
    expect(text).toContain(JSON.stringify({ delayedActivities: 3, overBudgetProjects: 1 }, null, 2));
    expect(lastDashCall?.path).toBe("/assistant");
    expect((lastDashCall?.options as { organizationId?: string })?.organizationId).toBe("org1");
  });
});
