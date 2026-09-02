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
import { CategoryFilterGroup, ScopeTable, noProgressText, reportIsEmpty, type LineItemRow } from "./WorkProgressReportClient";

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
  touched: { prev: true, current: true, total: true }, // real entries underlie every bucket here
};
const child = (id: string, code: string): LineItemRow => ({
  lineItemId: id, code, description: code, categoryName: "Partitions", unit: "Sqm", rate: 0,
  qtyTotal: 0, amtTotal: 0, parentLineItemId: "p-1.01",
  qty: { prev: 0, current: 0, total: 0, balance: 0 },
  amt: { prev: 0, current: 0, total: 0, balance: 0 },
  percentage: { prev: 0, current: 0, total: 0, balance: 0 }, // never rendered -- child rows are blank regardless
  touched: { prev: false, current: false, total: false }, // no entries -- these fixtures exist only to test percent blanking
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

// T-WPR-14-1 (WPR-14, point 111): "a computed zero is a dash, a never-touched
// cell is blank" -- the oracle is "Frame 01 balance renders '-' " (Frame 01
// is fully complete: balance computes to a real 0) and "Taping Jointing 01
// current renders '' " (no entry logged in this window at all). Neither may
// render a bare "0.00" or "0" -- that was the actual FAIL this test caught
// (money() rendered every Qty/Amt cell as a plain number, touched or not).
describe("ScopeTable Qty/Amt cells (T-WPR-14-1: dash vs. blank, not a bare 0)", () => {
  test("Frame 01: balance computes to a real zero -- renders a dash, not 0.00", () => {
    const frame01: LineItemRow = {
      lineItemId: "c-frame01", code: "1.01.1", description: "Frame 01", categoryName: "Partitions",
      unit: "Sqm", rate: 108, qtyTotal: 400, amtTotal: 43200, parentLineItemId: "p-1.01",
      qty: { prev: 300, current: 100, total: 400, balance: 0 }, // fully progressed -- real, computed 0
      amt: { prev: 32400, current: 10800, total: 43200, balance: 0 },
      percentage: { prev: 75, current: 25, total: 100, balance: 0 },
      touched: { prev: true, current: true, total: true },
    };
    const html = renderToStaticMarkup(<ScopeTable rows={[frame01]} mode="balance" />);
    expect(textsByTestId(html, "qty-third")[0]).toBe("-");
    expect(textsByTestId(html, "amt-third")[0]).toBe("-");
  });

  test("Taping Jointing 01: no entry in this window -- renders blank, not 0.00", () => {
    const taping: LineItemRow = {
      lineItemId: "c-taping01", code: "1.01.4", description: "Taping Jointing 01", categoryName: "Partitions",
      unit: "Sqm", rate: 108, qtyTotal: 150, amtTotal: 16200, parentLineItemId: "p-1.01",
      qty: { prev: 50, current: 0, total: 50, balance: 100 }, // current never touched this window
      amt: { prev: 5400, current: 0, total: 5400, balance: 10800 },
      percentage: { prev: 33.33, current: 0, total: 33.33, balance: 66.67 },
      touched: { prev: true, current: false, total: true },
    };
    const html = renderToStaticMarkup(<ScopeTable rows={[taping]} mode="total" />);
    expect(textsByTestId(html, "qty-current")[0]).toBe("");
    expect(textsByTestId(html, "amt-current")[0]).toBe("");
    // prev WAS touched, so it still renders as a real formatted number.
    expect(textsByTestId(html, "qty-prev")[0]).toBe("50");
    expect(textsByTestId(html, "amt-prev")[0]).toBe("5,400");
  });

  test("a real touched value still uses money()'s thousands formatting, not a raw number", () => {
    const html = renderToStaticMarkup(<ScopeTable rows={[PARENT]} mode="total" />);
    expect(textsByTestId(html, "amt-third")[0]).toBe("23,490");
  });
});

// R67 lane I (WS-I item I-05, R-177): the Category multi-select the item asks
// for on the WPR parameter bar. Same renderToStaticMarkup approach as above --
// this asserts the real component's markup, not a description of it.
const noop = () => {};

describe("CategoryFilterGroup (I-05: the WPR Category multi-select)", () => {
  test("renders one labelled checkbox per available category, with its name", () => {
    const html = renderToStaticMarkup(
      <CategoryFilterGroup
        available={["Civil", "Electrical", "Paint"]}
        selected={[]}
        disabled={false}
        onToggle={noop}
        onApply={noop}
      />
    );
    expect(Array.from(html.matchAll(/type="checkbox"/g))).toHaveLength(3);
    for (const name of ["Civil", "Electrical", "Paint"]) expect(html).toContain(name);
  });

  test("the group is labelled 'Category' and reachable by its test id", () => {
    const html = renderToStaticMarkup(
      <CategoryFilterGroup available={["Civil"]} selected={[]} disabled={false} onToggle={noop} onApply={noop} />
    );
    expect(html).toContain('id="wpr-category-filter-label"');
    expect(html).toContain("Category");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-labelledby="wpr-category-filter-label"');
    expect(html).toContain('data-testid="wpr-category-filter"');
    expect(html).toContain('data-testid="wpr-category-apply"');
  });

  test("an EMPTY selection reads 'All categories' -- never as 'nothing matches'", () => {
    const html = renderToStaticMarkup(
      <CategoryFilterGroup
        available={["Civil", "Electrical"]}
        selected={[]}
        disabled={false}
        onToggle={noop}
        onApply={noop}
      />
    );
    expect(html).toContain("All categories");
    expect(html).not.toContain("selected");
  });

  test("a non-empty selection reports its count, and exactly those boxes are checked", () => {
    const html = renderToStaticMarkup(
      <CategoryFilterGroup
        available={["Civil", "Electrical", "Paint"]}
        selected={["Civil", "Paint"]}
        disabled={false}
        onToggle={noop}
        onApply={noop}
      />
    );
    expect(html).toContain("2 selected");
    expect(Array.from(html.matchAll(/type="checkbox" checked=""/g))).toHaveLength(2);
  });

  test("no categories at all: renders NOTHING rather than an empty filter box", () => {
    const html = renderToStaticMarkup(
      <CategoryFilterGroup available={[]} selected={[]} disabled={false} onToggle={noop} onApply={noop} />
    );
    expect(html).toBe("");
  });

  test("Apply is disabled while a report is already running", () => {
    const html = renderToStaticMarkup(
      <CategoryFilterGroup available={["Civil"]} selected={["Civil"]} disabled onToggle={noop} onApply={noop} />
    );
    expect(html).toMatch(/data-testid="wpr-category-apply"[^>]*disabled=""|disabled=""[^>]*data-testid="wpr-category-apply"/);
// ─── R67 D-29 (audit R-080) ──────────────────────────────────────────────
// A report that ran over a window in which nothing happened used to render four
// empty tables under four tabs, leaving the reader to work out for themselves
// whether that meant "no progress" or "the report is broken". One sentence
// answers it. `touched.current` is the flag the report already computes for
// exactly this distinction -- money() cannot tell a real computed zero from a
// bucket nothing has ever reached, because both are the number 0.
describe("R67 D-29: an untouched window says so", () => {
  const UNTOUCHED: LineItemRow = {
    lineItemId: "p-2.01", code: "2.01", description: "Screed", categoryName: "Finishes",
    unit: "Sqm", rate: 60, qtyTotal: 100, amtTotal: 6000, parentLineItemId: null,
    qty: { prev: 20, current: 0, total: 20, balance: 80 },
    amt: { prev: 1200, current: 0, total: 1200, balance: 4800 },
    percentage: { prev: 20, current: 0, total: 20, balance: 80 },
    touched: { prev: true, current: false, total: true },
  };

  test("every band untouched and no manpower or vendor rows means no progress in the window", () => {
    expect(reportIsEmpty({ rows: [UNTOUCHED], byManpower: [], byVendor: [] })).toBe(true);
  });

  test("one touched line, one manpower row or one vendor row is enough to be a real report", () => {
    expect(
      reportIsEmpty({ rows: [{ ...UNTOUCHED, touched: { prev: true, current: true, total: true } }], byManpower: [], byVendor: [] })
    ).toBe(false);
    expect(
      reportIsEmpty({ rows: [UNTOUCHED], byManpower: [{ trade: "Mason", workerDays: 4, totalCost: 800 }], byVendor: [] })
    ).toBe(false);
    expect(
      reportIsEmpty({ rows: [UNTOUCHED], byManpower: [], byVendor: [{ vendorId: "v1", vendorName: "Al Noor", totalCost: 900 }] })
    ).toBe(false);
  });

  test("a BOQ with no lines at all still reads as no progress, not as a broken report", () => {
    expect(reportIsEmpty({ rows: [], byManpower: [], byVendor: [] })).toBe(true);
  });

  test("the sentence names the window the user asked for", () => {
    expect(noProgressText("2026-08-01", "2026-08-31")).toBe("No progress recorded between 2026-08-01 and 2026-08-31");
  });
});
