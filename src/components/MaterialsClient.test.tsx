/// <reference types="bun-types" />
// R67 D-35 acceptance (audit R-095) and the D-36 half that lives on this
// screen: a row click used to produce no visible change at all even though
// the object page existed, the two fields a QS changes weekly could only be
// edited through a full object-page round trip, and no reported number could
// be opened down to the transactions behind it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const push = mock(() => {});
const prefetch = mock(() => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push, prefetch }),
  usePathname: () => "/materials",
}));

const MaterialsClient = (await import("./MaterialsClient")).default;

const MATERIALS = [
  { id: "mat-cement", name: "Cement OPC 53", spec: "53 grade", unit: "bag", unitCost: "420", isActive: true },
  { id: "mat-steel", name: "Steel rebar 12mm", spec: null, unit: "kg", unitCost: "3", isActive: true },
];
const RECEIPTS = [
  { id: "rec-1", materialId: "mat-cement", receivedDate: "2026-08-28", quantity: "50", unitCost: "435", vendorId: "v1", reference: "R60T2", voidedAt: null, voidReason: null },
  { id: "rec-2", materialId: "mat-steel", receivedDate: "2026-08-29", quantity: "1000", unitCost: "3", vendorId: null, reference: null, voidedAt: "2026-09-01T00:00:00.000Z", voidReason: "Quantity keyed wrong" },
];
const REPORT = [
  { materialId: "mat-cement", name: "Cement OPC 53", spec: "53 grade", unit: "bag", totalQuantityReceived: 50, totalCost: 21750, averageUnitCost: 435 },
];

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function router(handlers: Record<string, (init?: RequestInit) => Response>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler(init);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const DEFAULTS: Record<string, (init?: RequestInit) => Response> = {
  "/api/materials/master": () => jsonRes({ materials: MATERIALS }),
  "/api/construction-materials/cost-report": () => jsonRes({ report: REPORT }),
  "/api/materials?": () => jsonRes({ receipts: RECEIPTS }),
  "/api/vendors": () => jsonRes({ vendors: [{ id: "v1", vendorName: "Gulf Cement Trading" }] }),
  "/api/currencies": () => jsonRes({ currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
};

const PROJECT = "Cedar Heights Villa - Phase 1";

afterEach(() => {
  cleanup();
  push.mockClear();
  prefetch.mockClear();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("the master row is openable and says so (R-095)", () => {
  test("every row carries the WORD 'Open', not an icon", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { container, getByText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    const body = container.querySelector("tbody") as HTMLElement;
    expect(within(body).getAllByText("Open").length).toBe(MATERIALS.length);
    // ...and it is a real, focusable control, not a decorative icon.
    expect(within(body).getAllByText("Open")[0].tagName).toBe("BUTTON");
  });

  test("hovering a row prefetches its object page", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    fireEvent.mouseEnter(getByText("Cement OPC 53").closest("tr")!);
    expect(prefetch).toHaveBeenCalledWith("/materials/mat-cement");
  });

  test("clicking a row shows 'Opening…' on that row and navigates -- no click is silent", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    const row = getByText("Cement OPC 53").closest("tr")!;
    fireEvent.click(row);

    await waitFor(() => expect(within(row).getByText("Opening…")).toBeDefined());
    expect(push).toHaveBeenCalledWith("/materials/mat-cement");
    // Only the clicked row announces itself.
    const otherRow = getByText("Steel rebar 12mm").closest("tr")!;
    expect(within(otherRow).queryByText("Opening…")).toBeNull();
  });

  test("the Open control itself navigates without needing the whole row", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    const row = getByText("Cement OPC 53").closest("tr")!;
    fireEvent.click(within(row).getByText("Open"));
    expect(push).toHaveBeenCalledWith("/materials/mat-cement");
  });
});

describe("inline Unit / Unit Cost editing", () => {
  test("clicking the Unit cell opens a select of the units this project actually uses, and does NOT navigate", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, getByLabelText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    const row = getByText("Cement OPC 53").closest("tr")!;
    fireEvent.click(within(row).getByText("bag"));

    const select = await waitFor(() => getByLabelText("Unit for Cement OPC 53") as HTMLSelectElement);
    expect([...select.options].map((o) => o.value)).toEqual(["bag", "kg"]);
    // Editing a cell must not also open the object page.
    expect(push).not.toHaveBeenCalled();
  });

  test("choosing a different unit PATCHes that one field and updates the cell optimistically", async () => {
    let patched: { url: string; body: unknown } | null = null;
    // The specific path is listed FIRST: router() matches by substring in
    // insertion order, and "/api/materials/master" would otherwise swallow
    // "/api/materials/master/mat-cement".
    globalThis.fetch = router({
      "/api/materials/master/mat-cement": (init) => {
        patched = { url: "/api/materials/master/mat-cement", body: JSON.parse(String(init?.body)) };
        return jsonRes({ ...MATERIALS[0], unit: "kg" });
      },
      ...DEFAULTS,
    });
    const { getByText, getByLabelText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    const row = getByText("Cement OPC 53").closest("tr")!;
    fireEvent.click(within(row).getByText("bag"));
    const select = await waitFor(() => getByLabelText("Unit for Cement OPC 53"));
    fireEvent.change(select, { target: { value: "kg" } });

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.body).toEqual({ unit: "kg" });
    await waitFor(() => expect(within(getByText("Cement OPC 53").closest("tr")!).getByText("kg")).toBeDefined());
  });

  test("a failed PATCH reverts the cell and prints the backend's message in the footer", async () => {
    globalThis.fetch = router({
      "/api/materials/master/mat-cement": () => jsonRes({ error: "unit cannot be empty" }, 400),
      ...DEFAULTS,
    });
    const { getByText, getByLabelText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText("Cement OPC 53")).toBeDefined());
    fireEvent.click(within(getByText("Cement OPC 53").closest("tr")!).getByText("bag"));
    fireEvent.change(await waitFor(() => getByLabelText("Unit for Cement OPC 53")), { target: { value: "kg" } });

    await waitFor(() => expect(getByText(/unit cannot be empty/)).toBeDefined());
    // Reverted: the cell is "bag" again, not the value that failed to save.
    expect(within(getByText("Cement OPC 53").closest("tr")!).getByText("bag")).toBeDefined();
  });

  test("clicking the Unit Cost cell opens a currency-prefixed numeric input, and Escape closes it unchanged", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, getByLabelText, queryByLabelText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText("AED 420.00")).toBeDefined());
    fireEvent.click(getByText("AED 420.00"));

    const input = await waitFor(() => getByLabelText("Unit Cost for Cement OPC 53") as HTMLInputElement);
    expect(input.value).toBe("420");
    expect(within(input.closest("span")!).getByText("AED")).toBeDefined();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(queryByLabelText("Unit Cost for Cement OPC 53")).toBeNull());
    expect(getByText("AED 420.00")).toBeDefined();
  });
});

