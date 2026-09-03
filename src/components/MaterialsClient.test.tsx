/// <reference types="bun-types" />
// R67 D-37 acceptance, asserted against the real component.
//
// The item's own acceptance is a Playwright walk against
// http://localhost:3100. This session is forbidden from starting a dev server,
// so the same strings and the same behaviours are asserted here against the
// real DOM (happy-dom + @testing-library/react, the setup this repo already
// uses -- see AttendanceSheetClient.test.tsx). What is NOT covered by this
// substitution, and is stated rather than implied: real Next.js routing, real
// network latency and the real VERIDIAN responses behind the proxies.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see PayrollClient.test.tsx's own comment.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock(() => {});
const prefetch = mock(() => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push, prefetch }),
  usePathname: () => "/materials",
}));

const MaterialsClient = (await import("./MaterialsClient")).default;

const CEMENT = {
  id: "mat-cement", name: "Cement OPC 53", spec: "53 grade", unit: "bag", unitCost: "420", isActive: true,
  reorderLevel: null as string | null, receivedToDate: 200, issuedToDate: 80, onHand: 120,
};
const STEEL = {
  id: "mat-steel", name: "Steel rebar 12mm", spec: null, unit: "kg", unitCost: "3", isActive: true,
  reorderLevel: null as string | null, receivedToDate: 0, issuedToDate: 0, onHand: 0,
};

