/// <reference types="bun-types" />
import { beforeEach, describe, expect, test, mock } from "bun:test";

// AUDIT-100 B6 / B56: an invited person joins the organisation WITHOUT anyone running SQL by hand. This route is the redemption step; it must
// (1) refuse a visitor who is not signed in, (2) refuse a request with no token, (3) hand the token to public.accept_org_invite() -- the one place
// that checks revocation, expiry, reuse and the e-mail binding and inserts the membership (drizzle/0015_org_invites.sql) -- and return the
// organisation the person is now in, and (4) pass the function's own plain-English refusal through with the right status instead of a generic one.
// The SQL itself runs in the database; what is proven here is the handler's contract with it.
//
// AUDIT-100 B55: the welcome e-mail with the person's AI prompt (src/lib/email/invite-welcome.ts) is sent exactly once per SUCCESSFUL accept,
// to the address on the verified session, for the organisation the function returned -- never for a refused, used, wrong or expired token,
// never for a visitor who is not signed in -- and the e-mail never changes the answer, even when it fails.

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
let claims: { data: { claims: { sub: string; email?: string } } | null; error: unknown };
let rpcResult: RpcResult;
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let welcomeCalls: Array<{ person: unknown; organizationId: string }> = [];
let welcomeImpl: () => Promise<unknown>;

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  }),
}));
mock.module("@/lib/supabase/get-claims-with-retry", () => ({ getClaimsWithRetry: async () => claims }));
mock.module("@/lib/email/invite-welcome", () => ({
  sendInviteWelcome: async (_supabase: unknown, person: unknown, organizationId: string) => {
    order.push("welcome");
    welcomeCalls.push({ person, organizationId });
    return welcomeImpl();
  },
  freshSession: () => ({ accessToken: async () => sessionToken, refresh: async () => sessionToken }),
}));
// AUDIT-100 (link-invited-members): the member link step, recorded (its own behaviour is src/lib/veridian-member-link.test.ts)
let sessionToken: string | null = "session-tok";
let linkCalls: Array<string | null | undefined> = [];
let linkImpl: () => Promise<{ linked: boolean; outcome: string }>;
let order: string[] = [];
mock.module("@/lib/veridian-member-link", () => ({
  requestMemberLink: async (token: string | null | undefined) => {
    order.push("link");
    linkCalls.push(token);
    return linkImpl();
  },
}));

const { POST } = await import("./route");

const request = (body: unknown) =>
  new Request("http://localhost/api/org/invites/accept", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  claims = { data: { claims: { sub: "user-1", email: "new.person@example.com" } }, error: null };
  rpcResult = { data: "org-42", error: null };
  rpcCalls = [];
  welcomeCalls = [];
  welcomeImpl = async () => ({ status: "sent", emailId: "em_1", linkId: "l1", level: 0 });
  sessionToken = "session-tok";
  linkCalls = [];
  linkImpl = async () => ({ linked: true, outcome: "created" });
  order = [];
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
    expect(welcomeCalls).toEqual([]);
  });

  test("no token, an empty token, or a body that is not JSON is a 400 and nothing is redeemed", async () => {
    for (const body of [{}, { token: "   " }, "not json"]) {
      const res = await POST(request(body));
      expect(res.status).toBe(400);
    }
    expect(rpcCalls).toEqual([]);
    expect(welcomeCalls).toEqual([]);
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
    expect(welcomeCalls).toEqual([]);
  });
});

