/// <reference types="bun-types" />
// Route-level proof of the GET-must-not-mutate fix (same class of bug as
// compliance-tracker's DPDP task-link route, fix/dpdp-task-link-get-
// confirmation): an email scanner or corporate security gateway prefetching
// the link -- Gmail, Outlook, and most corporate gateways do this -- could
// previously burn the token and apply the action via a bare GET, before a
// human ever opened the email. GET now only previews (read-only); only a
// real POST (the confirmation button's form submit) consumes the token and
// applies the action.
import { describe, expect, test, mock } from "bun:test";
import type { ConsumeResult, OneClickAction } from "@/lib/services/email-token-service";

let mockPreviewResult: ConsumeResult;
let mockConsumeResult: ConsumeResult;
let previewCalls: string[] = [];
let consumeCalls: string[] = [];
let applyCalls: Array<{ todoId: string; action: OneClickAction }> = [];
let insertedRows: Array<Record<string, unknown>> = [];

mock.module("@/lib/services/email-token-service", () => ({
  previewEmailActionToken: async (token: string) => {
    previewCalls.push(token);
    return mockPreviewResult;
  },
  consumeEmailActionToken: async (token: string) => {
    consumeCalls.push(token);
    return mockConsumeResult;
  },
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

const { GET, POST } = await import("./route");

function call(handler: typeof GET, token: string) {
  return handler(new Request("http://test/api/email/" + token, { method: handler === POST ? "POST" : "GET" }) as unknown as import("next/server").NextRequest, {
    params: Promise.resolve({ token }),
  });
}

function reset() {
  previewCalls = [];
  consumeCalls = [];
  applyCalls = [];
  insertedRows = [];
}

describe("GET /api/email/[token] (preview only -- never mutates)", () => {
  test("valid token: 200, renders a confirm page naming the action, never touches consume/apply/audit", async () => {
    mockPreviewResult = { ok: true, todoId: "todo-1", action: "mark_done" };
    reset();

    for (let i = 0; i < 3; i++) {
      const res = await call(GET, "tok-good");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Confirm");
      expect(body).toContain("mark this to-do as done");
      expect(body).toContain('method="POST"');
      expect(body).not.toContain("Done");
    }

    expect(previewCalls).toEqual(["tok-good", "tok-good", "tok-good"]);
    expect(consumeCalls).toEqual([]);
    expect(applyCalls).toEqual([]);
    expect(insertedRows).toEqual([]);
  });

  test("already_used: 410, exact sentence, never touches consume/apply/audit", async () => {
    mockPreviewResult = { ok: false, reason: "already_used" };
    reset();
    const res = await call(GET, "tok-used");
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain(
      "This link has already been used. If you clicked it before, that action already went through — nothing more to do here."
    );
    expect(consumeCalls).toEqual([]);
    expect(applyCalls).toEqual([]);
    expect(insertedRows).toEqual([]);
  });

  test("not_found: 410, exact sentence, never touches consume/apply/audit", async () => {
    mockPreviewResult = { ok: false, reason: "not_found" };
    reset();
    const res = await call(GET, "tok-missing");
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain("This link doesn't match anything we know about — it may have been copied incorrectly.");
    expect(consumeCalls).toEqual([]);
    expect(applyCalls).toEqual([]);
    expect(insertedRows).toEqual([]);
  });

  test("expired: 410, exact sentence, never touches consume/apply/audit", async () => {
    mockPreviewResult = { ok: false, reason: "expired" };
    reset();
    const res = await call(GET, "tok-expired");
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain("This link has expired. Ask for a fresh one if you still need to act on it.");
    expect(consumeCalls).toEqual([]);
    expect(applyCalls).toEqual([]);
    expect(insertedRows).toEqual([]);
  });
});

describe("POST /api/email/[token] (the confirm button -- the only path that mutates)", () => {
  test("ok: 200, Done body, applyOneClickAction called with (todoId, action), applied audit logged", async () => {
    mockConsumeResult = { ok: true, todoId: "todo-1", action: "mark_done" };
    reset();
    const res = await call(POST, "tok-good");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Done");
    expect(body).toContain("Thanks — that's recorded. You can close this page.");
    expect(applyCalls).toEqual([{ todoId: "todo-1", action: "mark_done" }]);
    expect(insertedRows).toEqual([
      { event: "email_action_token_applied", actor: "public_link", metadata: { todoId: "todo-1", action: "mark_done" } },
    ]);
  });

  test("already_used: 410, exact sentence, refusal audit logged, applyOneClickAction never called", async () => {
    mockConsumeResult = { ok: false, reason: "already_used" };
    reset();
    const res = await call(POST, "tok-used");
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
    reset();
    const res = await call(POST, "tok-missing");
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain("This link doesn't match anything we know about — it may have been copied incorrectly.");
    expect(insertedRows).toEqual([
      { event: "email_action_token_refused", actor: "public_link", metadata: { reason: "not_found" } },
    ]);
    expect(applyCalls).toEqual([]);
  });

  test("expired: 410, exact sentence, refusal audit logged", async () => {
    mockConsumeResult = { ok: false, reason: "expired" };
    reset();
    const res = await call(POST, "tok-expired");
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain("This link has expired. Ask for a fresh one if you still need to act on it.");
    expect(insertedRows).toEqual([
      { event: "email_action_token_refused", actor: "public_link", metadata: { reason: "expired" } },
    ]);
    expect(applyCalls).toEqual([]);
  });
});
