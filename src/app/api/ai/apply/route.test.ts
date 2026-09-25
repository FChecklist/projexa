/// <reference types="bun-types" />
import { describe, expect, test, mock } from "bun:test";
import { NextResponse } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let insertCalls: { values: unknown }[] = [];
// Keyed by "METHOD path" (e.g. "GET /tasks/t1") so each test can script
// exactly the VERIDIAN responses its scenario needs.
let veridianResponses: Map<string, unknown>;
let veridianCalls: { path: string; options: Record<string, unknown> }[] = [];

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (arg: unknown) => {
        insertCalls.push({ values: arg });
        return Promise.resolve();
      },
    }),
  },
  securityAuditLog: {},
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridianResult: async (path: string, options: Record<string, unknown>) => {
    veridianCalls.push({ path, options });
    const method = (options.method as string) ?? "GET";
    const key = `${method} ${path}`;
    const scripted = veridianResponses.get(key);
    if (scripted) return scripted;
    // An unscripted call is a real test-authoring bug, not a legitimate
    // "not found" -- fail loud rather than silently returning ok:false.
    throw new Error(`unscripted VERIDIAN call in test: ${key}`);
  },
  // The route now wears withTiming() (U-20b: that is where the acting-person
  // scope opens), and withTiming's veridian-response import needs this export.
  VeridianApiError: class VeridianApiError extends Error {},
}));

const { POST } = await import("./route");

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: { id: "u1", email: "u1@example.com" },
    organizationId: "org-1",
    role: "member",
    response: null,
    ...overrides,
  };
}

function post(body: unknown) {
  return { json: async () => body } as never;
}

function reset() {
  insertCalls = [];
  veridianCalls = [];
  veridianResponses = new Map();
}

function okResult<T>(data: T) {
  return { ok: true, status: 200, code: null, message: null, durationMs: 5, data };
}
function notFoundResult() {
  return { ok: false, status: 404, code: null, message: "Task not found", durationMs: 5, data: null };
}

