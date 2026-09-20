/// <reference types="bun-types" />
// PROJEXA-E2E-001 work order section 4 (2026-09-21). "A number on a dashboard
// must be provably derived, and clicking it should reach what produced it."
//
// ReportOutput.test.ts already covers cellValue's own formatting; this covers
// the actual DOM `rowLinks`/`fieldLinks` produce -- a real <a href> on the
// exact cell/field asked for, and no change at all to a caller (CopilotClient)
// that passes neither.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

const { ReportOutput } = await import("./ReportOutput");

afterEach(cleanup);

describe("ReportOutput rowLinks (array-of-objects branch)", () => {
  const ROWS = [{ rosterId: "wrk_1", name: "Ali Khan", trade: "Mason" }];

  test("a column with a resolver that returns an href renders as a real link", () => {
    const { container } = render(
      <ReportOutput data={ROWS} rowLinks={{ name: (row) => `/labour/${row.rosterId}` }} />
    );
    const link = container.querySelector('[data-testid="report-table"] a, table a');
    // jsdom/happy-dom table cells: query any anchor inside the rendered table.
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/labour/wrk_1");
    expect(anchor?.textContent).toBe("Ali Khan");
    void link;
  });

  test("a resolver returning null leaves the cell as plain text, not a broken link", () => {
    const { container } = render(
      <ReportOutput data={[{ rosterId: null, name: "No Roster Link" }]} rowLinks={{ name: () => null }} />
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("No Roster Link");
  });

  test("no rowLinks prop at all (e.g. CopilotClient's arbitrary tool results) renders exactly as before -- no links anywhere", () => {
    const { container } = render(<ReportOutput data={ROWS} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("Ali Khan");
  });

  test("a column with no resolver for it is untouched even when other columns link", () => {
    const { container } = render(
      <ReportOutput data={ROWS} rowLinks={{ name: (row) => `/labour/${row.rosterId}` }} />
    );
    // "trade" has no resolver -- its cell text is present, and only ONE link exists on the page (the name column).
    expect(container.textContent).toContain("Mason");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("ReportOutput fieldLinks (scalar key/value grid branch)", () => {
  test("a scalar field with a resolver renders as a link, reading the WHOLE object at that level", () => {
    const { container } = render(
      <ReportOutput
        data={{ boq: { id: "boq_5", version: 3 }, totalValue: 100 }}
        fieldLinks={{ version: (obj) => `/scope/${obj.id}` }}
      />
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/scope/boq_5");
  });

  test("totalValue (no resolver registered) stays plain text beside the linked version field", () => {
    const { container } = render(
      <ReportOutput
        data={{ boq: { id: "boq_5", version: 3 }, totalValue: 100 }}
        fieldLinks={{ version: (obj) => `/scope/${obj.id}` }}
      />
    );
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.textContent).toContain("100");
  });
});
