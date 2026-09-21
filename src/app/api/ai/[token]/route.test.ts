/// <reference types="bun-types" />
import { describe, expect, test, mock } from "bun:test";

let resolvedLink: { organizationId: string; userId: string } | null;
let projectionResult: (() => Promise<string>) | null;
let tasksResult: () => Promise<unknown>;
let dashResult: () => Promise<unknown>;
let lastResolveCall: string | null = null;
let lastProjectionCall: { organizationId: string; userId: string } | null = null;
let veridianCalls: { path: string; options: Record<string, unknown> }[] = [];

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

// callVeridianResult is now called twice by this route: once for the real
// pipeline_tasks list (bug-1 fix) and once for the construction dashboard
// (pre-existing). Dispatched on `path` so each test can control them
// independently.
mock.module("@/lib/veridian-client", () => ({
  callVeridianResult: async (path: string, options: Record<string, unknown>) => {
    veridianCalls.push({ path, options });
    if (path.startsWith("/tasks")) return tasksResult();
    return dashResult();
  },
}));

const { GET } = await import("./route");

function params(token: string) {
  return { params: Promise.resolve({ token }) };
}

function reset() {
  veridianCalls = [];
  lastProjectionCall = null;
  // Defaults: tasks empty (ok), dashboard down (not ok) -- most tests only
  // care about one half and this keeps both sides well-defined.
  tasksResult = async () => ({ ok: true, status: 200, code: null, message: null, durationMs: 3, data: { tasks: [] } });
  dashResult = async () => ({ ok: false, status: 502, code: "NETWORK", message: "down", durationMs: 5, data: null });
}

describe("GET /api/ai/[token]", () => {
  test("an unknown/revoked/expired token refuses with a plain-text 404, and never reaches the projection", async () => {
    reset();
    resolvedLink = null;

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
    reset();
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = async () => "ORGANIZATION: Acme\n\nRECENT NOTIFICATIONS:\n(none)\n";

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(text).toContain("ORGANIZATION: Acme");
    expect(text).toContain("Allowed verbs, nothing else: ASSIGN, SET_DUE, NOTE, MARK_STATUS, DRAFT.");
    expect(lastProjectionCall).toEqual({ organizationId: "org1", userId: "u1" });
  });

  test("getAiLinkProjection throwing answers a plain-text 500, not a stack trace or JSON", async () => {
    reset();
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = null;

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(text).toBe("Could not build the snapshot right now. Try again in a moment.");
    expect(text).not.toContain("db unreachable");
  });

  test("callVeridianResult throwing (dashboard) still yields a 200 snapshot -- best-effort, degrades not fails", async () => {
    reset();
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = async () => "ORGANIZATION: Acme\n\nRECENT NOTIFICATIONS:\n(none)\n";
    dashResult = async () => {
      throw new Error("timeout");
    };

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("ORGANIZATION: Acme");
    expect(text).not.toContain("CONSTRUCTION DASHBOARD");
  });

  test("callVeridianResult resolving ok:true includes the dashboard JSON under its heading", async () => {
    reset();
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = async () => "ORGANIZATION: Acme\n\nRECENT NOTIFICATIONS:\n(none)\n";
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
    const dashCall = veridianCalls.find((c) => c.path === "/assistant");
    expect(dashCall?.path).toBe("/assistant");
    expect((dashCall?.options as { organizationId?: string })?.organizationId).toBe("org1");
  });

  // ---------------------------------------------------------------------
  // Bug 1 fix -- the TASKS section reads REAL, live pipeline_tasks (via
  // VERIDIAN's GET /tasks), not the orphaned local todos table.
  // ---------------------------------------------------------------------

  test("real pipeline_tasks rows render under a TASKS heading, org-scoped through VERIDIAN", async () => {
    reset();
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = async () => "ORGANIZATION: Acme\n\nRECENT NOTIFICATIONS:\n(none)\n";
    tasksResult = async () => ({
      ok: true,
      status: 200,
      code: null,
      message: null,
      durationMs: 8,
      data: {
        tasks: [
          { id: "cljk1", status: "to_do", label: "Record progress", functionId: "record_work_progress", rawInput: "log 40% on skiphop" },
        ],
      },
    });

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("TASKS (live, from the app's own Tasks tab):");
    expect(text).toContain("- [id: cljk1] Record progress (status: to_do): log 40% on skiphop");
    const tasksCall = veridianCalls.find((c) => c.path.startsWith("/tasks"));
    expect((tasksCall?.options as { organizationId?: string })?.organizationId).toBe("org1");
  });

  test("no tasks renders an honest (none), never a fabricated row", async () => {
    reset();
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = async () => "ORGANIZATION: Acme\n\nRECENT NOTIFICATIONS:\n(none)\n";
    tasksResult = async () => ({ ok: true, status: 200, code: null, message: null, durationMs: 3, data: { tasks: [] } });

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(text).toContain("TASKS (live, from the app's own Tasks tab):\n(none)");
  });

  test("the tasks upstream failing still yields a 200 snapshot -- best-effort, degrades not fails", async () => {
    reset();
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = async () => "ORGANIZATION: Acme\n\nRECENT NOTIFICATIONS:\n(none)\n";
    tasksResult = async () => ({ ok: false, status: 504, code: "UPSTREAM_TIMEOUT", message: "slow", durationMs: 5000, data: null });

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain("TASKS: (could not load right now -- try again in a moment)");
  });

  test("the instructions point targetKey at the [id: ...] format, not a todo", async () => {
    reset();
    resolvedLink = { organizationId: "org1", userId: "u1" };
    projectionResult = async () => "ORGANIZATION: Acme\n\nRECENT NOTIFICATIONS:\n(none)\n";

    const res = await GET(new Request("http://x") as never, params("good-token"));
    const text = await res.text();

    expect(text).toContain("targetKey is the id of one of the TASKS listed above");
    expect(text).toContain("[id: ...]");
    expect(text).not.toContain("targetKey is the id of a todo");
  });
});
