/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  buildManpowerBreakdown,
  buildVendorBreakdown,
  buildWorkProgressReport,
  computeLineItemProgress,
  formatParentOnlyPercent,
  formatProgressCell,
  sumRootAmtTotal,
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

    expect(result.qty).toEqual({ prev: 30, current: 20, total: 50, balance: 50 }); // 100 - 50
    expect(result.amt).toEqual({ prev: 300, current: 200, total: 500, balance: 500 }); // 1000 - 500
    expect(result.percentage).toEqual({ prev: 30, current: 20, total: 50, balance: 50 }); // (1000-500)/1000*100
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
    expect(result.qty).toEqual({ prev: 0, current: 25, total: 25, balance: 75 }); // 100 - 25
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
    expect(result.qty).toEqual({ prev: 0, current: 0, total: 0, balance: 100 }); // 100 - 0
    expect(result.categoryName).toBe("Uncategorized");
    expect(result.touched).toEqual({ prev: false, current: false, total: false }); // never-touched, not a computed zero
  });
});

// R39/R-46 (r39_wpr_entry_basis, TC-32): SNAPSHOT entries replace rather than
// sum. The schema's real ambiguity (quantity_done + percent_complete, both
// NOT NULL, no discriminator) resolved AIA-G703-style: DELTA is additive
// (unchanged, see the describe block above), SNAPSHOT is a cumulative-to-
// date reading that the latest row wins.
describe("computeLineItemProgress -- SNAPSHOT entry_basis (R39/R-46, TC-32)", () => {
  test("30% then 60%, both SNAPSHOT -> report shows 60%, not 90% (no double-count) -- both rows stay in history", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_1", entryDate: "2026-07-05", quantityDone: 0, percentComplete: 30, entryBasis: "SNAPSHOT", createdAt: "2026-07-05T09:00:00Z" },
      { id: "e2", activityId: "act_1", entryDate: "2026-07-15", quantityDone: 0, percentComplete: 60, entryBasis: "SNAPSHOT", createdAt: "2026-07-15T09:00:00Z" },
    ];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.percentage.total).toBe(60); // latest wins, never 30+60=90
    expect(result.percentage.prev).toBe(30); // latest SNAPSHOT strictly before `from`
    expect(result.percentage.current).toBe(30); // 60 - 30
    expect(entries).toHaveLength(2); // both rows still exist -- SNAPSHOT never deletes/overwrites history
  });

  test("a same-day double-entry (30 then 60, same entryDate) breaks the tie by createdAt, not insertion order", () => {
    const entries: ProgressEntry[] = [
      { id: "e2", activityId: "act_1", entryDate: "2026-07-15", quantityDone: 0, percentComplete: 60, entryBasis: "SNAPSHOT", createdAt: "2026-07-15T09:00:01Z" },
      { id: "e1", activityId: "act_1", entryDate: "2026-07-15", quantityDone: 0, percentComplete: 30, entryBasis: "SNAPSHOT", createdAt: "2026-07-15T09:00:00Z" },
    ];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.percentage.total).toBe(60);
  });

  test("zero regression: a line with ONLY DELTA entries (undefined entryBasis, every pre-R39 row) is untouched by the SNAPSHOT branch -- T-WPR-03/TC-30 byte-identical", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_1", entryDate: "2026-07-01", quantityDone: 30 },
      { id: "e2", activityId: "act_1", entryDate: "2026-07-15", quantityDone: 20 },
    ];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.percentage).toEqual({ prev: 30, current: 20, total: 50, balance: 50 }); // identical to the top describe block's oracle
  });
});

