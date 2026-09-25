/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-20b -- a cached VERIDIAN answer can never be one
// person's answer served to another because of the acting-person headers.
//
// THE ANALYSIS THIS PINS. createCachedVeridianGet() (and every other
// cross-request cache in src, all built on personFreeCache) keys an entry on
// `${callback source}-${keyParts}` + the JSON of its arguments -- the org is in
// both, the PERSON is in neither. Next runs the callback, on a miss and on a
// background revalidation, inside whichever request triggered it. Had the fill
// carried that request's X-Acting-User, the stored value would be that
// person's view (VERIDIAN redacts some figures by the acting person's role)
// and every other person of the org would be served it until the TTL ran out.
// So the fill runs as nobody: the stored value is the person-free org answer,
// the same thing these caches held before the headers existed, and the key --
// unchanged, byte for byte -- still covers everything the value depends on.
//
// next/cache is replaced by a faithful model of unstable_cache: one store
// shared across "requests", keyed exactly the way Next keys it
// (next/dist/server/web/spec-extension/unstable-cache.js: fixedKey =
// `${cb.toString()}-${keyParts.join(",")}`, then `-${JSON.stringify(args)}`),
// calling the callback in the caller's async context on a miss. That is the
// property the leak depends on, so it is modelled rather than stubbed away.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { NextResponse } from "next/server";
import * as schema from "@/lib/db/schema";

const store = new Map<string, unknown>();
const registrations: { cbSource: string; keyParts: string[] }[] = [];

mock.module("next/cache", () => ({
  unstable_cache: <A extends unknown[], R>(cb: (...args: A) => Promise<R>, keyParts: string[] = []) => {
    const fixedKey = `${cb.toString()}-${keyParts.join(",")}`;
    registrations.push({ cbSource: cb.toString(), keyParts });
    return async (...args: A): Promise<R> => {
      const key = `${fixedKey}-${JSON.stringify(args)}`;
      if (store.has(key)) return store.get(key) as R;
      const value = await cb(...args);
      store.set(key, value);
      return value;
    };
  },
  revalidateTag: () => {},
}));

type Session = { userId: string; email: string; orgId: string };
const cookieJar = new AsyncLocalStorage<Session | null>();

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => {
    const session = cookieJar.getStore() ?? null;
    return {
      auth: {
        getClaims: async () =>
          session
            ? { data: { claims: { sub: session.userId, email: session.email } }, error: null }
            : { data: null, error: { message: "Auth session missing!" } },
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: session ? { organization_id: session.orgId, role: "owner" } : null, error: null }),
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
const { callVeridian, createCachedVeridianGet, ACTING_USER_HEADER } = await import("@/lib/veridian-client");
const { personFreeCache } = await import("@/lib/person-free-cache");

type Outbound = { path: string; actingUser: string | null };
let outbound: Outbound[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  outbound = [];
  store.clear();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const actingUser = new Headers(init?.headers).get(ACTING_USER_HEADER);
    outbound.push({ path: new URL(String(input)).pathname, actingUser });
    // What a person-shaped upstream would answer: the view depends on who asked.
    return new Response(JSON.stringify({ viewFor: actingUser ?? "org-level" }), {
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

const getCurrencies = createCachedVeridianGet<{ viewFor: string }>("test-currencies", "/currencies", 60);

const handler = withTiming("GET", async () => {
  const ctx = await requireAuth();
  if (ctx.response) return ctx.response;
  // An uncached call in the same request, as a control: the person IS live here.
  const live = await callVeridian<{ viewFor: string }>("/me", { organizationId: ctx.organizationId! });
  const cached = await getCurrencies(ctx.organizationId!);
  return NextResponse.json({ live: live.viewFor, cached: cached.viewFor });
});

describe("createCachedVeridianGet: the acting person never enters a shared cache entry", () => {
  test("Alice fills the cache as nobody, and Bob is served that org-level answer -- never Alice's view", async () => {
    const aliceRes = await cookieJar.run(ALICE, () => handler());
    const bobRes = await cookieJar.run(BOB, () => handler());

    expect(await aliceRes.json()).toEqual({ live: "user-alice", cached: "org-level" });
    expect(await bobRes.json()).toEqual({ live: "user-bob", cached: "org-level" });

    // One fill for the whole org, made with no acting user; the uncached
    // control calls carried each person.
    const fills = outbound.filter((o) => o.path.endsWith("/currencies"));
    expect(fills).toEqual([{ path: expect.stringMatching(/\/currencies$/), actingUser: null }]);
    expect(outbound.filter((o) => o.path.endsWith("/me")).map((o) => o.actingUser)).toEqual(["user-alice", "user-bob"]);
  });

  test("Bob filling first changes nothing: the cached value never depends on who filled it", async () => {
    const bobRes = await cookieJar.run(BOB, () => handler());
    const aliceRes = await cookieJar.run(ALICE, () => handler());
    expect((await bobRes.json()).cached).toBe("org-level");
    expect((await aliceRes.json()).cached).toBe("org-level");
  });
});

describe("personFreeCache: the cache key is exactly what a raw unstable_cache would have used", () => {
  test("keyParts pass through unchanged, and the key's source text is the wrapped function's own", () => {
    registrations.length = 0;
    const fn = async (orgId: string) => ({ orgId, marker: "labour-landing" });
    personFreeCache(fn, ["veridian-module-list", "module:manpower"], { revalidate: 30, tags: ["module:manpower"] });
    expect(registrations).toEqual([{ cbSource: fn.toString(), keyParts: ["veridian-module-list", "module:manpower"] }]);
  });

  test("two caches with the same keyParts but different functions do not share entries", async () => {
    const first = personFreeCache(async (orgId: string) => `first:${orgId}`, ["same-key"]);
    const second = personFreeCache(async (orgId: string) => `second:${orgId}`, ["same-key"]);
    expect(await first("org-1")).toBe("first:org-1");
    expect(await second("org-1")).toBe("second:org-1");
  });
});
