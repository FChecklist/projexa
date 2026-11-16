import { describe, expect, test } from "bun:test";
import { budgetOverlayHidden, projectSideHidden } from "@/lib/cost-hidden";

// Sumeet R-50 (dual-view money model): a viewer without cost visibility
// (e.g. client_viewer) must never be shown the project (cost) side of a BOQ.
// The server removes the KEYS for such a viewer; these two helpers are the one
// place every screen asks "was cost withheld?". The signal is the ABSENCE of a
// key, never a null value: a cost-visible viewer whose line is "not costed yet"
// still gets the keys (value null) and must keep seeing the cost columns.
// Boss16 (16 Nov 2026) closure test for the client half; break-restore run
// recorded in the commit message. The live check stays
// e2e/r50-boq-dual-view-grid-env1.spec.ts.

describe("budgetOverlayHidden (R-50)", () => {
  test("every row lacks both budget keys: the overlay is hidden", () => {
    expect(budgetOverlayHidden([{}, {}])).toBe(true);
  });

  test("keys present with null values (not costed yet) is NOT hidden", () => {
    expect(budgetOverlayHidden([{ computedBudget: null, budgetPercentage: null }])).toBe(false);
  });

  test("one row still carrying a key means cost was not withheld", () => {
    expect(budgetOverlayHidden([{}, { budgetPercentage: "25" }])).toBe(false);
    expect(budgetOverlayHidden([{ computedBudget: 0 }, {}])).toBe(false);
  });

  test("no rows at all is not 'hidden': there is nothing to infer from", () => {
    expect(budgetOverlayHidden([])).toBe(false);
  });
});

describe("projectSideHidden (R-50)", () => {
  test("lines without qtyProject/rateProject: the project side is hidden", () => {
    expect(projectSideHidden({ lineItems: [{ qtyContract: "5", rateContract: "9" }, { qtyContract: "1" }] })).toBe(true);
  });

  test("a line with qtyProject or rateProject (even null) means the viewer may see cost", () => {
    expect(projectSideHidden({ lineItems: [{ qtyProject: null }] })).toBe(false);
    expect(projectSideHidden({ lineItems: [{ qtyContract: "5" }, { rateProject: "7" }] })).toBe(false);
  });

  test("with no lines, the roll-up decides: projectValue absent is hidden, present (even null) is not", () => {
    expect(projectSideHidden({ lineItems: [], moneyView: { contractValue: 100 } })).toBe(true);
    expect(projectSideHidden({ lineItems: [], moneyView: { contractValue: 100, projectValue: null } })).toBe(false);
  });

  test("no lines and no roll-up: nothing to hide", () => {
    expect(projectSideHidden({ lineItems: [] })).toBe(false);
    expect(projectSideHidden({ lineItems: [], moneyView: null })).toBe(false);
  });

  test("lines take precedence over the roll-up", () => {
    expect(projectSideHidden({ lineItems: [{ qtyContract: "1" }], moneyView: { projectValue: 5 } })).toBe(true);
  });
});