// R46 L2 01 (SNAPSHOT progress-entry bug, closure R45SEQ8-R46-L2-01): before
// this fix, qty/amt were summed via sumQtyInRange() regardless of
// entry_basis -- so a line whose latest entry was SNAPSHOT (entryBasis
// filtered OUT of that sum by isDelta()) reported percentage=60% but
// qty/amt=0 (or whatever stale DELTA history happened to predate it), a
// real internal contradiction on the same report row. Fixed by deriving
// qty/amt from the SAME resolved percentage reading used above (schema.ts's
// own R39/R-46 comment: percent_complete, not quantity_done, is the
// authoritative field on a SNAPSHOT row -- every existing TC-32 fixture
// above already encodes this by using quantityDone: 0 on its SNAPSHOT rows).
// This regression test asserts the resulting mutual-consistency invariant
// (amt = percentage/100 * amtTotal, qty = percentage/100 * qtyTotal) holds
// for EVERY row buildWorkProgressReport() -- the real function route.ts
// calls, not a reimplementation -- returns, for both a pure-DELTA line and a
// mixed DELTA+SNAPSHOT line whose latest entry is SNAPSHOT-basis.
describe("buildWorkProgressReport -- qty/amt/percentage mutual consistency (R46 L2 01)", () => {
  const PURE_DELTA_LINE: BoqLineItem = { ...LINE_ITEM, id: "line_delta", activityId: "act_delta", itemCode: "D-1" };
  const MIXED_LINE: BoqLineItem = { ...LINE_ITEM, id: "line_mixed", activityId: "act_mixed", itemCode: "M-1" };
  const MIXED_ACTIVITIES: Activity[] = [
    { id: "act_delta", categoryId: "cat_1", name: "Delta Only" },
    { id: "act_mixed", categoryId: "cat_1", name: "Delta then Snapshot" },
  ];

  function assertRowIsMutuallyConsistent(row: { qty: { prev: number; current: number; total: number }; amt: { prev: number; current: number; total: number }; percentage: { prev: number; current: number; total: number }; qtyTotal: number; amtTotal: number }) {
    for (const bucket of ["prev", "current", "total"] as const) {
      const expectedAmt = (row.percentage[bucket] / 100) * row.amtTotal;
      const expectedQty = (row.percentage[bucket] / 100) * row.qtyTotal;
      // Tolerance accounts for percentage's own 2-decimal-place rounding
      // (pct() in work-progress-report.ts) -- not a magic slop factor, the
      // max possible drift is amtTotal/qtyTotal * 0.005 (half a rounding
      // step), which is well under 1 for this fixture's scale (amtTotal
      // 1000, qtyTotal 100).
      expect(row.amt[bucket]).toBeCloseTo(expectedAmt, 0);
      expect(row.qty[bucket]).toBeCloseTo(expectedQty, 0);
    }
  }

  test("pure-DELTA history: qty/amt/percentage stay mutually consistent (sanity -- this already worked pre-fix)", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_delta", entryDate: "2026-07-01", quantityDone: 30 },
      { id: "e2", activityId: "act_delta", entryDate: "2026-07-15", quantityDone: 20 },
    ];
    const report = buildWorkProgressReport({
      lineItems: [PURE_DELTA_LINE], entries, activities: MIXED_ACTIVITIES, categories: CATEGORIES,
      from: "2026-07-10", to: "2026-07-20",
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].qty).toEqual({ prev: 30, current: 20, total: 50, balance: 50 });
    for (const row of report.rows) assertRowIsMutuallyConsistent(row);
  });

  test("mixed DELTA+SNAPSHOT history, latest entry is SNAPSHOT: qty/amt now read off the snapshot's percentage, not summed with the prior DELTA row (the bug)", () => {
    const entries: ProgressEntry[] = [
      // An early DELTA entry -- pre-R39 style, additive.
      { id: "e1", activityId: "act_mixed", entryDate: "2026-07-01", quantityDone: 15 },
      // Then the site switches to SNAPSHOT-basis cumulative readings for
      // this activity: 30% as of 07-05 (before the window), 60% as of
      // 07-15 (inside the window) -- the latest SNAPSHOT reading in [from,
      // to] must win outright, not be added to the DELTA 15 units above.
      { id: "e2", activityId: "act_mixed", entryDate: "2026-07-05", quantityDone: 0, percentComplete: 30, entryBasis: "SNAPSHOT", createdAt: "2026-07-05T09:00:00Z" },
      { id: "e3", activityId: "act_mixed", entryDate: "2026-07-15", quantityDone: 0, percentComplete: 60, entryBasis: "SNAPSHOT", createdAt: "2026-07-15T09:00:00Z" },
    ];
    const report = buildWorkProgressReport({
      lineItems: [MIXED_LINE], entries, activities: MIXED_ACTIVITIES, categories: CATEGORIES,
      from: "2026-07-10", to: "2026-07-20",
    });
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];

    // The bug: qty/amt used to come out {prev:0, current:0, total:0} here
    // (isDelta() filters both SNAPSHOT rows out of sumQtyInRange, and the
    // one DELTA entry -- 15 units on 07-01 -- predates `from` so it would
    // have landed in qty.prev, not total 0 -- either way, NOT consistent
    // with percentage.total=60%). Fixed: qty/amt now derive from the same
    // 30%/60% snapshot reading percentage already used.
    expect(row.percentage).toEqual({ prev: 30, current: 30, total: 60, balance: 40 });
    expect(row.qty.total).toBe(60); // 60% of qtyTotal=100, NOT 15 (the stale DELTA entry) and NOT 0
    expect(row.amt.total).toBe(600); // 60% of amtTotal=1000
    assertRowIsMutuallyConsistent(row);
  });

  test("mixed history, byCategory rollup also reflects the snapshot-derived amt (not the pre-fix 0)", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_mixed", entryDate: "2026-07-05", quantityDone: 0, percentComplete: 30, entryBasis: "SNAPSHOT", createdAt: "2026-07-05T09:00:00Z" },
      { id: "e2", activityId: "act_mixed", entryDate: "2026-07-15", quantityDone: 0, percentComplete: 60, entryBasis: "SNAPSHOT", createdAt: "2026-07-15T09:00:00Z" },
    ];
    const report = buildWorkProgressReport({
      lineItems: [MIXED_LINE], entries, activities: MIXED_ACTIVITIES, categories: CATEGORIES,
      from: "2026-07-10", to: "2026-07-20",
    });
    expect(report.byCategory).toHaveLength(1);
    expect(report.byCategory[0].amt.total).toBe(600); // not 0
    expect(report.byCategory[0].percentage.total).toBe(60);
  });
});

