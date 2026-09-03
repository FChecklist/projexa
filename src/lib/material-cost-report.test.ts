/// <reference types="bun-types" />
// R67 F-07 (R-100/R-106) -- sibling test for material-cost-report.ts.
//
// This helper exists so the Cost Report tab stops costing a third network call
// for numbers the browser already holds. The risk it introduces is that the
// on-screen roll-up drifts from the SERVER-side one behind the exportable
// report, so these tests pin the exact behaviours of
// construction-materials-service.ts#getMaterialCostReport that a re-expression
// is most likely to get wrong: NULL unit costs, rounding, and which materials
// appear at all.
import { describe, expect, test } from "bun:test";
import { buildMaterialCostReport, type CostReportMaterial, type CostReportReceipt } from "./material-cost-report";

const MATERIALS: CostReportMaterial[] = [
  { id: "m1", name: "OPC 53 Cement", spec: "53 grade", unit: "bag" },
  { id: "m2", name: "Aggregate 20mm", spec: null, unit: "cum" },
  { id: "m3", name: "Binding Wire", spec: null, unit: "kg" },
];

describe("buildMaterialCostReport", () => {
  test("sums quantity and quantity x unitCost per material, with a real average", () => {
    const receipts: CostReportReceipt[] = [
      { materialId: "m1", quantity: "100", unitCost: "24.5" },
      { materialId: "m1", quantity: "50", unitCost: "25.5" },
    ];

    expect(buildMaterialCostReport(MATERIALS, receipts)).toEqual([
      {
        materialId: "m1",
        name: "OPC 53 Cement",
        spec: "53 grade",
        unit: "bag",
        totalQuantityReceived: 150,
        totalCost: 3725, // 100 x 24.5 + 50 x 25.5
        averageUnitCost: 24.83, // 3725 / 150, 2 dp
      },
    ]);
  });

  test("a receipt with NO unit cost adds its quantity but no cost -- exactly what SQL sum() does with a NULL factor", () => {
    const receipts: CostReportReceipt[] = [
      { materialId: "m2", quantity: "10", unitCost: "100" },
      { materialId: "m2", quantity: "10", unitCost: null },
    ];

    const [row] = buildMaterialCostReport(MATERIALS, receipts);
    expect(row.totalQuantityReceived).toBe(20);
    expect(row.totalCost).toBe(1000);
    // Deliberately NOT 100: the average is over everything received, which is
    // what the exported report says too.
    expect(row.averageUnitCost).toBe(50);
  });

  test("a material with no receipts at all never appears -- it is not a zero row", () => {
    const receipts: CostReportReceipt[] = [{ materialId: "m1", quantity: "1", unitCost: "10" }];

    const rows = buildMaterialCostReport(MATERIALS, receipts);
    expect(rows.map((r) => r.materialId)).toEqual(["m1"]);
  });

  test("no receipts at all is an empty report, not a row per material", () => {
    expect(buildMaterialCostReport(MATERIALS, [])).toEqual([]);
  });

  test("zero received quantity gives an average of 0, never a division by zero", () => {
    const receipts: CostReportReceipt[] = [{ materialId: "m3", quantity: "0", unitCost: "12" }];

    const [row] = buildMaterialCostReport(MATERIALS, receipts);
    expect(row.totalQuantityReceived).toBe(0);
    expect(row.totalCost).toBe(0);
    expect(row.averageUnitCost).toBe(0);
  });

  test("a receipt for a material missing from the master is named by its id, never dropped or blank", () => {
    const receipts: CostReportReceipt[] = [{ materialId: "ghost", quantity: "2", unitCost: "5" }];

    expect(buildMaterialCostReport(MATERIALS, receipts)).toEqual([
      { materialId: "ghost", name: "ghost", spec: null, unit: "", totalQuantityReceived: 2, totalCost: 10, averageUnitCost: 5 },
    ]);
  });

  test("money is rounded to 2 dp the same way and at the same step as the service", () => {
    const receipts: CostReportReceipt[] = [
      { materialId: "m1", quantity: "3", unitCost: "0.335" }, // 1.005
      { materialId: "m1", quantity: "3", unitCost: "0.335" },
    ];

    const [row] = buildMaterialCostReport(MATERIALS, receipts);
    expect(row.totalCost).toBe(2.01);
    expect(row.averageUnitCost).toBe(0.34); // 2.01 / 6
  });

  test("rows are sorted by material name so the table order is stable between renders", () => {
    const receipts: CostReportReceipt[] = [
      { materialId: "m1", quantity: "1", unitCost: "1" },
      { materialId: "m3", quantity: "1", unitCost: "1" },
      { materialId: "m2", quantity: "1", unitCost: "1" },
    ];

    expect(buildMaterialCostReport(MATERIALS, receipts).map((r) => r.name)).toEqual([
      "Aggregate 20mm",
      "Binding Wire",
      "OPC 53 Cement",
    ]);
  });
});
