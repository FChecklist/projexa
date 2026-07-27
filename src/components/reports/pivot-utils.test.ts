/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { computePivot, computeChartData } from "./pivot-utils";

const ROWS = [
  { region: "West", category: "Sales", amount: 100 },
  { region: "West", category: "Marketing", amount: 50 },
  { region: "East", category: "Sales", amount: 200 },
  { region: "East", category: "Sales", amount: 40 },
  { region: "East", category: "Marketing", amount: 10 },
];

describe("computePivot", () => {
  test("groups by row only (no column field) and sums the value field", () => {
    const result = computePivot(ROWS, { rowField: "region", colField: null, valueField: "amount", agg: "sum" });
    expect(result.rowKeys).toEqual(["West", "East"]);
    expect(result.cells["West"].value).toBe(150);
    expect(result.cells["East"].value).toBe(250);
    expect(result.grandTotal).toBe(400);
  });

  test("groups by row AND column, producing a real 2D matrix", () => {
    const result = computePivot(ROWS, { rowField: "region", colField: "category", valueField: "amount", agg: "sum" });
    expect(result.rowKeys).toEqual(["West", "East"]);
    expect(result.colKeys).toEqual(["Sales", "Marketing"]);
    expect(result.cells["East"]["Sales"]).toBe(240);
    expect(result.cells["East"]["Marketing"]).toBe(10);
    expect(result.cells["West"]["Marketing"]).toBe(50);
    expect(result.rowTotals["East"]).toBe(250);
    expect(result.colTotals["Sales"]).toBe(340); // West Sales 100 + East Sales 240
    expect(result.grandTotal).toBe(400);
  });

  test("count aggregation ignores valueField and counts rows per bucket", () => {
    const result = computePivot(ROWS, { rowField: "region", colField: "category", agg: "count" });
    expect(result.cells["East"]["Sales"]).toBe(2);
    expect(result.cells["West"]["Sales"]).toBe(1);
    expect(result.grandTotal).toBe(5);
  });

  test("avg aggregation averages pooled raw values, not an average of averages", () => {
    const result = computePivot(ROWS, { rowField: "region", colField: null, valueField: "amount", agg: "avg" });
    // East: (200 + 40 + 10) / 3 = 83.33..., not avg(sales_avg, marketing_avg)
    expect(result.cells["East"].value).toBeCloseTo(250 / 3, 5);
  });

  test("null/undefined/empty group values bucket into (blank) instead of throwing", () => {
    const rows = [{ region: null, amount: 5 }, { region: undefined, amount: 3 }, { region: "", amount: 2 }];
    const result = computePivot(rows, { rowField: "region", colField: null, valueField: "amount", agg: "sum" });
    expect(result.rowKeys).toEqual(["(blank)"]);
    expect(result.cells["(blank)"].value).toBe(10);
  });

  test("non-numeric value cells coerce to 0 rather than producing NaN", () => {
    const rows = [{ region: "West", amount: "not-a-number" }];
    const result = computePivot(rows, { rowField: "region", colField: null, valueField: "amount", agg: "sum" });
    expect(result.cells["West"].value).toBe(0);
  });

  test("empty input returns empty structure, not a throw", () => {
    const result = computePivot([], { rowField: "region", colField: null, valueField: "amount", agg: "sum" });
    expect(result.rowKeys).toEqual([]);
    expect(result.grandTotal).toBe(0);
  });
});

describe("computeChartData", () => {
  test("produces one datum per category, summed", () => {
    const data = computeChartData(ROWS, { categoryField: "region", valueField: "amount", agg: "sum" });
    expect(data).toEqual([
      { category: "West", value: 150 },
      { category: "East", value: 250 },
    ]);
  });

  test("count aggregation counts rows per category", () => {
    const data = computeChartData(ROWS, { categoryField: "category", agg: "count" });
    expect(data.find((d) => d.category === "Sales")?.value).toBe(3);
    expect(data.find((d) => d.category === "Marketing")?.value).toBe(2);
  });
});