// R12 point 7 (Option B) / E-89 (AR-01): preference-order entry-to-line
// resolution -- boq_line_item_id, when present on an entry, wins over the
// activityId match, and is never ALSO counted a second time via activityId.
describe("computeLineItemProgress -- Option B boq_line_item_id preference order (E-89/AR-01)", () => {
  test("an entry keyed by boqLineItemId is counted once, not twice, even though it shares the line's activityId", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_1", boqLineItemId: "line_1", entryDate: "2026-07-15", quantityDone: 20 },
    ];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty.current).toBe(20); // not 40 -- must not match under both rules
  });

  test("a boqLineItemId entry pointed at a DIFFERENT line is excluded here, even though activityId matches", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_1", boqLineItemId: "some_other_line", entryDate: "2026-07-15", quantityDone: 20 },
    ];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty.current).toBe(0); // claimed exclusively by "some_other_line", not this one
    expect(result.touched.current).toBe(false);
  });

  test("boqLineItemId-keyed and activityId-only entries for the same line both count (no boqLineItemId on the legacy entry)", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_1", boqLineItemId: "line_1", entryDate: "2026-07-15", quantityDone: 20 },
      { id: "e2", activityId: "act_1", entryDate: "2026-07-16", quantityDone: 5 }, // legacy, activityId-only
    ];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty.current).toBe(25);
  });

  test("a line with no activityId can still pick up progress via boqLineItemId alone", () => {
    const unlinked: BoqLineItem = { ...LINE_ITEM, id: "line_3", activityId: null };
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_1", boqLineItemId: "line_3", entryDate: "2026-07-15", quantityDone: 20 },
    ];
    const result = computeLineItemProgress(
      unlinked, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty.current).toBe(20);
    expect(result.touched.current).toBe(true);
  });
});

