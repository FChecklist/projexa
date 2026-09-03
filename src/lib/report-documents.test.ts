import { describe, expect, test } from "bun:test";
import {
  NOT_SET,
  alignFor,
  buildAttendanceDocument,
  buildProjectStatusDocument,
  buildScopeDocument,
  buildSitePictureDocument,
  buildWeeklyProjectDocument,
  csvEscape,
  documentToCsv,
  scopeFilterOptions,
  type BudgetVariancePayload,
} from "./report-documents";

describe("alignFor", () => {
  test("numbers right, words left, unless the column says otherwise", () => {
    expect(alignFor({ key: "a", label: "A", unit: "currency" })).toBe("right");
    expect(alignFor({ key: "a", label: "A", unit: "percent" })).toBe("right");
    expect(alignFor({ key: "a", label: "A", unit: "text" })).toBe("left");
    expect(alignFor({ key: "a", label: "A", unit: "currency", align: "left" })).toBe("left");
  });
});

describe("buildProjectStatusDocument (Sumeet's Project Status sheet)", () => {
  const status = {
    projectId: "g555imnoq4wihavpwc7t64um",
    projectName: "Cedar Heights Villa - Phase 1",
    budget: 0,
    revenue: 0,
    expenses: 185_000,
    progressPercent: 60,
    percentByValue: 25,
    contractValue: 475_000,
    projectValue: null,
    earnedValue: 118_750,
    taskCount: 4,
    delayedTaskCount: 1,
  };

  test("the raw project id never appears anywhere in the document", () => {
    const doc = buildProjectStatusDocument(status, null);
    const printed = JSON.stringify(doc);
    expect(printed).not.toContain("g555imnoq4wihavpwc7t64um");
  });

  test("the money table is Revenue | Budget | Expense, as rows, with a currency column", () => {
    const doc = buildProjectStatusDocument(status, null);
    const money = doc.sections.find((s) => s.key === "money")!;
    expect(money.columns.map((c) => c.unit)).toContain("currency");
    expect(money.rows.slice(0, 3).map((r) => r.cells.measure)).toEqual(["Revenue", "Budget", "Expense"]);
    expect(money.rows[2].cells.amount).toBe(185_000);
  });

  test("a zero is a figure and a null is 'not set' with the action that would set it", () => {
    const doc = buildProjectStatusDocument(status, null);
    const money = doc.sections.find((s) => s.key === "money")!;
    // budget is a real 0 -- the cell keeps it and offers no "set a budget" hint.
    expect(money.rows[1].cells.amount).toBe(0);
    // projectValue is genuinely null.
    const projectValue = money.rows.find((r) => r.key === "projectValue")!;
    expect(projectValue.cells.amount).toBeNull();
    expect(projectValue.hint).toContain("Set a project value");
  });

  test("both progress measures are named in words, and the note says they are expected to differ", () => {
    const doc = buildProjectStatusDocument(status, null);
    const progress = doc.sections.find((s) => s.key === "progress")!;
    expect(progress.rows[0].cells.measure).toBe("% complete by BOQ value");
    expect(progress.rows[1].cells.measure).toBe("% complete by activity log");
    expect(progress.rows[0].cells.percent).toBe(25);
    expect(progress.rows[1].cells.percent).toBe(60);
    expect(progress.note).toContain("measure different things");
    // No camelCase key survives into anything the reader sees.
    expect(JSON.stringify(progress.rows.map((r) => r.cells.measure))).not.toContain("percentByValue");
  });

  test("the subcontractor/budget breakup carries its lines and a total that sums them", () => {
    const variance: BudgetVariancePayload = {
      lines: [
        { lineItemId: "l1", code: "1.1", description: "Blockwork", category: "Civil", budget: 1625, vendorId: "v1", vendorName: "Al Noor", vendorAmount: 1800, variance: 175 },
        { lineItemId: "l2", code: "1.2", description: "Plaster", category: null, budget: 900, vendorId: null, vendorName: null, vendorAmount: null, variance: null },
      ],
      totalBudget: 2525,
      totalVendorAmount: 1800,
      totalVariance: 175,
    };
    const doc = buildProjectStatusDocument(status, variance);
    const breakup = doc.sections.find((s) => s.key === "breakup")!;
    expect(breakup.rows).toHaveLength(3);
    expect(breakup.rows[1].cells.vendor).toBe(NOT_SET);
    const total = breakup.rows[2];
    expect(total.kind).toBe("total");
    expect(total.cells.budget).toBe(2525);
  });

  test("no vendor amounts and no budgets anywhere leaves an empty breakup that says so", () => {
    const doc = buildProjectStatusDocument(status, { lines: [], totalBudget: 0 });
    const breakup = doc.sections.find((s) => s.key === "breakup")!;
    expect(breakup.rows).toHaveLength(0);
    expect(breakup.emptyLabel).toContain("No BOQ line");
  });
});

