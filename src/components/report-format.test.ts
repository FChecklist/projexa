/// <reference types="bun-types" />
// R67 E-13 (R-131 / R-138). The Project Status card's formatting rules, tested
// without a browser: one shape per field, absent never rendered as zero, and no
// label that is really a JSON key.
import { describe, expect, test } from "bun:test";
import {
  LEDGER_BUDGET_LABEL,
  NOT_RECORDED_TITLE,
  PERCENT_DIVERGENCE_NOTE,
  PROJECT_STATUS_FIELDS,
  REPORT_FIELD_GROUPS,
  fieldsInGroup,
  reportValueFormatter,
} from "./report-format";

// Bound to the org's currency, exactly as the card binds it -- nothing here
// guesses a code (R-260), and a call site cannot forget to supply one.
const formatReportValue = reportValueFormatter({ currency: "AED", pending: false });

describe("one shape per field (R67 E-13)", () => {
  test("ACCEPTANCE: an absent figure is the en dash, and is never coerced to zero", () => {
    expect(formatReportValue("budget", null)).toBe("–");
    expect(formatReportValue("budget", undefined)).toBe("–");
    // ...and a real zero is still a real zero, in the other direction.
    expect(formatReportValue("budget", 0)).toBe("AED 0");
  });

  test("ACCEPTANCE: money carries the org's code and grouping", () => {
    expect(formatReportValue("revenue", 475000)).toBe("AED 475,000");
  });

  test("the three formats that used to appear on ONE card now all come out the same shape", () => {
    // Before: "475000", "0" and "AED 6500", side by side.
    expect(formatReportValue("contractValue", 475000)).toBe("AED 475,000");
    expect(formatReportValue("expenses", 0)).toBe("AED 0");
    expect(formatReportValue("earnedValue", 6500)).toBe("AED 6,500");
  });

  test("real cents are kept -- rounding money away would be worse than a ragged column", () => {
    expect(formatReportValue("budget", 6500.5)).toBe("AED 6,500.50");
    expect(formatReportValue("budget", 2193.75)).toBe("AED 2,193.75");
  });

  test("both percentages take one decimal, so the two can be compared at a glance", () => {
    expect(formatReportValue("percentByValue", 62)).toBe("62.0%");
    expect(formatReportValue("progressPercent", 41.25)).toBe("41.3%");
    expect(formatReportValue("percentByValue", null)).toBe("–");
  });

  test("a count is not money -- it takes no currency token", () => {
    expect(formatReportValue("taskCount", 12)).toBe("12");
    expect(formatReportValue("photoCount", 1400)).toBe("1,400");
  });

  test("an org with NO currency gets the warning glyph, never a guessed code", () => {
    const noCurrency = reportValueFormatter({ currency: null, pending: false });
    expect(noCurrency("revenue", 475000)).not.toContain("AED");
    expect(noCurrency("revenue", 475000)).toContain("475,000");
  });
});

describe("the card's fields, their order and their bands (R67 E-13)", () => {
  test("no label contains a camelCase key -- that is the defect, not a naming style", () => {
    for (const field of PROJECT_STATUS_FIELDS) {
      expect(field.label).not.toMatch(/[a-z][A-Z]/);
      expect(field.label.length).toBeGreaterThan(2);
    }
    expect(LEDGER_BUDGET_LABEL).not.toMatch(/[a-z][A-Z]/);
  });

  test("the raw project cuid is NOT a field on the card -- it is an address, and it stays in the URL", () => {
    const keys = PROJECT_STATUS_FIELDS.map((f) => f.key);
    expect(keys).not.toContain("projectId");
    expect(keys).not.toContain("projectName");
  });

  test("Money comes first, in R-131's own order", () => {
    expect(fieldsInGroup("Money").map((f) => f.label)).toEqual([
      "Contract Value", "Project Value", "Budget", "Revenue", "Expenses", "Earned Value",
    ]);
    expect([...REPORT_FIELD_GROUPS]).toEqual(["Money", "Progress", "Activity"]);
  });

  test("the two contradicting progress figures are RELABELLED and carry the reason they differ", () => {
    const progress = fieldsInGroup("Progress");
    expect(progress.map((f) => f.label)).toEqual(["% complete (by BOQ value)", "% complete (by activity log)"]);
    for (const field of progress) expect(field.note).toBe(PERCENT_DIVERGENCE_NOTE);
    expect(PERCENT_DIVERGENCE_NOTE).toBe("differs because activity logs are not weighted by BOQ value");
  });

  test("the en dash carries an explanation for whoever hovers it", () => {
    expect(NOT_RECORDED_TITLE).toBe("not recorded");
  });
});