describe("POST /api/ai/apply", () => {
  test("an unapproved proposal is declined and logs nothing -- declining a checkbox isn't a rejected attempt", async () => {
    reset();
    mockCtx = ctx();

    const res = await POST(post({ proposals: [{ verb: "MARK_STATUS", targetKey: "t1", approved: false }] }));
    const body = (await res.json()) as { results: unknown[] };

    expect(res.status).toBe(200);
    expect(body.results).toEqual([{ targetKey: "t1", verb: "MARK_STATUS", ok: false, reason: "Not approved" }]);
    expect(insertCalls.length).toBe(0);
    expect(veridianCalls.length).toBe(0);
  });

  test("a verb outside the allowlist is refused and logged with reason verb_not_allowed", async () => {
    reset();
    mockCtx = ctx();

    const res = await POST(post({ proposals: [{ verb: "DELETE_EVERYTHING", targetKey: "t1", approved: true }] }));
    const body = (await res.json()) as { results: unknown[] };

    expect(body.results).toEqual([
      { targetKey: "t1", verb: "DELETE_EVERYTHING", ok: false, reason: "That action is not one this link is allowed to propose" },
    ]);
    expect(insertCalls.length).toBe(1);
    const logged = insertCalls[0].values as { event: string; actor: string; metadata: Record<string, unknown> };
    expect(logged.event).toBe("ai_link_proposal_refused");
    expect(logged.actor).toBe("u1");
    expect(logged.metadata).toEqual({ targetKey: "t1", verb: "DELETE_EVERYTHING", reason: "verb_not_allowed" });
    expect(veridianCalls.length).toBe(0);
  });

  test("an approved, allowed verb with no targetKey is refused and logged with reason missing_target", async () => {
    reset();
    mockCtx = ctx();

    const res = await POST(post({ proposals: [{ verb: "SET_DUE", approved: true }] }));
    const body = (await res.json()) as { results: unknown[] };

    expect(body.results).toEqual([{ targetKey: null, verb: "SET_DUE", ok: false, reason: "No target given" }]);
    expect(insertCalls.length).toBe(1);
    const logged = insertCalls[0].values as { metadata: Record<string, unknown> };
    expect(logged.metadata).toEqual({ targetKey: null, verb: "SET_DUE", reason: "missing_target" });
  });

  test("an unfindable target (id doesn't exist, or belongs to another org) gives the IDENTICAL message either way -- resolved now against the real pipeline_tasks table via VERIDIAN", async () => {
    mockCtx = ctx();

    reset();
    veridianResponses.set("GET /tasks/nonexistent-id", notFoundResult());
    const resMissing = await POST(
      post({ proposals: [{ verb: "NOTE", targetKey: "nonexistent-id", approved: true, payload: { note: "x" } }] })
    );
    const bodyMissing = (await resMissing.json()) as { results: { reason?: string }[] };
    const loggedMissing = insertCalls[0].values as { metadata: Record<string, unknown> };

    reset();
    // VERIDIAN's own GET /tasks/[id] already scopes id+orgId together, so a
    // real id belonging to a different org 404s there too -- same response
    // shape as a nonexistent id, nothing new to fake here.
    veridianResponses.set("GET /tasks/real-id-other-org", notFoundResult());
    const resForeign = await POST(
      post({ proposals: [{ verb: "NOTE", targetKey: "real-id-other-org", approved: true, payload: { note: "x" } }] })
    );
    const bodyForeign = (await resForeign.json()) as { results: { reason?: string }[] };
    const loggedForeign = insertCalls[0].values as { metadata: Record<string, unknown> };

    expect(bodyMissing.results[0]).toEqual({
      targetKey: "nonexistent-id",
      verb: "NOTE",
      ok: false,
      reason: "Target not found in your organization",
    });
    expect(bodyForeign.results[0]).toEqual({
      targetKey: "real-id-other-org",
      verb: "NOTE",
      ok: false,
      reason: "Target not found in your organization",
    });
    expect(bodyMissing.results[0].reason).toBe(bodyForeign.results[0].reason);
    expect(loggedMissing.metadata.reason).toBe("target_not_found_or_foreign_org");
    expect(loggedForeign.metadata.reason).toBe("target_not_found_or_foreign_org");
  });

  test("the upstream target-lookup failing (not a 404) is a distinct, non-security refusal -- and logs nothing, since nothing about the proposal was judged", async () => {
    reset();
    mockCtx = ctx();
    veridianResponses.set("GET /tasks/t1", { ok: false, status: 504, code: "UPSTREAM_TIMEOUT", message: "slow", durationMs: 5000, data: null });

    const res = await POST(post({ proposals: [{ verb: "MARK_STATUS", targetKey: "t1", approved: true, payload: { done: true } }] }));
    const body = (await res.json()) as { results: { reason?: string }[] };

    expect(body.results[0]).toEqual({ targetKey: "t1", verb: "MARK_STATUS", ok: false, reason: "Could not verify the target right now. Try again." });
    expect(insertCalls.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Bug 1 fix -- the target is the REAL, live pipeline_tasks record (via
  // VERIDIAN), not the orphaned local todos table. ASSIGN/SET_DUE/NOTE are
  // honestly refused (pipeline_tasks has no such field); MARK_STATUS and
  // DRAFT keep working for real.
  // -----------------------------------------------------------------------

  test("a real approved MARK_STATUS calls VERIDIAN's PATCH with status:'done' for {done:true}, and logs the applied event", async () => {
    reset();
    mockCtx = ctx();
    veridianResponses.set("GET /tasks/t1", okResult({ task: { id: "t1", status: "to_do" } }));
    veridianResponses.set("PATCH /tasks/t1", okResult({ task: { id: "t1", status: "done" } }));

    const res = await POST(
      post({ proposals: [{ verb: "MARK_STATUS", targetKey: "t1", approved: true, payload: { done: true } }] })
    );
    const body = (await res.json()) as { results: unknown[] };

    expect(body.results).toEqual([{ targetKey: "t1", verb: "MARK_STATUS", ok: true }]);
    const patchCall = veridianCalls.find((c) => c.path === "/tasks/t1" && c.options.method === "PATCH");
    expect(patchCall?.options.body).toEqual({ status: "done" });
    expect(insertCalls.length).toBe(1);
    const logged = insertCalls[0].values as { event: string; actor: string; metadata: Record<string, unknown> };
    expect(logged.event).toBe("ai_link_mark_status_applied");
    expect(logged.actor).toBe("u1");
    expect(logged.metadata).toEqual({ organizationId: "org-1", targetKey: "t1", payload: { done: true } });
  });

  test("MARK_STATUS with {done:false} reopens the task (status:'to_do')", async () => {
    reset();
    mockCtx = ctx();
    veridianResponses.set("GET /tasks/t1", okResult({ task: { id: "t1", status: "done" } }));
    veridianResponses.set("PATCH /tasks/t1", okResult({ task: { id: "t1", status: "to_do" } }));

    const res = await POST(
      post({ proposals: [{ verb: "MARK_STATUS", targetKey: "t1", approved: true, payload: { done: false } }] })
    );
    const body = (await res.json()) as { results: unknown[] };

    expect(body.results).toEqual([{ targetKey: "t1", verb: "MARK_STATUS", ok: true }]);
    const patchCall = veridianCalls.find((c) => c.path === "/tasks/t1" && c.options.method === "PATCH");
    expect(patchCall?.options.body).toEqual({ status: "to_do" });
  });

  test("MARK_STATUS whose PATCH fails upstream is refused, not silently marked ok", async () => {
    reset();
    mockCtx = ctx();
    veridianResponses.set("GET /tasks/t1", okResult({ task: { id: "t1", status: "to_do" } }));
    veridianResponses.set("PATCH /tasks/t1", { ok: false, status: 400, code: null, message: "bad", durationMs: 5, data: null });

    const res = await POST(
      post({ proposals: [{ verb: "MARK_STATUS", targetKey: "t1", approved: true, payload: { done: true } }] })
    );
    const body = (await res.json()) as { results: { ok: boolean; reason?: string }[] };

    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].reason).toBe("Could not update the task right now. Try again.");
    // No "applied" event for a write that never actually happened.
    expect(insertCalls.length).toBe(0);
  });

  test.each(["ASSIGN", "SET_DUE", "NOTE"] as const)(
    "%s is honestly refused for a pipeline_tasks target -- no such field exists, so nothing is forced onto one that does",
    async (verb) => {
      reset();
      mockCtx = ctx();
      veridianResponses.set("GET /tasks/t1", okResult({ task: { id: "t1", status: "to_do" } }));

      const res = await POST(post({ proposals: [{ verb, targetKey: "t1", approved: true, payload: {} }] }));
      const body = (await res.json()) as { results: { ok: boolean; reason?: string }[] };

      expect(body.results[0].ok).toBe(false);
      expect(body.results[0].reason).toContain("Not supported yet");
      // Never reaches a PATCH -- there is nothing to write.
      const patchCall = veridianCalls.find((c) => c.options.method === "PATCH");
      expect(patchCall).toBeUndefined();
      expect(insertCalls.length).toBe(1);
      const logged = insertCalls[0].values as { event: string; metadata: Record<string, unknown> };
      expect(logged.event).toBe("ai_link_proposal_refused");
      expect(logged.metadata.reason).toContain("field_not_supported_on_pipeline_tasks");
    }
  );

  test("DRAFT still applies as a no-op (audit-log only) against a real pipeline_tasks target", async () => {
    reset();
    mockCtx = ctx();
    veridianResponses.set("GET /tasks/t1", okResult({ task: { id: "t1", status: "to_do" } }));

    const res = await POST(post({ proposals: [{ verb: "DRAFT", targetKey: "t1", approved: true, payload: { kind: "RFI response" } }] }));
    const body = (await res.json()) as { results: unknown[] };

    expect(body.results).toEqual([{ targetKey: "t1", verb: "DRAFT", ok: true }]);
    const patchCall = veridianCalls.find((c) => c.options.method === "PATCH");
    expect(patchCall).toBeUndefined();
    expect(insertCalls.length).toBe(1);
    const logged = insertCalls[0].values as { event: string };
    expect(logged.event).toBe("ai_link_draft_applied");
  });

  test("multiple proposals in one request each get their own independent result, in order", async () => {
    reset();
    mockCtx = ctx();
    veridianResponses.set("GET /tasks/t1", okResult({ task: { id: "t1", status: "to_do" } }));
    veridianResponses.set("PATCH /tasks/t1", okResult({ task: { id: "t1", status: "done" } }));

    const res = await POST(
      post({
        proposals: [
          { verb: "MARK_STATUS", targetKey: "t1", approved: false },
          { verb: "DELETE_EVERYTHING", targetKey: "t1", approved: true },
          { verb: "MARK_STATUS", targetKey: "t1", approved: true, payload: { done: true } },
        ],
      })
    );
    const body = (await res.json()) as { results: unknown[] };

    expect(body.results).toEqual([
      { targetKey: "t1", verb: "MARK_STATUS", ok: false, reason: "Not approved" },
      { targetKey: "t1", verb: "DELETE_EVERYTHING", ok: false, reason: "That action is not one this link is allowed to propose" },
      { targetKey: "t1", verb: "MARK_STATUS", ok: true },
    ]);
    // Only the one real, approved, supported proposal should have PATCHed.
    const patchCalls = veridianCalls.filter((c) => c.options.method === "PATCH");
    expect(patchCalls.length).toBe(1);
    expect(insertCalls.length).toBe(2); // the DELETE_EVERYTHING refusal + the MARK_STATUS applied event
  });

  test("requireAuth's own refusal short-circuits before VERIDIAN or the db is touched at all", async () => {
    reset();
    mockCtx = {
      user: null,
      organizationId: null,
      role: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };

    const res = await POST(post({ proposals: [{ verb: "MARK_STATUS", targetKey: "t1", approved: true }] }));

    expect(res.status).toBe(401);
    expect(veridianCalls.length).toBe(0);
    expect(insertCalls.length).toBe(0);
  });

  test("an authenticated context with no organizationId is rejected before VERIDIAN or the db is touched", async () => {
    reset();
    mockCtx = { user: { id: "u1", email: "u1@example.com" }, organizationId: null, role: "member", response: null };

    const res = await POST(post({ proposals: [{ verb: "MARK_STATUS", targetKey: "t1", approved: true }] }));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("No organization");
    expect(veridianCalls.length).toBe(0);
    expect(insertCalls.length).toBe(0);
  });
});
