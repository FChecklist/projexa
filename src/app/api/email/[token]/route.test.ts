/// <reference types="bun-types" />
import { describe, expect, test, mock } from "bun:test";
import type { ConsumeResult, OneClickAction } from "@/lib/services/email-token-service";

let mockConsumeResult: ConsumeResult;
let applyCalls: Array<{ todoId: string; action: OneClickAction }> = [];
let insertedRows: Array<Record<string, unknown>> = [];

mock.module("@/lib/services/email-token-service", () => ({
  consumeEmailActionToken: async (_token: string) => mockConsumeResult,
  applyOneClickAction: async (todoId: string, action: OneClickAction) => {
    applyCalls.push({ todoId, action });
  },
}));

mock.module("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (arg: Record<string, unknown>) => {
        insertedRows.push(arg);
        return Promise.resolve();
      },
    }),
  },
  securityAuditLog: {}, // opaque stand-in, never inspected -- route only passes it to db.insert()
}));

const { GET } = await import("./route");

function get(token: string) {
  return GET(new Request("http://test/api/email/" + token) as unknown as import("next/server").NextRequest, {
    params: Promise.resolve({ token }),
  });
}

describe("GET /api/email/[token]", () => {
  test("already_used: 410, exact sentence, refusal audit logged, applyOneClickAction never called", async () => {
    mockConsumeResult = { ok: false, reason: "already_used" };
    applyCalls = [];
    insertedRows = [];
    const res = await get("tok-used");
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain(
      "This link has already been used. If you clicked it before, that action already went through — nothing more to do here."
    );
    expect(insertedRows).toEqual([
      { event: "email_action_token_refused", actor: "public_link", metadata: { reason: "already_used" } },
    ]);
    expect(applyCalls).toEqual([]);
  });

  test("not_found: 410, exact sentence, refusal audit logged", async () => {
    mockConsumeResult = { ok: false, reason: "not_found" };
    applyCalls = [];
    insertedRows = [];
    const res = await get("tok-missing");
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain(
      "This link doesn't match anything we know about — it may have been copied incorrectly."
    );
    expect(insertedRows).toEqual([
      { event: "email_action_token_refused", actor: "public_link", metadata: { reason: "not_found" } },
    ]);
    expect(applyCalls).toEqual([]);
  });

  test("expired: 410, exact sentence, refusal audit logged", async () => {
    mockConsumeResult = { ok: false, reason: "expired" };
    applyCalls = [];
    insertedRows = [];
    const res = await get("tok-expired");
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain("This link has expired. Ask for a fresh one if you still need to act on it.");
    expect(insertedRows).toEqual([
      { event: "email_action_token_refused", actor: "public_link", metadata: { reason: "expired" } },
    ]);
    expect(applyCalls).toEqual([]);
  });

  test("ok: 200, Done body, applyOneClickAction called with (todoId, action), applied audit logged", async () => {
    mockConsumeResult = { ok: true, todoId: "todo-1", action: "mark_done" };
    applyCalls = [];
    insertedRows = [];
    const res = await get("tok-good");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Done");
    expect(body).toContain("Thanks — that's recorded. You can close this page.");
    expect(applyCalls).toEqual([{ todoId: "todo-1", action: "mark_done" }]);
    expect(insertedRows).toEqual([
      { event: "email_action_token_applied", actor: "public_link", metadata: { todoId: "todo-1", action: "mark_done" } },
    ]);
  });
});