// Point 11 (Rajat, 21 Aug: "SHOW BOTH TOTAL AND BALANCE, USER CHOOSES -- it's
// a mathematical formula"): total = previous + current (already existed);
// balance = original (this line's own BoQ total) - total. Both derive from
// the same three stored numbers -- nothing new is persisted. Oracle: his
// Gypsum Board 01 row shows 300 + 100 with a third column of 72, and
// 472 - 400 = 72.
describe("Point 11: TOTAL/BALANCE toggle -- balance = original (BoQ total) - total", () => {
  const GYPSUM: BoqLineItem = {
    id: "gypsum_01", activityId: "act_gypsum", itemCode: "1.01.1", description: "Gypsum Board 01",
    unit: "sqm", quantity: 472, rate: 1, amount: 472,
  };
  const GYPSUM_ACTS: Activity[] = [{ id: "act_gypsum", categoryId: "cat_1", name: "Gypsum Board 01" }];

  test("ORACLE: his sheet's 300 (prev) + 100 (current) reproduces his own printed 72 -- balance = 472 - 400", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_gypsum", entryDate: "2026-07-01", quantityDone: 300 },
      { id: "e2", activityId: "act_gypsum", entryDate: "2026-07-15", quantityDone: 100 },
    ];
    const result = computeLineItemProgress(
      GYPSUM, entries, new Map(GYPSUM_ACTS.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty.total).toBe(400); // total = previous + current
    expect(result.qty.balance).toBe(72); // balance = original - total = 472 - 400 -- THE FIGURE FROM HIS OWN SHEET
  });

  test("balance goes negative when total exceeds the original BoQ quantity (over-recorded progress)", () => {
    const entries: ProgressEntry[] = [
      { id: "e1", activityId: "act_gypsum", entryDate: "2026-07-01", quantityDone: 400 },
      { id: "e2", activityId: "act_gypsum", entryDate: "2026-07-15", quantityDone: 100 },
    ];
    const result = computeLineItemProgress(
      GYPSUM, entries, new Map(GYPSUM_ACTS.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty.total).toBe(500);
    expect(result.qty.balance).toBe(-28); // 472 - 500
  });

  test("amt and percentage balance mirror the qty balance formula (original - total), scaled by rate", () => {
    const rated: BoqLineItem = { ...GYPSUM, id: "gypsum_rated", rate: 10, amount: 4720 };
    const entries: ProgressEntry[] = [{ id: "e1", activityId: "act_gypsum", entryDate: "2026-07-15", quantityDone: 400 }];
    const result = computeLineItemProgress(
      rated, entries, new Map(GYPSUM_ACTS.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    // total = 400*10 = 4000; amtTotalBoq = 4720; balance = 4720 - 4000 = 720
    expect(result.amt.balance).toBe(720);
    expect(result.percentage.balance).toBe(Math.round((720 / 4720) * 10000) / 100); // pct() rounds to 2dp, same as every other percentage field
  });

  test("weighted parent rollup: balance uses the PARENT's own original BoQ qty, never a child's -- same oracle figure, 72", () => {
    const parent: BoqLineItem = { id: "p_wall", activityId: null, itemCode: "1.02", description: "Wall", unit: "sqm", quantity: 472, rate: 108, amount: 50976 };
    const child1: BoqLineItem = { id: "c_wall_1", activityId: "act_w1", itemCode: "1.02.1", description: "Frame", unit: "sqm", quantity: 0, rate: 0, amount: 0, parentLineItemId: "p_wall", breakdownPercentage: 100 };
    const acts: Activity[] = [{ id: "act_w1", categoryId: "cat_1", name: "Frame" }];
    const entries: ProgressEntry[] = [{ id: "e1", activityId: "act_w1", entryDate: "2026-07-15", quantityDone: 400 }];
    const report = buildWorkProgressReport({ lineItems: [parent, child1], entries, activities: acts, categories: CATEGORIES, from: "2026-07-10", to: "2026-07-20" });
    const parentRow = report.rows.find((r) => r.lineItemId === "p_wall")!;
    expect(parentRow.qty.total).toBe(400); // 400 * 100% breakdown
    expect(parentRow.qty.balance).toBe(72); // 472 (PARENT's own qty) - 400, not child1's own (0)
  });
});

// Point 111 (WPR-14): a computed zero and a never-touched cell both compute
// to the number 0 -- his sheet distinguishes them (dash vs. blank) and a UI
// rendering 0.00 for both loses that distinction. `touched` on
// LineItemProgress carries which one applies; formatProgressCell() is the
// pure function that turns (value, touched) into what actually renders.
// Missing must NEVER be treated as zero in the ARITHMETIC -- only in the
// display -- so every qty/amt/percentage number above is asserted unchanged
// throughout; only `touched` and formatProgressCell() are new.
describe("WPR-14: computed zero (dash) vs. never-touched (blank)", () => {
  test("entries exist but are all outside the report window -> Current is never-touched, Prev is a real value", () => {
    const entries: ProgressEntry[] = [{ id: "e1", activityId: "act_1", entryDate: "2026-07-01", quantityDone: 30 }];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty).toEqual({ prev: 30, current: 0, total: 30, balance: 70 }); // arithmetic unaffected; 100 - 30
    expect(result.touched).toEqual({ prev: true, current: false, total: true });
  });

  test("an activity with zero total quantity done still counts as touched if an entry exists (a real computed zero)", () => {
    const entries: ProgressEntry[] = [{ id: "e1", activityId: "act_1", entryDate: "2026-07-15", quantityDone: 0 }];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.qty.current).toBe(0);
    expect(result.touched.current).toBe(true); // an entry WAS recorded, it just summed to 0
  });

  test("a real nonzero value is touched", () => {
    const entries: ProgressEntry[] = [{ id: "e1", activityId: "act_1", entryDate: "2026-07-15", quantityDone: 20 }];
    const result = computeLineItemProgress(
      LINE_ITEM, entries,
      new Map(ACTIVITIES.map((a) => [a.id, a])), new Map(CATEGORIES.map((c) => [c.id, c])),
      "2026-07-10", "2026-07-20"
    );
    expect(result.touched.current).toBe(true);
  });

  test("a parent with hierarchical children: touched per bucket iff ANY child is touched for that bucket", () => {
    const parent: BoqLineItem = { id: "parent_1", activityId: null, itemCode: "1.01", description: "Main", unit: "sqm", quantity: 472, rate: 108, amount: 50976 };
    const childA: BoqLineItem = { id: "child_a", activityId: "act_a", itemCode: "1.01.1", description: "Frame 01", unit: "sqm", quantity: 0, rate: 0, amount: 0, parentLineItemId: "parent_1", breakdownPercentage: 30 };
    const childB: BoqLineItem = { id: "child_b", activityId: "act_b", itemCode: "1.01.2", description: "Taping Jointing 01", unit: "sqm", quantity: 0, rate: 0, amount: 0, parentLineItemId: "parent_1", breakdownPercentage: 15 };
    const lineItems = [parent, childA, childB];
    const activities: Activity[] = [{ id: "act_a", categoryId: "cat_1", name: "Frame" }, { id: "act_b", categoryId: "cat_1", name: "Taping" }];
    // childA has a recorded entry (a real computed-zero balance is possible downstream); childB has none at all.
    const entries: ProgressEntry[] = [{ id: "e1", activityId: "act_a", entryDate: "2026-07-01", quantityDone: 0 }];
    const report = buildWorkProgressReport({ lineItems, entries, activities, categories: CATEGORIES, from: "2026-07-10", to: "2026-07-20" });
    const parentRow = report.rows.find((r) => r.lineItemId === "parent_1")!;
    const childARow = report.rows.find((r) => r.lineItemId === "child_a")!;
    const childBRow = report.rows.find((r) => r.lineItemId === "child_b")!;
    expect(childARow.touched.prev).toBe(true); // Frame 01: entry exists, before the window -> a real computed zero once rolled up
    expect(childBRow.touched.prev).toBe(false); // Taping Jointing 01: no entry ever -> never-touched
    expect(parentRow.touched.prev).toBe(true); // parent touched because childA was
  });
});

