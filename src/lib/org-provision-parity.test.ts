import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IDENTITIES, ORG_A } from "./projexa-api-parity-cases";
import { orgCases, VERIDIAN_NEW_ORG, type OrgCase, type OrgEffects, type OrgOutcome } from "./org-provision-parity-cases";

// AUDIT-100 G-09, the Next half of the PARITY CONTRACT for /api/org/provision and /api/org/repair with the Edge Function projexa-api
// (compliance-tracker supabase/functions/projexa-api/org-provision.ts). Every scenario of org-provision-parity-cases.ts runs through the REAL
// pipeline: src/middleware.ts, the real route, the real requireAuth(), the real veridian-client (provisionVeridianOrg, getVeridianApiKey, the
// error vocabulary). Only the edges are fakes: the Supabase session / tables, the database and the VERIDIAN platform endpoint.
// Golden: ai-os/audit37/projexa-api/org-parity.golden.json (copy in compliance-tracker supabase/functions/projexa-api/). Rewrite after a deliberate change:
//   UPDATE_PARITY_GOLDEN=1 bun test src/lib/org-provision-parity.test.ts

const GOLDEN_PATH = join(import.meta.dir, "..", "..", "ai-os", "audit37", "projexa-api", "org-parity.golden.json");
const BASE = "https://upstream.test/api/v1/projexa";
const ROOT = BASE.replace(/\/projexa$/, "");
process.env.VERIDIAN_API_BASE_URL = BASE;
process.env.VERIDIAN_PLATFORM_APPLICATION_KEY = "pk_test_platform";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projexa.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
const NEW_ORG = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

let current: OrgCase | null = null;
let fx: OrgEffects = { veridian_provisioned: [], orgs_inserted: [], memberships_inserted: [], credentials_stored: [] };
let stored = false;
const identity = () => (current && current.who !== "signed_out" ? IDENTITIES[current.who as keyof typeof IDENTITIES] : null);
const world = () => current?.world ?? {};

