/// <reference types="bun-types" />
// Owner work order PROJEXA-E2E-001, section 5 item 1: "the /change-orders
// screen shows 'No change orders yet' even though there are 2 real change
// orders in the database for the relevant project." Re-investigated end to
// end (compliance-tracker's listChangeOrders() service call, the /api/v1/
// projexa/change-orders route, this repo's own /api/change-orders proxy) --
// the query and the data were never wrong. The real defect was that this
// screen never named which project it was showing, so
// resolveSelectedProject()'s documented, deliberate first-project fallback
// (src/lib/project-selection.ts) could silently land a viewer on a DIFFERENT
// project that genuinely has zero change orders, and the empty state gave no
// hint that was what had happened -- indistinguishable from "PROJEXA has no
// change orders feature". change-orders/page.tsx now passes `projectName` +
// `resolvedByFallback` down (same D-13/D-20/D-32 convention already proven
// out on DocumentsClient/LabourClient), and these tests are this component's
// half of that fix: the empty state must name the project, and must say so
// out loud when nobody chose it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/change-orders",
}));

const mod = await import("./ChangeOrdersClient");
const ChangeOrdersClient = mod.default;

const CHANGE_ORDER = {
  id: "co-1",
  number: 1,
  title: "Upgrade kitchen countertop to quartz",
  reason: null,
  costImpact: "85000",
  scheduleImpactDays: 3,
  status: "draft",
};

const realFetch = globalThis.fetch;
let requested: string[] = [];

/** `changeOrders` answers with `rows`; anything else (signature-status) answers empty. */
function stubFetch(rows: unknown[]) {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/api/change-orders?")) {
      return new Response(JSON.stringify({ changeOrders: rows }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/signature-status")) {
      return new Response(JSON.stringify({ signatureRequest: null }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

beforeEach(() => {
  requested = [];
  push.mockClear();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("ChangeOrdersClient -- empty state names the project (PROJEXA-E2E-001 section 5 item 1)", () => {
  test("with no projectName/resolvedByFallback (explicit ?projectId=, the fast path): plain, project-scoped message, no fallback admission", async () => {
    stubFetch([]);
    const { getByText, queryByText } = render(
      <ChangeOrdersClient projectId="p1" projectName="Business Bay Corporate HQ" />
    );

    await waitFor(() => expect(getByText("No change orders yet for Business Bay Corporate HQ.")).toBeDefined());
    expect(queryByText(/auto-selected/i)).toBeNull();
  });

  test("with resolvedByFallback=true: the empty state admits the project was picked FOR the user, not by them", async () => {
    stubFetch([]);
    const { getByText } = render(
      <ChangeOrdersClient projectId="p1" projectName="Business Bay Corporate HQ" resolvedByFallback />
    );

    await waitFor(() => expect(getByText("No change orders yet for Business Bay Corporate HQ.")).toBeDefined());
    expect(getByText(/This project was auto-selected/i)).toBeDefined();
  });

  test("with no projectName at all (prop omitted): falls back to the old, ungrammatical-free generic sentence rather than throwing", async () => {
    stubFetch([]);
    const { getByText } = render(<ChangeOrdersClient projectId="p1" />);
    await waitFor(() => expect(getByText("No change orders yet.")).toBeDefined());
  });

  test("REGRESSION: a project that genuinely HAS change orders still renders them -- the fix must not turn a real 2-row response into an empty state", async () => {
    stubFetch([CHANGE_ORDER, { ...CHANGE_ORDER, id: "co-2", number: 2, title: "Additional false ceiling cove lighting", status: "pending_approval" }]);
    const { getByText, queryByText } = render(
      <ChangeOrdersClient projectId="p1" projectName="Villa 21 - Whitefield" resolvedByFallback={false} />
    );

    await waitFor(() => expect(getByText("Upgrade kitchen countertop to quartz")).toBeDefined());
    expect(getByText("Additional false ceiling cove lighting")).toBeDefined();
    expect(queryByText(/No change orders yet/i)).toBeNull();
    expect(requested.some((u) => u.includes("/api/change-orders?projectId=p1"))).toBe(true);
  });
});
