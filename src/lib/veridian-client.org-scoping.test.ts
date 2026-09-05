/// <reference types="bun-types" />
// R43_EXEC_01 (Critical, closed as a false positive by R52/R56/R60 on
// platform.r43_faults -- the row's own "unrelated org" observation was an
// id-space mixup between PROJEXA's own org id and VERIDIAN's org id for the
// SAME provisioned tenant, not a real cross-tenant leak; see that row's
// justification). No code fix landed for this row. What IS security-critical,
// and had zero regression coverage in this file before this suite, is the
// exact mechanism R52/R56/R60 hand-verified each time by direct query rather
// than a test: getVeridianApiKey()/resolveApiKey() must resolve an org's
// VERIDIAN API key ONLY from that org's own row in veridian_credentials
// (organizationId is that table's PRIMARY KEY -- see schema.ts:43-46), and
// resolveApiKey() must never fall back to the shared platform VERIDIAN_API_KEY
// when an organizationId WAS supplied but has no per-org row (the AR-04
// fail-loud guard) -- see veridian-client.ts:184-210's own comment. Either
// regression (a lookup that isn't scoped to the caller's exact org, or a
// silent fallback to the shared key) would let one org's server-side calls
// authenticate as a different VERIDIAN tenant -- the actual cross-tenant leak
// this fault row was worried about, even though this particular row's own
// evidence didn't show one.
import { describe, test, expect, mock, afterEach } from "bun:test";

let lastRequestedOrgId: string | undefined;

// veridian-client.ts's ONLY drizzle-orm import is `eq`. This mock does NOT
// call through to the real drizzle-orm implementation: bun's mock.module()
// replaces the module registry entry that a captured `import * as
// realDrizzle` binding itself resolves against, so a "delegate to the real
// eq() from inside the mock" pattern recurses into itself infinitely
// (confirmed by hand -- that exact pattern hung this test file indefinitely
// before being caught here). A synthetic marker object is all the `.where()`
// mock below needs; the actual filtering happens via the `lastRequestedOrgId`
// side-channel set here, which is what proves the code path really did
// pass THIS call's organizationId through to the lookup, not some
// leftover/global value.
function mockDbWithRows(rows: { organizationId: string; veridianApiKey: string }[]) {
  mock.module("drizzle-orm", () => ({
    eq: (_col: unknown, val: string) => {
      lastRequestedOrgId = val;
      return { __mockEq: true, val };
    },
  }));
  mock.module("@/lib/db", () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve(
                rows.filter((r) => r.organizationId === lastRequestedOrgId).map((r) => ({ apiKey: r.veridianApiKey }))
              ),
          }),
        }),
      }),
    },
    veridianCredentials: { organizationId: "organization_id" },
  }));
}

const originalSharedKey = process.env.VERIDIAN_API_KEY;
afterEach(() => {
  if (originalSharedKey === undefined) delete process.env.VERIDIAN_API_KEY;
  else process.env.VERIDIAN_API_KEY = originalSharedKey;
});

describe("getVeridianApiKey: scoped strictly to the requested organizationId", () => {
  test("returns org A's own key for org A, never org B's key", async () => {
    mockDbWithRows([
      { organizationId: "org-a", veridianApiKey: "key-for-org-a" },
      { organizationId: "org-b", veridianApiKey: "key-for-org-b" },
    ]);
    const { getVeridianApiKey } = await import("./veridian-client");

    const keyA = await getVeridianApiKey("org-a");
    const keyB = await getVeridianApiKey("org-b");

    expect(keyA).toBe("key-for-org-a");
    expect(keyB).toBe("key-for-org-b");
    expect(keyA).not.toBe(keyB);
  });

  test("returns null (never another org's key) when the requested org has no row", async () => {
    mockDbWithRows([{ organizationId: "org-a", veridianApiKey: "key-for-org-a" }]);
    const { getVeridianApiKey } = await import("./veridian-client");

    const key = await getVeridianApiKey("org-with-no-credentials-row");
    expect(key).toBeNull();
  });
});

describe("resolveApiKey: AR-04 fail-loud guard (R43_EXEC_01 regression guard)", () => {
  test("an organizationId with its own row resolves to that org's own key", async () => {
    mockDbWithRows([{ organizationId: "org-a", veridianApiKey: "key-for-org-a" }]);
    const { resolveApiKey } = await import("./veridian-client");

    const key = await resolveApiKey({ organizationId: "org-a" });
    expect(key).toBe("key-for-org-a");
  });

  test("an organizationId with NO per-org row throws rather than silently falling back to the shared VERIDIAN_API_KEY", async () => {
    process.env.VERIDIAN_API_KEY = "shared-platform-key";
    mockDbWithRows([{ organizationId: "org-a", veridianApiKey: "key-for-org-a" }]);
    const { resolveApiKey, VeridianApiError } = await import("./veridian-client");

    await expect(resolveApiKey({ organizationId: "org-with-no-credentials-row" })).rejects.toBeInstanceOf(VeridianApiError);
  });

  test("an explicit apiKey passed by the caller always wins, even over a resolvable organizationId", async () => {
    mockDbWithRows([{ organizationId: "org-a", veridianApiKey: "key-for-org-a" }]);
    const { resolveApiKey } = await import("./veridian-client");

    const key = await resolveApiKey({ apiKey: "explicit-key", organizationId: "org-a" });
    expect(key).toBe("explicit-key");
  });

  test("omitting organizationId entirely falls back to the shared VERIDIAN_API_KEY (legacy call sites only)", async () => {
    process.env.VERIDIAN_API_KEY = "shared-platform-key";
    mockDbWithRows([]);
    const { resolveApiKey } = await import("./veridian-client");

    const key = await resolveApiKey({});
    expect(key).toBe("shared-platform-key");
  });
});
