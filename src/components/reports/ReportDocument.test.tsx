/// <reference types="bun-types" />
// R67 E-12 (R-136). The document, rendered: that the columns come from the
// schema and not from the payload's keys, that the arithmetic is visibly true
// (and visibly untrue when it is), that a code is a way to reach its line, and
// that a chart is a sorted bar rather than a pie.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

const { ReportDocument } = await import("./ReportDocument");
const { reportSchema } = await import("@/lib/report-schema");

afterEach(cleanup);

const SCHEMA = reportSchema("project-status")!;
const AED = { currency: "AED", pending: false };

const PAYLOAD = {
  projectName: "Cedar Heights Villa - Phase 1",
  totalBudget: 6240,
  lines: [
    { lineItemId: "l-1", boqId: "b-1", category: "Civil", code: "1.1", description: "Excavation", budget: 4320, vendorName: "Alpha Contracting", vendorAmount: 4500 },
    { lineItemId: "l-2", boqId: "b-1", category: "Paint", code: "2.1", description: "Emulsion", budget: 1920, vendorName: null, vendorAmount: null },
  ],
};

function renderDocument(payload: unknown, onTieMessage?: (m: string | null) => void) {
  return render(
    <ReportDocument schema={SCHEMA} payload={payload} format={AED} emptyMessage="No rows recorded" onTieMessage={onTieMessage} />
  );
}

describe("the document renders its SCHEMA, not the payload's keys (R67 E-12)", () => {
  test("the header is the schema's labels, with the currency in the money headers once", () => {
    const { container } = renderDocument(PAYLOAD);
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Category", "Code", "Description", "Budget (AED)", "Vendor", "Vendor amount (AED)"]);
  });

  test("money carries the code and two decimals; an absent figure is the en dash and never a zero", () => {
    const { container } = renderDocument(PAYLOAD);
    const text = container.textContent ?? "";
    expect(text).toContain("AED 4,320.00");
    expect(text).toContain("AED 4,500.00");
    // The unlet line's vendor and vendor amount: absent, not zero.
    expect(text).not.toContain("AED 0.00");
    expect(text).toContain("–");
  });

  test("every code is a link to the BOQ line it names, anchored on that line", () => {
    const { container } = renderDocument(PAYLOAD);
    const hrefs = [...container.querySelectorAll("tbody a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/scope/b-1#line-l-1", "/scope/b-1#line-l-2"]);
  });

  test("rows band by category with a subtotal each, and a grand total that ties to them", () => {
    const { container, getByTestId } = renderDocument(PAYLOAD);
    expect(container.textContent).toContain("Civil subtotal");
    expect(container.textContent).toContain("Paint subtotal");
    expect(getByTestId("report-grand-total").textContent).toContain("AED 6,240.00");
  });
});

describe("arithmetic identities are visibly true (R67 E-12)", () => {
  test("ACCEPTANCE: rows that do not add up to the stated total raise the banner, in the reader's units", () => {
    const { getByTestId } = renderDocument({ ...PAYLOAD, totalBudget: 6120 });
    expect(getByTestId("report-totals-banner").textContent).toContain("Totals do not tie (difference AED 120.00)");
  });

  test("...and the reason is reported UP, so Export can be disabled with that exact sentence", () => {
    const seen: (string | null)[] = [];
    renderDocument({ ...PAYLOAD, totalBudget: 6120 }, (m) => seen.push(m));
    expect(seen.at(-1)).toBe("Totals do not tie (difference AED 120.00)");
  });

  test("when they tie there is no banner and nothing is disabled", () => {
    const seen: (string | null)[] = [];
    const { queryByTestId } = renderDocument(PAYLOAD, (m) => seen.push(m));
    expect(queryByTestId("report-totals-banner")).toBeNull();
    expect(seen.at(-1)).toBeNull();
  });
});

describe("the empty state and the chart (R67 E-12)", () => {
  test("a report that ran and returned no rows says so, rather than drawing an empty table", () => {
    const { getByTestId, queryByRole } = renderDocument({ lines: [] });
    expect(getByTestId("report-empty").textContent).toBe("No rows recorded");
    expect(queryByRole("table")).toBeNull();
  });

  test("the chart is opt-in, and when opened it is a SORTED horizontal bar -- never a pie", () => {
    const { getByTestId, queryByTestId, container } = renderDocument(PAYLOAD);
    expect(queryByTestId("report-chart")).toBeNull();
    fireEvent.click(getByTestId("report-chart-toggle"));
    const labels = [...getByTestId("report-chart").querySelectorAll("li > span:first-child")].map((s) => s.textContent);
    // Biggest first: Civil 4,320 before Paint 1,920.
    expect(labels).toEqual(["Civil", "Paint"]);
    // Not a pie, and not a canvas nobody can read a number off: the figures are
    // printed beside the bars.
    expect(container.querySelector("canvas")).toBeNull();
    expect(getByTestId("report-chart").textContent).toContain("AED 4,320.00");
  });
});
