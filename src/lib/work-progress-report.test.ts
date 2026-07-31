/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  buildManpowerBreakdown,
  buildVendorBreakdown,
  buildWorkProgressReport,
  computeLineItemProgress,
  type Activity,
  type Attendance,
  type BoqLineItem,
  type Category,
  type LabourRoster,
  type ProgressEntry,
  type Vendor,
} from "./work-progress-report";

// The exact scenario from SUCCESS_CRITERIA: a line item worth 100 units at
// rate 10 (BoQ value 1000). Day 1 (before the report window) completes 30%
// of the quantity; day 2 (inside the report window) completes another 20%.
// Expected: Prev=30%, Current=20%, Total=50% -- computed as ratios over the
// Amt columns, not raw input.
const LINE_ITEM: BoqLineItem = {
  id: "line_1",
  activityId: "act_1",
  itemCode: "C-101",
  description: "RCC Column Casting",
  unit: "cum",
  quantity: 100,
  rate: 10,
  amount: 1000,
};

const ACTIVITIES: Activity[] = [{ id: "act_1", categoryId: "cat_1", name: "Column Casting" }];
const CATEGORIES: Category[] = [{ id: "cat_1", name: "Civil Works" }];

describe("computeLineItemProgress (Prev/Current/Total)", () => {
  test("day1 30% before the window, day2 20% inside it -> Prev=30%, Current=20%, Total=50%", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_1", entryDate: "2026-07-01", quantityDone: 30 },
      { id: "e2", activityId: "act_1", entryDate: "2026-07-15", quantityDone: 20 },
    ];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );

    expect(result.qty).toEqual({ prev: 30, current: 20, total: 50 });
    expect(result.amt).toEqual({ prev: 300, current: 200, total: 500 });
    expect(result.percentage).toEqual({ prev: 30, current: 20, total: 50 });
    expect(result.categoryName).toBe("Civil Works");
    expect(result.code).toBe("C-101");
  });

  test("multiple entries within the window sum together for Current", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_1", entryDate: "2026-07-11", quantityDone: 10 },
      { id: "e2", activityId: "act_1", entryDate: "2026-07-12", quantityDone: 15 },
    ];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty).toEqual({ prev: 0, current: 25, total: 25 });
    expect(result.percentage.current).toBe(25);
  });

  test("an entry exactly ON `to` counts as Current, not excluded by an off-by-one boundary", () => {
    const entries: ProgressEntry[] = [{ id: "e1", activityId: "act_1", entryDate: "2026-07-20", quantityDone: 5 }];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty.current).toBe(5);
  });

  test("a line item with no activityId (not yet linked) has zero progress, not a crash", () => {
    const unlinked: BoqLineItem = { ...LINE_ITEM, id: "line_2", activityId: null };
    const result = computeLineItemProgress(
      unlinked, [], new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty).toEqual({ prev: 0, current: 0, total: 0 });
    expect(result.categoryName).toBe("Uncategorized");
  });
});

describe("buildWorkProgressReport (scope-wise base report + category-wise rollup)", () => {
  test("category rollup sums Amt/Percentage across every line item sharing a category", () => {
    const lineItems: BoqLineItem[] = [
      LINE_ITEM,
      { id: "line_2", activityId: "act_1", itemCode: "C-102", description: "Slab Casting", unit: "cum", quantity: 50, rate: 20, amount: 1000 },
    ];
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_1", entryDate: "2026-07-01", quantityDone: 30 }, // both line items share activityId here for the test
      { id: "e2", activityId: "act_1", entryDate: "2026-07-15", quantityDone: 20 },
    ];
    const report = buildWorkProgressReport({ lineItems, entries, activities: ACTIVITIES, categories: CATEGORIES, from: "2026-07-10", to: "2026-07-20" });

    expect(report.rows).toHaveLength(2);
    expect(report.byCategory).toHaveLength(1);
    const civil = report.byCategory[0];
    expect(civil.name).toBe("Civil Works");
    // line_1: amtTotal 1000, prev 300, current 200; line_2 rate 20: prev 30*20=600, current 20*20=400, amtTotal 1000
    expect(civil.amtTotal).toBe(2000);
    expect(civil.amt).toEqual({ prev: 900, current: 600, total: 1500 });
    expect(civil.percentage).toEqual({ prev: 45, current: 30, total: 75 });
  });
});

describe("buildManpowerBreakdown / buildVendorBreakdown (attendance-cost based, date-range filtered)", () => {
  const roster: LabourRoster[] = [
    { id: "r1", trade: "Mason", vendorId: "v1", name: "Ramesh" },
    { id: "r2", trade: "Electrician", vendorId: "v2", name: "Suresh" },
  ];
  const vendors: Vendor[] = [{ id: "v1", name: "ABC Contractors" }, { id: "v2", name: "XYZ Electricals" }];
  const attendance: Attendance[] = [
    { id: "a1", rosterId: "r1", attendanceDate: "2026-07-05", dailyCost: 500 }, // before window
    { id: "a2", rosterId: "r1", attendanceDate: "2026-07-12", dailyCost: 500 }, // in window
    { id: "a3", rosterId: "r2", attendanceDate: "2026-07-13", dailyCost: 800 }, // in window
  ];

  test("manpower-wise groups attendance cost by trade, only within [from, to]", () => {
    const rows = buildManpowerBreakdown({ roster, attendance, from: "2026-07-10", to: "2026-07-20" });
    expect(rows).toEqual(
      expect.arrayContaining([
        { trade: "Mason", workerDays: 1, totalCost: 500 },
        { trade: "Electrician", workerDays: 1, totalCost: 800 },
      ])
    );
  });

  test("vendor-wise groups attendance cost by vendor, only within [from, to]", () => {
    const rows = buildVendorBreakdown({ roster, attendance, vendors, from: "2026-07-10", to: "2026-07-20" });
    expect(rows).toEqual(
      expect.arrayContaining([
        { vendorId: "v1", vendorName: "ABC Contractors", totalCost: 500 },
        { vendorId: "v2", vendorName: "XYZ Electricals", totalCost: 800 },
      ])
    );
  });
});
