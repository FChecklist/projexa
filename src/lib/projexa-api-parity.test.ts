import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCases, IDENTITIES, ORG_KEYS, REQUESTS, type Outcome, type ParityCase, type UpstreamCall, type Who } from "./projexa-api-parity-cases";

// AUDIT-100 A2, the Next half of the PARITY CONTRACT with the Supabase Edge Function `projexa-api` (compliance-tracker
// supabase/functions/projexa-api). Every case of projexa-api-parity-cases.ts runs through the REAL pipeline a browser's /api call meets on
// Vercel: src/middleware.ts (session + the write role gate), then the real route handler, the real requireAuth(), the real veridian-client
// (key resolution, acting-person headers, actorEmail rewrite, budgets, retry, error vocabulary) and the real veridian-response. Only the
// edges are fakes: the Supabase session/membership reads, the veridian_credentials row and the upstream HTTP server.
//
// What it answered is the contract: ai-os/audit37/projexa-api/parity.golden.json. This test fails when the Next pipeline stops answering the
// golden (so a change of a proxied route forces the contract, and therefore the edge function, to be looked at again); compliance-tracker's
// src/lib/services/projexa-api-edge-parity.test.ts replays the same file through the edge handler. Rewrite after a deliberate change with
//   UPDATE_PARITY_GOLDEN=1 bun test src/lib/projexa-api-parity.test.ts
// and copy the file to compliance-tracker (bun scripts/projexa-api-edge.mjs --write --ct <checkout> copies both files).

const GOLDEN_PATH = join(import.meta.dir, "..", "..", "ai-os", "audit37", "projexa-api", "parity.golden.json");
const BASE = "https://upstream.test/api/v1/projexa";
process.env.VERIDIAN_API_BASE_URL = BASE;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projexa.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

/** The VERIDIAN root (veridian-client.ts VERIDIAN_API_ROOT): a `root: true` call goes to /api/v1/... instead of /api/v1/projexa/... (batch 5). */
const ROOT = BASE.replace(/\/projexa$/, "");
/** What the upstream receives, relative to BASE: the URL-normalised href (fetch percent-encodes a raw space etc. before sending; a bare "?" stays).
 *  A call outside BASE (a `root` call) is written "[root]" + its path relative to ROOT; compliance-tracker records the same way. */
const wirePath = (url: string) => {
  const href = new URL(url).href;
  const base = new URL(BASE).href;
  return href.startsWith(base) ? href.slice(base.length) : `[root]${href.slice(new URL(ROOT).href.length)}`;
};

let current: ParityCase | null = null;
let calls: UpstreamCall[] = [];

const identity = () => (current && current.who !== "signed_out" ? IDENTITIES[current.who as Exclude<Who, "signed_out">] : null);

function fakeSupabase() {
  return {
    auth: {
      async getClaims() {
        const id = identity();
        return id ? { data: { claims: { sub: id.sub, email: id.email ?? undefined } }, error: null } : { data: { claims: null }, error: null };
      },
    },
    from(table: string) {
      if (table !== "memberships") throw new Error(`unexpected table ${table}`);
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        async maybeSingle() {
          const m = identity()?.membership;
          if (m === "error") return { data: null, error: { message: "connection reset" } };
          return { data: m ?? null, error: null };
        },
      };
      return chain;
    },
  };
}