describe("formatProgressCell (dash vs. blank vs. the real number)", () => {
  test("never-touched renders blank, not 0", () => {
    expect(formatProgressCell(0, false)).toBe("");
  });
  test("a computed zero renders a dash", () => {
    expect(formatProgressCell(0, true)).toBe("-");
  });
  test("a real value renders unchanged, for the caller to format as today", () => {
    expect(formatProgressCell(32.4, true)).toBe(32.4);
  });
});

// CONS-05 (R46 P4 consistency sweep): the public share-link page previously
// blanked a PARENT row's percent cell whenever it was untouched, disagreeing
// with the live Report tab's ScopeTable, which shows a real "0%" for every
// parent regardless of touched -- only a hierarchical child ever blanks.
describe("formatParentOnlyPercent (WPR-06: percent cells are parent rows only)", () => {
  test("a parent line always renders a real number, even an untouched/computed zero", () => {
    expect(formatParentOnlyPercent(0, false)).toBe("0%");
  });
  test("a parent line's real non-zero value renders with a % suffix", () => {
    expect(formatParentOnlyPercent(48, false)).toBe("48%");
  });
  test("a child line always renders blank, regardless of its value", () => {
    expect(formatParentOnlyPercent(0, true)).toBe("");
    expect(formatParentOnlyPercent(75, true)).toBe("");
  });
});

