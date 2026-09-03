/// <reference types="bun-types" />
// R67 D-55 / D-65 -- the Work Progress reads, asserted without a DOM.
//
// The case that matters most is the last describe block: a 500 on the entry
// list must come back as an ERROR OUTCOME, not as zero rows. Both Work
// Progress screens used to render the empty sentence and a "0" KPI from
// exactly that response.

import { afterEach, describe, expect, test } from "bun:test";
import {
  averagePercentComplete,
  pickCurrentBoq,
  readCategoryProgress,
  readWorkProgress,
  type ProgressEntry,
} from "./work-progress-reads";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers each url from a table; anything unlisted is a 500. */
function stubFetch(table: Record<string, { status: number; body: unknown }>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = Object.keys(table).find((k) => url.startsWith(k));
    const hit = key ? table[key] : { status: 500, body: { error: `no stub for ${url}` } };
    return new Response(JSON.stringify(hit.body), {
      status: hit.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function entry(id: string, percentComplete: string): ProgressEntry {
  return {
    id,
    activityId: "act-1",
    boqLineItemId: null,
    entryDate: "2026-08-28",
    quantityDone: "10",
    percentComplete,
    entryBasis: "quantity",
    remarks: null,
  };
}

describe("pickCurrentBoq -- one rule, not two copies of it", () => {
  test("an approved revision wins over everything else", () => {
    const picked = pickCurrentBoq([
      { id: "a", version: 3, status: "draft" },
      { id: "b", version: 1, status: "approved" },
      { id: "c", version: 2, status: "submitted" },
    ]);
    expect(picked?.id).toBe("b");
  });

  test("failing that, a submitted one", () => {
    const picked = pickCurrentBoq([
      { id: "a", version: 3, status: "draft" },
      { id: "c", version: 2, status: "submitted" },
    ]);
    expect(picked?.id).toBe("c");
  });

  test("failing that, the highest version number", () => {
    const picked = pickCurrentBoq([
      { id: "a", version: 3, status: "draft" },
      { id: "b", version: 9, status: "draft" },
    ]);
    expect(picked?.id).toBe("b");
  });

  test("no BOQs is null, not a throw", () => {
    expect(pickCurrentBoq([])).toBeNull();
  });

  test("the caller's array is not reordered underneath them", () => {
    // It is the same array a screen is rendering from; sorting it in place
    // would silently reorder what is on screen.
    const boqs = [
      { id: "a", version: 1, status: "draft" },
      { id: "b", version: 9, status: "draft" },
    ];
    pickCurrentBoq(boqs);
    expect(boqs.map((b) => b.id)).toEqual(["a", "b"]);
  });
});

describe("averagePercentComplete -- nothing to average is null, never 0", () => {
  test("averages and rounds", () => {
    expect(averagePercentComplete([entry("1", "50"), entry("2", "51")])).toBe(51);
  });

  test("an empty list has no average -- 0% would be a claim about the site", () => {
    expect(averagePercentComplete([])).toBeNull();
  });

  test("an unparseable figure does not become 0 either", () => {
    expect(averagePercentComplete([entry("1", "not-a-number")])).toBeNull();
  });
});

describe("readWorkProgress -- a failed entry read can never become zero rows", () => {
  test("a 500 on the entry list resolves to an error outcome carrying the backend's words", async () => {
    stubFetch({
      "/api/work-progress?": { status: 500, body: { error: "The construction data service did not respond." } },
      "/api/work-progress/activities": { status: 200, body: { activities: [] } },
      "/api/scope?": { status: 200, body: { boqs: [] } },
    });

    const result = await readWorkProgress("p-1");
    expect(result.entries.status).toBe("error");
    if (result.entries.status === "error") {
      expect(result.entries.message).toBe("The construction data service did not respond.");
      expect(result.entries.httpStatus).toBe(500);
    }
  });

  test("a 200 with no entries is EMPTY -- the only way to reach the empty sentence", async () => {
    stubFetch({
      "/api/work-progress?": { status: 200, body: { entries: [] } },
      "/api/work-progress/activities": { status: 200, body: { activities: [] } },
      "/api/scope?": { status: 200, body: { boqs: [] } },
    });

    const result = await readWorkProgress("p-1");
    expect(result.entries.status).toBe("empty");
  });

  test("a 200 with rows is ready, and the lookups come with it", async () => {
    stubFetch({
      "/api/work-progress?": { status: 200, body: { entries: [entry("e1", "40")] } },
      "/api/work-progress/activities": { status: 200, body: { activities: [{ id: "act-1", name: "Blockwork" }] } },
      "/api/scope?": { status: 200, body: { boqs: [{ id: "boq-1", version: 1, status: "approved" }] } },
      "/api/scope/boq-1": { status: 200, body: { lineItems: [{ id: "li-1", itemCode: "A.1", description: "Walls" }] } },
    });

    const result = await readWorkProgress("p-1");
    expect(result.entries.status).toBe("ready");
    expect(result.activities).toEqual([{ id: "act-1", name: "Blockwork" }]);
    expect(result.lineItems).toEqual([{ id: "li-1", itemCode: "A.1", description: "Walls" }]);
  });

  test("a failed LOOKUP does not take the successful entry list down with it", async () => {
    // The BOQ hop is the module's slowest and least reliable read (the /scope
    // N+1 the repo map records). Losing the line-item COLUMN is survivable;
    // losing the entries the user came to see is not.
    stubFetch({
      "/api/work-progress?": { status: 200, body: { entries: [entry("e1", "40")] } },
      "/api/work-progress/activities": { status: 500, body: { error: "activities are down" } },
      "/api/scope?": { status: 500, body: { error: "scope is down" } },
    });

    const result = await readWorkProgress("p-1");
    expect(result.entries.status).toBe("ready");
    expect(result.activities).toEqual([]);
    expect(result.lineItems).toEqual([]);
  });

  test("a thrown read -- no response at all -- is an error, not an empty list", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    const result = await readWorkProgress("p-1");
    expect(result.entries.status).toBe("error");
    if (result.entries.status === "error") expect(result.entries.retry).toBe(true);
  });
});

describe("readCategoryProgress -- the chart's failure is the chart's own", () => {
  test("a 500 is an error outcome, not an empty bar set", async () => {
    stubFetch({ "/api/reports/category-progress": { status: 500, body: { error: "no categories service" } } });
    const outcome = await readCategoryProgress("p-1");
    expect(outcome.status).toBe("error");
  });

  test("a 200 with bars is ready", async () => {
    stubFetch({
      "/api/reports/category-progress": {
        status: 200,
        body: { categories: [{ categoryId: "c1", name: "Civil", percentComplete: 62 }] },
      },
    });
    const outcome = await readCategoryProgress("p-1");
    expect(outcome.status).toBe("ready");
    if (outcome.status === "ready") expect(outcome.rows[0]?.name).toBe("Civil");
  });
});
