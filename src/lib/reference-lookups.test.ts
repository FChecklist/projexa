/// <reference types="bun-types" />
// R67 F-06 (R-088/R-094) -- sibling test for reference-lookups.ts.
//
// The three behaviours worth pinning, each of which was a real defect in the
// hand-rolled per-screen copies this module replaces:
//   1. three screens asking for the same vendor list produce ONE request;
//   2. a failure resolves to [] (a Company cell degrades to "—") instead of
//      rejecting and taking the roster table down with it;
//   3. a failure is NOT cached -- the next mount retries, rather than the tab
//      believing "this org has no vendors" for a whole minute.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadVendors, invalidateVendors } from "./reference-lookups";

const realFetch = globalThis.fetch;
let requestedUrls: string[] = [];

function stubFetch(handler: () => Response | Promise<Response>) {
  requestedUrls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(typeof input === "string" ? input : input.toString());
    return handler();
  }) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const VENDORS = { vendors: [{ id: "v1", vendorName: "Al Noor Contracting" }] };

beforeEach(() => {
  invalidateVendors();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  invalidateVendors();
});

describe("loadVendors", () => {
  test("three screens mounting in one tab share ONE /api/vendors request", async () => {
    stubFetch(() => json(VENDORS));

    const [a, b, c] = await Promise.all([loadVendors(), loadVendors(), loadVendors()]);

    expect(requestedUrls).toEqual(["/api/vendors"]);
    expect(a).toEqual(VENDORS.vendors);
    expect(b).toEqual(VENDORS.vendors);
    expect(c).toEqual(VENDORS.vendors);
  });

  test("a later read inside the TTL makes no request at all", async () => {
    stubFetch(() => json(VENDORS));

    await loadVendors();
    await loadVendors();

    expect(requestedUrls).toHaveLength(1);
  });

  test("a failed lookup resolves to an empty list -- it never rejects into the caller's render path", async () => {
    stubFetch(() => json({ error: "VERIDIAN did not respond in time" }, 504));

    await expect(loadVendors()).resolves.toEqual([]);
  });

  test("a failure is not cached: the next mount retries and can succeed", async () => {
    let attempt = 0;
    stubFetch(() => {
      attempt += 1;
      return attempt === 1 ? json({ error: "boom" }, 502) : json(VENDORS);
    });

    expect(await loadVendors()).toEqual([]);
    expect(await loadVendors()).toEqual(VENDORS.vendors);
    expect(requestedUrls).toHaveLength(2);
  });

  test("invalidateVendors() forces the next read to re-request", async () => {
    stubFetch(() => json(VENDORS));

    await loadVendors();
    invalidateVendors();
    await loadVendors();

    expect(requestedUrls).toHaveLength(2);
  });
});