describe("buildWeeklyProjectDocument (day columns, category rows, totals)", () => {
  const payload = {
    weekStart: "2026-08-24",
    weekEnd: "2026-08-31",
    byDay: [
      { date: "2026-08-24", labourCost: 1200, workersPresent: 4, expenseTotal: 0, progressEntriesLogged: 1, diaryEntries: 1 },
      { date: "2026-08-25", labourCost: 0, workersPresent: 0, expenseTotal: 4500, progressEntriesLogged: 0, diaryEntries: 0 },
      { date: "2026-08-26", labourCost: 900, workersPresent: 3, expenseTotal: 0, progressEntriesLogged: 2, diaryEntries: 0 },
    ],
  };

  test("one column per day plus a week total", () => {
    const section = buildWeeklyProjectDocument(payload).sections[0];
    expect(section.columns.map((c) => c.label)).toEqual(["Category", "2026-08-24", "2026-08-25", "2026-08-26", "Week total"]);
  });

  test("one row per category, and the week total is the sum of that row's day columns", () => {
    const section = buildWeeklyProjectDocument(payload).sections[0];
    expect(section.rows).toHaveLength(5);
    const labour = section.rows.find((r) => r.key === "labourCost")!;
    expect(labour.cells["d_2026-08-24"]).toBe(1200);
    expect(labour.cells["d_2026-08-25"]).toBe(0);
    expect(labour.cells.total).toBe(2100);
    for (const row of section.rows) {
      const dayTotal = Object.entries(row.cells)
        .filter(([k]) => k.startsWith("d_"))
        .reduce((s, [, v]) => s + Number(v ?? 0), 0);
      expect(row.cells.total).toBe(dayTotal);
    }
  });

  test("a week the backend returned no days for renders no rows and says why", () => {
    const section = buildWeeklyProjectDocument({ weekStart: "2026-08-24", weekEnd: "2026-08-31" }).sections[0];
    expect(section.rows).toHaveLength(0);
    expect(section.emptyLabel).toContain("pick a week start");
  });
});

