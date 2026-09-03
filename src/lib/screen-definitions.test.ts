/// <reference types="bun-types" />
// R67 F-02/F-03. The behaviour that matters here is the failure posture and
// the org scoping, not the happy path -- a column-label lookup must never be
// able to take a screen down, and it must never be able to serve one tenant's
// labels to another.
//
// next/cache's unstable_cache is mocked to a pass-through: outside a Next
// request scope it has no cache to talk to, and what is under test is this
// module's own error handling and key/tag construction, not Next's Data Cache.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const cacheCalls: { keyParts: string[]; options: { revalidate?: number; tags?: string[] } }[] = [];

mock.module("next/cache", () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => unknown,
    keyParts: string[],
    options: { revalidate?: number; tags?: string[] }
  ) => {
    cacheCalls.push({ keyParts, options });
    return fn;
  },
}));

const { resolveRegistryColumns, screenDefinitionsTag } = await import("./screen-definitions");

const realFetch = globalThis.fetch;
let requestedUrls: string[] = [];

function stubFetch(body: unknown, status = 200) {
  requestedUrls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(typeof input === "string" ? input : input.toString());
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => {
  cacheCalls.length = 0;
  process.env.VERIDIAN_API_KEY = "vk_test_only";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("resolveRegistryColumns", () => {
  test("returns the registry's columns and asks the right endpoint", async () => {
    stubFetch({ columns: [{ field: "name", label: "Document", type: "text" }] });

    const columns = await resolveRegistryColumns("documents.list", null, 600);

    expect(columns).toEqual([{ field: "name", label: "Document", type: "text" }]);
    expect(requestedUrls[0]).toContain("/screen-definitions/documents.list");
  });

  test("a 404 (no row seeded yet) is null, not an error", async () => {
    stubFetch({ error: "Not found" }, 404);

    expect(await resolveRegistryColumns("moms.list", null, 3600)).toBeNull();
  });

  test("an empty columns array is treated as no definition", async () => {
    stubFetch({ columns: [] });

    expect(await resolveRegistryColumns("documents.list", null, 600)).toBeNull();
  });

  test("a 500 resolves to null instead of throwing -- a label lookup cannot take a screen down", async () => {
    stubFetch({ error: "boom" }, 500);

    expect(await resolveRegistryColumns("documents.list", null, 600)).toBeNull();
  });

  test("a network failure resolves to null too", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;

    expect(await resolveRegistryColumns("documents.list", null, 600)).toBeNull();
  });

  test("the cache key carries the org AND the function id, so labels cannot cross tenants", async () => {
    stubFetch({ columns: [{ field: "name", label: "X", type: "text" }] });

    await resolveRegistryColumns("documents.list", "org-a", 600);

    expect(cacheCalls).toHaveLength(1);
    expect(cacheCalls[0].keyParts).toEqual(["screen-definitions", "documents.list", "org-a"]);
  });

  test("the caller's TTL and a per-org revalidation tag reach unstable_cache", async () => {
    stubFetch({ columns: [{ field: "name", label: "X", type: "text" }] });

    await resolveRegistryColumns("moms.list", "org-b", 3600);

    expect(cacheCalls[0].options.revalidate).toBe(3600);
    expect(cacheCalls[0].options.tags).toEqual(["screen-definitions:org-b"]);
  });

  test("screenDefinitionsTag names the org, and a null org gets its own bucket", () => {
    expect(screenDefinitionsTag("org-c")).toBe("screen-definitions:org-c");
    expect(screenDefinitionsTag(null)).toBe("screen-definitions:shared");
  });
});
