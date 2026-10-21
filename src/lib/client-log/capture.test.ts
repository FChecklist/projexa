/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createCapture, DEDUPE_WINDOW_MS, type OutboxLike } from "./capture";
import { describeWrite, markSubmitSignal, trackedCall, wrapFetch } from "./fetch-capture";
import { redactDeep, safePath, scrubText } from "./redact";
import type { ClientLogEvent } from "./types";

function rig(route = "/budgets/41") {
  let t = 1_700_000_000_000;
  let n = 0;
  const queue: ClientLogEvent[] = [];
  const outbox: OutboxLike = {
    enqueue: (e) => void queue.push(e),
    patch: (id, fn) => {
      const i = queue.findIndex((e) => e.id === id);
      if (i < 0) return false;
      queue[i] = fn(queue[i]!);
      return true;
    },
  };
  const capture = createCapture(
    {
      now: () => t, newId: () => `ev-${++n}`, sessionId: "sess-1", getRoute: () => route, getProjectId: () => "proj-9",
      getContext: () => ({ userAgent: "UA", platform: "Win", screen: "800x600@1", language: "en", online: true, appVersion: "v1" }),
    },
    outbox
  );
  return { capture, queue, tick: (ms: number) => void (t += ms) };
}

describe("capture: errors", () => {
  test("an error becomes one complete event: message, stack, screen, project, session, device, the steps before it", () => {
    const r = rig();
    r.capture.crumb("nav", "Opened /budgets/41");
    r.capture.crumb("click", "Save");
    const err = new Error("Cannot read properties of undefined (reading 'total')");
    r.capture.captureError({ kind: "error", message: err, stack: err.stack });
    expect(r.queue.length).toBe(1);
    const e = r.queue[0]!;
    expect(e).toMatchObject({ kind: "error", severity: "error", route: "/budgets/41", projectId: "proj-9", sessionId: "sess-1", outcome: null });
    expect(e.message).toContain("Cannot read properties of undefined");
    expect(e.stack).toContain("Error:");
    expect(e.context).toMatchObject({ userAgent: "UA", platform: "Win", appVersion: "v1", online: true });
    expect(e.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(e.breadcrumbs.map((b) => [b.type, b.label])).toEqual([["nav", "Opened /budgets/41"], ["click", "Save"], ["error", e.message.slice(0, 100)]]);
    expect(e.occurredAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  test("unhandled rejections and render errors keep their own kind", () => {
    const r = rig();
    r.capture.captureError({ kind: "unhandled_rejection", message: "Promise failed" });
    r.capture.captureError({ kind: "render_error", message: "Boom while drawing" });
    expect(r.queue.map((e) => e.kind)).toEqual(["unhandled_rejection", "render_error"]);
  });

  test("the same problem within 30 s is counted once, with a repeat count; after 30 s it is a new event", () => {
    const r = rig();
    for (let i = 0; i < 4; i++) r.capture.captureError({ kind: "error", message: `Row ${i} missing` });
    expect(r.queue.length).toBe(1);
    expect(r.queue[0]!.context.repeatCount).toBe(3);
    r.tick(DEDUPE_WINDOW_MS + 1);
    r.capture.captureError({ kind: "error", message: "Row 7 missing" });
    expect(r.queue.length).toBe(2);
  });

  test("capturing never throws, whatever it is given", () => {
    const r = rig();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => r.capture.captureError({ kind: "error", message: cyclic })).not.toThrow();
    expect(() => r.capture.captureError({ kind: "error", message: undefined })).not.toThrow();
    expect(() => r.capture.captureAction({ actionName: "x", outcome: "ok" })).not.toThrow();
  });
});

describe("capture: redaction (secrets never reach the outbox)", () => {
  test("passwords, tokens, keys, bearer headers and JWTs are hidden in messages, stacks and steps", () => {
    const r = rig();
    const AWS = ["AKIA", "1234567890"].join(""); // built at run time: secret scanners flag such literals
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijk"].join(".");
    r.capture.crumb("click", "Sign in password=hunter2");
    r.capture.captureError({
      kind: "error",
      message: `Login failed {"password":"hunter2","token":"tok_secret_123"} api_key=${AWS} Authorization: Bearer abcdef123456 jwt ${jwt} key: s3cr3t`,
      stack: `Error: x password=hunter2\n    at fn (https://a/b.js:1:1)`,
    });
    const text = JSON.stringify(r.queue[0]);
    for (const secret of ["hunter2", "tok_secret_123", AWS, "abcdef123456", jwt, "s3cr3t"]) expect(text).not.toContain(secret);
    expect(text).toContain("[hidden]");
  });

  test("redactDeep blanks fields NAMED like secrets and scrubs strings", () => {
    const out = redactDeep({ password: "p", token: "t", key: "k", apiKey: "x", ok: "fine", nested: { secret: "s", note: "token=abc999" } });
    expect(out).toEqual({ password: "[hidden]", token: "[hidden]", key: "[hidden]", apiKey: "[hidden]", ok: "fine", nested: { secret: "[hidden]", note: "token=[hidden]" } });
  });

  test("scrubText caps length, safePath drops the query string", () => {
    expect(scrubText("x".repeat(900), 500).length).toBe(500);
    expect(safePath("https://px.test/api/budgets/12?token=abc&q=secret#x")).toBe("/api/budgets/12");
  });
});

describe("fetch capture", () => {
  const origin = "https://px.test";
  function wrapped(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, route = "/budgets/41", extra: { isOnline?: () => boolean; isLeaving?: () => boolean } = {}) {
    const r = rig(route);
    let t = 5_000;
    const calls: { input: unknown; init?: RequestInit }[] = [];
    const original = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      t += 120;
      return impl(input, init);
    }) as typeof fetch;
    const f = wrapFetch(original, { capture: r.capture, origin: () => origin, now: () => t, getProjectId: () => "proj-9", ...extra });
    return { ...r, f, calls };
  }
  const settle = () => new Promise((res) => setTimeout(res, 0));

  test("a failed API call is recorded with path, method, status, the server's own words (truncated, scrubbed), request id and duration - and the caller still gets the untouched response", async () => {
    const w = wrapped(async () => new Response(JSON.stringify({ error: `Budget is locked. token=tok_abc999 ${"x".repeat(900)}` }), { status: 409, headers: { "x-request-id": "req-77", "content-type": "application/json" } }));
    const res = await w.f("/api/budgets/12?secret=1", { method: "PATCH", body: JSON.stringify({ password: "hunter2", amount: 5 }), headers: { Authorization: "Bearer abcdef123456", Cookie: "sb=xyz" } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Budget is locked"); // body still readable by the caller
    await settle();
    const e = w.queue.find((x) => x.kind === "api_failure")!;
    expect(e).toMatchObject({ apiPath: "/api/budgets/12", httpMethod: "PATCH", httpStatus: 409, requestId: "req-77", durationMs: 120 });
    expect(e.message).toContain("Budget is locked");
    expect(e.message.length).toBeLessThan(700);
    const text = JSON.stringify(w.queue);
    for (const secret of ["hunter2", "abcdef123456", "tok_abc999", "sb=xyz", "secret=1"]) expect(text).not.toContain(secret); // body, headers, query never captured
  });

  test("a network failure and a timeout are failures (status 0); a quick cancel is not", async () => {
    const down = wrapped(async () => { throw new TypeError("Failed to fetch"); });
    await expect(down.f("/api/projects")).rejects.toThrow("Failed to fetch");
    expect(down.queue[0]).toMatchObject({ kind: "api_failure", httpStatus: 0, apiPath: "/api/projects", httpMethod: "GET" });
    expect(down.queue[0]!.message).toContain("could not reach the server");

    const slow = wrapped(async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
    await expect(slow.f("/api/projects")).rejects.toThrow();
    expect(slow.queue[0]!.message).toContain("did not answer in time");

    const cancelled = wrapped(async () => { const e = new Error("a"); e.name = "AbortError"; throw e; });
    await expect(cancelled.f("/api/projects")).rejects.toThrow();
    expect(cancelled.queue.length).toBe(0);
  });

  test("offline: a call made while the browser says it has no network is not logged as a problem, a call made online still is", async () => {
    let online = false;
    const offline = wrapped(async () => { throw new TypeError("Failed to fetch"); }, "/budgets/41", { isOnline: () => online });
    await expect(offline.f("/api/projects")).rejects.toThrow();
    await expect(offline.f("/api/budgets/1", { method: "PATCH" })).rejects.toThrow();
    expect(offline.queue.length).toBe(0); // no api_failure and no failed action
    online = true;
    await expect(offline.f("/api/projects")).rejects.toThrow();
    expect(offline.queue.map((e) => e.kind)).toEqual(["api_failure"]);
    // started online, the network dropped before it failed: also expected
    let flip = true;
    const drop = wrapped(async () => { flip = false; throw new TypeError("Failed to fetch"); }, "/budgets/41", { isOnline: () => flip });
    await expect(drop.f("/api/projects")).rejects.toThrow();
    expect(drop.queue.length).toBe(0);
  });

  test("a call cut off because the page is going away is not a problem", async () => {
    const gone = wrapped(async () => { throw new TypeError("Failed to fetch"); }, "/budgets/41", { isOnline: () => true, isLeaving: () => true });
    await expect(gone.f("/api/projects")).rejects.toThrow();
    expect(gone.queue.length).toBe(0);
  });

  test("writes are actions in plain words; background writes (drafts, preferences, sync) are not", async () => {
    const w = wrapped(async () => new Response("{}", { status: 200 }));
    await w.f("/api/scope/3f2a9c1e-1111-4222-8333-444455556666", { method: "PATCH" });
    await w.f("/api/screen-drafts", { method: "POST" });
    await w.f("/api/local-first/client-error", { method: "POST" });
    await w.f("/api/user-preference", { method: "PUT" });
    expect(w.queue.map((e) => [e.kind, e.actionName, e.outcome])).toEqual([["action", "Saved a BOQ", "ok"]]);
    const bad = wrapped(async () => new Response("{}", { status: 403 }));
    await bad.f("/api/scope/3f2a9c1e-1111-4222-8333-444455556666/approve", { method: "POST" });
    expect(bad.queue.filter((e) => e.kind === "action").map((e) => [e.actionName, e.outcome])).toEqual([["Approved a BOQ", "failed"]]);
  });

  test("a successful write is an action with outcome ok; reads are only steps; the log's own endpoints are never tracked", async () => {
    const w = wrapped(async () => new Response("{}", { status: 200 }));
    await w.f("/api/budgets/12/approve", { method: "POST" });
    await w.f("/api/budgets");
    await w.f("/api/client-logs", { method: "POST" });
    await w.f("/api/local-first/client-error", { method: "POST" });
    await w.f("https://other.example/api/x", { method: "POST" });
    expect(w.queue.map((e) => [e.kind, e.outcome, e.actionName])).toEqual([["action", "ok", "Approved a budget"]]);
    expect(w.queue[0]).toMatchObject({ projectId: "proj-9", httpMethod: "POST", apiPath: "/api/budgets/12/approve", durationMs: 120 });
    expect(w.capture.breadcrumbs.snapshot().map((b) => b.label)).toEqual(["POST /api/budgets/12/approve 200 120ms", "GET /api/budgets 200 120ms"]);
  });

  test("a write that already reports itself through the submit hook is not also written as a generic action", async () => {
    const w = wrapped(async () => new Response("{}", { status: 200 }));
    const guard = new AbortController();
    markSubmitSignal(guard.signal);
    await w.f("/api/permits", { method: "POST", signal: guard.signal });
    expect(w.queue.length).toBe(0);
  });

  test("the edge function answers the same routes: tracked by its API path", () => {
    expect(trackedCall("https://x.supabase.co/functions/v1/projexa-api/api/exceptions?projectId=1", undefined, origin)).toEqual({ method: "GET", path: "/api/exceptions" });
    expect(trackedCall("/_next/static/a.js", undefined, origin)).toBeNull();
    expect(describeWrite("DELETE", "/api/permits/3f2a9c1e-1111-4222-8333-444455556666")).toBe("Deleted a permit");
    expect(describeWrite("PATCH", "/api/scope/3f2a9c1e-1111-4222-8333-444455556666")).toBe("Saved a BOQ");
    expect(describeWrite("POST", "/api/scope/3f2a9c1e-1111-4222-8333-444455556666/approve")).toBe("Approved a BOQ");
  });
});

describe("capture: actions", () => {
  test("an action carries name, outcome, duration and project; failed ones are warnings", () => {
    const r = rig();
    r.capture.captureAction({ actionName: "Create Permit", outcome: "failed", durationMs: 840 });
    r.capture.captureAction({ actionName: "Create Permit", outcome: "ok", durationMs: 200 });
    expect(r.queue.map((e) => [e.kind, e.severity, e.outcome, e.durationMs, e.projectId])).toEqual([
      ["action", "warning", "failed", 840, "proj-9"],
      ["action", "info", "ok", 200, "proj-9"],
    ]);
  });
});
