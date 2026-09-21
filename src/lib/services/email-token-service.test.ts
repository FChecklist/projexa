/// <reference types="bun-types" />
// Unit tests for the GET-must-not-mutate fix: previewEmailActionToken (used
// by the route's GET, read-only) vs consumeEmailActionToken (used by the
// route's POST, the only path allowed to mark a token used). Mocks the
// drizzle chain -- same "mock the DB layer, run the real service logic"
// pattern as this codebase's own reference closure test
// (compliance-tracker's src/app/api/v1/construction/boq/route.test.ts,
// R74-RULING-03) -- so the shared checkTokenValidity() branch logic runs
// for real, and route.test.ts already proves the route wires these two
// functions to the right HTTP verbs.
import { describe, expect, test, mock } from "bun:test";

type Row = { todoId: string; action: string; usedAt: Date | null; expiresAt: Date };

let row: Row | undefined;
let updateCalls = 0;
let updateShouldReturnRow = true;

function future(hours = 1) {
  return new Date(Date.now() + hours * 3600_000);
}
function past(hours = 1) {
  return new Date(Date.now() - hours * 3600_000);
}

mock.module("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            updateCalls++;
            if (!row || !updateShouldReturnRow) return Promise.resolve([]);
            return Promise.resolve([row]);
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => Promise.resolve(),
    }),
  },
  emailActionToken: {},
  todos: {},
}));

const { previewEmailActionToken, consumeEmailActionToken } = await import("./email-token-service");

function reset(r: Row | undefined, opts: { updateReturnsRow?: boolean } = {}) {
  row = r;
  updateCalls = 0;
  updateShouldReturnRow = opts.updateReturnsRow ?? true;
}

describe("previewEmailActionToken (GET, read-only)", () => {
  test("valid token: returns ok+action, never calls UPDATE", async () => {
    reset({ todoId: "todo-1", action: "mark_done", usedAt: null, expiresAt: future() });
    const result = await previewEmailActionToken("raw");
    expect(result).toEqual({ ok: true, todoId: "todo-1", action: "mark_done" });
    expect(updateCalls).toBe(0);
  });

  test("not found: ok:false, never calls UPDATE", async () => {
    reset(undefined);
    const result = await previewEmailActionToken("raw");
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(updateCalls).toBe(0);
  });

  test("already used: ok:false, never calls UPDATE", async () => {
    reset({ todoId: "todo-1", action: "mark_done", usedAt: new Date(), expiresAt: future() });
    const result = await previewEmailActionToken("raw");
    expect(result).toEqual({ ok: false, reason: "already_used" });
    expect(updateCalls).toBe(0);
  });

  test("expired: ok:false, never calls UPDATE", async () => {
    reset({ todoId: "todo-1", action: "mark_done", usedAt: null, expiresAt: past() });
    const result = await previewEmailActionToken("raw");
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(updateCalls).toBe(0);
  });

  test("calling preview repeatedly never marks the token used", async () => {
    reset({ todoId: "todo-1", action: "note_ack", usedAt: null, expiresAt: future() });
    for (let i = 0; i < 5; i++) {
      const result = await previewEmailActionToken("raw");
      expect(result).toEqual({ ok: true, todoId: "todo-1", action: "note_ack" });
    }
    expect(updateCalls).toBe(0);
    expect(row!.usedAt).toBeNull();
  });
});

describe("consumeEmailActionToken (POST, the only path that marks a token used)", () => {
  test("valid token: returns ok+action and calls UPDATE exactly once", async () => {
    reset({ todoId: "todo-1", action: "mark_done", usedAt: null, expiresAt: future() });
    const result = await consumeEmailActionToken("raw");
    expect(result).toEqual({ ok: true, todoId: "todo-1", action: "mark_done" });
    expect(updateCalls).toBe(1);
  });

  test("not found: ok:false, never calls UPDATE", async () => {
    reset(undefined);
    const result = await consumeEmailActionToken("raw");
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(updateCalls).toBe(0);
  });

  test("already used (pre-check): ok:false, never calls UPDATE", async () => {
    reset({ todoId: "todo-1", action: "mark_done", usedAt: new Date(), expiresAt: future() });
    const result = await consumeEmailActionToken("raw");
    expect(result).toEqual({ ok: false, reason: "already_used" });
    expect(updateCalls).toBe(0);
  });

  test("expired: ok:false, never calls UPDATE", async () => {
    reset({ todoId: "todo-1", action: "mark_done", usedAt: null, expiresAt: past() });
    const result = await consumeEmailActionToken("raw");
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(updateCalls).toBe(0);
  });

  test("lost the race to a simultaneous click: pre-check passes but the atomic UPDATE returns no row -> already_used", async () => {
    reset({ todoId: "todo-1", action: "mark_done", usedAt: null, expiresAt: future() }, { updateReturnsRow: false });
    const result = await consumeEmailActionToken("raw");
    expect(result).toEqual({ ok: false, reason: "already_used" });
    expect(updateCalls).toBe(1);
  });
});