describe("buildAttendanceDocument (S.No | ID | Name | Company | Trade | Salary)", () => {
  const payload = {
    workers: [
      { rosterId: "r1", employeeCode: "W-0001", name: "Ravi", company: "Al Noor Labour", trade: "Civil", daysPresent: 5, salary: 1500 },
      { rosterId: "r2", employeeCode: null, name: "Suresh", company: null, trade: "Civil", daysPresent: 4, salary: 1200 },
      { rosterId: "r3", employeeCode: "W-0003", name: "Ahmed", company: "Al Noor Labour", trade: "Electrical", daysPresent: 6, salary: 2100 },
    ],
    tradeSubtotals: [
      { trade: "Civil", workers: 2, daysPresent: 9, salary: 2700 },
      { trade: "Electrical", workers: 1, daysPresent: 6, salary: 2100 },
    ],
  };

  test("the exact six columns of Sumeet's sheet, in his order", () => {
    const section = buildAttendanceDocument(payload).sections[0];
    expect(section.columns.map((c) => c.label)).toEqual(["S.No", "ID", "Name", "Company", "Trade", "Days present", "Salary"]);
  });

  test("a subtotal row is emitted when the trade changes, and a grand total at the end", () => {
    const rows = buildAttendanceDocument(payload).sections[0].rows;
    expect(rows.map((r) => r.kind ?? "row")).toEqual(["row", "row", "subtotal", "row", "subtotal", "total"]);
    expect(rows[2].cells.name).toBe("Civil subtotal");
    expect(rows[2].cells.salary).toBe(2700);
    expect(rows[5].cells.salary).toBe(1500 + 1200 + 2100);
  });

  test("S.No counts workers, not rows -- a subtotal is not a worker", () => {
    const rows = buildAttendanceDocument(payload).sections[0].rows;
    expect(rows.filter((r) => (r.kind ?? "row") === "row").map((r) => r.cells.sno)).toEqual([1, 2, 3]);
  });

  test("a worker with no ID and no company says so and offers the fix, never a blank cell", () => {
    const rows = buildAttendanceDocument(payload).sections[0].rows;
    expect(rows[1].cells.id).toBe(NOT_SET);
    expect(rows[1].cells.company).toBe("Direct labour");
    expect(rows[1].hint).toContain("Give this worker an ID");
  });

  test("an untraded worker's subtotal label matches the backend's own 'Not set' bucket", () => {
    const doc = buildAttendanceDocument({
      workers: [{ rosterId: "r1", employeeCode: null, name: "Ravi", company: null, trade: null, daysPresent: 2, salary: 800 }],
      tradeSubtotals: [{ trade: "Not set", workers: 1, daysPresent: 2, salary: 800 }],
    });
    const subtotal = doc.sections[0].rows.find((r) => r.kind === "subtotal")!;
    expect(subtotal.cells.name).toBe("Not set subtotal");
    expect(subtotal.cells.salary).toBe(800);
  });

  test("no attendance at all renders no rows and says so", () => {
    const section = buildAttendanceDocument({ workers: [] }).sections[0];
    expect(section.rows).toHaveLength(0);
    expect(section.emptyLabel).toContain("No attendance");
  });
});