function fakeSupabase() {
  return {
    auth: {
      async getClaims() {
        const id = identity();
        return id ? { data: { claims: { sub: id.sub, email: id.email ?? undefined } }, error: null } : { data: { claims: null }, error: null };
      },
    },
    from(table: string) {
      if (table === "memberships") {
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
          async insert(row: { user_id: string; role: string; organization_id: string }) {
            if (world().membership_insert === "error") return { error: { message: 'new row violates row-level security policy for table "memberships"' } };
            fx.memberships_inserted.push({ user_id: row.user_id, role: row.role, organization_is_new: row.organization_id === NEW_ORG });
            return { error: null };
          },
        };
        return chain;
      }
      if (table === "organizations") {
        return {
          insert(row: { name: string; slug: string }) {
            const ok = world().org_insert !== "error";
            if (ok) fx.orgs_inserted.push({ name: row.name, slug_prefix: row.slug.replace(/-[a-z0-9]{1,5}$/, "") });
            const res = ok ? { data: { id: NEW_ORG, name: row.name, slug: row.slug }, error: null } : { data: null, error: { message: 'duplicate key value violates unique constraint "organizations_slug_key"' } };
            const c = { select: () => c, single: async () => res };
            return c;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const CRED_TABLE = { organizationId: "organization_id", veridianOrgId: "veridian_org_id", veridianApiKey: "veridian_api_key", __t: "creds" };
const ORG_TABLE = { id: "id", name: "name", country: "country", __t: "orgs" };
mock.module("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
mock.module("@supabase/ssr", () => ({ createServerClient: () => fakeSupabase(), createBrowserClient: () => fakeSupabase() }));
mock.module("@/lib/db", () => ({
  veridianCredentials: CRED_TABLE,
  organizations: ORG_TABLE,
  memberships: {},
  db: {
    select: () => ({
      from: (t: { __t: string }) => ({
        where: () => ({
          async limit() {
            if (t.__t === "creds") return world().credentials || stored ? [{ apiKey: "key-existing" }] : [];
            const w = world();
            if (w.org_read === "error") throw new Error("connection terminated");
            if (w.org_read === "missing") return [];
            return [{ name: "Existing Org", country: w.org_country === undefined ? "IN" : w.org_country }];
          },
        }),
      }),
    }),
    insert: () => ({
      values(v: { organizationId: string; veridianOrgId: string }) {
        if (world().store === "error") throw new Error("password authentication failed");
        if (world().store !== "silent_noop") stored = true;
        fx.credentials_stored.push({ organization: v.organizationId === NEW_ORG ? "new" : "existing", veridian_org_id: v.veridianOrgId });
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  },
}));

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== `${ROOT}/platform/provision-org`) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String(init?.body)) as { customerOrgName: string; country?: string };
    fx.veridian_provisioned.push({ name: body.customerOrgName, country: body.country ?? null });
    const v = world().veridian ?? "ok";
    if (v !== "ok") return new Response(JSON.stringify({ error: v.error }), { status: v.status, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ organisationId: VERIDIAN_NEW_ORG, apiKey: "vk_" + "t".repeat(32) }), { status: 201, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

type Handler = (req: Request) => Promise<Response>;
export async function runNext(c: OrgCase): Promise<OrgOutcome> {
  current = c;
  stored = false;
  fx = { veridian_provisioned: [], orgs_inserted: [], memberships_inserted: [], credentials_stored: [] };
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("@/middleware");
  const url = `http://localhost:3100${c.path}`;
  const sent = c.raw_body !== undefined ? c.raw_body : c.body === undefined ? undefined : JSON.stringify(c.body);
  const init = { method: c.method, headers: sent === undefined ? {} : { "content-type": "application/json" }, body: sent };
  let res: Response = await middleware(new NextRequest(url, init));
  if (res.headers.get("x-middleware-next") === "1") {
    const mod = (await import(`@/app${c.path}/route`)) as Record<string, Handler>;
    try {
      res = await mod[c.method]!(new NextRequest(url, init));
    } catch {
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
  return { status: res.status, body, effects: fx };
}

describe("org provision / repair parity contract: the Next pipeline (AUDIT-100 G-09)", () => {
  test("every golden case: the Next pipeline answers exactly the recorded contract", async () => {
    const outcomes: { case: OrgCase; expect: OrgOutcome }[] = [];
    for (const c of orgCases()) outcomes.push({ case: c, expect: await runNext(c) });
    const golden = { _about: "AUDIT-100 G-09 parity contract for /api/org/provision and /api/org/repair. Recorded from the REAL PROJEXA Next pipeline by src/lib/org-provision-parity.test.ts (projexa repo); replayed against the edge function by compliance-tracker src/lib/services/projexa-org-edge-parity.test.ts. Do not edit by hand.", identities: IDENTITIES, org_a: ORG_A, new_org: NEW_ORG, veridian_new_org: VERIDIAN_NEW_ORG, cases: outcomes };
    if (process.env.UPDATE_PARITY_GOLDEN === "1") writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 1) + "\n");
    const committed = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
    expect(committed.cases.length).toBe(outcomes.length);
    for (let i = 0; i < outcomes.length; i++) {
      expect({ name: outcomes[i]!.case.name, ...outcomes[i]!.expect }).toEqual({ name: committed.cases[i].case.name, ...committed.cases[i].expect });
    }
  }, 120_000);

  test("the contract is not vacuous", async () => {
    const committed = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as { cases: { case: OrgCase; expect: OrgOutcome }[] };
    const by = (name: string) => committed.cases.find((c) => c.case.name === name)!.expect;
    expect(by("provision: new organisation").status).toBe(201);
    expect(by("provision: new organisation").effects.credentials_stored).toHaveLength(1);
    expect(by("provision: VERIDIAN answers 500").effects.orgs_inserted).toHaveLength(0); // VERIDIAN first: nothing on the PROJEXA side
    expect(by("repair POST: member").status).toBe(403);
    expect(by("repair POST: admin repairs a broken workspace").status).toBe(201);
  });
});
