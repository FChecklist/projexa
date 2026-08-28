/// <reference types="bun-types" />
// R48_REPORTS_BUDGETS_NO_CURRENCY_01 (gap 1, part B): before this fix,
// ReportsClient.tsx's fieldFormatters prop was only ever populated when
// reportName === "project-status" (via a bespoke buildProjectStatusFormatters()
// covering exactly ONE field, contractValue) -- every other report, and
// project-status's own remaining five money fields, fell through to
// ReportOutput's bare cellValue() default. buildMoneyFormatters() is the
// real fix: a per-report money-field map, verified field-by-field against
// construction-reports-service.ts's actual return shapes, wired for every
// report that genuinely returns a money-shaped value.
import { describe, expect, test } from "bun:test";
import { buildMoneyFormatters } from "./ReportsClient";
import type { Currency } from "@/lib/currency";

const AED_BASE: Currency[] = [{ id: "c1", code: "AED", name: "UAE Dirham", symbol: "AED", isBaseCurrency: true }];
const NO_CURRENCIES: Currency[] = [];

describe("buildMoneyFormatters (R48_REPORTS_BUDGETS_NO_CURRENCY_01)", () => {
  test("project-status now covers all six of its own money fields, not just contractValue", () => {
    const f = buildMoneyFormatters("project-status", AED_BASE);
    expect(f).toBeDefined();
    for (const field of ["contractValue", "budget", "revenue", "expenses", "projectValue", "earnedValue"]) {
      expect(f?.[field]?.(1000)).toBe("AED 1000");
    }
    // percentByValue/progressPercent/delayedTaskCount etc. are real
    // project-status fields but are NOT money -- must stay unformatted.
    expect(f?.["percentByValue"]).toBeUndefined();
    expect(f?.["delayedTaskCount"]).toBeUndefined();
  });

  test("every report previously stuck on the bare default now has its real money fields covered", () => {
    const cases: [report: string, field: string][] = [
      ["weekly-project", "labourCost"],
      ["weekly-project", "expenseTotal"],
      ["attendance", "cost"],
      ["manpower-cost", "totalCost"],
      ["scope", "totalValue"],
      ["budget-summary", "total"],
      ["budget-vs-actual", "budget"],
      ["budget-vs-actual", "actual"],
      ["budget-vs-actual", "variance"],
      ["budget-vs-actual", "total"],
      ["material-consumption", "totalValue"],
      ["vendor-cost", "total"],
      ["designer-timesheet", "overallBudget"],
      ["designer-timesheet", "overallActual"],
      ["designer-timesheet", "overallVariance"],
      ["revenue", "total"],
      ["revenue", "grandTotal"],
      ["revenue", "subtotal"],
      ["revenue", "taxAmount"],
      ["revenue", "outstandingAmount"],
      ["expense", "total"],
    ];
    for (const [report, field] of cases) {
      const formatters = buildMoneyFormatters(report, AED_BASE);
      expect(formatters?.[field]).toBeDefined();
      expect(formatters?.[field]?.(42)).toBe("AED 42");
    }
  });

  test("reports verified to have no money fields get no formatter map at all -- never a false-positive label", () => {
    for (const report of ["project-completion", "work-progress", "category-progress", "site-picture", "kpi"]) {
      expect(buildMoneyFormatters(report, AED_BASE)).toBeUndefined();
    }
  });

  test("a quantity/count field sitting next to a money field in the same report is never formatted", () => {
    const f = buildMoneyFormatters("manpower-cost", AED_BASE);
    expect(f?.["totalCost"]?.(500)).toBe("AED 500");
    expect(f?.["workerDays"]).toBeUndefined();
    expect(f?.["trade"]).toBeUndefined();
  });

  test("with no org base currency configured, the formatter falls back honestly (no fabricated symbol), never crashes", () => {
    const f = buildMoneyFormatters("budget-summary", NO_CURRENCIES);
    // No NEXT_PUBLIC_DEFAULT_CURRENCY_CODE set in this test env and no base
    // currency row -> currencyLabel() resolves to "", matching
    // CURRENCY_FALLBACK_LABEL -- an honest bare number, never a wrong ₹/$.
    expect(f?.["total"]?.(100)).toBe("100");
  });

  test("null/undefined money values still render the existing dash placeholder, not \"AED null\"", () => {
    const f = buildMoneyFormatters("expense", AED_BASE);
    expect(f?.["total"]?.(null)).toBe("—");
    expect(f?.["total"]?.(undefined)).toBe("—");
  });
});
