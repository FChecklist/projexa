/// <reference types="bun-types" />
import { beforeEach, describe, expect, test, mock } from "bun:test";

// AUDIT-100 B6 / B56: an invited person joins the organisation WITHOUT anyone running SQL by hand. This route is the redemption step; it must
// (1) refuse a visitor who is not signed in, (2) refuse a request with no token, (3) hand the token to public.accept_org_invite() -- the one place
// that checks revocation, expiry, reuse and the e-mail binding and inserts the membership (drizzle/0015_org_invites.sql) -- and return the
// organisation the person is now in, and (4) pass the function's own plain-English refusal through with the right status instead of a generic one.
// The SQL itself runs in the database; what is proven here is the handler's contract with it.

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
let claims: { data: { claims: { sub: string } } | null; error: unknown };
let rpcResult: RpcResult;
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  }),
}));
mock.module("@/lib/supabase/get-claims-with-retry", () => ({ getClaimsWithRetry: async () => claims }));

const { POST } = await import("./route");

const request = (body: unknown) =>
  new Request("http://localhost/api/org/invites/accept", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  claims = { data: { claims: { sub: "user-1" } }, error: null };
  rpcResult = { data: "org-42", error: null };
  rpcCalls = [];
});

describe("POST /api/org/invites/accept", () => {
  test("a signed-in invitee with a good token joins and is told which organisation", async () => {
    const res = await POST(request({ token: "  tok-abc  " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ organizationId: "org-42" });
    expect(rpcCalls).toEqual([{ fn: "accept_org_invite", args: { p_token: "tok-abc" } }]);
  });

  test("a visitor who is not signed in is refused and nothing is redeemed", async () => {
    claims = { data: null, error: new Error("no session") };
    const res = await POST(request({ token: "tok-abc" }));
    expect(res.status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });

  test("no token, an empty token, or a body that is not JSON is a 400 and nothing is redeemed", async () => {
    for (const body of [{}, { token: "   " }, "not json"]) {
      const res = await POST(request(body));
      expect(res.status).toBe(400);
    }
    expect(rpcCalls).toEqual([]);
  });

  test("the database's own refusal (wrong e-mail, used, revoked, expired) reaches the person verbatim; an unknown token is a 404", async () => {
    rpcResult = { data: null, error: { code: "P0001", message: "This invitation was sent to a different email address." } };
    const refused = await POST(request({ token: "tok-abc" }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "This invitation was sent to a different email address." });

    rpcResult = { data: null, error: { code: "P0002", message: "This invitation link is not valid." } };
    const unknown = await POST(request({ token: "nope" }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "This invitation link is not valid." });
  });
});
