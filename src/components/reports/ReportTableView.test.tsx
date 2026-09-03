/// <reference types="bun-types" />
// R67 E-32 (R-265). The renderer's own acceptance, as a render test.
//
// The item's Playwright clause is "/reports -> Run Project Status -> a <table>
// with a <thead> row and a cell text 'AED 6,500' (no '6500' or 'AED6500'
// variant) and a final row containing 'Total'". This lane may not start a
// server, so the clause is asserted here against the real component tree in a
// real DOM: a thead, formatted money in a cell, and a labelled totals row.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ReportTableView } from "./ReportTableView";
import type { ReportTable } from "@/lib/report-table";
import type { OrgMoney } from "@/lib/use-org-money";

/** The shape useOrgMoney() hands a screen, built here rather than mocking a hook. */
function orgMoney(currency: string | null): OrgMoney {
  const format = { currency, pending: false };
  return {
    currency,
    loaded: true,
    currencySet: currency !== null,
    showNotice: currency === null,
    format,
    money: () => "",
    signedMoney: () => "",
    unitSuffix: currency ? ` (${currency})` : "",
    notice: "Currency not set → Settings",
  };
}

const TABLE: ReportTable = {
  columns: [
    { key: "head", label: "Expense head", unit: "text", align: "left" },
    { key: "budget", label: "Budget", unit: "currency", align: "right" },
    { key: "actual", label: "Actual", unit: "currency", align: "right" },
    { key: "share", label: "Share", unit: "percent", align: "right" },
  ],
  rows: [
    { head: "Material", budget: null, actual: 6500, share: 65 },
    { head: "Labour", budget: null, actual: 3500, share: 35 },
  ],
  totals: { actual: 10_000 },
  currency: "AED",
};

afterEach(cleanup);

describe("ReportTableView (R67 E-32)", () => {
  test("renders a real table with a header row -- not a key-value card", () => {
    const { container } = render(<ReportTableView table={TABLE} orgMoney={orgMoney("AED")} />);
    expect(container.querySelector("table")).not.toBeNull();
    const heads = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(heads).toEqual(["Expense head", "Budget (AED)", "Actual (AED)", "Share"]);
    // The currency is named on the money columns and nowhere else.
    expect(heads.filter((h) => h?.includes("(AED)"))).toHaveLength(2);
  });

  test("money reads 'AED 6,500' -- never '6500' and never 'AED6500'", () => {
    const { container } = render(<ReportTableView table={TABLE} orgMoney={orgMoney("AED")} />);
    expect(container.textContent).toContain("AED 6,500");
    expect(container.textContent).not.toContain("AED6500");
    // The raw digits never appear on their own in a money cell.
    const cells = Array.from(container.querySelectorAll("tbody td")).map((td) => td.textContent);
    expect(cells).not.toContain("6500");
  });

  test("a final row contains 'Total', carrying only the totals the server sent", () => {
    const { getByTestId } = render(<ReportTableView table={TABLE} orgMoney={orgMoney("AED")} />);
    const row = getByTestId("report-total-row");
    expect(row.textContent).toContain("Total");
    expect(row.textContent).toContain("AED 10,000");
    // No total was sent for Budget or Share, so none is invented for them.
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells).toEqual(["Total", "", "AED 10,000.00", ""]);
  });

  test("no totals from the server means NO bold total row at all", () => {
    const { queryByTestId } = render(
      <ReportTableView table={{ ...TABLE, totals: undefined }} orgMoney={orgMoney("AED")} />
    );
    expect(queryByTestId("report-total-row")).toBeNull();
  });

  test("a missing figure is an en-dash, never a zero", () => {
    const { container } = render(<ReportTableView table={TABLE} orgMoney={orgMoney("AED")} />);
    const cells = Array.from(container.querySelectorAll("tbody td")).map((td) => td.textContent);
    // Budget is null on every row -- and a null must not read as AED 0.00.
    expect(cells).toContain("–");
    expect(cells).not.toContain("AED 0.00");
  });

  test("numbers are right-aligned in tabular figures and text is left", () => {
    const { container } = render(<ReportTableView table={TABLE} orgMoney={orgMoney("AED")} />);
    const heads = Array.from(container.querySelectorAll("thead th"));
    expect(heads[0].className).toContain("text-left");
    expect(heads[2].className).toContain("text-right");
    expect(heads[2].className).toContain("tabular-nums");
  });

  test("an org with no currency gets bare numbers and is told once, not per cell", () => {
    const { container } = render(
      <ReportTableView table={{ ...TABLE, currency: null }} orgMoney={orgMoney(null)} />
    );
    expect(container.textContent).not.toContain("AED");
    expect(container.textContent).toContain("Currency not set");
    expect(container.textContent?.match(/Currency not set/g)).toHaveLength(1);
  });

  test("an empty result says so, and still shows the table's own note", () => {
    const { container } = render(
      <ReportTableView table={{ ...TABLE, rows: [], note: "Totals sum root BOQ lines only." }} orgMoney={orgMoney("AED")} />
    );
    expect(container.textContent).toContain("No rows returned.");
    expect(container.textContent).toContain("Totals sum root BOQ lines only.");
    expect(container.querySelector("table")).toBeNull();
  });

  test("a table with nothing numeric in it is not offered a Chart tab", () => {
    const textOnly: ReportTable = {
      columns: [
        { key: "name", label: "Photo", unit: "text", align: "left" },
        { key: "createdAt", label: "Uploaded", unit: "date", align: "left" },
      ],
      rows: [{ name: "Level 3 slab.jpg", createdAt: "2026-08-25" }],
      currency: "AED",
    };
    const { container } = render(<ReportTableView table={textOnly} orgMoney={orgMoney("AED")} />);
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual(["Table", "Pivot"]);
  });
});
