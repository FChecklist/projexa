/// <reference types="bun-types" />
// R67 D-55 / D-65 -- the Work Progress reads, asserted without a DOM.
//
// The case that matters most is the last describe block: a 500 on the entry
// list must come back as an ERROR OUTCOME, not as zero rows. Both Work
// Progress screens used to render the empty sentence and a "0" KPI from
// exactly that response.
//
// R67 MERGE (lane F2's F-24). readWorkProgress() no longer fetches /api/scope
// or /api/scope/{id}: the BOQ line names it used to resolve now arrive on the
// entry rows themselves (compliance-tracker #1579). The assertions below that
// stubbed those two urls and read back `result.lineItems` are CORRECTED to
// that reality rather than deleted -- each one keeps the property it was
// written to protect. The "a failed LOOKUP does not take the entry list down"
// case now exercises the activities lookup, which is the lookup that is left,
// and pickCurrentBoq keeps every one of its own tests because
// WorkProgressFormClient still uses it for the BOQ picker.

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
    });

    const result = await readWorkProgress("p-1");
    expect(result.entries.status).toBe("empty");
  });

  test("a 200 with rows is ready, and the activity lookup comes with it", async () => {
    stubFetch({
      "/api/work-progress?": { status: 200, body: { entries: [entry("e1", "40")] } },
      "/api/work-progress/activities": { status: 200, body: { activities: [{ id: "act-1", name: "Blockwork" }] } },
    });

    const result = await readWorkProgress("p-1");
    expect(result.entries.status).toBe("ready");
    expect(result.activities).toEqual([{ id: "act-1", name: "Blockwork" }]);
  });

  test("the BOQ is NOT read here any more -- F-24 deleted both scope calls", async () => {
    // The assertion is the absence: anything unlisted in the stub table
    // answers 500, so a surviving /api/scope hop would show up as a failure
    // rather than passing silently. This is what stops the four-call chain
    // being reintroduced by a later edit.
    const asked: string[] = [];
    const table: Record<string, { status: number; body: unknown }> = {
      "/api/work-progress?": { status: 200, body: { entries: [entry("e1", "40")] } },
      "/api/work-progress/activities": { status: 200, body: { activities: [] } },
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      asked.push(url);
      const key = Object.keys(table).find((k) => url.startsWith(k));
      const hit = key ? table[key] : { status: 500, body: { error: `no stub for ${url}` } };
      return new Response(JSON.stringify(hit.body), {
        status: hit.status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await readWorkProgress("p-1");
    expect(result.entries.status).toBe("ready");
    expect(asked.some((u) => u.startsWith("/api/scope"))).toBe(false);
    expect(asked).toHaveLength(2);
  });

  test("a failed LOOKUP does not take the successful entry list down with it", async () => {
    // Losing the activity lookup costs the FORM's picker its options, which is
    // survivable and says so on the control; losing the entries the user came
    // to see is not. (Before F-24 this case was written against the BOQ hop,
    // which this read no longer makes.)
    stubFetch({
      "/api/work-progress?": { status: 200, body: { entries: [entry("e1", "40")] } },
      "/api/work-progress/activities": { status: 500, body: { error: "activities are down" } },
    });

    const result = await readWorkProgress("p-1");
    expect(result.entries.status).toBe("ready");
    expect(result.activities).toEqual([]);
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

// R67 F-05 (lane F1, ported here by the integration train). THE REGRESSION
// GUARD THIS FILE WAS MISSING.
//
// The 7.4 s /work-progress load was a SERIAL CHAIN: entries and activities,
// then /api/scope, then /api/scope/{id} -- pulling a whole BOQ's line items
// across the wire to translate one column, and still printing a raw id when
// the translation missed. VERIDIAN now LEFT JOINs the names onto the progress
// query, so that chain is gone.
//
// Nothing above would notice it coming back: every assertion in this file is
// about the OUTCOME of the entry read, and the fan-out could be reinstated
// underneath them with every one still green. This asserts the request set
// itself, which is the only thing that can catch it.
//
// Lane F1 asserted the same property through the rendered component. It is
// asserted here instead because this is where the reads live and because a
// plain async function needs no DOM to prove it -- the component-level version
// could not survive the merge, since the merged screen is built on this module.
describe("readWorkProgress -- the BOQ fan-out stays gone", () => {
  test("reads entries and activities ONLY -- never /api/scope, at any depth", async () => {
    const requested: string[] = [];
    const realFetchLocal = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requested.push(url);
      const body = url.includes("/activities")
        ? { activities: [{ id: "act-1", name: "Blockwork" }] }
        : { entries: [entry("e1", "40")] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const result = await readWorkProgress("p-1");
      expect(result.entries.status).toBe("ready");

      // The two that remain are ONE parallel batch, not a chain.
      expect(requested).toHaveLength(2);
      expect(requested.some((u) => u.startsWith("/api/work-progress?"))).toBe(true);
      expect(requested.some((u) => u.startsWith("/api/work-progress/activities"))).toBe(true);
      // The expensive half, in either of its two forms.
      expect(requested.some((u) => u.includes("/api/scope"))).toBe(false);
    } finally {
      globalThis.fetch = realFetchLocal;
    }
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
