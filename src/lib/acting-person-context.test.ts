/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-20b -- the acting person reaches VERIDIAN on every call a
// signed-in route makes, and ONLY that person.
//
// Everything that decides the outcome runs for real: withTiming() (opens the
// per-request scope), requireAuth() (verifies the session and records the
// person), veridian-client (builds the outbound request), and -- for the
// route-level cases -- a real route file, /api/scope/categories. Only three
// things are faked, each at the boundary it stands for:
//   - @/lib/supabase/server: the Supabase client requireAuth() asks for the
//     JWT claims and the membership row. Which session a request carries is
//     held in `cookieJar`, a test-side AsyncLocalStorage that plays the part of
//     Next's own per-request cookie store, so overlapping requests really do
//     carry different sessions.
//   - @/lib/db: the per-org API key lookup (no database in a unit test).
//   - globalThis.fetch: the network, recorded so the outbound headers and body
//     can be read back.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { NextRequest, NextResponse } from "next/server";
import * as schema from "@/lib/db/schema";

type Session = { userId: string; email: string | null; orgId: string; claimsDelayMs?: number };
const cookieJar = new AsyncLocalStorage<Session | null>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => {
    const session = cookieJar.getStore() ?? null;
    return {
      auth: {
        getClaims: async () => {
          await sleep(session?.claimsDelayMs ?? 0);
          return session
            ? { data: { claims: { sub: session.userId, ...(session.email ? { email: session.email } : {}) } }, error: null }
            : { data: null, error: { message: "Auth session missing!" } };
        },
      },
      from: (table: string) => ({
        select: () => ({
          eq: (_column: string, userId: string) => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: table === "memberships" && session && userId === session.userId ? { organization_id: session.orgId, role: "owner" } : null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };
  },
}));

mock.module("@/lib/db", () => ({
  ...schema,
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ apiKey: "org-key" }] }) }) }) },
}));

const { withTiming } = await import("@/lib/with-timing");
const { requireAuth } = await import("@/lib/supabase/auth-guard");
const veridian = await import("@/lib/veridian-client");
const { callVeridian, callVeridianBinary, callVeridianUpload, provisionVeridianOrg, ACTING_USER_HEADER, ACTING_USER_EMAIL_HEADER } = veridian;
const acting = await import("@/lib/acting-person-context");
const categories = await import("@/app/api/scope/categories/route");

