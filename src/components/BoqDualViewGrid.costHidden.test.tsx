/// <reference types="bun-types" />
// R-50 (Sumeet audit 2026-10-20): for a viewer without cost visibility the server removes the project-side keys outright. The
// grid must then draw NO "Project (cost)" group, NO Variance columns and NO cost-coverage / project-value summary lines, and
// the same must hold when the parent screen has already seen the budget overlay withheld. A viewer WITH cost visibility,
// whose project-side values are merely null (not costed yet), must still see every one of them.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

let payload: unknown = null;
mock.module("@/lib/boq-read-source", () => ({ readBoqDualView: async () => payload }));
mock.module("@/lib/use-org-money", () => ({
  useOrgMoney: () => ({ currency: "AED", loaded: true, currencySet: true, showNotice: false, money: (v: number) => `AED ${v}` }),
}));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

const BoqDualViewGrid = (await import("./BoqDualViewGrid")).default;

afterEach(() => cleanup());

const withheldLine = { id: "l1", itemCode: "1", parentLineItemId: null, description: "Partition", unit: "m2", quantity: "10", rate: "50", qtyContract: "10", rateContract: "50", contractValue: 500 };
const visibleLine = { ...withheldLine, qtyProject: null, rateProject: null, projectValue: "NOT_SET", variance: "NOT_SET", variancePercent: "NOT_SET" };

async function renderGrid(props: { costHidden?: boolean } = {}) {
  const view = render(<BoqDualViewGrid boqId="boq-1" {...props} />);
  await waitFor(() => view.getByTestId("boq-dual-view-grid"));
  return view;
}

const COST_WORDS = [/project \(cost\)/i, /variance/i, /cost coverage/i, /project value/i];

describe("BoqDualViewGrid when the server withheld the cost side", () => {
  test("no cost header, variance column, project value or cost coverage is drawn", async () => {
    payload = { id: "boq-1", status: "draft", lineItems: [withheldLine], moneyView: { contractValue: 500, rootLineCount: 1 }, costCoverage: { totalContractValue: 500 } };
    const view = await renderGrid();
    const text = view.container.textContent ?? "";
    for (const word of COST_WORDS) expect(text).not.toMatch(word);
    expect(text).toMatch(/contract \(customer\)/i);
    expect(view.queryByLabelText("qtyProject for Partition")).toBeNull();
    expect(view.queryByLabelText("qtyContract for Partition")).not.toBeNull();
  });

  test("the parent screen's own withheld-budget signal is enough, even if this response still carried project keys", async () => {
    payload = { id: "boq-1", status: "draft", lineItems: [visibleLine], moneyView: { projectValue: "NOT_SET", contractValue: 500, rootLineCount: 1 } };
    const view = await renderGrid({ costHidden: true });
    const text = view.container.textContent ?? "";
    for (const word of COST_WORDS) expect(text).not.toMatch(word);
  });

  test("a viewer WITH cost visibility but nothing costed yet still sees every cost header and summary line", async () => {
    payload = { id: "boq-1", status: "draft", lineItems: [visibleLine], moneyView: { projectValue: "NOT_SET", contractValue: 500, rootLineCount: 1 }, costCoverage: { coveredContractValue: 0, totalContractValue: 500, coverageRatio: "NOT_SET" } };
    const view = await renderGrid();
    const text = view.container.textContent ?? "";
    for (const word of COST_WORDS) expect(text).toMatch(word);
    expect(view.queryByLabelText("qtyProject for Partition")).not.toBeNull();
  });
});
