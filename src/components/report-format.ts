// R67 E-13 (R-131 / R-138). The Project Status card, described.
//
// The card used to be ReportOutput's generic scalar grid over whatever
// getProjectDashboard returned, in whatever order Object.entries gave it. The
// three defects that produced, all in one screenshot:
//
//   1. THREE money formats at once -- "475000", "0" and "AED 6500" -- because
//      each figure was String(v) and only contractValue had a formatter;
//   2. two percentages that disagree, labelled "percentByValue" and
//      "progressPercent", with the explanation living in a CODE COMMENT that
//      acknowledged the confusion instead of a sentence the reader can see;
//   3. the project's raw cuid printed as a field, which is a database key, not
//      a fact about a construction project.
//
// So the card's fields, their order, their bands and their labels live here as
// data. No label may contain a camelCase key -- that is the defect, not a
// naming style.

import { formatMoney, type MoneyFormat } from "@/lib/format-money";
import { EMPTY_VALUE, formatNumber } from "@/lib/format-number";

export type ReportFieldType = "money" | "percent" | "count" | "text";

export type ReportField = {
  key: string;
  label: string;
  type: ReportFieldType;
  /** The band it belongs to. */
  group: "Money" | "Progress" | "Activity";
  /** A sentence under the value, where the figure needs one to be read correctly. */
  note?: string;
};

/**
 * R-138: the two percentages measure different things and always will --
 * percentByValue is weighted against the current BOQ, progressPercent is a flat
 * average of each activity's latest logged percent with no BOQ scoping. The
 * reader is told WHY they differ, once, under them.
 */
export const PERCENT_DIVERGENCE_NOTE = "differs because activity logs are not weighted by BOQ value";

/** The title on an en dash, so hovering an absent figure explains itself. */
export const NOT_RECORDED_TITLE = "not recorded";

/** The bands, in the order R-131 gives them. */
export const REPORT_FIELD_GROUPS = ["Money", "Progress", "Activity"] as const;

/**
 * Project Status, in an explicit order. `projectId` is deliberately absent: the
 * cuid stays in the share URL, where it is an address, and is not a field on a
 * card a QS reads. `projectName` is the card's heading, not a row in it.
 */
export const PROJECT_STATUS_FIELDS: ReportField[] = [
  { key: "contractValue", label: "Contract Value", type: "money", group: "Money" },
  { key: "projectValue", label: "Project Value", type: "money", group: "Money" },
  { key: "budget", label: "Budget", type: "money", group: "Money" },
  { key: "revenue", label: "Revenue", type: "money", group: "Money" },
  { key: "expenses", label: "Expenses", type: "money", group: "Money" },
  { key: "earnedValue", label: "Earned Value", type: "money", group: "Money" },
  { key: "percentByValue", label: "% complete (by BOQ value)", type: "percent", group: "Progress", note: PERCENT_DIVERGENCE_NOTE },
  { key: "progressPercent", label: "% complete (by activity log)", type: "percent", group: "Progress", note: PERCENT_DIVERGENCE_NOTE },
  { key: "taskCount", label: "Tasks", type: "count", group: "Activity" },
  { key: "delayedTaskCount", label: "Delayed Tasks", type: "count", group: "Activity" },
  { key: "photoCount", label: "Site Photos", type: "count", group: "Activity" },
];

/**
 * The ERP's annual ledger budget, kept beside the BOQ budget under a name that
 * says which one it is (item E-06 separated the two figures; this is where the
 * card says so). Rendered as the Budget field's own subtitle rather than as a
 * second "Budget" row that would restart the confusion E-06 closed.
 */
export const LEDGER_BUDGET_LABEL = "Annual ledger budget";

export function reportFieldType(key: string): ReportFieldType {
  return PROJECT_STATUS_FIELDS.find((f) => f.key === key)?.type ?? "text";
}

/**
 * ONE value, formatted by its FIELD -- so "budget" and "revenue" can never come
 * out in two different shapes on one card, which is R-131's whole complaint.
 *
 * Money keeps its decimals only when it HAS any: 475000 prints "AED 475,000"
 * (cents on a contract value are noise), 6500.5 prints "AED 6,500.50" (rounding
 * real money away is worse than a ragged column). Absent is the en dash, never
 * 0 -- "not recorded" and "zero" are different facts, in both directions.
 */
export function formatReportValue(field: string, value: unknown, format: MoneyFormat = {}): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  const type = reportFieldType(field);

  if (type === "money") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return EMPTY_VALUE;
    return formatMoney(n, { ...format, fractionDigits: Number.isInteger(n) ? 0 : 2 });
  }

  if (type === "percent") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return EMPTY_VALUE;
    // One decimal down both percentage rows, so the two can be compared at a
    // glance -- which is the point of printing them next to each other.
    // R67 D-61 (second-merge fix): formatNumber(), not a direct toFixed().
    return `${formatNumber(n, { fractionDigits: 1 })}%`;
  }

  if (type === "count") {
    const n = typeof value === "number" ? value : Number(value);
    // R67 D-61 (second-merge fix): formatNumber(), not a direct toLocaleString().
    return Number.isFinite(n) ? formatNumber(n) : EMPTY_VALUE;
  }

  return String(value);
}

/**
 * The formatter BOUND to the org's currency, so a call site is
 * formatReportValue(field, value) and cannot forget to pass one -- and cannot
 * pass a currency the org does not use. R-260's rule stands: nothing here
 * invents a currency code; an org with none gets the warning glyph from
 * formatMoney and the footer notice the screen already renders.
 */
export function reportValueFormatter(format: MoneyFormat): (field: string, value: unknown) => string {
  return (field, value) => formatReportValue(field, value, format);
}

/** The fields of one band, in order. */
export function fieldsInGroup(group: (typeof REPORT_FIELD_GROUPS)[number]): ReportField[] {
  return PROJECT_STATUS_FIELDS.filter((f) => f.group === group);
}
