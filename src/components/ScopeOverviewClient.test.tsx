/// <reference types="bun-types" />
// R-96 (Sumeet: Scope of work must be a real, usable concept). Closure test for the project-level "Scope of Work" overview:
// the current approved scope, earlier versions, what changed since the original, pending change orders, and the three
// links into the existing BOQ screens. Money must appear only where the payload carries a figure.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { EMPTY_VALUE } from "@/lib/format-money";

await mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/scope",
}));

const { default: ScopeOverviewClient } = await import("./ScopeOverviewClient");
const { buildScopeOverview } = await import("@/lib/scope-overview");
type OverviewBoq = import("@/lib/scope-overview").OverviewBoq;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function stubFetch(changeOrders: unknown[] | "fail" = []) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/change-orders")) {
      if (changeOrders === "fail") return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ changeOrders }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ currencies: [{ id: "c-1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  return urls;
}

const ORIGINAL: OverviewBoq = {
  id: "b1", version: 1, title: "Villa 21 Fit-out", status: "superseded", parentBoqId: null, createdAt: "2026-09-01T00:00:00.000Z",
  compare: { lineCount: 2, total: 5020, deltaAmount: null, deltaPct: null },
};
const REV1: OverviewBoq = {
  id: "b2", version: 2, title: "Villa 21 Fit-out", status: "approved", parentBoqId: "b1", createdAt: "2026-09-02T00:00:00.000Z",
  compare: { lineCount: 3, total: 6025, deltaAmount: 1005, deltaPct: 20 },
};
const REV2: OverviewBoq = {
  id: "b3", version: 3, title: "Villa 21 Fit-out", status: "draft", parentBoqId: "b2", createdAt: "2026-09-03T00:00:00.000Z",
  compare: { lineCount: 4, total: 6500, deltaAmount: 475, deltaPct: 7.9 }, totalVariationVsOriginal: 1480,
};
const REDACTED: OverviewBoq = { ...REV1, compare: undefined, variationVsPrior: undefined };

describe("buildScopeOverview", () => {
  test("current is the highest approved revision, not the newest draft", () => {
    const o = buildScopeOverview([ORIGINAL, REV1, REV2]);
    expect(o.current?.id).toBe("b2");
    expect(o.currentApproved).toBe(true);
    expect(o.currentRevLabel).toBe("Rev1");
    expect(o.previous.map((p) => p.boq.id)).toEqual(["b3", "b1"]);
    expect(o.variations.map((v) => [v.revLabel, v.vsPrior, v.vsOriginal])).toEqual([["Rev1", 1005, 1005], ["Rev2", 475, 1480]]);
  });
  test("nothing approved: the latest version is current and says so", () => {
    const o = buildScopeOverview([{ ...ORIGINAL, status: "draft" }]);
    expect(o.current?.id).toBe("b1");
    expect(o.currentApproved).toBe(false);
    expect(o.variations).toEqual([]);
  });
  test("an empty project has no current scope", () => {
    expect(buildScopeOverview([]).current).toBeNull();
  });
});

describe("ScopeOverviewClient", () => {
  test("empty project: says so in plain words and offers New and Import", async () => {
    stubFetch();
    const { getByTestId, getByText } = render(<ScopeOverviewClient projectId="p-1" projectName="Cedar" boqs={[]} initialChangeOrders={[]} />);
    expect(getByTestId("scope-overview").getAttribute("data-state")).toBe("empty");
    expect(getByText("Cedar has no Scope of Work yet.")).toBeDefined();
    expect(document.querySelector("a[href='/scope/new']")).not.toBeNull();
    expect(document.querySelector("a[href='/scope/import']")).not.toBeNull();
  });

  test("one BOQ (the original): shows its title, version, status, total and line count; no earlier versions; no variation", async () => {
    stubFetch();
    const { getByTestId } = render(<ScopeOverviewClient projectId="p-1" boqs={[{ ...ORIGINAL, status: "approved" }]} initialChangeOrders={[]} />);
    await waitFor(() => expect(getByTestId("scope-current-total").textContent).toContain("5,020.00"));
    expect(getByTestId("scope-current-title").textContent).toBe("Villa 21 Fit-out");
    expect(getByTestId("scope-current-rev").textContent).toBe("Rev0");
    expect(getByTestId("scope-current-lines").textContent).toBe("2");
    expect(getByTestId("scope-no-previous")).toBeDefined();
    expect(getByTestId("scope-no-variations")).toBeDefined();
    // No earlier version, so no Compare link; Open and Revise are there.
    expect(document.querySelector("a[href='/scope/b1']")).not.toBeNull();
    expect(document.querySelector("a[href='/scope/b1/revise']")).not.toBeNull();
    expect(document.querySelector("a[href='/scope/b1/compare']")).toBeNull();
  });

  test("several revisions: current, earlier versions with status, signed variations, and the three links", async () => {
    stubFetch();
    const { getByTestId, getAllByTestId } = render(<ScopeOverviewClient projectId="p-1" boqs={[REV2, ORIGINAL, REV1]} initialChangeOrders={[]} />);
    await waitFor(() => expect(getByTestId("scope-current-total").textContent).toContain("6,025.00"));
    expect(getByTestId("scope-current-rev").textContent).toBe("Rev1");
    expect(getAllByTestId("scope-previous-row")).toHaveLength(2);
    const prev = getByTestId("scope-previous").textContent ?? "";
    expect(prev).toContain("Rev2");
    expect(prev).toContain("draft");
    expect(prev).toContain("superseded");
    const vrows = getAllByTestId("scope-variation-row").map((r) => r.textContent ?? "");
    expect(vrows).toHaveLength(2);
    expect(vrows[0]).toMatch(/\+1,005\.00/);
    expect(vrows[1]).toMatch(/\+475\.00/);
    expect(vrows[1]).toMatch(/\+1,480\.00/);
    expect(document.querySelector("a[href='/scope/b2']")).not.toBeNull();
    expect(document.querySelector("a[href='/scope/b2/revise']")).not.toBeNull();
    expect(document.querySelector("a[href='/scope/b2/compare']")).not.toBeNull();
  });

  test("a role whose payload carries no money sees em-dashes, never a figure or a zero", async () => {
    stubFetch();
    const { getByTestId } = render(
      <ScopeOverviewClient
        projectId="p-1"
        boqs={[ORIGINAL, REDACTED]}
        initialChangeOrders={[{ id: "co1", number: 7, title: "Extra door", status: "pending_approval", costImpact: null }]}
      />,
    );
    await waitFor(() => expect(getByTestId("scope-current-title")).toBeDefined());
    expect(getByTestId("scope-current-total").textContent).toBe(EMPTY_VALUE);
    expect(getByTestId("scope-current-lines").textContent).toBe(EMPTY_VALUE);
    const variation = getByTestId("scope-variation-row").textContent ?? "";
    expect(variation).not.toMatch(/\d{2,}/);
    expect(getByTestId("scope-order-row").textContent).toContain(EMPTY_VALUE);
    expect(document.body.textContent).not.toContain("AED 0");
  });

  test("pending change orders are read from the existing route and listed; other statuses are not", async () => {
    const urls = stubFetch([
      { id: "co1", number: 1, title: "Extra door", status: "pending_approval", costImpact: "1200" },
      { id: "co2", number: 2, title: "Old one", status: "approved", costImpact: "50" },
    ]);
    const { findAllByTestId, queryByText } = render(<ScopeOverviewClient projectId="p-1" boqs={[REV1]} />);
    const rows = await findAllByTestId("scope-order-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("CO-1 Extra door");
    expect(rows[0].textContent).toContain("1,200.00");
    expect(queryByText(/Old one/)).toBeNull();
    // The overview adds NO BOQ request: only change orders (and the currency label).
    expect(urls.filter((u) => u.includes("/api/scope"))).toEqual([]);
    expect(urls.some((u) => u.includes("/api/change-orders?projectId=p-1"))).toBe(true);
  });

  test("a failed change-order read says so instead of claiming there are none", async () => {
    stubFetch("fail");
    const { findByTestId, queryByTestId } = render(<ScopeOverviewClient projectId="p-1" boqs={[REV1]} />);
    expect(await findByTestId("scope-orders-failed")).toBeDefined();
    expect(queryByTestId("scope-no-orders")).toBeNull();
  });

  test("says in one sentence that the tab needs a connection", () => {
    stubFetch();
    const { getByTestId } = render(<ScopeOverviewClient projectId="p-1" boqs={[REV1]} initialChangeOrders={[]} />);
    expect(getByTestId("scope-online-note").textContent).toContain("needs a connection");
  });
});
