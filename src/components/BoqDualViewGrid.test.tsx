// R85 Addendum 3 v4 (R-50), Phase 2. Unit coverage for the pure money math
// and validation this file mirrors from compliance-tracker's
// boq-dual-view-service.ts (see BoqDualViewGrid.tsx's own header for why a
// mirror exists at all -- LIVE Part C/2-06 feedback before a save round
// trip). The real end-to-end proof (gate 11-02: two internal roles, a real
// customer preview with genuinely no project-side figures) is the
// Playwright spec, e2e/r50-boq-dual-view-grid-env1.spec.ts -- this file only
// proves the pure functions this component's live-preview math depends on
// are correct in isolation, the same way boq-dual-view-service.test.ts
// proves the server's own copy of this math (found and read this session;
// this file intentionally uses the SAME fixture numbers where practical so
// the two can be compared by eye).
import { describe, expect, test } from "bun:test";
import { NOT_SET, computeLineMoneyView, validateCellEdit } from "./BoqDualViewGrid";

describe("computeLineMoneyView -- A4, mirrored from boq-dual-view-service.ts", () => {
  test("full precision, no rounding of an intermediate", () => {
    const view = computeLineMoneyView({ qtyProject: "3", rateProject: "33.333", qtyContract: "3", rateContract: "40" });
    expect(view.projectValue).toBeCloseTo(99.999, 5);
    expect(view.contractValue).toBe(120);
    expect(view.variance).toBeCloseTo(20.001, 5);
  });

  test("NULL propagation: a missing rateProject makes projectValue AND variance NOT_SET, never a number", () => {
    const view = computeLineMoneyView({ qtyProject: "10", rateProject: null, qtyContract: "10", rateContract: "50" });
    expect(view.projectValue).toBe(NOT_SET);
    expect(view.variance).toBe(NOT_SET);
    expect(view.contractValue).toBe(500); // the contract side is unaffected by the project side being unset
  });

  test("a genuinely zero projectValue is a real 0, never coerced from/confused with NOT_SET", () => {
    const view = computeLineMoneyView({ qtyProject: "0", rateProject: "50", qtyContract: "10", rateContract: "50" });
    expect(view.projectValue).toBe(0);
    expect(view.variance).toBe(500); // 500 - 0, not NOT_SET
  });

  test("division by zero: contractValue = 0 makes variancePercent NOT_SET, never Infinity/NaN/0", () => {
    const view = computeLineMoneyView({ qtyProject: "10", rateProject: "50", qtyContract: "0", rateContract: "50" });
    expect(view.contractValue).toBe(0);
    expect(view.variancePercent).toBe(NOT_SET);
  });

  test("decomposition: quantity variance and rate variance both non-zero and sum to the total variance", () => {
    // Same shape as boq-dual-view-service.test.ts's own decomposition fixture.
    const view = computeLineMoneyView({ qtyProject: "100", rateProject: "40", qtyContract: "120", rateContract: "45" });
    // QUANTITY VARIANCE = (qtyContract - qtyProject) * rateProject = 20 * 40 = 800
    // RATE VARIANCE     = (rateContract - rateProject) * qtyContract = 5 * 120 = 600
    expect(view.quantityVariance).toBe(800);
    expect(view.rateVariance).toBe(600);
    expect(view.quantityVariance).not.toBe(0);
    expect(view.rateVariance).not.toBe(0);
    // Both terms genuinely explain the total: contractValue - projectValue = 5400 - 4000 = 1400.
    expect(view.variance).toBe(1400);
  });

  test("an empty string is absence, the same as null -- never coerced to 0", () => {
    const view = computeLineMoneyView({ qtyProject: "", rateProject: "50", qtyContract: "10", rateContract: "50" });
    expect(view.projectValue).toBe(NOT_SET);
  });
});

describe("validateCellEdit -- 2-04", () => {
  test("a negative quantity is REFUSED", () => {
    const r = validateCellEdit("qty", "-5");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.refused).toBe(true);
  });

  test("a negative rate is WARNED, not refused -- a credit line is legitimate (A4)", () => {
    const r = validateCellEdit("rate", "-10");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.refused).toBe(false);
  });

  test("a non-numeric value is REFUSED, on either field", () => {
    expect(validateCellEdit("qty", "abc").valid).toBe(false);
    const rate = validateCellEdit("rate", "abc");
    expect(rate.valid).toBe(false);
    if (!rate.valid) expect(rate.refused).toBe(true);
  });

  test("an empty string is valid -- clearing a cell is legal, becomes NOT_SET", () => {
    expect(validateCellEdit("qty", "").valid).toBe(true);
    expect(validateCellEdit("rate", "  ").valid).toBe(true);
  });

  test("a positive number on either field is valid", () => {
    expect(validateCellEdit("qty", "12.5").valid).toBe(true);
    expect(validateCellEdit("rate", "0").valid).toBe(true);
  });
});
