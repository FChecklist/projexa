/// <reference types="bun-types" />
// Point 108: the WPR scope-wise table lays out in three bands, XLSX order
// (Percent, then Quantity, then Amount, each Previous/Current/Total-or-
// Balance), visually separated -- and WPR-06: percentages are PARENT rows
// only, child rows render blank percent cells (not 0.00, not a number).
//
// Renders the real ScopeTable component via react-dom/server's
// renderToStaticMarkup rather than @testing-library/react + happy-dom --
// @happy-dom/global-registrator is declared in package.json but is not
// present in node_modules in this environment (reproduced identically on
// the pre-existing CategoryDistributionCharts.test.tsx, which fails the
// same "Cannot find module" way; not something this point caused, and
// `npm install` is out of scope for this run). react-dom/server ships with
// react-dom itself (already a real dependency of every Next.js page), so
// this still genuinely renders the actual component tree -- it just reads
// the output as an HTML string instead of through a jsdom-backed query API.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScopeTable, type LineItemRow } from "./WorkProgressReportClient";

function textsOfTag(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(.*?)</${tag}>`, "gs");
  return Array.from(html.matchAll(re)).map((m) => m[1]);
}

function textsByTestId(html: string, testId: string): string[] {
  const re = new RegExp(`data-testid="${testId}"[^>]*>(.*?)</td>`, "gs");
  return Array.from(html.matchAll(re)).map((m) => m[1]);
}

// Item 1.01 "Partition wall" + its four hierarchical children, the same
// oracle fixture used throughout this codebase (work-progress-report.test.ts's
// applyWeightedParentRollup describe block) -- rate 108, BoQ amount 50,976.
const PARENT: LineItemRow = {
  lineItemId: "p-1.01", code: "1.01", description: "Partition wall", categoryName: "Partitions",
  unit: "Sqm", rate: 108, qtyTotal: 472, amtTotal: 50976, parentLineItemId: null,
  qty: { prev: 150, current: 67.5, total: 217.5, balance: 254.5 },
  amt: { prev: 16200, current: 7290, total: 23490, balance: 27486 },
  percentage: { prev: 31.79, current: 14.3, total: 46.08, balance: 53.92 },
};
const child = (id: string, code: string): LineItemRow => ({
  lineItemId: id, code, description: code, categoryName: "Partitions", unit: "Sqm", rate: 0,
  qtyTotal: 0, amtTotal: 0, parentLineItemId: "p-1.01",
  qty: { prev: 0, current: 0, total: 0, balance: 0 },
  amt: { prev: 0, current: 0, total: 0, balance: 0 },
  percentage: { prev: 0, current: 0, total: 0, balance: 0 }, // never rendered -- child rows are blank regardless
});
const CHILDREN: LineItemRow[] = [child("c1", "Frame"), child("c2", "Gypsum"), child("c3", "Rockwool"), child("c4", "Taping")];

describe("ScopeTable (point 108: banded layout)", () => {
  test("renders three visually separated bands in XLSX order: Percent, then Quantity, then Amount", () => {
    const html = renderToStaticMarkup(<ScopeTable rows={[PARENT]} mode="total" />);
    const headerText = textsOfTag(html, "th");
    expect(headerText).toEqual([
      "S.No", "Category", "Code", "Description", "Unit", "Rate", "Amt",
      "Percent", "Quantity", "Amount",
      "Previous", "Current", "Total", "Previous", "Current", "Total", "Previous", "Current", "Total",
    ]);
  });

  test("the Total-or-Balance label switches with the toggle mode", () => {
    const html = renderToStaticMarkup(<ScopeTable rows={[PARENT]} mode="balance" />);
    const headerText = textsOfTag(html, "th");
    expect(headerText.filter((t) => t === "Balance")).toHaveLength(3); // one per band
    expect(headerText).not.toContain("Total");
  });

  test("item 1.01 with its four children: the PARENT row shows real percentages", () => {
    const html = renderToStaticMarkup(<ScopeTable rows={[PARENT, ...CHILDREN]} mode="total" />);
    const pctPrev = textsByTestId(html, "pct-prev");
    const pctCurrent = textsByTestId(html, "pct-current");
    const pctThird = textsByTestId(html, "pct-third");
    expect(pctPrev[0]).toBe("31.79%");
    expect(pctCurrent[0]).toBe("14.3%");
    expect(pctThird[0]).toBe("46.08%");
  });

  test("item 1.01 with its four children: CHILD percent cells are blank -- not 0.00, not a number", () => {
    const html = renderToStaticMarkup(<ScopeTable rows={[PARENT, ...CHILDREN]} mode="total" />);
    const pctPrev = textsByTestId(html, "pct-prev");
    const pctCurrent = textsByTestId(html, "pct-current");
    const pctThird = textsByTestId(html, "pct-third");
    for (const i of [1, 2, 3, 4]) {
      expect(pctPrev[i]).toBe("");
      expect(pctCurrent[i]).toBe("");
      expect(pctThird[i]).toBe("");
    }
  });

  test("a standalone line with no children and no parent (e.g. item 2.01) is not a child -- shows real percentages", () => {
    const standalone: LineItemRow = { ...PARENT, lineItemId: "p-2.01", code: "2.01", parentLineItemId: null };
    const html = renderToStaticMarkup(<ScopeTable rows={[standalone]} mode="total" />);
    expect(textsByTestId(html, "pct-third")[0]).toBe("46.08%");
  });
});
