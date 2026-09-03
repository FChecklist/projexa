/// <reference types="bun-types" />
// R67 WS-A (A-17), review fix -- THE ONE NEW AUTHENTICATED ENDPOINT IN THIS
// LANE, AND THE TWO PROPERTIES ITS OWN HEADER CLAIMS.
//
//   1. IT IS BEHIND requireAuth. It is reached from the composer, which only
//      renders for a signed-in user, but a route is reachable by anyone who
//      types its path.
//   2. IT TAKES NO DESTINATION. The route's comment says "a route that
//      redirected to a caller-supplied URL would be an open redirect", and the
//      thing that makes that true is that GET accepts no argument at all -- it
//      cannot read a query string even if one is sent. That is a signature, and
//      a signature is exactly the kind of thing that changes by accident when
//      somebody later wants "?to=/permits", so it is asserted here rather than
//      left as prose.
import { describe, expect, test, mock } from "bun:test";
import { NextResponse } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

const ORIGIN = "https://veridian.example";

let mockCtx: AuthContext;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

// The real module reads VERIDIAN_API_BASE_URL and imports the database, which
// is the whole reason this redirect exists instead of a client-side constant.
mock.module("@/lib/veridian-client", () => ({ VERIDIAN_ORIGIN: ORIGIN }));

const { GET } = await import("./route");

const SIGNED_IN: AuthContext = {
  user: { id: "u1", email: "u1@example.com" },
  organizationId: "org1",
  role: "owner",
  response: null,
};

describe("GET /api/veridian-link", () => {
  test("an unauthenticated caller gets the guard's own refusal, not a redirect", async () => {
    mockCtx = {
      user: null,
      organizationId: null,
      role: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  test("a signed-in caller is redirected to the configured VERIDIAN origin", async () => {
    mockCtx = SIGNED_IN;
    const res = await GET();
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(new URL(location!).origin).toBe(ORIGIN);
  });

  test("it opens VERIDIAN's front door and nothing deeper -- no path, query or fragment", async () => {
    mockCtx = SIGNED_IN;
    const target = new URL((await GET()).headers.get("location")!);
    expect(target.pathname).toBe("/");
    expect(target.search).toBe("");
    expect(target.hash).toBe("");
  });

  test("the handler takes no argument, so no caller can supply a destination", () => {
    // This is the open-redirect property as a fact about the code rather than a
    // promise in a comment: a handler with no Request parameter cannot read a
    // query string, a header or a body.
    expect(GET.length).toBe(0);
  });
});
