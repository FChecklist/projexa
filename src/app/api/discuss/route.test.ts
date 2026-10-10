/// <reference types="bun-types" />
// Internal AI (the Claude Code bridge on the owner's laptop) needs 12 s or more per answer. The default 8 s upstream
// budget made every Discuss call end as UPSTREAM_TIMEOUT on the live site (2026-10-10). This pins the model-sized budget.
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { NextRequest } from "next/server";

let calls: Array<{ path: string; options: Record<string, unknown> }>;
mock.module("@/lib/supabase/auth-guard", () => ({ requireAuth: async () => ({ organizationId: "org1", user: { id: "u1" } }) }));
const realClient = await import("@/lib/veridian-client");
mock.module("@/lib/veridian-client", () => ({
  ...realClient,
  callVeridian: async (path: string, options: Record<string, unknown>) => { calls.push({ path, options }); return { reply: "PONG" }; },
}));

const { POST, maxDuration } = await import("./route");

describe("POST /api/discuss", () => {
  beforeEach(() => { calls = []; });
  test("asks the backend with a model-sized time budget and says so to the host", async () => {
    const res = await POST(new NextRequest("http://x/api/discuss", { method: "POST", body: JSON.stringify({ message: "hi" }) }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/discuss");
    expect(calls[0].options.timeoutMs).toBe(55_000);
    expect(maxDuration).toBeGreaterThanOrEqual(60);
  });
});
