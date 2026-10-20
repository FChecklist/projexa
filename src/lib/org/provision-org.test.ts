/// <reference types="bun-types" />
// Two simultaneous provisioning calls for the same person create exactly ONE organisation, and the create runs under a per-user advisory lock.
import { beforeEach, describe, expect, mock, test } from "bun:test";

let veridianCalls = 0;
let orgInserts = 0;
let membershipInserts = 0;
let credentialInserts = 0;
let lockStatements = 0;
let memberships: { user_id: string; organization_id: string }[] = [];
let useTransaction = true;

const insertHandle = {
  insert: () => ({ values: async () => { credentialInserts++; } }),
};

mock.module("@/lib/db", () => ({
  veridianCredentials: {},
  db: {
    insert: insertHandle.insert,
    get transaction() {
      return useTransaction
        ? async (fn: (tx: unknown) => Promise<unknown>) => fn({ ...insertHandle, execute: async () => { lockStatements++; } })
        : undefined;
    },
  },
}));
mock.module("@/lib/veridian-client", () => ({
  VeridianApiError: class extends Error { status = 502; },
  getVeridianApiKey: async () => "key",
  provisionVeridianOrg: async () => {
    veridianCalls++;
    await new Promise((r) => setTimeout(r, 20));
    return { organisationId: "v-org", apiKey: "k" };
  },
}));

const { provisionOrgForUser } = await import("./provision-org");

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "memberships") {
        const chain: any = {
          select: () => chain, eq: () => chain, limit: () => chain,
          maybeSingle: async () => ({ data: memberships[0] ?? null, error: null }),
          insert: async (row: { user_id: string; organization_id: string }) => { membershipInserts++; memberships.push(row); return { error: null }; },
        };
        return chain;
      }
      return {
        insert: () => ({ select: () => ({ single: async () => { orgInserts++; return { data: { id: "org-1" }, error: null }; } }) }),
      };
    },
  };
}

beforeEach(() => {
  veridianCalls = orgInserts = membershipInserts = credentialInserts = lockStatements = 0;
  memberships = [];
  useTransaction = true;
});

describe("provisionOrgForUser", () => {
  test("two simultaneous calls create exactly one organisation, one membership, one credentials row", async () => {
    const s = fakeSupabase();
    const [a, b] = await Promise.all([provisionOrgForUser(s, "u1", "Acme"), provisionOrgForUser(s, "u1", "Acme")]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(veridianCalls).toBe(1);
    expect(orgInserts).toBe(1);
    expect(membershipInserts).toBe(1);
    expect(credentialInserts).toBe(1);
  });

  test("the create runs under a per-user advisory lock, and the credentials insert uses the same transaction", async () => {
    await provisionOrgForUser(fakeSupabase(), "u2", "Acme");
    expect(lockStatements).toBe(1);
    expect(credentialInserts).toBe(1);
  });

  test("a later call (another instance, queued behind the lock) sees the membership written under it and creates nothing", async () => {
    const s = fakeSupabase();
    await provisionOrgForUser(s, "u3", "Acme");
    const again = await provisionOrgForUser(s, "u3", "Acme");
    expect(again.status).toBe(200);
    expect(again.body.alreadyProvisioned).toBe(true);
    expect(orgInserts).toBe(1);
  });

  test("without a transaction-capable db it still provisions (single-flight only)", async () => {
    useTransaction = false;
    const r = await provisionOrgForUser(fakeSupabase(), "u4", "Acme");
    expect(r.status).toBe(201);
    expect(lockStatements).toBe(0);
  });
});