describe("buildSitePictureDocument (date-grouped photo grid)", () => {
  test("groups by upload day, newest day first", () => {
    const doc = buildSitePictureDocument({
      photos: [
        { id: "p1", name: "wall.jpg", createdAt: "2026-08-25T10:00:00.000Z" },
        { id: "p2", name: "slab.jpg", createdAt: "2026-08-26T08:00:00.000Z" },
        { id: "p3", name: "beam.jpg", createdAt: "2026-08-25T18:00:00.000Z" },
      ],
    });
    const groups = doc.sections[0].photos!;
    expect(groups.map((g) => g.date)).toEqual(["2026-08-26", "2026-08-25"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["p1", "p3"]);
  });

  test("no photos renders the honest empty sentence, not an empty grid", () => {
    const section = buildSitePictureDocument({ photos: [] }).sections[0];
    expect(section.photos).toEqual([]);
    expect(section.emptyLabel).toContain("No site photos");
  });
});

describe("buildScopeDocument (subcontractor rate/amount/vendor with Category and Vendor filters)", () => {
  const variance: BudgetVariancePayload = {
    lines: [
      { lineItemId: "l1", code: "1.1", description: "Blockwork", category: "Civil", amount: 6500, budgetPercentage: 25, budget: 1625, vendorName: "Al Noor", vendorAmount: 1800 },
      { lineItemId: "l2", code: "2.1", description: "Wiring", category: "Electrical", amount: 4000, budgetPercentage: 30, budget: 1200, vendorName: "Sparks LLC", vendorAmount: null },
      { lineItemId: "l3", code: "3.1", description: "Painting", category: null, amount: 1000, budgetPercentage: 10, budget: 100, vendorName: null, vendorAmount: null },
    ],
  };
  const scope = { boq: { id: "b1", version: 3, status: "approved" }, totalValue: 11_500, lineItemCount: 3 };

  test("the header names the revision it is reporting", () => {
    const section = buildScopeDocument(scope, variance).sections[0];
    expect(section.title).toBe("BOQ revision 3 (approved)");
    expect(section.note).toContain("3 root lines");
  });

  test("a Category filter narrows the rows", () => {
    const rows = buildScopeDocument(scope, variance, { category: "Civil" }).sections[0].rows;
    expect(rows.filter((r) => r.kind !== "total").map((r) => r.cells.code)).toEqual(["1.1"]);
  });

  test("a Vendor filter narrows the rows, and an unset vendor is filterable by name", () => {
    const rows = buildScopeDocument(scope, variance, { vendor: NOT_SET }).sections[0].rows;
    expect(rows.filter((r) => r.kind !== "total").map((r) => r.cells.code)).toEqual(["3.1"]);
  });

  test("a filter that matches nothing says the filter is why, not that the BOQ is empty", () => {
    const section = buildScopeDocument(scope, variance, { category: "Joinery" }).sections[0];
    expect(section.rows).toHaveLength(0);
    expect(section.emptyLabel).toContain("No BOQ line matches");
  });

  test("a project with no BOQ lines at all says that instead", () => {
    const section = buildScopeDocument({ boq: null }, { lines: [] }).sections[0];
    expect(section.emptyLabel).toContain("no BOQ lines yet");
  });

  test("the total sums the filtered rows, not the whole BOQ", () => {
    const rows = buildScopeDocument(scope, variance, { category: "Civil" }).sections[0].rows;
    const total = rows.find((r) => r.kind === "total")!;
    expect(total.cells.amount).toBe(6500);
  });

  test("filter options include every distinct value, with unset ones named", () => {
    expect(scopeFilterOptions(variance)).toEqual({
      categories: ["Civil", "Electrical", NOT_SET],
      vendors: ["Al Noor", NOT_SET, "Sparks LLC"],
    });
  });
});

describe("documentToCsv", () => {
  test("writes the currency in the header and the raw number in the cell", () => {
    const doc = buildAttendanceDocument({
      workers: [{ rosterId: "r1", employeeCode: "W-1", name: "Ravi", company: null, trade: "Civil", daysPresent: 5, salary: 1500 }],
      tradeSubtotals: [{ trade: "Civil", workers: 1, daysPresent: 5, salary: 1500 }],
    });
    const csv = documentToCsv(doc, "AED");
    expect(csv).toContain("Salary (AED)");
    // A formatted "AED 1,500.00" is not a number a spreadsheet can sum.
    expect(csv).toContain(",1500");
    expect(csv).not.toContain("AED 1,500");
  });

  test("keeps the subtotal and total rows -- a spreadsheet of a report without its total is not the report", () => {
    const doc = buildAttendanceDocument({
      workers: [{ rosterId: "r1", employeeCode: "W-1", name: "Ravi", company: null, trade: "Civil", daysPresent: 5, salary: 1500 }],
      tradeSubtotals: [{ trade: "Civil", workers: 1, daysPresent: 5, salary: 1500 }],
    });
    const csv = documentToCsv(doc, "AED");
    expect(csv).toContain("Civil subtotal");
    expect(csv).toContain("Total");
  });

  test("a cell that would execute as a formula is neutralised, not corrupted", () => {
    // Prefixed, so Excel reads it as text; not quoted, because it carries no
    // comma, double quote or newline -- same rule as compliance-tracker's own
    // report-export-shared.ts#csvEscape.
    expect(csvEscape("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(csvEscape("+1")).toBe("'+1");
    expect(csvEscape("plain")).toBe("plain");
  });

  test("a comma or quote in a description does not break the row", () => {
    expect(csvEscape('Blockwork, 200mm "fair face"')).toBe('"Blockwork, 200mm ""fair face"""');
  });

  test("a photo-only section contributes no CSV rows rather than an empty header", () => {
    const csv = documentToCsv(buildSitePictureDocument({ photos: [{ id: "p1", name: "a.jpg", createdAt: "2026-08-25T00:00:00Z" }] }), "AED");
    expect(csv).toBe("");
  });
});
