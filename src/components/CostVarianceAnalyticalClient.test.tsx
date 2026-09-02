/// <reference types="bun-types" />
// R67 D-26 (R-066). THE FAULT: the Cost Variance tab reported a sum of nothing
// as if it were a measurement ("Total vendor amount 0" over rows where nothing
// was linked), knew only ONE of the three components of Sumeet's budget model,
// and rendered Filter and Export disabled with "Not yet available".
//
// These tests cover the pure rules the screen is built on -- the no-data vs
// real-zero distinction, the filter, and the CSV of exactly the visible rows --
// plus the two renders that prove the tiles and the empty chart say the right
// thing.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({ useRouter: () => ({ push: mock(() => {}), prefetch: mock(() => {}) }) }));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

const CostVarianceAnalyticalClient = (await import("./CostVarianceAnalyticalClient")).default;
const { applyFilters, money, toCsv } = await import("./CostVarianceAnalyticalClient");
type VarianceLine = import("./CostVarianceAnalyticalClient").VarianceLine;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function line(over: Partial<VarianceLine> = {}): VarianceLine {
  return {
    serialNumber: 1, lineItemId: "li-1", code: "A1", category: "Gypsum",
    description: "Partition", unit: "sqm", quantity: 10, rate: 5, amount: 50,
    budget: 100, vendorId: null, vendorName: null,
    vendorAmount: null, materialAmount: null, manpowerAmount: null,
    committed: null, variance: null, ...over,
  };
}

describe("money -- no data and a real zero are DIFFERENT answers", () => {
  test("a figure nobody entered is an en dash, never 'AED 0'", () => {
    expect(money(null, "AED")).toBe("–");
  });

  test("a real, entered zero is 'AED 0'", () => {
    expect(money(0, "AED")).toBe("AED 0");
  });

  test("degrades to the bare number when the org has no base currency", () => {
    expect(money(1200, "")).toBe("1,200");
  });
});

describe("applyFilters", () => {
  const lines = [
    line({ lineItemId: "a", category: "Gypsum", vendorName: "Al Noor" }),
    line({ lineItemId: "b", category: "Paint", vendorName: "Al Noor" }),
    line({ lineItemId: "c", category: null, vendorName: null }),
  ];

  test("no filter keeps every row", () => {
    expect(applyFilters(lines, "__all__", "__all__")).toHaveLength(3);
  });

  test("filters by category", () => {
    expect(applyFilters(lines, "Gypsum", "__all__").map((l) => l.lineItemId)).toEqual(["a"]);
  });

  test("filters by vendor", () => {
    expect(applyFilters(lines, "__all__", "Al Noor").map((l) => l.lineItemId)).toEqual(["a", "b"]);
  });

  test("an uncategorised, unlinked row is reachable through its own honest labels, not lost", () => {
    expect(applyFilters(lines, "Uncategorized", "No vendor").map((l) => l.lineItemId)).toEqual(["c"]);
  });

  test("the two filters combine", () => {
    expect(applyFilters(lines, "Paint", "Al Noor").map((l) => l.lineItemId)).toEqual(["b"]);
  });
});

describe("toCsv -- exactly the rows on screen, in Sumeet's Budget Report shape", () => {
  test("the header carries every column the table shows", () => {
    const [header] = toCsv([]).split("\n");
    expect(header).toBe("S.No,Category,Code,Description,Unit,Qty,Rate,Amount,Budget,Vendor,Vendor Amt,Material,Manpower,Variance");
  });

  test("an absent figure is an EMPTY cell, not a 0 a spreadsheet would sum", () => {
    const [, row] = toCsv([line()]).split("\n");
    expect(row).toBe("1,Gypsum,A1,Partition,sqm,10,5,50,100,,,,,");
  });

  test("a real zero survives as 0", () => {
    const [, row] = toCsv([line({ materialAmount: 0, committed: 0, variance: 100 })]).split("\n");
    expect(row.endsWith(",0,,100")).toBe(true);
  });

  test("a description containing a comma is quoted", () => {
    const [, row] = toCsv([line({ description: "Blockwork, external" })]).split("\n");
    expect(row).toContain('"Blockwork, external"');
  });
});

function mount(report: unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/reports/budget-variance")) {
      return new Response(JSON.stringify(report), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/currencies")) {
      return new Response(JSON.stringify({ currencies: [{ code: "AED", isBaseCurrency: true }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<CostVarianceAnalyticalClient projectId="proj-1" />);
}

describe("CostVarianceAnalyticalClient tiles and chart (D-26)", () => {
  const uncosted = {
    boqId: "boq-1",
    lines: [line({ lineItemId: "a" }), line({ lineItemId: "b", serialNumber: 2 })],
    totalBudget: 200, totalCommitted: null, totalVariance: null, linesOverBudget: 0, lineCount: 2,
  };

  test("with nothing linked, Committed reads as an en dash rather than a fabricated zero", async () => {
    const { findByText, getByText } = mount(uncosted);
    await findByText("Total budget");
    expect(getByText("Committed (vendor + material + manpower)")).toBeDefined();
    // The tile's own value, not the budget's.
    const committedTile = getByText("Committed (vendor + material + manpower)").parentElement;
    expect(committedTile?.textContent).toContain("–");
  });

  test("'Lines over budget' is counted OF the visible lines, not left as a bare number", async () => {
    const { findByText, getByText } = mount(uncosted);
    await findByText("Total budget");
    expect(getByText("0 of 2")).toBeDefined();
  });

  test("with no committed cost the chart slot says so and links to the current BOQ", async () => {
    const { findByText, getByRole } = mount(uncosted);
    expect(await findByText(/No committed cost yet - enter vendor, material or manpower amounts on a BOQ line to see variance\./)).toBeDefined();
    expect(getByRole("link", { name: "Open the current BOQ" }).getAttribute("href")).toBe("/scope/boq-1");
  });

  test("Filter and Export are REAL header actions -- neither carries 'Not yet available' any more", async () => {
    const { findByText, getByRole } = mount(uncosted);
    await findByText("Total budget");
    const filter = getByRole("button", { name: /Filter/ }) as HTMLButtonElement;
    const exportBtn = getByRole("button", { name: /Export CSV/ }) as HTMLButtonElement;
    expect(filter.disabled).toBe(false);
    expect(exportBtn.disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Not yet available");
  });

  test("a costed, over-budget line makes the tiles real and counts itself", async () => {
    const { findByText, getByText } = mount({
      boqId: "boq-1",
      lines: [
        line({ lineItemId: "a", vendorAmount: 130, committed: 130, variance: -30 }),
        line({ lineItemId: "b", serialNumber: 2 }),
      ],
      totalBudget: 200, totalCommitted: 130, totalVariance: -30, linesOverBudget: 1, lineCount: 2,
    });
    await findByText("Total budget");
    await waitFor(() => expect(getByText("1 of 2")).toBeDefined());
    const committedTile = getByText("Committed (vendor + material + manpower)").parentElement;
    expect(committedTile?.textContent).toContain("AED 130");
  });
});
