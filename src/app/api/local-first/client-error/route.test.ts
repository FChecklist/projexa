import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { POST } from "./route";

// AUDIT-100 A33 / B57: the server end of error capture. The real handler is called; the only thing replaced is console.error, which is
// where the `[client-error]` line lands in the Vercel runtime log (that line is what we grep for).

let lines: string[] = [];
const realError = console.error;
beforeEach(() => {
  lines = [];
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
});
afterEach(() => {
  console.error = realError;
});

const post = (body: string) =>
  POST(new NextRequest("http://localhost/api/local-first/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body }), { params: Promise.resolve({}) } as never);

describe("POST /api/local-first/client-error", () => {
  test("a report becomes one greppable [client-error] line with only the data-free fields", async () => {
    const res = await post(JSON.stringify({ reports: [{ kind: "outbox_push_server", message: "SyncError: HTTP 503", where: "outbox:push", at: "2026-10-05T10:00:00Z", secret: "must-not-appear" }] }));
    expect(res.status).toBe(204);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith("[client-error] ");
    const parsed = JSON.parse(lines[0].slice("[client-error] ".length));
    expect(parsed).toEqual({ kind: "outbox_push_server", message: "SyncError: HTTP 503", where: "outbox:push", at: "2026-10-05T10:00:00Z" });
    expect(lines[0]).not.toContain("must-not-appear");
  });
  test("works without signing in (a login failure is exactly what we need to hear about)", async () => {
    const res = await post(JSON.stringify({ reports: [{ kind: "window_error", message: "boom" }] }));
    expect(res.status).toBe(204);
  });
  test("at most 20 reports per request, long text is cut", async () => {
    const reports = Array.from({ length: 25 }, (_, i) => ({ kind: "k", message: "m".repeat(500) + i }));
    await post(JSON.stringify({ reports }));
    expect(lines).toHaveLength(20);
    expect(JSON.parse(lines[0].slice("[client-error] ".length)).message.length).toBe(300);
  });
  test("refuses a body that is too large, not JSON, or not a list", async () => {
    expect((await post("x".repeat(20_000))).status).toBe(413);
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ reports: "no" }))).status).toBe(400);
    expect(lines).toHaveLength(0);
  });
});
