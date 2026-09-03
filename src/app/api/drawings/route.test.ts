/// <reference types="bun-types" />
// R67 D-12. THE DEFECT THIS FILE EXISTS FOR: this proxy forwarded projectId,
// kind and discipline to VERIDIAN and silently dropped `status`. DrawingsClient
// sends &status=current from first paint (DEFAULT_FILTERS.status is "current")
// and draws a removable "Current only" chip over the result, so the register
// listed superseded and for-approval revisions under a chip claiming it did
// not -- and "Showing n of m" always read n of n, because the count query and
// the filtered query resolved to the same rows. Nothing downstream re-filters:
// whatever URL this route builds is what the table renders.
//
// There is no way to catch that from the component side (the client's request
// was correct), which is why the assertion belongs here, on the URL this route
// actually calls.
import { describe, expect, test, mock } from "bun:test";
import { NextResponse } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let lastPath: string | null = null;
let mockError: { message: string; status: number } | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

class MockVeridianApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

mock.module("@/lib/veridian-client", () => ({
  callVeridian: async (path: string) => {
    lastPath = path;
    if (mockError) throw new MockVeridianApiError(mockError.message, mockError.status);
    return { drawings: [], totalCount: 0 };
  },
  callVeridianUpload: async () => ({ id: "doc-1" }),
  VeridianApiError: MockVeridianApiError,
}));

const { GET } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "member", response: null };
}

// The route reads `request.nextUrl`, which Next populates and a bare Request
// does not, so the test supplies it -- the same URL, parsed, and nothing else
// about the request faked.
function request(query: string) {
  const url = `http://test/api/drawings${query}`;
  const req = new Request(url) as unknown as import("next/server").NextRequest;
  Object.defineProperty(req, "nextUrl", { value: new URL(url), configurable: true });
  return req;
}

/** The query string this route handed VERIDIAN, as a parsed map. */
function forwarded(): URLSearchParams {
  return new URLSearchParams((lastPath ?? "").split("?")[1] ?? "");
}

describe("GET /api/drawings", () => {
  test("forwards status, the parameter the register's default 'Current only' chip depends on", async () => {
    mockCtx = ctx();
    mockError = null;
    const res = await GET(request("?projectId=proj-1&status=current"));
    expect(res.status).toBe(200);
    expect(forwarded().get("status")).toBe("current");
  });

  test("forwards kind and discipline alongside it, so all three filters reach the backend together", async () => {
    mockCtx = ctx();
    mockError = null;
    await GET(request("?projectId=proj-1&status=current&kind=dwg&discipline=Architectural"));
    const params = forwarded();
    expect(params.get("projectId")).toBe("proj-1");
    expect(params.get("status")).toBe("current");
    expect(params.get("kind")).toBe("dwg");
    expect(params.get("discipline")).toBe("Architectural");
  });

  test("a filter the caller did not send is not invented -- the unfiltered register stays unfiltered", async () => {
    mockCtx = ctx();
    mockError = null;
    await GET(request("?projectId=proj-1"));
    const params = forwarded();
    expect(params.has("status")).toBe(false);
    expect(params.has("kind")).toBe(false);
    expect(params.has("discipline")).toBe(false);
  });

  test("projectId is still required, and no upstream call is made without it", async () => {
    mockCtx = ctx();
    mockError = null;
    lastPath = null;
    const res = await GET(request("?status=current"));
    expect(res.status).toBe(400);
    expect(lastPath).toBeNull();
  });

  test("VERIDIAN's own error message and status reach the caller, not a flattened 502", async () => {
    mockCtx = ctx();
    mockError = { message: "Unknown drawing status 'draft'", status: 400 };
    const res = await GET(request("?projectId=proj-1&status=draft"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown drawing status 'draft'");
  });

  test("an unauthenticated caller never reaches VERIDIAN", async () => {
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    mockError = null;
    lastPath = null;
    const res = await GET(request("?projectId=proj-1&status=current"));
    expect(res.status).toBe(401);
    expect(lastPath).toBeNull();
  });
});
