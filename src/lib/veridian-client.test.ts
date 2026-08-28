/// <reference types="bun-types" />
// T7 / E-45 regression armor (platform.error_log E-45, "A tenant with no
// credentials row silently falls back to a SHARED key and therefore reads
// another organisation's data"). Fixed in commit d5bf258
// ("fix(veridian-client): fail loud on org key lookup miss (E-45 / AR-04)"):
// resolveApiKey() now THROWS when an organizationId is provided but has no
// row in veridian_credentials, instead of silently authenticating as
// whichever tenant the shared VERIDIAN_API_KEY env var belongs to.
//
// This file exists so a future edit that reintroduces that fallback (e.g.
// "just make it more resilient" or a merge that reverts the AR-04 branch)
// breaks CI instead of shipping a cross-tenant data leak quietly again.
//
// Also covers the DB-unreachable path: getVeridianApiKey() deliberately
// swallows a DB error and resolves null (see its own comment -- a transient
// outage must not crash unrelated requests). From resolveApiKey()'s point of
// view "no row" and "DB unreachable" must be indistinguishable: both mean
// "cannot prove which tenant this is," and AR-04 says both must fail loud,
// not fall back.
import { describe, expect, test, beforeEach, mock } from "bun:test";

const SHARED_KEY = "shared-demo-key-should-never-leak-to-another-org";
const ORG_WITH_NO_ROW = "11111111-1111-1111-1111-111111111111";

// Controls what the mocked drizzle chain's terminal .limit() call resolves
// (or rejects) with -- reassigned per test before calling resolveApiKey().
let selectResult: Promise<{ apiKey: string }[]>;

// Mocks the ENTIRE @/lib/db module (not just a function inside it) so this
// test never opens a real DATABASE_URL connection -- getVeridianApiKey()'s
// db.select().from().where().limit() chain resolves to whatever the test
// case above set. veridianCredentials only needs to look enough like a
// drizzle table for `eq(veridianCredentials.organizationId, ...)` inside
// veridian-client.ts to build a condition object; it is never sent anywhere
// in this mock.
mock.module("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => selectResult,
        }),
      }),
    }),
  },
  veridianCredentials: {
    organizationId: "organization_id",
    veridianApiKey: "veridian_api_key",
  },
}));

const { resolveApiKey, VeridianApiError } = await import("@/lib/veridian-client");

describe("resolveApiKey -- AR-04 / E-45 tenant-isolation fail-closed guard", () => {
  beforeEach(() => {
    process.env.VERIDIAN_API_KEY = SHARED_KEY;
  });

  test("throws instead of using SHARED_VERIDIAN_KEY when org has no credentials row", async () => {
    selectResult = Promise.resolve([]); // no veridian_credentials row for this org

    let resolved: string | null = null;
    let thrown: unknown = null;
    try {
      resolved = await resolveApiKey({ organizationId: ORG_WITH_NO_ROW });
    } catch (err) {
      thrown = err;
    }

    // The dangerous outcome this guards against: resolveApiKey() returning
    // the shared key instead of throwing. Assert the resolved value directly
    // (not just "it threw") so a future change that throws something but
    // still returns the shared key via some other path is also caught.
    expect(resolved).toBeNull();
    expect(thrown).toBeInstanceOf(VeridianApiError);
    expect((thrown as InstanceType<typeof VeridianApiError>).status).toBe(500);
    expect((thrown as Error).message).not.toContain(SHARED_KEY);
    expect((thrown as Error).message).toContain(ORG_WITH_NO_ROW);
  });

  test("throws instead of using SHARED_VERIDIAN_KEY when the credentials lookup is DB-unreachable", async () => {
    selectResult = Promise.reject(new Error("connection refused (simulated DB outage)"));

    let resolved: string | null = null;
    let thrown: unknown = null;
    try {
      resolved = await resolveApiKey({ organizationId: ORG_WITH_NO_ROW });
    } catch (err) {
      thrown = err;
    }

    expect(resolved).toBeNull();
    expect(thrown).toBeInstanceOf(VeridianApiError);
  });

  test("control: still resolves the org's own key when a credentials row exists", async () => {
    selectResult = Promise.resolve([{ apiKey: "org-scoped-real-key" }]);

    const key = await resolveApiKey({ organizationId: ORG_WITH_NO_ROW });
    expect(key).toBe("org-scoped-real-key");
  });

  test("control: the shared key remains available for legacy calls that omit organizationId entirely", async () => {
    const key = await resolveApiKey({});
    expect(key).toBe(SHARED_KEY);
  });
});
