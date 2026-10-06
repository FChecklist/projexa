import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCases, buildSequences, IDENTITIES, ORG_KEYS, pickUpstream, REQUESTS, type Outcome, type ParityCase, type RecordedForm, type Sequence, type UpstreamCall, type Who } from "./projexa-api-parity-cases";

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

/** What an upload sends upstream, as the contract records it (names, text, and each file's name / type / size / text, in order). */
async function recordForm(form: FormData): Promise<RecordedForm> {
  const out: RecordedForm["multipart"] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") out.push([name, value]);
    else out.push([name, { file: { name: value.name, type: value.type, size: value.size, text: await value.text() } }]);
  }
  return { multipart: out };
}

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
// The database reads of the Next pipeline, answered from the identities: the organisation's VERIDIAN key (veridian_credentials, by organisation) and, for
// the company routes (batch 8, src/lib/company-scope.ts requireCompanyScope), the person's membership of the company named in the path. A company id that
// is not a UUID is refused by the database (an error, which no handler catches: Next renders an empty 500).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const companyInPath = () => /\/api\/dashboard-hierarchy\/companies\/([^/?]+)/.exec(current?.path ?? "")?.[1] ?? null;
const membershipOf = (company: string) => {
  const id = identity();
  if (!id || id.membership === "error" || !id.membership) return null;
  return [id.membership, ...(id.more ?? [])].find((m) => m.organization_id === company) ?? null;
};
mock.module("@/lib/db", () => ({
  veridianCredentials: { organizationId: "organization_id", veridianApiKey: "veridian_api_key" },
  db: {
    select: (fields?: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          async limit() {
            if (fields && "role" in fields) {
              // requireCompanyScope: the membership of THIS person in the company of the path
              const company = companyInPath() ?? "";
              if (identity()?.membership === "error" || !UUID.test(decodeURIComponent(company))) throw new Error("connection reset / invalid input syntax for type uuid");
              const m = membershipOf(decodeURIComponent(company));
              return m ? [{ role: m.role }] : [];
            }
            // the organisation's key: a company route works in the company of the path, every other route in the person's own organisation
            const m = identity()?.membership;
            const org = companyInPath() ? decodeURIComponent(companyInPath()!) : m && m !== "error" ? m.organization_id : "";
            const key = m && m !== "error" ? ORG_KEYS[org] : undefined;
            return key ? [{ apiKey: key }] : [];
          },
        }),
      }),
    }),
  },
}));