// CONS-04 (R46 P4 consistency sweep): the public share-link page previously
// carried no Rate/Contract-Amt/Grand-Total field at all. sumRootAmtTotal is
// the same D-3 "parent BOQ lines only" rule WorkProgressReportClient.tsx's
// computeGrandTotal() already applies to this exact figure.
describe("sumRootAmtTotal (Grand Total: parent/root BOQ lines only, D-3)", () => {
  test("sums only rows with no parentLineItemId, ignoring children entirely", () => {
    const rows = [
      { amtTotal: 5000, parentLineItemId: null },
      { amtTotal: 999, parentLineItemId: "parent_1" }, // child -- informational only, never counted here
      { amtTotal: 2000, parentLineItemId: null },
    ];
    expect(sumRootAmtTotal(rows)).toBe(7000);
  });
  test("empty report sums to zero", () => {
    expect(sumRootAmtTotal([])).toBe(0);
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
    expect(civil.amt).toEqual({ prev: 900, current: 600, total: 1500, balance: 500 }); // 2000 - 1500
    expect(civil.percentage).toEqual({ prev: 45, current: 30, total: 75, balance: 25 }); // 500/2000*100
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

// RUN R12-21AUG point 10: the weighted parent roll-up. Oracle datapoint --
// item 1.01 (rate 108, BoQ amount 50,976.00 -- same item used across every
// run's oracle checks), 4 children at breakdown 30/15/10/15 whose own cum
// qty is 400/300/300/150. Parent cum qty 217.50, cum amt 23,490.00, percent
// 46.08. The forbidden unweighted sum is 400+300+300+150=1150 (which,
// divided by the parent's own total qty 472, gives the nonsensical 243.6%
// the ORACLE explicitly calls out as wrong by construction) -- it must
// never appear anywhere in the result.
describe("applyWeightedParentRollup (via buildWorkProgressReport) -- R12 point 10", () => {
  // PARENT carries its own activityId (a real Main BOQ item belongs to a
  // category too), but no progress entries are ever logged against it --
  // its progress is purely derived from its children, and the roll-up
  // must still land its weighted total in ITS OWN category, not
  // "Uncategorized", since categoryId/categoryName are untouched by the
  // roll-up (they come from computeLineItemProgress, before the roll-up
  // runs) and are orthogonal to the qty/amt weighting.
  const PARENT: BoqLineItem = {
    id: "p-1.01", activityId: "act-p-1.01", itemCode: "1.01", description: "Partition wall", unit: "Sqm",
    quantity: 472, rate: 108, amount: 50976,
  };
  const child = (id: string, code: string, pct: number): BoqLineItem => ({
    id, activityId: `act-${id}`, itemCode: code, description: code, unit: "Sqm",
    quantity: 0, rate: 0, amount: 0, parentLineItemId: PARENT.id, breakdownPercentage: pct,
  });
  const CHILDREN: BoqLineItem[] = [child("c1", "Frame", 30), child("c2", "Gypsum", 15), child("c3", "Rockwool", 10), child("c4", "Taping", 15)];
  const CATS: Category[] = [{ id: "cat_1", name: "Partitions" }];
  const ACTS: Activity[] = [
    { id: "act-p-1.01", categoryId: "cat_1", name: "Partition wall" },
    { id: "act-c1", categoryId: "cat_1", name: "Frame" }, { id: "act-c2", categoryId: "cat_1", name: "Gypsum" }, { id: "act-c3", categoryId: "cat_1", name: "Rockwool" }, { id: "act-c4", categoryId: "cat_1", name: "Taping" },
  ];

  // Split prev/current per child so the total (400/300/300/150) is not
  // trivially all-current -- also exercises that the SAME weighting
  // applies consistently to prev and current, not just total.
  const ENTRIES: ProgressEntry[] = [
    { id: "e1", activityId: "act-c1", entryDate: "2026-07-01", quantityDone: 250 }, // prev
    { id: "e2", activityId: "act-c1", entryDate: "2026-07-15", quantityDone: 150 }, // current
    { id: "e3", activityId: "act-c2", entryDate: "2026-07-01", quantityDone: 100 },
    { id: "e4", activityId: "act-c2", entryDate: "2026-07-15", quantityDone: 200 },
    { id: "e5", activityId: "act-c3", entryDate: "2026-07-01", quantityDone: 300 },
    { id: "e6", activityId: "act-c4", entryDate: "2026-07-15", quantityDone: 150 },
  ];

  test("parent cum qty 217.50, cum amt 23,490.00, percent 46.08 -- the unweighted sum (1150 / 243.6%) never appears", () => {
    const report = buildWorkProgressReport({
      lineItems: [PARENT, ...CHILDREN], entries: ENTRIES, activities: ACTS, categories: CATS,
      from: "2026-07-10", to: "2026-07-20",
    });
    const parentRow = report.rows.find((r) => r.lineItemId === PARENT.id)!;

    expect(parentRow.qty.total).toBeCloseTo(217.5, 5);
    expect(parentRow.amt.total).toBeCloseTo(23490, 5);
    expect(parentRow.percentage.total).toBe(46.08);

    // The forbidden unweighted values must never appear.
    expect(parentRow.qty.total).not.toBe(1150);
    expect(parentRow.percentage.total).not.toBeCloseTo(243.6, 1);

    // prev/current split sums back to total (linearity sanity check).
    expect(parentRow.qty.prev + parentRow.qty.current).toBeCloseTo(parentRow.qty.total, 5);
    expect(parentRow.amt.prev + parentRow.amt.current).toBeCloseTo(parentRow.amt.total, 5);

    // Every child's OWN row is untouched by the roll-up -- still its own
    // real (unweighted, BOQ-stored) qty/amt, not overwritten.
    const child1 = report.rows.find((r) => r.lineItemId === "c1")!;
    expect(child1.qty.total).toBe(400);
  });

  test("a childless parent (e.g. item 2.01/2.06) keeps its own directly-recorded progress, untouched", () => {
    const childless: BoqLineItem = { id: "p-2.01", activityId: "act-2.01", itemCode: "2.01", description: "Standalone item", unit: "nos", quantity: 10, rate: 100, amount: 1000 };
    const acts: Activity[] = [{ id: "act-2.01", categoryId: "cat_1", name: "Standalone" }];
    const entries: ProgressEntry[] = [{ id: "e1", activityId: "act-2.01", entryDate: "2026-07-15", quantityDone: 4 }];
    const report = buildWorkProgressReport({ lineItems: [childless], entries, activities: acts, categories: CATS, from: "2026-07-10", to: "2026-07-20" });
    const row = report.rows.find((r) => r.lineItemId === "p-2.01")!;
    // Its own directly-recorded progress (4 units, its own rate 100) -- NOT zeroed out by the roll-up just because it has no children.
    expect(row.qty.current).toBe(4);
    expect(row.amt.current).toBe(400);
  });

  test("a line with no parentLineItemId is a parent, never double-counted as anyone's own child", () => {
    const a: BoqLineItem = { id: "a", activityId: "act-a", itemCode: "A", description: "A", unit: "nos", quantity: 10, rate: 5, amount: 50 };
    const b: BoqLineItem = { id: "b", activityId: "act-b", itemCode: "B", description: "B", unit: "nos", quantity: 10, rate: 5, amount: 50 }; // also parentless -- must never be swept into A's children
    const acts: Activity[] = [{ id: "act-a", categoryId: "cat_1", name: "A" }, { id: "act-b", categoryId: "cat_1", name: "B" }];
    const report = buildWorkProgressReport({ lineItems: [a, b], entries: [], activities: acts, categories: CATS, from: "2026-07-10", to: "2026-07-20" });
    expect(report.rows).toHaveLength(2);
    expect(report.rows.find((r) => r.lineItemId === "a")!.qty.total).toBe(0);
  });

  test("category roll-up (byCategory) does not double-count the parent's weighted total against its children's own (unweighted) figures", () => {
    const report = buildWorkProgressReport({
      lineItems: [PARENT, ...CHILDREN], entries: ENTRIES, activities: ACTS, categories: CATS,
      from: "2026-07-10", to: "2026-07-20",
    });
    // Every child's own rate/quantity is 0 in this fixture (real hierarchical
    // sub-task rows store amount via the parent-derived formula, not their
    // own qty*rate -- see construction-boq-service.ts), so each child's own
    // amt.total is 0 and only the parent's weighted 23,490.00 shows up once.
    const partitions = report.byCategory.find((c) => c.name === "Partitions")!;
    expect(partitions.amt.total).toBeCloseTo(23490, 5);
  });

  // Cycle 2 edge case, documented as a KNOWN LIMITATION (see the code
  // comment on applyWeightedParentRollup): no run's oracle data covers a
  // three-level hierarchy, and a middle node's own stored `rate` is
  // typically 0 (same as any hierarchical child), so today a middle node
  // with its own children rolls up to 0 rather than a real weighted
  // figure. This test pins down and documents that CURRENT behavior --
  // it is not asserting the number is correct, only that it doesn't
  // silently produce something else undocumented, and that it doesn't
  // throw.
  test("KNOWN LIMITATION: a three-level chain (Main -> Sub -> Sub-sub) does not cascade -- the middle node rolls up to 0, not a compounded figure", () => {
    const main: BoqLineItem = { id: "main", activityId: "act-main", itemCode: "M", description: "Main", unit: "nos", quantity: 100, rate: 50, amount: 5000 };
    const sub: BoqLineItem = { id: "sub", activityId: null, itemCode: "S", description: "Sub", unit: "nos", quantity: 0, rate: 0, amount: 2000, parentLineItemId: "main", breakdownPercentage: 40 };
    const subsub: BoqLineItem = { id: "subsub", activityId: "act-subsub", itemCode: "SS", description: "Sub-sub", unit: "nos", quantity: 0, rate: 0, amount: 1000, parentLineItemId: "sub", breakdownPercentage: 50 };
    const acts: Activity[] = [{ id: "act-main", categoryId: "cat_1", name: "Main" }, { id: "act-subsub", categoryId: "cat_1", name: "Sub-sub" }];
    const entries: ProgressEntry[] = [{ id: "e1", activityId: "act-subsub", entryDate: "2026-07-15", quantityDone: 10 }];

    const report = buildWorkProgressReport({ lineItems: [main, sub, subsub], entries, activities: acts, categories: CATS, from: "2026-07-10", to: "2026-07-20" });
    const subRow = report.rows.find((r) => r.lineItemId === "sub")!;
    // sub has one child (subsub) -- gets rolled up using sub's OWN rate (0), not main's.
    expect(subRow.amt.total).toBe(0);
    expect(() => report).not.toThrow();
  });
});
