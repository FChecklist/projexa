/// <reference types="bun-types" />
// R67 F-05 (R-075) acceptance test.
//
// THE BUG. WorkProgressPageClient fetched the entries and activities, and THEN
// -- serially -- GET /api/scope (the whole BOQ list with every line item of
// every revision, measured at 1.5-4.4 s) and GET /api/scope/{id}, purely to
// turn each entry's boqLineItemId into a readable "A-102 -- 230mm blockwork".
// The Analytics tab repeated the identical chain on switch. 15 requests and
// 7.4 s to network idle on a screen whose backend answers /work-progress in
// 400-831 ms.
//
// THE CONTRACT NOW. One /api/work-progress call, no /api/scope call, and the
// BOQ line renders from fields the API joined on server-side.
//
// SCOPE NOTE, stated rather than hidden: WorkProgressFormClient is stubbed
// below. The form has its OWN, legitimate /api/scope need -- it offers a BOQ
// selector, so it must know which BOQs exist -- and that is not a label
// lookup this item removes. What is under test here is the LIST's data path,
// which is what fired the three serial hops. (The form's own second hop,
// GET /api/scope/{id}, was also deleted in this item: /api/scope now returns
// each BOQ's line items, so switching BOQ costs no request at all.)
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// `screen` is intentionally not imported: @testing-library/dom binds it to
// document.body at module-evaluation time, before GlobalRegistrator.register()
// has created `document`.
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), prefetch: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
}));

// See the SCOPE NOTE above.
mock.module("@/components/WorkProgressFormClient", () => ({
  default: () => <div data-testid="form-stub" />,
}));

const WorkProgressPageClient = (await import("./WorkProgressPageClient")).default;
const { WorkProgressDataProvider, __resetWorkProgressCacheForTests } = await import("./WorkProgressDataProvider");

afterEach(() => {
  cleanup();
  __resetWorkProgressCacheForTests();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const JOINED_ENTRY = {
  id: "e1",
  activityId: "act-1",
  boqLineItemId: "line-1",
  entryDate: "2026-09-01",
  quantityDone: "12",
  percentComplete: "40",
  entryBasis: "DELTA",
  remarks: null,
  // joined server-side by compliance-tracker's listProgressEntries
  activityName: "Blockwork",
  boqItemCode: "A-102",
  boqLineDescription: "230mm blockwork to walls",
  unit: "cum",
};

function stubFetch(entries: unknown[] = [JOINED_ENTRY]) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.includes("/api/work-progress/activities")) return jsonRes({ activities: [{ id: "act-1", name: "Blockwork" }] });
    if (url.includes("/api/work-progress")) return jsonRes({ entries });
    if (url.includes("/api/scope")) return jsonRes({ boqs: [] });
    return jsonRes({});
  }) as typeof fetch;
  return calls;
}

function renderPage() {
  return render(
    <WorkProgressDataProvider projectId="proj-1">
      <WorkProgressPageClient projectId="proj-1" />
    </WorkProgressDataProvider>
  );
}

describe("WorkProgressPageClient -- one entries call, no BOQ lookup chain", () => {
  test("mounts with exactly ONE /api/work-progress call and ZERO /api/scope calls", async () => {
    const calls = stubFetch();

    const { findByText } = renderPage();
    await findByText("Blockwork");
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));

    // The activities call is a different endpoint and is counted separately.
    const entryCalls = calls.filter((u) => u.includes("/api/work-progress?") || /\/api\/work-progress\?/.test(u));
    expect(entryCalls).toHaveLength(1);
    expect(entryCalls[0]).toContain("projectId=proj-1");

    expect(calls.filter((u) => u.includes("/api/scope"))).toHaveLength(0);
  });

  test("a row renders its BOQ line from the joined fields", async () => {
    stubFetch();

    const { findByText } = renderPage();

    // "A-102 -- 230mm blockwork to walls", assembled from boqItemCode +
    // boqLineDescription, both of which arrived on the entry itself.
    expect(await findByText("A-102 -- 230mm blockwork to walls")).toBeDefined();
    expect(await findByText("Blockwork")).toBeDefined();
  });

  test("an entry whose activity no longer resolves shows a dash, not a raw id", async () => {
    stubFetch([{ ...JOINED_ENTRY, activityName: null, boqItemCode: null, boqLineDescription: null }]);

    const { container, findByText } = renderPage();
    await findByText("40%");

    // The uuid must never appear in a column headed "Activity".
    expect(container.textContent).not.toContain("act-1");
    expect(container.textContent).toContain("—");
  });

  test("the skeleton names the real columns while the entries load", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/work-progress/activities")) return jsonRes({ activities: [] });
      await gate;
      return jsonRes({ entries: [] });
    }) as typeof fetch;

    const { findByText } = renderPage();

    expect(await findByText("Loading progress entries...")).toBeDefined();
    expect(await findByText("BOQ line")).toBeDefined();
    release?.();
  });

  test("a failed entries load shows the backend's own words", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/work-progress/activities")) return jsonRes({ activities: [] });
      return jsonRes({ error: "projectId query param is required" }, 400);
    }) as typeof fetch;

    const { findByText } = renderPage();

    expect(await findByText(/projectId query param is required/)).toBeDefined();
  });
});
