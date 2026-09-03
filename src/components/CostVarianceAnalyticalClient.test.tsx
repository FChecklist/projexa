/// <reference types="bun-types" />
// R67 E-26 (R-212). The bar block's own behaviour, as a render test: the
// figure is printed at every bar end (so the chart never depends on telling
// two muted fills apart), and clicking a bar reports the line it belongs to so
// the table can filter to it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Guarded, like the other happy-dom suites in this repo -- `bun test` runs
// every file in one process and a second register() throws.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// Queries come from render()'s own result, never the module-level `screen`:
// ESM evaluates every import before the register() call above, and `screen`
// binds itself to document.body at import time, so it would be bound to a
// document that did not exist yet.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CostVarianceBars } from "./CostVarianceAnalyticalClient";
import { NO_VARIANCE_CAPTION, budgetBars, buildCostVarianceRows, type CostVarianceLine } from "@/lib/cost-variance-rows";

afterEach(cleanup);

function line(over: Partial<CostVarianceLine> = {}): CostVarianceLine {
  return {
    lineItemId: "root",
    code: "1",
    description: "Blockwork",
    amount: 6500,
    budget: 1625,
    vendorId: null,
    vendorName: null,
    vendorAmount: null,
    variance: null,
    parentLineItemId: null,
    budgetIsDerived: false,
    percentOfParent: null,
    ...over,
  };
}

const rows = buildCostVarianceRows([
  line({ lineItemId: "root", code: "1", budget: 1625 }),
  line({ lineItemId: "child", code: "1.1", budget: 568.75, parentLineItemId: "root", budgetIsDerived: true, percentOfParent: 35 }),
  line({ lineItemId: "root2", code: "2", description: "Plaster", budget: 4000 }),
]);

describe("CostVarianceBars", () => {
  test("with nothing quoted it draws budget per root line and says so", () => {
    const { getByText, queryByText } = render(
      <CostVarianceBars
        bars={budgetBars(rows)}
        measure="budget"
        selectedLineItemId={null}
        onSelect={() => {}}
        formatValue={(v) => `AED ${v}`}
      />
    );
    expect(getByText(NO_VARIANCE_CAPTION)).toBeDefined();
    // The child is NOT a bar -- a root and its sub-task are the same money.
    expect(queryByText("1.1")).toBeNull();
    // Every bar prints its figure, so the chart reads without hovering.
    expect(getByText("AED 4000")).toBeDefined();
    expect(getByText("AED 1625")).toBeDefined();
  });

  test("clicking a bar reports its line, and clicking the selected bar clears it", () => {
    const onSelect = mock((_id: string | null) => {});
    const { getByText, rerender } = render(
      <CostVarianceBars
        bars={budgetBars(rows)}
        measure="budget"
        selectedLineItemId={null}
        onSelect={onSelect}
        formatValue={(v) => `AED ${v}`}
      />
    );
    fireEvent.click(getByText("2").closest("button")!);
    expect(onSelect).toHaveBeenCalledWith("root2");

    rerender(
      <CostVarianceBars
        bars={budgetBars(rows)}
        measure="budget"
        selectedLineItemId="root2"
        onSelect={onSelect}
        formatValue={(v) => `AED ${v}`}
      />
    );
    const selected = getByText("2").closest("button")!;
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(selected);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  test("an empty BOQ says there is nothing to chart, not an empty frame", () => {
    const { getByText } = render(
      <CostVarianceBars bars={[]} measure="budget" selectedLineItemId={null} onSelect={() => {}} formatValue={(v) => String(v)} />
    );
    expect(getByText("No BOQ line items with a budget yet.")).toBeDefined();
  });
});
