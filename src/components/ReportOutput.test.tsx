/// <reference types="bun-types" />
// R48_REPORTS_BUDGETS_NO_CURRENCY_01 (gap 1, part A): fieldFormatters was
// only ever honored on the scalar key/value grid (isPlainObject(data)
// branch) -- the array/table branch (Array.isArray(data)) called
// cellValue() unconditionally regardless of what a caller passed, even
// though the prop is accepted and documented as applying to any report
// shape. Verified directly against the pre-fix source: the array branch's
// <TableCell> had `{cellValue(isPlainObject(row) ? row[c] : row)}` with no
// fieldFormatters reference anywhere in that branch. Several real reports
// (budget-summary's byAccount, budget-vs-actual's byHead, vendor-cost's
// labourVendorCosts, manpower-cost's byTrade, designer-timesheet's
// byCategory/byDesigner/byProject/byDesignerStatus) return their money
// fields nested inside an array, so a currency formatter supplied for them
// was silently dropped before this fix -- this suite pins the array path to
// the same contract the object path already had.
//
// Renders via react-dom/server's renderToStaticMarkup (matching
// WorkProgressReportClient.test.tsx's own documented reason: happy-dom is
// declared in package.json but not present in node_modules in this
// environment) rather than @testing-library/react.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportOutput } from "./ReportOutput";

function textsByTag(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(.*?)</${tag}>`, "gs");
  return Array.from(html.matchAll(re)).map((m) => m[1]);
}

describe("ReportOutput array/table branch honors fieldFormatters (previously silently ignored)", () => {
  test("a money column inside an array-of-rows report gets the supplied formatter, not the bare number", () => {
    const rows = [
      { accountId: "acc-1", total: 5000 },
      { accountId: "acc-2", total: 1200 },
    ];
    const html = renderToStaticMarkup(
      <ReportOutput data={rows} fieldFormatters={{ total: (v) => `AED ${v}` }} />
    );
    const cells = textsByTag(html, "td");
    // accountId cells stay bare (no formatter registered for that key) --
    // this proves the fix is per-key, not a blanket change to every cell.
    expect(cells).toContain("acc-1");
    expect(cells).toContain("acc-2");
    // total cells now carry the live currency prefix instead of a bare number.
    expect(cells).toContain("AED 5000");
    expect(cells).toContain("AED 1200");
    expect(cells).not.toContain("5000");
    expect(cells).not.toContain("1200");
  });

  test("a report with no fieldFormatters supplied renders exactly as before (no behavioural change)", () => {
    const rows = [{ trade: "Electrical", totalCost: 900 }];
    const html = renderToStaticMarkup(<ReportOutput data={rows} />);
    const cells = textsByTag(html, "td");
    expect(cells).toContain("Electrical");
    expect(cells).toContain("900");
  });

  test("the pre-existing scalar/object branch still honors fieldFormatters unchanged (parity with the array branch)", () => {
    const html = renderToStaticMarkup(
      <ReportOutput data={{ contractValue: 250000 }} fieldFormatters={{ contractValue: (v) => `AED ${v}` }} />
    );
    expect(html).toContain("AED 250000");
    expect(html).not.toContain(">250000<");
  });

  test("null/undefined money values still render the dash placeholder through a formatter, not a crash", () => {
    const rows = [{ total: null }];
    const money = (v: unknown) => (v === null || v === undefined ? "—" : `AED ${v}`);
    const html = renderToStaticMarkup(<ReportOutput data={rows} fieldFormatters={{ total: money }} />);
    const cells = textsByTag(html, "td");
    expect(cells).toContain("—");
  });
});
