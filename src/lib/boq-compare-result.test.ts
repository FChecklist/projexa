import { describe, expect, test } from "bun:test";
import type { BoqComparison, BoqLineItemRow, ChangedLineItem } from "@/lib/boq-helpers";
import { changedFieldsFor, toCompareResult } from "@/lib/boq-compare-result";

// Sumeet R-24 "Percentage-only change detected as variation" and R-21
// "Revision variation vs prior shown": the screen side of both rules.
// Boss16 (16 Nov 2026) closure test, written to the R74-RULING-03 standard
// as far as a unit test can go: it runs the real function; the break-restore
// run (the breakdown-% clause removed, test fails, clause restored) is
// recorded in the commit message. It does NOT replace the live browser spec
// e2e/r21-r24-boq-compare-variation-and-percentage-change-env1.spec.ts.

const row = (o: Partial<BoqLineItemRow>): BoqLineItemRow => ({
  id: "x", itemCode: "A1.1", description: "Sub-task", unit: "m2", quantity: "10", rate: "50", amount: "500",
  activityId: null, ...o,
} as BoqLineItemRow);

const changedLine = (o: Partial<ChangedLineItem>): ChangedLineItem => ({
  key: "A1.1", previous: row({ breakdownPercentage: "40" }), current: row({ breakdownPercentage: "60" }),
  quantityChange: 0, rateChange: 0, breakdownPercentageChange: 0, netVariation: 0, ...o,
});

describe("changedFieldsFor (R-24)", () => {
  test("a percentage-only change is flagged: breakdown % and amount, never silently dropped", () => {
    expect(changedFieldsFor({ quantityChange: 0, rateChange: 0, breakdownPercentageChange: 20 }))
      .toEqual(["amount", "breakdownPercentage"]);
  });

  test("a quantity-only change flags quantity and amount, not rate or breakdown %", () => {
    expect(changedFieldsFor({ quantityChange: 5, rateChange: 0, breakdownPercentageChange: 0 }))
      .toEqual(["quantity", "amount"]);
  });

  test("a rate-only change flags rate and amount", () => {
    expect(changedFieldsFor({ quantityChange: 0, rateChange: -2, breakdownPercentageChange: 0 }))
      .toEqual(["rate", "amount"]);
  });

  test("a negative percentage change counts too (a reduction is still a variation)", () => {
    expect(changedFieldsFor({ quantityChange: 0, rateChange: 0, breakdownPercentageChange: -10 }))
      .toContain("breakdownPercentage");
  });

  test("all three together flag all four fields", () => {
    expect(changedFieldsFor({ quantityChange: 1, rateChange: 1, breakdownPercentageChange: 1 }))
      .toEqual(["quantity", "rate", "amount", "breakdownPercentage"]);
  });

  test("nothing moved: nothing flagged", () => {
    expect(changedFieldsFor({ quantityChange: 0, rateChange: 0, breakdownPercentageChange: 0 })).toEqual([]);
  });
});

describe("toCompareResult (R-21, R-24)", () => {
  const cmp = (changed: ChangedLineItem[]): BoqComparison => ({
    added: [row({ id: "n1", itemCode: "B1" })], removed: [row({ id: "r1", itemCode: "C1" })],
    changed, warnings: ["Reducing A1 below its progress is refused"], totalVariation: 250,
  });

  test("a percentage-only line comes through as a changed row with both prior and current values", () => {
    const r = toCompareResult(cmp([changedLine({ breakdownPercentageChange: 20, netVariation: 250 })]));
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0].key).toBe("A1.1");
    expect(r.changed[0].previous.breakdownPercentage).toBe("40");
    expect(r.changed[0].current.breakdownPercentage).toBe("60");
    expect(r.changed[0].changedFields).toContain("breakdownPercentage");
    expect(r.changed[0].changedFields).toContain("amount");
  });

  test("added, removed and the scope-reduction warning are passed through, not dropped", () => {
    const r = toCompareResult(cmp([]));
    expect(r.added.map((a) => a.itemCode)).toEqual(["B1"]);
    expect(r.removed.map((a) => a.itemCode)).toEqual(["C1"]);
    expect(r.warnings).toEqual(["Reducing A1 below its progress is refused"]);
    expect(r.changed).toEqual([]);
  });

  test("every changed line keeps its own flags (two lines, two different change kinds)", () => {
    const r = toCompareResult(cmp([
      changedLine({ key: "A1", quantityChange: 20 }),
      changedLine({ key: "A1.1", breakdownPercentageChange: 20 }),
    ]));
    expect(r.changed.find((c) => c.key === "A1")!.changedFields).toEqual(["quantity", "amount"]);
    expect(r.changed.find((c) => c.key === "A1.1")!.changedFields).toEqual(["amount", "breakdownPercentage"]);
  });
});