type Outbound = { url: string; method: string; headers: Record<string, string>; body: unknown };
let outbound: Outbound[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  outbound = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
    let body: unknown = init?.body;
    if (typeof body === "string") body = JSON.parse(body);
    outbound.push({ url: String(input), method: (init?.method ?? "GET").toUpperCase(), headers, body });
    return new Response(JSON.stringify({ ok: true, organisationId: "v-org", apiKey: "v-key" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const ALICE: Session = { userId: "user-alice", email: "alice@example.com", orgId: "org-1" };
const BOB: Session = { userId: "user-bob", email: "bob@example.com", orgId: "org-1" };

const who = (call: Outbound | undefined) => ({
  id: call?.headers[ACTING_USER_HEADER.toLowerCase()] ?? null,
  email: call?.headers[ACTING_USER_EMAIL_HEADER.toLowerCase()] ?? null,
});

function postCategory(body: Record<string, unknown>, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://projexa.test/api/scope/categories", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("a signed-in route's VERIDIAN calls carry the session person", () => {
  test("a real route (POST /api/scope/categories) sends X-Acting-User and X-Acting-User-Email from the verified session", async () => {
    const res = await cookieJar.run(ALICE, () => categories.POST(postCategory({ name: "Civil" })));
    expect(res.status).toBe(201);
    expect(outbound).toHaveLength(1);
    expect(outbound[0].url).toEndWith("/scope/categories");
    expect(outbound[0].method).toBe("POST");
    expect(outbound[0].headers.authorization).toBe("Bearer org-key");
    expect(who(outbound[0])).toEqual({ id: "user-alice", email: "alice@example.com" });
  });

  test("reads carry the person too, and a session with no email sends the id alone", async () => {
    const noEmail: Session = { ...ALICE, email: null };
    const res = await cookieJar.run(noEmail, () => categories.GET(new NextRequest("http://projexa.test/api/scope/categories")));
    expect(res.status).toBe(200);
    expect(outbound[0].method).toBe("GET");
    expect(who(outbound[0])).toEqual({ id: "user-alice", email: null });
  });

  test("callVeridianUpload and callVeridianBinary carry the person as well", async () => {
    const handler = withTiming("POST", async () => {
      const ctx = await requireAuth();
      if (ctx.response) return ctx.response;
      const form = new FormData();
      form.set("file", new Blob(["x"]), "a.txt");
      await callVeridianUpload("/permits", form, { organizationId: ctx.organizationId! });
      await callVeridianBinary("/payslips/1/pdf", { organizationId: ctx.organizationId! });
      return NextResponse.json({ ok: true });
    });
    await cookieJar.run(BOB, () => handler());
    expect(outbound.map(who)).toEqual([
      { id: "user-bob", email: "bob@example.com" },
      { id: "user-bob", email: "bob@example.com" },
    ]);
  });
});

describe("rule a: the identity comes only from the verified session", () => {
  test("an inbound X-Acting-User / X-Acting-User-Email from the browser is never forwarded", async () => {
    await cookieJar.run(ALICE, () =>
      categories.POST(
        postCategory({ name: "Civil" }, { "X-Acting-User": "user-mallory", "X-Acting-User-Email": "mallory@example.com" })
      )
    );
    expect(outbound).toHaveLength(1);
    expect(who(outbound[0])).toEqual({ id: "user-alice", email: "alice@example.com" });
    expect(JSON.stringify(outbound[0])).not.toContain("mallory");
  });

  test("a browser-supplied body actorEmail is replaced with the session's own email", async () => {
    // compliance-tracker reads a body actorEmail BEFORE the email header, and
    // this route forwards the browser's body as-is.
    await cookieJar.run(ALICE, () => categories.POST(postCategory({ name: "Civil", actorEmail: "mallory@example.com" })));
    expect(outbound[0].body).toEqual({ name: "Civil", actorEmail: "alice@example.com" });
    expect(JSON.stringify(outbound[0])).not.toContain("mallory");
  });

  test("a body without actorEmail is sent untouched (no field is added)", async () => {
    await cookieJar.run(ALICE, () => categories.POST(postCategory({ name: "Civil" })));
    expect(outbound[0].body).toEqual({ name: "Civil" });
  });

  test("no verified session: 401, and nothing reaches VERIDIAN at all", async () => {
    const res = await cookieJar.run(null, () =>
      categories.POST(postCategory({ name: "Civil" }, { "X-Acting-User": "user-mallory" }))
    );
    expect(res.status).toBe(401);
    expect(outbound).toHaveLength(0);
  });

  test("outside a route scope (a server component, a webhook, a script) no acting headers are sent, even after requireAuth()", async () => {
    await cookieJar.run(ALICE, async () => {
      const ctx = await requireAuth();
      expect(ctx.user?.id).toBe("user-alice");
      await callVeridian("/projects", { organizationId: ctx.organizationId! });
    });
    expect(who(outbound[0])).toEqual({ id: null, email: null });
    expect(acting.currentActingPerson()).toBeNull();
  });

  test("provisionVeridianOrg never carries a person, even inside a signed-in request", async () => {
    process.env.VERIDIAN_PLATFORM_APPLICATION_KEY = "platform-key";
    const handler = withTiming("POST", async () => {
      await requireAuth();
      await provisionVeridianOrg({ customerOrgName: "Acme" });
      return NextResponse.json({ ok: true });
    });
    await cookieJar.run(ALICE, () => handler());
    expect(outbound[0].url).toEndWith("/platform/provision-org");
    expect(who(outbound[0])).toEqual({ id: null, email: null });
  });
});

describe("an explicit identity always wins, as a pair", () => {
  test("a call site that names someone else is sent as named, with nothing filled in from the session", async () => {
    const handler = withTiming("POST", async () => {
      const ctx = await requireAuth();
      await callVeridian("/work-progress", {
        organizationId: ctx.organizationId!,
        method: "POST",
        body: { actorEmail: "member@example.com" },
        actingUserEmail: "member@example.com",
      });
      await callVeridian("/timesheets", { organizationId: ctx.organizationId!, method: "POST", body: {}, actingUserId: "user-explicit" });
      return NextResponse.json({ ok: true });
    });
    await cookieJar.run(ALICE, () => handler());
    // Not the session's id beside someone else's email: VERIDIAN resolves the
    // id first, so a mixed pair would silently attribute the write to Alice.
    expect(who(outbound[0])).toEqual({ id: null, email: "member@example.com" });
    expect(outbound[0].body).toEqual({ actorEmail: "member@example.com" });
    expect(who(outbound[1])).toEqual({ id: "user-explicit", email: null });
  });
});

describe("rule b: overlapping requests never see each other's person", () => {
  test("two real route requests in flight at once each send their own person", async () => {
    // Alice's session takes longer to verify, so Bob's whole request runs
    // inside Alice's.
    const slowAlice: Session = { ...ALICE, claimsDelayMs: 80 };
    const fastBob: Session = { ...BOB, claimsDelayMs: 5 };
    await Promise.all([
      cookieJar.run(slowAlice, () => categories.POST(postCategory({ name: "from-alice" }))),
      cookieJar.run(fastBob, () => categories.POST(postCategory({ name: "from-bob" }))),
    ]);
    expect(outbound.map((o) => (o.body as { name: string }).name)).toEqual(["from-bob", "from-alice"]);
    const byName = new Map(outbound.map((o) => [(o.body as { name: string }).name, who(o)]));
    expect(byName.get("from-alice")).toEqual({ id: "user-alice", email: "alice@example.com" });
    expect(byName.get("from-bob")).toEqual({ id: "user-bob", email: "bob@example.com" });
  });

  test("each request's calls happen AFTER the other request recorded its person, and still carry their own", async () => {
    const handler = withTiming("POST", async () => {
      const ctx = await requireAuth();
      if (ctx.response) return ctx.response;
      await sleep(ctx.user!.id === "user-alice" ? 80 : 0);
      await callVeridian("/rfis", { organizationId: ctx.organizationId!, method: "POST", body: { from: ctx.user!.id } });
      return NextResponse.json({ ok: true });
    });
    await Promise.all([
      cookieJar.run({ ...ALICE, claimsDelayMs: 5 }, () => handler()), // records at ~5 ms, calls at ~85 ms
      cookieJar.run({ ...BOB, claimsDelayMs: 20 }, () => handler()), // records at ~20 ms, calls at ~20 ms
    ]);
    expect(outbound.map((o) => (o.body as { from: string }).from)).toEqual(["user-bob", "user-alice"]);
    for (const call of outbound) expect(who(call).id).toBe((call.body as { from: string }).from);
  });
});

describe("rule c: the scope is cleared when the request ends", () => {
  test("work that outlives the response carries no identity at all", async () => {
    let late: Promise<unknown> | null = null;
    let personSeenLate: unknown = "unset";
    const handler = withTiming("POST", async () => {
      const ctx = await requireAuth();
      if (ctx.response) return ctx.response;
      await callVeridian("/rfis", { organizationId: ctx.organizationId!, method: "POST", body: { when: "in-request" } });
      late = new Promise((resolve) =>
        setTimeout(() => {
          personSeenLate = acting.currentActingPerson();
          resolve(callVeridian("/rfis", { organizationId: ctx.organizationId!, method: "POST", body: { when: "after-response" } }));
        }, 25)
      );
      return NextResponse.json({ ok: true });
    });

    const res = await cookieJar.run(ALICE, () => handler());
    expect(res.status).toBe(200);
    await late;
    expect(outbound).toHaveLength(2);
    expect(who(outbound[0])).toEqual({ id: "user-alice", email: "alice@example.com" });
    expect(personSeenLate).toBeNull();
    expect(who(outbound[1])).toEqual({ id: null, email: null });
  });

  test("a handler that throws still closes its scope", async () => {
    let captured: () => unknown = () => "unset";
    const handler = withTiming("POST", async () => {
      await requireAuth();
      captured = () => acting.currentActingPerson();
      expect(captured()).toEqual({ userId: "user-alice", email: "alice@example.com" });
      throw new Error("boom");
    });
    await expect(cookieJar.run(ALICE, () => handler())).rejects.toThrow("boom");
    expect(captured()).toBeNull();
  });
});

describe("the slot itself", () => {
  test("outside any scope, recording is a no-op and nothing is read", () => {
    acting.recordVerifiedActingPerson({ id: "user-x", email: null });
    expect(acting.currentActingPerson()).toBeNull();
  });

  test("two DIFFERENT users recorded into one request fail closed: no identity for the rest of it", async () => {
    await acting.runWithActingPersonScope(async () => {
      acting.recordVerifiedActingPerson({ id: "user-alice", email: "alice@example.com" });
      acting.recordVerifiedActingPerson({ id: "user-alice", email: "alice@example.com" });
      expect(acting.currentActingPerson()?.userId).toBe("user-alice");
      acting.recordVerifiedActingPerson({ id: "user-bob", email: "bob@example.com" });
      expect(acting.currentActingPerson()).toBeNull();
      acting.recordVerifiedActingPerson({ id: "user-alice", email: "alice@example.com" });
      expect(acting.currentActingPerson()).toBeNull();
    });
  });

  test("runWithoutActingPerson hides the person from everything it awaits", async () => {
    await acting.runWithActingPersonScope(async () => {
      acting.recordVerifiedActingPerson({ id: "user-alice", email: null });
      const inside = await acting.runWithoutActingPerson(async () => {
        await sleep(1);
        return acting.currentActingPerson();
      });
      expect(inside).toBeNull();
      expect(acting.currentActingPerson()?.userId).toBe("user-alice");
    });
  });

  test("a scope opened inside another (same request) starts from the enclosing person", async () => {
    await acting.runWithActingPersonScope(async () => {
      acting.recordVerifiedActingPerson({ id: "user-alice", email: null });
      const inner = await acting.runWithActingPersonScope(async () => acting.currentActingPerson());
      expect(inner?.userId).toBe("user-alice");
      expect(acting.currentActingPerson()?.userId).toBe("user-alice");
    });
  });
});