mock.module("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
mock.module("@supabase/ssr", () => ({ createServerClient: () => fakeSupabase(), createBrowserClient: () => fakeSupabase() }));
mock.module("@/lib/db", () => ({
  veridianCredentials: { organizationId: "organization_id", veridianApiKey: "veridian_api_key" },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          async limit() {
            const m = identity()?.membership;
            const key = m && m !== "error" ? ORG_KEYS[m.organization_id] : undefined;
            return key ? [{ apiKey: key }] : [];
          },
        }),
      }),
    }),
  },
}));

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(ROOT + "/")) throw new Error(`unexpected fetch ${url}`);
    const h = new Headers(init?.headers);
    calls.push({
      method: (init?.method ?? "GET").toUpperCase(),
      // the path AS IT GOES ON THE WIRE (URL-normalised: a raw space in an id is sent as %20 by fetch); compliance-tracker records the same way
      path: wirePath(url),
      authorization: h.get("authorization"),
      acting_user: h.get("x-acting-user"),
      acting_email: h.get("x-acting-user-email"),
      content_type: h.get("content-type"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    const u = current!.upstream;
    if (u.kind === "refused") throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    if (u.kind === "text") return new Response(u.text, { status: u.status, statusText: u.status_text });
    return new Response(JSON.stringify(u.body), { status: u.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/** The route Next would pick for a path: a literal segment beats a dynamic one at the same position (/api/materials/issues is not
 *  /api/materials/:id), as in the App Router. */
const routeOf = (path: string) => {
  const segs = new URL(path, "http://x").pathname.split("/").filter(Boolean);
  let best: { route: string; params: Record<string, string>; rank: string } | null = null;
  for (const r of REQUESTS) {
    const pat = r.route.split("/").filter(Boolean);
    if (pat.length !== segs.length) continue;
    const params: Record<string, string> = {};
    if (!pat.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = decodeURIComponent(segs[i]!)), true) : p === segs[i]))) continue;
    const rank = pat.map((p) => (p.startsWith(":") ? "0" : "1")).join("");
    if (!best || rank > best.rank) best = { route: r.route, params, rank };
  }
  if (!best) throw new Error(`no route for ${path}`);
  return { route: best.route, params: best.params };
};

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** The Vercel pipeline: middleware first (a non-"next" answer ends the request), then the route handler. */
export async function runNext(c: ParityCase): Promise<Outcome> {
  current = c;
  calls = [];
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("@/middleware");
  const url = `http://localhost:3100${c.path}`;
  const sent = c.raw_body !== undefined ? c.raw_body : c.body === undefined ? undefined : JSON.stringify(c.body);
  const init = { method: c.method, headers: sent === undefined ? {} : { "content-type": "application/json" }, body: sent };
  let res: Response = await middleware(new NextRequest(url, init));
  if (res.headers.get("x-middleware-next") === "1") {
    const { route, params } = routeOf(c.path);
    const mod = (await import(`@/app${route.replace(/:(\w+)/g, "[$1]")}/route`)) as Record<string, Handler>;
    res = await mod[c.method]!(new NextRequest(url, init), { params: Promise.resolve(params) });
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { __not_json__: text.slice(0, 80) };
  }
  const cc = res.headers.get("cache-control");
  return { status: res.status, body, retry_after: res.headers.get("retry-after"), upstream_calls: calls, ...(cc && cc !== "no-store" ? { cache_control: cc } : {}) };
}

describe("projexa-api parity contract: the Next pipeline (AUDIT-100 A2)", () => {
  test("every golden case: the Next pipeline answers exactly the recorded contract", async () => {
    const cases = buildCases();
    const outcomes: { case: ParityCase; expect: Outcome }[] = [];
    for (const c of cases) outcomes.push({ case: c, expect: await runNext(c) });
    const golden = { _about: "AUDIT-100 A2 parity contract. Recorded from the REAL PROJEXA Next pipeline by src/lib/projexa-api-parity.test.ts (projexa repo); replayed against the edge function by compliance-tracker src/lib/services/projexa-api-edge-parity.test.ts. Do not edit by hand.", identities: IDENTITIES, org_keys: ORG_KEYS, upstream_base: BASE, cases: outcomes };
    if (process.env.UPDATE_PARITY_GOLDEN === "1") writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 1) + "\n");
    const committed = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
    expect(committed.cases.length).toBe(outcomes.length);
    for (let i = 0; i < outcomes.length; i++) {
      expect({ name: outcomes[i]!.case.name, ...outcomes[i]!.expect }).toEqual({ name: committed.cases[i].case.name, ...committed.cases[i].expect });
    }
  }, 120_000);

  test("the contract is not vacuous: it covers every role tier deciding a write both ways, and real upstream calls", async () => {
    const committed = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as { cases: { case: ParityCase; expect: Outcome }[] };
    const by = (name: string) => committed.cases.find((c) => c.case.name === name)!.expect;
    // BOQ line edit is PM_OR_ABOVE: pm allowed (one upstream call), site_engineer and client_viewer refused by the gate (no upstream call)
    expect(by("PATCH /api/scope/line-items/:id as pm").status).toBe(200);
    expect(by("PATCH /api/scope/line-items/:id as pm").upstream_calls).toHaveLength(1);
    expect(by("PATCH /api/scope/line-items/:id as site_engineer").status).toBe(403);
    expect(by("PATCH /api/scope/line-items/:id as client_viewer").upstream_calls).toHaveLength(0);
    // documents are FIELD: site_engineer allowed, member refused
    expect(by("PATCH /api/documents/:id as site_engineer").status).toBe(200);
    expect(by("PATCH /api/documents/:id as member").status).toBe(403);
    // reads are open to every role (the backend redacts by the acting person it is told about)
    expect(by("GET /api/dashboard/project/:projectId as client_viewer").status).toBe(200);
    expect(by("GET /api/dashboard/project/:projectId as client_viewer").upstream_calls[0]!.acting_user).toBe(IDENTITIES.client_viewer.sub);
    expect(by("GET /api/dashboard/project/:projectId as signed_out").status).toBe(401);
    expect(by("GET /api/dashboard/project/:projectId as no_org").status).toBe(400);
    // the org's own key; never another org's
    expect(by("GET /api/dashboard/project/:projectId: another organisation's record").upstream_calls[0]!.authorization).toBe("Bearer key-org-b");
    // a GET retries once after a refused connection, a write never does
    expect(by("GET /api/dashboard/project/:projectId: connection refused").upstream_calls).toHaveLength(2);
    expect(by("PATCH /api/scope/line-items/:id: connection refused").upstream_calls).toHaveLength(1);
  });
});