const REPORT_ROW = {
  materialId: CEMENT.id,
  name: CEMENT.name,
  spec: CEMENT.spec,
  unit: "bag",
  totalQuantityReceived: 50,
  totalCost: 21750,
  averageUnitCost: 435,
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = () => Response | Promise<Response>;

function router(handlers: Record<string, Handler>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    // Longest path first so "/api/materials/master" is not swallowed by
    // "/api/materials".
    for (const path of Object.keys(handlers).sort((a, b) => b.length - a.length)) {
      if (url.includes(path)) return handlers[path]();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const CURRENCIES = { currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] };

function handlers(over: Partial<Record<string, Handler>> = {}): Record<string, Handler> {
  return {
    "/api/materials/master": () => jsonRes({ materials: [CEMENT, STEEL] }),
    "/api/materials/issues": () => jsonRes({ issues: [] }),
    "/api/construction-materials/cost-report": () => jsonRes({ report: [REPORT_ROW] }),
    "/api/materials": () => jsonRes({ receipts: [] }),
    "/api/vendors": () => jsonRes({ vendors: [] }),
    "/api/currencies": () => jsonRes(CURRENCIES),
    ...over,
  } as Record<string, Handler>;
}

// Radix Tabs unmounts the inactive TabsContent, so a tab's own strings are
// only in the DOM when that tab is the open one -- which is exactly why the
// three loading flags had to be split in the first place.
function renderClient(over: Partial<Record<string, Handler>> = {}, initialTab?: string) {
  globalThis.fetch = router(handlers(over));
  return render(
    <MaterialsClient
      projectId="p1"
      projectName="Cedar Heights Villa - Phase 1"
      registryColumns={null}
      initialTab={initialTab}
    />
  );
}

afterEach(() => {
  cleanup();
  push.mockClear();
  prefetch.mockClear();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("MaterialsClient -- per-tab loading (D-37)", () => {
  test("the Material Master paints while the receipts ledger and the cost report are still in flight", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const { getByText, getByTestId } = renderClient({
      "/api/materials": async () => { await gate; return jsonRes({ receipts: [] }); },
      "/api/construction-materials/cost-report": async () => { await gate; return jsonRes({ report: [] }); },
    });

    // The master's rows AND its header actions are live while the other two
    // tabs' fetches are still open -- which is the whole point of splitting the
    // single loading flag.
    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    expect((getByTestId("materials-new") as HTMLButtonElement).disabled).toBe(false);

    release!();
  });

  test("the receipts tab paints while the master is still in flight -- the split works in both directions", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const { getByText, queryByText } = renderClient({
      "/api/materials/master": async () => { await gate; return jsonRes({ materials: [CEMENT] }); },
    }, "receipts");

    await waitFor(() => expect(getByText("No receipts recorded yet —")).toBeDefined());
    expect(queryByText("Loading receipts for Cedar Heights Villa - Phase 1…")).toBeNull();

    release!();
    await waitFor(() => expect(queryByText("Add a material first")).toBeNull());
  });

  test("each table loads behind a skeleton built from its own real column labels, not a spinner", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const { getByText, getAllByText } = renderClient({
      "/api/materials/master": async () => { await gate; return jsonRes({ materials: [CEMENT] }); },
    });

    await waitFor(() => expect(getByText("Loading materials for Cedar Heights Villa - Phase 1…")).toBeDefined());
    // The skeleton's header row is the honest one: the real labels.
    expect(getAllByText("Unit Cost").length).toBeGreaterThan(0);
    expect(getAllByText("Open").length).toBeGreaterThan(0);

    release!();
    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
  });
});

describe("MaterialsClient -- empty states carry a next step (D-37)", () => {
  test("an empty master says what to do next instead of only that it is empty", async () => {
    const { getByText, getAllByText } = renderClient({
      "/api/materials/master": () => jsonRes({ materials: [] }),
      "/api/construction-materials/cost-report": () => jsonRes({ report: [] }),
    });

    await waitFor(() => expect(getByText("No materials in the master yet —")).toBeDefined());
    // The header action and the empty-state action share the one label.
    expect(getAllByText("+ New Material").length).toBeGreaterThan(0);
  });

  test("with an empty master the receipts tab keeps Record Receipt visible and says 'Add a material first'", async () => {
    const { getByText, getByTestId } = renderClient({
      "/api/materials/master": () => jsonRes({ materials: [] }),
      "/api/construction-materials/cost-report": () => jsonRes({ report: [] }),
    }, "receipts");

    await waitFor(() => expect(getByText("Add a material first")).toBeDefined());
    const record = getByTestId("materials-record-receipt") as HTMLButtonElement;
    // Visible, not hidden -- and disabled, with the reason beside it.
    expect(record.textContent).toContain("Record Receipt");
    expect(record.disabled).toBe(true);
  });

  test("an empty Cost Report explains how it fills in", async () => {
    const { getByText } = renderClient({
      "/api/construction-materials/cost-report": () => jsonRes({ report: [] }),
    }, "cost-report");

    await waitFor(() =>
      expect(getByText("No receipts to report yet — the Cost Report fills in as receipts are recorded")).toBeDefined()
    );
  });
});

describe("MaterialsClient -- no click is silent (D-37)", () => {
  test("clicking a master row shows 'Opening…' on that row and pushes the object route", async () => {
    const { getByText, getAllByText } = renderClient();

    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    fireEvent.click(getByText("Cement OPC 53").closest("tr")!);

    expect(getAllByText("Opening…").length).toBeGreaterThan(0);
    expect(push).toHaveBeenCalledWith("/materials/mat-cement");
  });

  test("the header '+ New Material' becomes 'Opening…' on click", async () => {
    const { getByTestId } = renderClient();

    await waitFor(() => expect((getByTestId("materials-new") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByTestId("materials-new"));

    const button = getByTestId("materials-new") as HTMLButtonElement;
    expect(button.textContent).toBe("Opening…");
    expect(button.disabled).toBe(true);
    expect(push).toHaveBeenCalledWith("/materials/new?projectId=p1");
  });
});

describe("MaterialsClient -- the master finally carries a quantity (D-40)", () => {
  test("Received to date and On hand are columns on the master", async () => {
    const { getByText } = renderClient();

    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    expect(getByText("Received to date")).toBeDefined();
    expect(getByText("On hand")).toBeDefined();
    expect(getByText("200")).toBeDefined();
    expect(getByText("120")).toBeDefined();
  });

  test("a registry row that predates the quantity columns does not hide them", async () => {
    globalThis.fetch = router(handlers());
    const { getByText } = render(
      <MaterialsClient
        projectId="p1"
        projectName="Cedar Heights Villa - Phase 1"
        registryColumns={[{ label: "Material", field: "name", type: "text", importance: "High" }]}
      />
    );

    await waitFor(() => expect(getByText("Material")).toBeDefined());
    expect(getByText("On hand")).toBeDefined();
  });

  test("below its reorder level a row is flagged with the glyph AND the word, never colour alone", async () => {
    const { getByText, queryByText } = renderClient({
      "/api/materials/master": () => jsonRes({ materials: [{ ...CEMENT, reorderLevel: "150" }, STEEL] }),
    });

    await waitFor(() => expect(getByText("▲ Low")).toBeDefined());
    // Steel has no threshold at all, so it is never "Low" -- an absent
    // threshold is not a threshold of zero.
    expect(queryByText("▲ Low")!.textContent).toBe("▲ Low");
  });

  test("with no reorder level nothing is flagged", async () => {
    const { getByText, queryByText } = renderClient();
    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    expect(queryByText("▲ Low")).toBeNull();
  });

  test("the Issues tab lists what left the store and offers Record Issue", async () => {
    const { getByText, getByTestId } = renderClient({
      "/api/materials/issues": () => jsonRes({
        issues: [{ id: "iss-1", materialId: "mat-cement", issuedDate: "2026-09-01", quantity: "80", boqLineItemId: null, issuedTo: "Falcon gang 3", note: null }],
      }),
    }, "issues");

    await waitFor(() => expect(getByText("Falcon gang 3")).toBeDefined());
    expect(getByText("Issued to")).toBeDefined();
    expect((getByTestId("materials-record-issue") as HTMLButtonElement).textContent).toContain("Record Issue");
  });

  test("an empty Issues tab says so and offers the way in", async () => {
    const { getByText } = renderClient({}, "issues");
    await waitFor(() => expect(getByText("Nothing issued to site yet —")).toBeDefined());
  });
});

describe("MaterialsClient -- a closed project is read-only (D-38)", () => {
  test("the rose banner is shown and every write carries its reason", async () => {
    globalThis.fetch = router(handlers());
    const { getByText, getByTestId } = render(
      <MaterialsClient
        projectId="p1"
        projectName="Marina Tower Fit-out"
        registryColumns={null}
        readOnlyReason="This project is closed — materials are read-only"
      />
    );

    await waitFor(() => expect(getByText("This project is closed — materials are read-only")).toBeDefined());
    const newMaterial = getByTestId("materials-new") as HTMLButtonElement;
    expect(newMaterial.textContent).toBe("+ New Material (This project is closed — materials are read-only)");
    expect(newMaterial.disabled).toBe(true);
  });
});

describe("MaterialsClient -- the Cost Report explains the 420 vs 435 disagreement (D-37)", () => {
  test("Master Unit Cost and Variance vs master are shown, with the glyph AND the word", async () => {
    const { getByText } = renderClient({}, "cost-report");

    await waitFor(() => expect(getByText("Master Unit Cost")).toBeDefined());
    expect(getByText("Variance vs master")).toBeDefined();
    expect(
      getByText("Avg Unit Cost is the average price actually received; the master's Unit Cost is the planned price")
    ).toBeDefined();
    // 435 received against a 420 master -> 15 over, in the org currency.
    expect(getByText("▲ over AED 15.00")).toBeDefined();
  });

  test("a material received BELOW its master price reads 'under', not a bare negative number", async () => {
    const { getByText } = renderClient({
      "/api/construction-materials/cost-report": () =>
        jsonRes({ report: [{ ...REPORT_ROW, averageUnitCost: 400, totalCost: 20000 }] }),
    }, "cost-report");

    await waitFor(() => expect(getByText("▼ under AED 20.00")).toBeDefined());
  });
});