describe("the welcome e-mail with the AI prompt (B55)", () => {
  test("a successful accept sends it ONCE, to the session's own address, for the organisation the function returned", async () => {
    const res = await POST(request({ token: "tok-abc" }));
    expect(res.status).toBe(200);
    expect(welcomeCalls).toEqual([{ person: { email: "new.person@example.com" }, organizationId: "org-42" }]);
  });

  test("accepting the same invitation twice: the second accept is refused by the database and sends NOTHING (one e-mail in all)", async () => {
    expect((await POST(request({ token: "tok-abc" }))).status).toBe(200);
    rpcResult = { data: null, error: { code: "P0001", message: "This invitation has already been used." } };
    const again = await POST(request({ token: "tok-abc" }));
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "This invitation has already been used." });
    expect(welcomeCalls).toHaveLength(1);
  });

  test("an expired or revoked invitation sends nothing", async () => {
    for (const message of ["This invitation has expired. Ask an administrator for a new one.", "This invitation has been revoked."]) {
      rpcResult = { data: null, error: { code: "P0001", message } };
      expect((await POST(request({ token: "tok-abc" }))).status).toBe(400);
    }
    expect(welcomeCalls).toEqual([]);
  });

  test("the e-mail never changes the answer: a skipped, failed or throwing welcome still joins with 200", async () => {
    for (const impl of [
      async () => ({ status: "skipped", reason: "mint_failed" }),
      async () => ({ status: "send_failed", linkId: "l1" }),
      async () => { throw new Error("resend down"); },
    ]) {
      welcomeImpl = impl;
      const res = await POST(request({ token: "tok-abc" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ organizationId: "org-42" });
    }
    expect(welcomeCalls).toHaveLength(3);
  });

  test("an account with no e-mail on its session is still attached; the sender is told there is no address", async () => {
    claims = { data: { claims: { sub: "user-1" } }, error: null };
    const res = await POST(request({ token: "tok-abc" }));
    expect(res.status).toBe(200);
    expect(welcomeCalls).toEqual([{ person: { email: null }, organizationId: "org-42" }]);
    expect(linkCalls).toEqual(["session-tok"]);
  });
});

describe("the new member gets their own VERIDIAN user (AUDIT-100 link-invited-members)", () => {
  test("a successful accept links the member ONCE, with the person's own session token, BEFORE the welcome e-mail mints their link", async () => {
    const res = await POST(request({ token: "tok-abc" }));
    expect(res.status).toBe(200);
    expect(linkCalls).toEqual(["session-tok"]);
    expect(order).toEqual(["link", "welcome"]);
  });

  test("a refused, used, expired or unknown invitation, a visitor and a bad body link nobody", async () => {
    for (const error of [{ code: "P0001", message: "This invitation has already been used." }, { code: "P0002", message: "This invitation link is not valid." }]) {
      rpcResult = { data: null, error };
      await POST(request({ token: "tok-abc" }));
    }
    claims = { data: null, error: new Error("no session") };
    await POST(request({ token: "tok-abc" }));
    claims = { data: { claims: { sub: "user-1", email: "new.person@example.com" } }, error: null };
    await POST(request({}));
    expect(linkCalls).toEqual([]);
  });

  test("the link step never changes the answer: not linked, throwing, or no session -> still 200, and the welcome still runs", async () => {
    for (const impl of [
      async () => ({ linked: false, outcome: "email_taken" }),
      async () => ({ linked: false, outcome: "http_503" }),
      async () => { throw new Error("edge down"); },
    ]) {
      linkImpl = impl;
      const res = await POST(request({ token: "tok-abc" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ organizationId: "org-42" });
    }
    sessionToken = null;
    expect((await POST(request({ token: "tok-abc" }))).status).toBe(200);
    expect(linkCalls).toEqual(["session-tok", "session-tok", "session-tok", null]);
    expect(welcomeCalls).toHaveLength(4);
  });

  test("a link step that hangs is cut off by its budget: the accept still answers 200 (never blocks)", async () => {
    linkImpl = () => new Promise(() => {});
    const started = Date.now();
    const res = await POST(request({ token: "tok-abc" }));
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(12_000);
    expect(welcomeCalls).toHaveLength(1);
  }, 20_000);

  test("no e-mail on the session: the link step still runs (the service decides), the accept is unchanged", async () => {
    claims = { data: { claims: { sub: "user-1" } }, error: null };
    const res = await POST(request({ token: "tok-abc" }));
    expect(res.status).toBe(200);
    expect(welcomeCalls).toEqual([{ person: { email: null }, organizationId: "org-42" }]);
    expect(linkCalls).toEqual(["session-tok"]);
  });
});
