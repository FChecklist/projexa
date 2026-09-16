/// <reference types="bun-types" />
import { describe, expect, test, mock } from "bun:test";
import { NextResponse } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let selectResult: unknown[] = [];
let selectCallCount = 0;
let updateCalls: { set: unknown }[] = [];
let insertCalls: { values: unknown }[] = [];

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

// drizzle-orm itself is NOT mocked -- eq()/and() are pure AST builders that
// never inspect the opaque `todos`/`securityAuditLog` stand-ins below until a
// real connection sends the query to Postgres, which never happens here.
mock.module("@/lib/db", () => ({
  db: {
    select: () => {
      selectCallCount++;
      return {
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectResult),
          }),
        }),
      };
    },
    update: () => ({
      set: (arg: unknown) => {
        updateCalls.push({ set: arg });
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (arg: unknown) => {
        insertCalls.push({ values: arg });
        return Promise.resolve();
      },
    }),
  },
  todos: {},
  securityAuditLog: {},
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
  selectResult = [];
  selectCallCount = 0;
  updateCalls = [];
  insertCalls = [];
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

  test("an unfindable target gives the IDENTICAL message for a nonexistent id and a real id in another org (deliberately not distinguished)", async () => {
    mockCtx = ctx();

    reset();
    selectResult = []; // stands in for "id doesn't exist at all"
    const resMissing = await POST(
      post({ proposals: [{ verb: "NOTE", targetKey: "nonexistent-id", approved: true, payload: { note: "x" } }] })
    );
    const bodyMissing = (await resMissing.json()) as { results: { reason?: string }[] };
    const loggedMissing = insertCalls[0].values as { metadata: Record<string, unknown> };

    reset();
    selectResult = []; // the org filter lives in the real WHERE clause sent to Postgres, never reached here --
    // an empty array is exactly what a real id belonging to a different org would also produce
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

  test("a real approved MARK_STATUS applies the update and logs the applied event", async () => {
    reset();
    mockCtx = ctx();
    selectResult = [{ id: "t1", organizationId: "org-1", done: false }];

    const res = await POST(
      post({ proposals: [{ verb: "MARK_STATUS", targetKey: "t1", approved: true, payload: { done: true } }] })
    );
    const body = (await res.json()) as { results: unknown[] };

    expect(body.results).toEqual([{ targetKey: "t1", verb: "MARK_STATUS", ok: true }]);
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].set).toEqual({ done: true });
    expect(insertCalls.length).toBe(1);
    const logged = insertCalls[0].values as { event: string; actor: string; metadata: Record<string, unknown> };
    expect(logged.event).toBe("ai_link_mark_status_applied");
    expect(logged.actor).toBe("u1");
    expect(logged.metadata).toEqual({ organizationId: "org-1", targetKey: "t1", payload: { done: true } });
  });

  test("multiple proposals in one request each get their own independent result, in order", async () => {
    reset();
    mockCtx = ctx();
    selectResult = [{ id: "t1", organizationId: "org-1", done: false }];

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
    // Only the one real, approved proposal should have touched the db.
    expect(updateCalls.length).toBe(1);
    expect(insertCalls.length).toBe(2); // the DELETE_EVERYTHING refusal + the MARK_STATUS applied event
  });

  test("requireAuth's own refusal short-circuits before the db is touched at all", async () => {
    reset();
    mockCtx = {
      user: null,
      organizationId: null,
      role: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };

    const res = await POST(post({ proposals: [{ verb: "MARK_STATUS", targetKey: "t1", approved: true }] }));

    expect(res.status).toBe(401);
    expect(selectCallCount).toBe(0);
    expect(updateCalls.length).toBe(0);
    expect(insertCalls.length).toBe(0);
  });

  test("an authenticated context with no organizationId is rejected before the db is touched", async () => {
    reset();
    mockCtx = { user: { id: "u1", email: "u1@example.com" }, organizationId: null, role: "member", response: null };

    const res = await POST(post({ proposals: [{ verb: "MARK_STATUS", targetKey: "t1", approved: true }] }));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("No organization");
    expect(selectCallCount).toBe(0);
    expect(updateCalls.length).toBe(0);
    expect(insertCalls.length).toBe(0);
  });
});