describe("the module header trio (R-095)", () => {
  test("the breadcrumb names the project and the three actions are Filter | Export | + New Material in that order", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { container, getByText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} />);

    await waitFor(() => expect(getByText(`${PROJECT} / Materials`)).toBeDefined());
    const header = container.querySelector("h1")!.closest("div")!.parentElement!;
    const labels = [...header.querySelectorAll("button")].map((b) => (b.textContent ?? "").split(" (")[0]);
    expect(labels.slice(0, 3)).toEqual(["Filter", "Export", "+ New Material"]);
  });

  test("Export is disabled with a stated reason when there is nothing to export", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/materials/master": () => jsonRes({ materials: [] }) });
    const { getByText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} />);
    await waitFor(() => expect(getByText("Export (No rows)")).toBeDefined());
    expect(getByText("Filter (No materials to filter)")).toBeDefined();
  });
});

describe("the Cost Report opens down to its transactions (R-095)", () => {
  test("clicking a reported material shows that material's receipts, names the filter and offers a way out", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, queryByText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} initialTab="cost-report" />);

    await waitFor(() => expect(getByText("AED 21,750.00")).toBeDefined());
    fireEvent.click(getByText("Cement OPC 53"));

    await waitFor(() => expect(getByText("Show all materials")).toBeDefined());
    // Only the cement receipt survives the filter.
    expect(getByText("R60T2")).toBeDefined();
    expect(queryByText("Steel rebar 12mm")).toBeNull();
  });

  test("arriving with ?materialId= already applied shows the same filtered list", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { container, getByText, queryByText } = render(
      <MaterialsClient projectId="p1" projectName={PROJECT} initialTab="receipts" initialMaterialId="mat-steel" />
    );

    await waitFor(() => expect(getByText("Show all materials")).toBeDefined());
    // The name appears twice on purpose: once in the "showing receipts for X"
    // line and once in the one surviving row.
    const body = container.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("Steel rebar 12mm")).toBeDefined();
    expect(queryByText("R60T2")).toBeNull();
  });
});

describe("voided receipts (D-36)", () => {
  test("a voided receipt is struck through, carries its reason on hover, and still opens", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} initialTab="receipts" />);

    await waitFor(() => expect(getByText("Steel rebar 12mm")).toBeDefined());
    const row = getByText("Steel rebar 12mm").closest("tr")!;
    expect(row.className).toContain("line-through");
    expect(row.getAttribute("title")).toBe("Voided — Quantity keyed wrong");

    fireEvent.click(row);
    expect(push).toHaveBeenCalledWith("/materials/receipts/rec-2");
  });

  test("a live receipt is not struck through and carries no void title", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<MaterialsClient projectId="p1" projectName={PROJECT} initialTab="receipts" />);

    await waitFor(() => expect(getByText("R60T2")).toBeDefined());
    const row = getByText("R60T2").closest("tr")!;
    expect(row.className).not.toContain("line-through");
    expect(row.getAttribute("title")).toBeNull();
  });
});