// AUDIT-100 A2 batch 7: next/cache outside a Next server. revalidateTag / revalidatePath are RECORDED (what the real handler clears; the edge cannot, the
// browser asks Vercel to: projexa-api-routes.json `revalidate`), and unstable_cache is a model of the real one: ONE store shared by every "request", keyed
// like Next keys it (next/dist/server/web/spec-extension/unstable-cache.js: the callback source + the key parts, then the JSON of the arguments), an entry
// fresh for `revalidate` seconds of a clock the sequences move, a throw never stored. The stale step is NOT modelled (real Next serves the stale answer once
// and refreshes in the background): no recorded case reaches it.
export const clock = { now: 0 };
const cacheStore = new Map<string, { at: number; value: unknown }>();
let revalidated: { tags: string[]; paths: string[] } = { tags: [], paths: [] };
mock.module("next/cache", () => ({
  unstable_cache: <A extends unknown[], R>(cb: (...args: A) => Promise<R>, keyParts: string[] = [], options: { revalidate?: number | false } = {}) => {
    const fixedKey = `${cb.toString()}-${keyParts.join(",")}`;
    return async (...args: A): Promise<R> => {
      const key = `${fixedKey}-${JSON.stringify(args)}`;
      const hit = cacheStore.get(key);
      const ttl = typeof options.revalidate === "number" ? options.revalidate * 1000 : Infinity;
      if (hit && clock.now - hit.at < ttl) return hit.value as R;
      const value = await cb(...args);
      cacheStore.set(key, { at: clock.now, value });
      return value;
    };
  },
  revalidateTag: (tag: string) => void revalidated.tags.push(tag),
  revalidatePath: (path: string) => void revalidated.paths.push(path),
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
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body instanceof FormData ? await recordForm(init.body) : null,
    });
    const u = pickUpstream(current!.upstream, url);
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
/** The request a browser sends for a case: JSON, a raw text body with its content type, or a multipart form (no content type written by hand). */
function requestInit(c: Pick<ParityCase, "method" | "body" | "raw_body" | "content_type" | "multipart">): { method: string; headers: Record<string, string>; body: BodyInit | undefined } {
  if (c.multipart) {
    const form = new FormData();
    for (const [k, v] of c.multipart.fields) form.append(k, v);
    for (const f of c.multipart.files ?? []) form.append(f.field, new File([f.content], f.name, { type: f.type }));
    return { method: c.method, headers: {}, body: form };
  }
  const sent = c.raw_body !== undefined ? c.raw_body : c.body === undefined ? undefined : JSON.stringify(c.body);
  return { method: c.method, headers: sent === undefined ? {} : { "content-type": c.content_type ?? "application/json" }, body: sent };
}

export async function runNext(c: Pick<ParityCase, "name" | "method" | "path" | "body" | "raw_body" | "content_type" | "multipart" | "who" | "upstream">): Promise<Outcome> {
  current = c as ParityCase;
  calls = [];
  revalidated = { tags: [], paths: [] };
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("@/middleware");
  const url = `http://localhost:3100${c.path}`;
  // a multipart body can be read once: the middleware and the handler each get their own copy of the form
  let res: Response = await middleware(new NextRequest(url, requestInit(c)));
  if (res.headers.get("x-middleware-next") === "1") {
    const { route, params } = routeOf(c.path);
    const mod = (await import(`@/app${route.replace(/:(\w+)/g, "[$1]")}/route`)) as Record<string, Handler>;
    try {
      res = await mod[c.method]!(new NextRequest(url, requestInit(c)), { params: Promise.resolve(params) });
    } catch {
      // AUDIT-100 A2 batch 6: a handler that THROWS (a field read on a JSON-null body: `null.projectId`) is rendered by Next as an empty
      // 500 (withTiming rethrows; next/dist/build/templates/app-route.js: `new Response(null, { status: 500 })`). The edge answers the same.
      res = new Response(null, { status: 500 });
    }
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { __not_json__: text.slice(0, 80) };
  }
  const cc = res.headers.get("cache-control");
  const cleared = revalidated.tags.length || revalidated.paths.length ? { revalidated: { tags: [...revalidated.tags], paths: [...revalidated.paths] } } : {};
  return { status: res.status, body, retry_after: res.headers.get("retry-after"), upstream_calls: calls, ...(cc && cc !== "no-store" ? { cache_control: cc } : {}), ...cleared };
}

/** A sequence: one cache that starts empty, the clock moving before each step. */
export async function runNextSequence(seq: Sequence): Promise<Outcome[]> {
  cacheStore.clear();
  clock.now = 0;
  const out: Outcome[] = [];
  for (const [i, step] of seq.steps.entries()) {
    clock.now += step.advance_ms ?? 0;
    out.push(await runNext({ name: `${seq.name} #${i + 1}`, ...step }));
  }
  return out;
}

describe("projexa-api parity contract: the Next pipeline (AUDIT-100 A2)", () => {
  test("every golden case: the Next pipeline answers exactly the recorded contract", async () => {
    const cases = buildCases();
    const outcomes: { case: ParityCase; expect: Outcome }[] = [];
    for (const c of cases) {
      cacheStore.clear();
      clock.now = 0;
      outcomes.push({ case: c, expect: await runNext(c) });
    }
    const sequences: { sequence: Sequence; expect: Outcome[] }[] = [];
    for (const sequence of buildSequences()) sequences.push({ sequence, expect: await runNextSequence(sequence) });
    const golden = { _about: "AUDIT-100 A2 parity contract. Recorded from the REAL PROJEXA Next pipeline by src/lib/projexa-api-parity.test.ts (projexa repo); replayed against the edge function by compliance-tracker src/lib/services/projexa-api-edge-parity.test.ts. Do not edit by hand.", identities: IDENTITIES, org_keys: ORG_KEYS, upstream_base: BASE, cases: outcomes, sequences };
    if (process.env.UPDATE_PARITY_GOLDEN === "1") writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 1) + "\n");
    const committed = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
    expect(committed.cases.length).toBe(outcomes.length);
    for (let i = 0; i < outcomes.length; i++) {
      expect({ name: outcomes[i]!.case.name, ...outcomes[i]!.expect }).toEqual({ name: committed.cases[i].case.name, ...committed.cases[i].expect });
    }
    expect(committed.sequences.length).toBe(sequences.length);
    for (let i = 0; i < sequences.length; i++) {
      expect({ name: sequences[i]!.sequence.name, steps: sequences[i]!.expect }).toEqual({ name: committed.sequences[i].sequence.name, steps: committed.sequences[i].expect });
    }
  }, 240_000);

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
