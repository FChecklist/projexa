/// <reference types="bun-types" />
// R62 B7 regression test for the ReportOutput.tsx half of
// R55_REPORTS_RUN_REPORT_RAW_DUMP_01 (fixed in projexa#187, squash SHA
// 4be56b602f). See ReportsClient.test.tsx for the end-to-end half (running
// the real project-status report through the real page).
//
// Before PR #187, ReportOutput accepted only `fieldLabels` (overriding a
// field's LABEL); the rendered VALUE always went through the generic
// `cellValue()` formatter with no way for a caller to override it. That is
// why contractValue rendered as a bare "2750" with no currency token, and
// more generally why callers had no way to make any scalar field
// self-explanatory beyond renaming its label. The fix added a sibling
// `fieldFormatters` prop, threaded through the same object/array recursion
// `fieldLabels` already used.
//
// This suite exercises ReportOutput directly and in isolation (no fetch, no
// ReportsClient) so a regression here is caught even if a future caller's
// wiring changes.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

const { ReportOutput } = await import("./ReportOutput");

afterEach(cleanup);

describe("ReportOutput fieldFormatters (R55_REPORTS_RUN_REPORT_RAW_DUMP_01 / R55_REPORTS_CONTRACTVALUE_NO_AED_01)", () => {
  test("a field with a formatter renders the FORMATTED value, not cellValue()'s default", () => {
    const { getByText, queryByText } = render(
      <ReportOutput
        data={{ contractValue: 2750 }}
        fieldLabels={{ contractValue: "Contract Value" }}
        fieldFormatters={{ contractValue: (v) => `AED ${v}` }}
      />
    );
    expect(getByText("Contract Value")).toBeDefined();
    expect(getByText("AED 2750")).toBeDefined();
    // The pre-fix rendering: the bare cellValue() output with no formatter
    // applied at all.
    expect(queryByText("2750")).toBeNull();
  });

  test("a field with no formatter keeps today's exact cellValue() display (no behavioural change for the other 16 reports)", () => {
    const { getByText } = render(<ReportOutput data={{ taskCount: 0 }} fieldLabels={{ taskCount: "Tasks" }} />);
    expect(getByText("Tasks")).toBeDefined();
    expect(getByText("0")).toBeDefined();
  });

  test("fieldFormatters is threaded through nested-object recursion, not just the top level", () => {
    const { getByText } = render(
      <ReportOutput
        data={{ summary: { contractValue: 2750 } }}
        fieldLabels={{ summary: "Summary", contractValue: "Contract Value" }}
        fieldFormatters={{ contractValue: (v) => `AED ${v}` }}
      />
    );
    // Before the fix, the recursive <ReportOutput> call for the nested
    // object did not forward fieldFormatters at all -- only fieldLabels --
    // so a nested formatted field would silently fall back to cellValue().
    expect(getByText("AED 2750")).toBeDefined();
  });

  test("a null/undefined value under a formatter still renders the em-dash placeholder, not a crash or blank", () => {
    const { getByText } = render(
      <ReportOutput
        data={{ contractValue: null }}
        fieldLabels={{ contractValue: "Contract Value" }}
        fieldFormatters={{ contractValue: (v) => (v === null || v === undefined ? "—" : `AED ${v}`) }}
      />
    );
    expect(getByText("—")).toBeDefined();
  });
});
