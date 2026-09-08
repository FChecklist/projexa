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
import { invalidateVendors, loadVendors, rememberedOption, soleOptionId } from "./reference-lookups";

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

// ---------------------------------------------------------------------------
// R80 GAP-8 -- the create-screen default derivations.
//
// Every one of these tests is the same question asked twice: does it seed when
// the answer is genuinely determined, and does it REFUSE to seed when it is
// not? The refusals matter more than the seeds -- a create screen that fills a
// field in with a plausible guess gets that guess saved.
// ---------------------------------------------------------------------------

describe("soleOptionId", () => {
  test("exactly one row is not a choice, so it is the answer", () => {
    expect(soleOptionId([{ id: "wh-1" }])).toBe("wh-1");
  });

  test("two rows is a real question and stays unanswered", () => {
    expect(soleOptionId([{ id: "wh-1" }, { id: "wh-2" }])).toBeNull();
  });

  test("an empty, null or undefined list seeds nothing", () => {
    expect(soleOptionId([])).toBeNull();
    expect(soleOptionId(null)).toBeNull();
    expect(soleOptionId(undefined)).toBeNull();
  });

  test("a blank id is no id -- it would set the field to the empty answer", () => {
    expect(soleOptionId([{ id: "" }])).toBeNull();
    expect(soleOptionId([{ id: "   " }])).toBeNull();
  });

  test("extra columns on the row are irrelevant; only the id is read", () => {
    expect(soleOptionId([{ id: "cust-9", customerName: "Al Noor Contracting" }])).toBe("cust-9");
  });
});

describe("rememberedOption", () => {
  test("a remembered id that is still offered comes back", () => {
    expect(rememberedOption("mat-steel", ["mat-cement", "mat-steel"])).toBe("mat-steel");
  });

  test("a remembered id that has since been retired is NOT re-selected", () => {
    expect(rememberedOption("mat-old", ["mat-cement", "mat-steel"])).toBeNull();
  });

  test("nothing remembered, and nothing to offer, both mean no suggestion", () => {
    expect(rememberedOption(null, ["a"])).toBeNull();
    expect(rememberedOption(undefined, ["a"])).toBeNull();
    expect(rememberedOption("", ["a"])).toBeNull();
    expect(rememberedOption("  ", ["a"])).toBeNull();
    expect(rememberedOption("a", [])).toBeNull();
    expect(rememberedOption("a", null)).toBeNull();
  });
});
