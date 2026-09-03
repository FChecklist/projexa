/// <reference types="bun-types" />
// R67 D-12. Same omission as ../route.ts, with a worse consequence: this relay
// promises in its own header comment that "the exported register is exactly the
// register on screen", and it dropped `status`. The screen filters to Current
// by default, so Export handed the reader a workbook full of superseded
// revisions under a filename that said otherwise -- a wrong answer they take
// away and act on, rather than one they can see is wrong.
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
  callVeridianRaw: async (path: string) => {
    lastPath = path;
    if (mockError) throw new MockVeridianApiError(mockError.message, mockError.status);
    return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="drawings.xlsx"',
      },
    });
  },
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
  const url = `http://test/api/drawings/export${query}`;
  const req = new Request(url) as unknown as import("next/server").NextRequest;
  Object.defineProperty(req, "nextUrl", { value: new URL(url), configurable: true });
  return req;
}

function forwarded(): URLSearchParams {
  return new URLSearchParams((lastPath ?? "").split("?")[1] ?? "");
}

describe("GET /api/drawings/export", () => {
  test("exports what is on screen: status travels with kind and discipline", async () => {
    mockCtx = ctx();
    mockError = null;
    const res = await GET(request("?projectId=proj-1&status=current&kind=dwg&discipline=Structural"));
    expect(res.status).toBe(200);
    const params = forwarded();
    expect(params.get("status")).toBe("current");
    expect(params.get("kind")).toBe("dwg");
    expect(params.get("discipline")).toBe("Structural");
  });

  test("the XLSX bytes and both headers are relayed unchanged -- projexa builds no workbook of its own", async () => {
    mockCtx = ctx();
    mockError = null;
    const res = await GET(request("?projectId=proj-1"));
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="drawings.xlsx"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  });

  test("projectId is still required, and no upstream call is made without it", async () => {
    mockCtx = ctx();
    mockError = null;
    lastPath = null;
    const res = await GET(request("?status=current"));
    expect(res.status).toBe(400);
    expect(lastPath).toBeNull();
  });

  test("an unauthenticated caller never reaches VERIDIAN", async () => {
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    mockError = null;
    lastPath = null;
    const res = await GET(request("?projectId=proj-1"));
    expect(res.status).toBe(401);
    expect(lastPath).toBeNull();
  });
});
