/// <reference types="bun-types" />
// R67 F-05. The properties worth pinning are the safety ones: a prewarm keyed
// by the wrong parameters must never be served (that would show a report for a
// date range the user did not ask for), and a consumed slot must not be
// re-served (a rerun has to be a real, fresh request).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  prewarmReport,
  takePrewarmedReport,
  reportRequestUrl,
  __resetReportPrewarmForTests,
} from "./work-progress-report-prewarm";

const realFetch = globalThis.fetch;
let requestedUrls: string[] = [];

function stubFetch(body: unknown, status = 200) {
  requestedUrls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(typeof input === "string" ? input : input.toString());
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const PARAMS = { projectId: "p1", from: "2026-09-01", to: "2026-09-30" };

beforeEach(() => __resetReportPrewarmForTests());
afterEach(() => {
  globalThis.fetch = realFetch;
  __resetReportPrewarmForTests();
});

describe("work-progress report prewarm", () => {
  test("reportRequestUrl carries every parameter, and omits boqId when absent", () => {
    expect(reportRequestUrl(PARAMS)).toBe("/api/work-progress/report?projectId=p1&from=2026-09-01&to=2026-09-30");
    expect(reportRequestUrl({ ...PARAMS, boqId: "b9" })).toContain("boqId=b9");
  });

  test("a prewarmed request is handed to the matching consumer", async () => {
    stubFetch({ rows: [{ id: "r1" }] });

    prewarmReport(PARAMS);
    const promise = takePrewarmedReport(PARAMS);

    expect(promise).not.toBeNull();
    expect(await promise).toEqual({ rows: [{ id: "r1" }] });
    expect(requestedUrls).toHaveLength(1);
  });

  test("hovering twice with the same parameters starts ONE request", async () => {
    stubFetch({ rows: [] });

    prewarmReport(PARAMS);
    prewarmReport(PARAMS);
    await takePrewarmedReport(PARAMS);

    expect(requestedUrls).toHaveLength(1);
  });

  test("a prewarm for DIFFERENT parameters is never served", async () => {
    stubFetch({ rows: [] });

    prewarmReport(PARAMS);
    // the user changed the date range before clicking Run
    const promise = takePrewarmedReport({ ...PARAMS, to: "2026-10-31" });

    expect(promise).toBeNull();
  });

  test("the slot is consumed once -- a rerun is a real request", async () => {
    stubFetch({ rows: [] });

    prewarmReport(PARAMS);
    expect(takePrewarmedReport(PARAMS)).not.toBeNull();
    expect(takePrewarmedReport(PARAMS)).toBeNull();
  });

  test("a failed prewarm is dropped, so the component's own run reports the real error", async () => {
    stubFetch({ error: "The construction data service did not respond in time." }, 504);

    prewarmReport(PARAMS);
    // let the rejection settle and clear the slot
    await new Promise((r) => setTimeout(r, 0));

    expect(takePrewarmedReport(PARAMS)).toBeNull();
  });

  test("nothing is armed before a hover", () => {
    expect(takePrewarmedReport(PARAMS)).toBeNull();
  });
});
