/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { chartDefaults, computePivot, computeChartData, filterRowsByCategory, inferColumnKind, inferColumnTypes } from "./pivot-utils";

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

// R67 E-27 (R-213). The chart used to open on columns[0] against columns[1],
// which on every report this app runs is an id against a name -- zero-height
// bars until the reader repaired two dropdowns. These are the rules that
// replaced that.
describe("inferColumnTypes", () => {
  const rows = [
    { projectId: "g555imnoq4wihavpwc7t64um", name: "Cedar Heights", amount: 6500, entryDate: "2026-08-25", percentComplete: 42 },
    { projectId: "h882bcdefghijklmnopqrstu", name: "Marina Tower", amount: "4000", entryDate: "2026-08-26", percentComplete: 60 },
  ];

  test("a key ending in Id is an id, whatever its values look like", () => {
    expect(inferColumnKind([{ projectId: "x" }], "projectId")).toBe("id");
    expect(inferColumnKind([{ project_id: "x" }], "project_id")).toBe("id");
    expect(inferColumnKind([{ id: "x" }], "id")).toBe("id");
  });

  test("a 20+ character id-like value is an id even when the key does not say so", () => {
    expect(inferColumnKind([{ ref: "g555imnoq4wihavpwc7t64um" }], "ref")).toBe("id");
  });

  test("a long DESCRIPTION is still text -- the rule is id-shaped, not merely long", () => {
    expect(inferColumnKind([{ description: "Blockwork to external walls, ground floor" }], "description")).toBe("text");
  });

  test("numbers, numeric strings and ISO dates are recognised for what they are", () => {
    const types = Object.fromEntries(inferColumnTypes(rows).map((t) => [t.name, t.kind]));
    expect(types).toEqual({
      projectId: "id", name: "text", amount: "number", entryDate: "date", percentComplete: "number",
    });
  });

  test("a numeric column holding one non-numeric value is text, not a broken number", () => {
    expect(inferColumnKind([{ qty: 5 }, { qty: "n/a" }], "qty")).toBe("text");
  });

  test("an all-blank column is text, never a number -- there is nothing to plot", () => {
    expect(inferColumnKind([{ note: null }, { note: "" }], "note")).toBe("text");
  });
});

describe("chartDefaults", () => {
  const rows = [
    { projectId: "g555imnoq4wihavpwc7t64um", name: "Cedar Heights", amount: 6500, entryDate: "2026-08-25" },
    { projectId: "h882bcdefghijklmnopqrstu", name: "Marina Tower", amount: 4000, entryDate: "2026-08-26" },
  ];

  test("first text column as the category, first numeric as the value -- never the id", () => {
    const d = chartDefaults(rows);
    expect(d.categoryField).toBe("name");
    expect(d.valueField).toBe("amount");
    expect(d.agg).toBe("sum");
  });

  test("a percentage column averages, because summing percentages means nothing", () => {
    const d = chartDefaults([{ category: "Civil", percentComplete: 42 }, { category: "Paint", percentComplete: 60 }]);
    expect(d.valueField).toBe("percentComplete");
    expect(d.agg).toBe("avg");
  });

  test("Line is offered only when a date column exists", () => {
    expect(chartDefaults(rows).hasDateColumn).toBe(true);
    expect(chartDefaults([{ name: "Civil", amount: 1 }]).hasDateColumn).toBe(false);
  });

  test("with no numeric column at all it counts rows rather than plotting nothing", () => {
    const d = chartDefaults([{ name: "Civil", trade: "Mason" }]);
    expect(d.agg).toBe("count");
    expect(d.categoryField).toBe("name");
  });

  test("with only ids and a date, the date becomes the category rather than an id", () => {
    const d = chartDefaults([{ projectId: "g555imnoq4wihavpwc7t64um", entryDate: "2026-08-25", amount: 5 }]);
    expect(d.categoryField).toBe("entryDate");
  });
});

describe("filterRowsByCategory -- the Chart tab's drill into the Table tab", () => {
  const rows = [
    { category: "Civil", amount: 100 },
    { category: "Paint", amount: 50 },
    { category: "", amount: 25 },
  ];

  test("null shows every row", () => {
    expect(filterRowsByCategory(rows, "category", null)).toHaveLength(3);
  });

  test("a clicked bar filters to exactly its rows", () => {
    expect(filterRowsByCategory(rows, "category", "Civil")).toEqual([{ category: "Civil", amount: 100 }]);
  });

  test("the '(blank)' bar selects the blank rows -- the same bucketing the chart grouped by", () => {
    expect(filterRowsByCategory(rows, "category", "(blank)")).toEqual([{ category: "", amount: 25 }]);
  });
});
