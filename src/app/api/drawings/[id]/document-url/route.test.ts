/// <reference types="bun-types" />
// R67 F-02 (review fix). This relay is the ONLY way a drawing's file is opened
// now that the register hands out `hasDocument` instead of a per-row signed
// URL, so it is on a user's click path and the three things that can go wrong
// on that path are worth pinning:
//
//  1. it is not public -- an unauthenticated caller gets the auth guard's own
//     response and callVeridian is never reached (no API key is spent, and no
//     document id is probed on behalf of a caller with no session);
//  2. the caller's OWN organisation is what is forwarded. The id comes
//     straight from the URL, so the org scope is the entire anti-fishing
//     guard; a future edit that drops it would let any signed-in user mint a
//     URL for any drawing in any tenant. The assertion is on the arguments the
//     route BUILDS, not merely on what it returns, so dropping the scope fails
//     here even if the (mocked) backend would still answer;
//  3. a failure keeps the backend's own words and status. The generic
//     "Couldn't open this drawing's file" is the last resort for a
//     non-VERIDIAN throw, not the message for a real 404.
import { describe, expect, test, mock } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";
// `bun test` runs every file in ONE process and mock.module is process-wide,
// so a mock that returns only the export THIS file needs deletes the rest of
// the module for every other file (the suite already shows that as
// "Export named 'ROLE_GROUPS' not found"). Spreading the real module keeps
// every other export intact and overrides only requireAuth.
import * as realAuthGuard from "@/lib/supabase/auth-guard";
import * as realVeridianClient from "@/lib/veridian-client";
import { NextResponse } from "next/server";

let mockCtx: AuthContext;
let veridianCalls: Array<{ path: string; options: { organizationId?: string } }> = [];
let veridianResult: unknown = { documentUrl: "https://storage.example/signed", isExternalLink: false };
let veridianThrows: Error | null = null;

class MockVeridianApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuth: async () => mockCtx,
}));

// Same reasoning: keep every other export of the client module intact.
mock.module("@/lib/veridian-client", () => ({
  ...realVeridianClient,
  callVeridian: async (path: string, options: { organizationId?: string }) => {
    veridianCalls.push({ path, options });
    if (veridianThrows) throw veridianThrows;
    return veridianResult;
  },
  VeridianApiError: MockVeridianApiError,
}));

const { GET } = await import("./route");

function signedIn(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org-1", role: "member", response: null };
}

function reset() {
  veridianCalls = [];
  veridianThrows = null;
  veridianResult = { documentUrl: "https://storage.example/signed", isExternalLink: false };
  mockCtx = signedIn();
}

function call(id: string) {
  return GET(new Request(`http://test/api/drawings/${id}/document-url`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/drawings/[id]/document-url", () => {
  test("an unauthenticated caller gets the guard's response and no backend call is made", async () => {
    reset();
    mockCtx = {
      user: null,
      organizationId: null,
      role: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };

    const res = await call("d1");

    expect(res.status).toBe(401);
    expect(veridianCalls).toHaveLength(0);
  });

  test("forwards the caller's own organisation -- the whole anti-fishing guard", async () => {
    reset();

    await call("d1");

    expect(veridianCalls).toHaveLength(1);
    expect(veridianCalls[0].options.organizationId).toBe("org-1");
  });

  test("asks for the drawing named in the URL, id-encoded", async () => {
    reset();

    await call("a b/c");

    expect(veridianCalls[0].path).toBe("/drawings/a%20b%2Fc/document-url");
  });

  test("returns the backend's payload unchanged, external-link flag included", async () => {
    reset();
    veridianResult = { documentUrl: "https://drive.example/plan.pdf", isExternalLink: true };

    const res = await call("d1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documentUrl: "https://drive.example/plan.pdf", isExternalLink: true });
  });

  test("a VERIDIAN failure keeps its own status and its own words", async () => {
    reset();
    veridianThrows = new MockVeridianApiError("This drawing's file could not be opened right now. Please retry.", 502);

    const res = await call("d1");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "This drawing's file could not be opened right now. Please retry.",
    });
  });

  test("a 404 from the backend is relayed as a 404, not flattened to 502", async () => {
    reset();
    veridianThrows = new MockVeridianApiError("Drawing not found", 404);

    const res = await call("missing");

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Drawing not found");
  });

  test("a non-VERIDIAN throw falls back to 502 and the generic sentence", async () => {
    reset();
    veridianThrows = new TypeError("fetch failed");

    const res = await call("d1");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't open this drawing's file" });
  });
});
