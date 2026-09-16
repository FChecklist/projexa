/// <reference types="bun-types" />
import { describe, expect, test, mock } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";
import { NextResponse } from "next/server";

let mockCtx: AuthContext;
let getMyAiLinkResult: unknown;
let getOrCreateResult: unknown;
let rotateResult: unknown;
let revokeCalled = false;

let getMyAiLinkCall: { organizationId: string; userId: string } | null = null;
let getOrCreateCall: { organizationId: string; userId: string } | null = null;
let rotateCall: { organizationId: string; userId: string } | null = null;
let revokeCall: { organizationId: string; userId: string } | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/services/ai-link-service", () => ({
  getMyAiLink: async (organizationId: string, userId: string) => {
    getMyAiLinkCall = { organizationId, userId };
    return getMyAiLinkResult;
  },
  getOrCreateMyAiLink: async (organizationId: string, userId: string) => {
    getOrCreateCall = { organizationId, userId };
    return getOrCreateResult;
  },
  rotateMyAiLink: async (organizationId: string, userId: string) => {
    rotateCall = { organizationId, userId };
    return rotateResult;
  },
  revokeMyAiLink: async (organizationId: string, userId: string) => {
    revokeCall = { organizationId, userId };
    revokeCalled = true;
  },
}));

const { GET, POST } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "owner", response: null };
}

function post(body: unknown) {
  return { json: async () => body } as never;
}

function resetCalls() {
  getMyAiLinkCall = null;
  getOrCreateCall = null;
  rotateCall = null;
  revokeCall = null;
  revokeCalled = false;
}

describe("GET /api/ai-link", () => {
  test("no existing link returns {link: null}", async () => {
    resetCalls();
    mockCtx = ctx();
    getMyAiLinkResult = null;

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ link: null });
    expect(getMyAiLinkCall).toEqual({ organizationId: "org1", userId: "u1" });
  });

  test("an existing link is wrapped as the public /api/ai/<token> URL", async () => {
    resetCalls();
    mockCtx = ctx();
    const createdAt = "2026-09-10T00:00:00.000Z";
    getMyAiLinkResult = { token: "tok-abc123", createdAt };

    const res = await GET();
    const body = (await res.json()) as { link: { url: string; createdAt: string } };
    expect(body.link.url).toBe(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100"}/api/ai/tok-abc123`);
    expect(body.link.createdAt).toBe(createdAt);
  });

  test("requireAuth() refusal short-circuits before the service is called", async () => {
    resetCalls();
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

    const res = await GET();
    expect(res.status).toBe(401);
    expect(getMyAiLinkCall).toBeNull();
  });
});

describe("POST /api/ai-link", () => {
  test("default action (create) calls getOrCreateMyAiLink with (organizationId, userId)", async () => {
    resetCalls();
    mockCtx = ctx();
    getOrCreateResult = { token: "tok-created", createdAt: "2026-09-11T00:00:00.000Z" };

    const res = await POST(post({}));
    const body = (await res.json()) as { link: { url: string; createdAt: string } };
    expect(res.status).toBe(200);
    expect(body.link.url).toBe(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100"}/api/ai/tok-created`);
    expect(getOrCreateCall).toEqual({ organizationId: "org1", userId: "u1" });
    expect(rotateCall).toBeNull();
    expect(revokeCalled).toBe(false);
  });

  test("action=rotate calls rotateMyAiLink with (organizationId, userId), never getOrCreate", async () => {
    resetCalls();
    mockCtx = ctx();
    rotateResult = { token: "tok-rotated", createdAt: "2026-09-12T00:00:00.000Z" };

    const res = await POST(post({ action: "rotate" }));
    const body = (await res.json()) as { link: { url: string } };
    expect(res.status).toBe(200);
    expect(body.link.url).toContain("tok-rotated");
    expect(rotateCall).toEqual({ organizationId: "org1", userId: "u1" });
    expect(getOrCreateCall).toBeNull();
  });

  test("action=revoke calls revokeMyAiLink with (organizationId, userId) and returns {link: null}", async () => {
    resetCalls();
    mockCtx = ctx();

    const res = await POST(post({ action: "revoke" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ link: null });
    expect(revokeCall).toEqual({ organizationId: "org1", userId: "u1" });
    // Revoke never falls through to create/rotate.
    expect(getOrCreateCall).toBeNull();
    expect(rotateCall).toBeNull();
  });

  test("an unknown action falls through to the default create path, not an error", async () => {
    resetCalls();
    mockCtx = ctx();
    getOrCreateResult = { token: "tok-fallback", createdAt: "2026-09-13T00:00:00.000Z" };

    const res = await POST(post({ action: "nonsense" }));
    expect(res.status).toBe(200);
    expect(getOrCreateCall).toEqual({ organizationId: "org1", userId: "u1" });
  });

  test("missing organizationId on ctx returns 400 without calling any service function", async () => {
    resetCalls();
    mockCtx = { user: { id: "u1", email: "u1@example.com" }, organizationId: null, role: "owner", response: null };

    const res = await POST(post({ action: "rotate" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No organization" });
    expect(rotateCall).toBeNull();
    expect(getOrCreateCall).toBeNull();
    expect(revokeCalled).toBe(false);
  });

  test("requireAuth() refusal short-circuits before any service function is called", async () => {
    resetCalls();
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

    const res = await POST(post({ action: "revoke" }));
    expect(res.status).toBe(401);
    expect(getOrCreateCall).toBeNull();
    expect(rotateCall).toBeNull();
    expect(revokeCalled).toBe(false);
  });

  test("an unparseable body falls back to {} and still defaults to create", async () => {
    resetCalls();
    mockCtx = ctx();
    getOrCreateResult = { token: "tok-noBody", createdAt: "2026-09-14T00:00:00.000Z" };

    const badBody = { json: async () => { throw new Error("not json"); } } as never;
    const res = await POST(badBody);
    expect(res.status).toBe(200);
    expect(getOrCreateCall).toEqual({ organizationId: "org1", userId: "u1" });
  });
});
