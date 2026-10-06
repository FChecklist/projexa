/// <reference types="bun-types" />
// AUDIT-100 G-09: getVeridianApiKey() reads the compliance-side credentials table (public.projexa_org_credential_get) FIRST when it is configured, and
// the legacy public.veridian_credentials otherwise. The key is only ever the one named by the caller's own organisation id (the rpc argument), and a
// failing / empty / malformed compliance-side answer is "no key from there", never an invented one.
import { describe, expect, mock, test } from "bun:test";

let legacyRows: { apiKey: string }[] = [];
let legacyAsked = 0;
mock.module("drizzle-orm", () => ({ eq: () => ({ __eq: true }) }));
mock.module("@/lib/db", () => ({
  veridianCredentials: { organizationId: "organization_id", veridianApiKey: "veridian_api_key" },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          async limit() {
            legacyAsked++;
            return legacyRows;
          },
        }),
      }),
    }),
  },
}));

const { readComplianceCredentialKey, getVeridianApiKey } = await import("./veridian-client");

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mk = (status: number, body: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => (calls.push({ url: String(url), init: init ?? {} }), new Response(JSON.stringify(body), { status }))) as typeof fetch;
  return { calls, fetchImpl };
};

describe("readComplianceCredentialKey", () => {
  test("asks the rpc with THIS organisation's id and the service key, returns its key", async () => {
    const f = mk(200, [{ veridian_org_id: "v", api_key: "vk_new" }]);
    expect(await readComplianceCredentialKey(ORG, { url: "https://c.test/", key: "srk", fetchImpl: f.fetchImpl })).toBe("vk_new");
    expect(f.calls[0]!.url).toBe("https://c.test/rest/v1/rpc/projexa_org_credential_get");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ p_projexa_org_id: ORG });
    expect(new Headers(f.calls[0]!.init.headers).get("authorization")).toBe("Bearer srk");
  });

  test("not configured, an empty answer, an error status, a malformed answer and a thrown fetch are all null", async () => {
    expect(await readComplianceCredentialKey(ORG, { url: "", key: "", fetchImpl: mk(200, []).fetchImpl })).toBeNull();
    expect(await readComplianceCredentialKey(ORG, { url: "https://c.test", key: "k", fetchImpl: mk(200, []).fetchImpl })).toBeNull();
    expect(await readComplianceCredentialKey(ORG, { url: "https://c.test", key: "k", fetchImpl: mk(500, { message: "x" }).fetchImpl })).toBeNull();
    expect(await readComplianceCredentialKey(ORG, { url: "https://c.test", key: "k", fetchImpl: mk(200, [{ api_key: 7 }]).fetchImpl })).toBeNull();
    expect(await readComplianceCredentialKey(ORG, { url: "https://c.test", key: "k", fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch })).toBeNull();
  });
});

describe("getVeridianApiKey: compliance side first, legacy table second", () => {
  const realFetch = globalThis.fetch;
  const withEnv = async (fetchImpl: typeof fetch | null, fn: () => Promise<void>) => {
    const old = { u: process.env.VERIDIAN_CREDENTIALS_SUPABASE_URL, k: process.env.VERIDIAN_CREDENTIALS_SERVICE_ROLE_KEY };
    if (fetchImpl) {
      process.env.VERIDIAN_CREDENTIALS_SUPABASE_URL = "https://c.test";
      process.env.VERIDIAN_CREDENTIALS_SERVICE_ROLE_KEY = "srk";
      globalThis.fetch = fetchImpl;
    } else {
      delete process.env.VERIDIAN_CREDENTIALS_SUPABASE_URL;
      delete process.env.VERIDIAN_CREDENTIALS_SERVICE_ROLE_KEY;
    }
    try {
      await fn();
    } finally {
      globalThis.fetch = realFetch;
      if (old.u === undefined) delete process.env.VERIDIAN_CREDENTIALS_SUPABASE_URL; else process.env.VERIDIAN_CREDENTIALS_SUPABASE_URL = old.u;
      if (old.k === undefined) delete process.env.VERIDIAN_CREDENTIALS_SERVICE_ROLE_KEY; else process.env.VERIDIAN_CREDENTIALS_SERVICE_ROLE_KEY = old.k;
    }
  };

  test("configured and the compliance side has the row: that key, the legacy table is not asked", async () => {
    legacyRows = [{ apiKey: "vk_legacy" }];
    legacyAsked = 0;
    await withEnv(mk(200, [{ veridian_org_id: "v", api_key: "vk_new" }]).fetchImpl, async () => {
      expect(await getVeridianApiKey(ORG)).toBe("vk_new");
    });
    expect(legacyAsked).toBe(0);
  });

  test("configured but no row there (an organisation not backfilled yet): the legacy table answers", async () => {
    legacyRows = [{ apiKey: "vk_legacy" }];
    await withEnv(mk(200, []).fetchImpl, async () => {
      expect(await getVeridianApiKey(ORG)).toBe("vk_legacy");
    });
  });

  test("not configured (no new secret needed on Vercel): exactly the legacy behaviour; no row anywhere is null, never a shared key", async () => {
    legacyRows = [{ apiKey: "vk_legacy" }];
    await withEnv(null, async () => {
      expect(await getVeridianApiKey(ORG)).toBe("vk_legacy");
      legacyRows = [];
      expect(await getVeridianApiKey(ORG)).toBeNull();
    });
  });
});
