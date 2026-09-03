// R67 D-31 (R-090): the display rules for the trade-wise attendance panel.
//
// Pure on purpose. The panel on /labour, the CSV it exports and the public
// share page all render the SAME summary, and the one thing that must not
// happen is three different opinions about what an empty cell means or which
// days "this week" covers. Every number itself is computed in VERIDIAN
// (construction-reports-service.ts's buildAttendanceSummaryRows /
// totalAttendanceSummary / reconcileAttendanceSummary); nothing is re-derived
// here.

export type AttendanceSummaryRow = {
  trade: string;
  present: number;
  halfDay: number;
  absent: number;
  workerDays: number;
  cost: number;
};

export type AttendanceSummaryTotals = Omit<AttendanceSummaryRow, "trade">;

export type AttendanceSummary = {
  projectId: string;
  from: string | null;
  to: string | null;
  rows: AttendanceSummaryRow[];
  totals: AttendanceSummaryTotals;
  headcount: number;
  reconciliation: {
    ties: boolean;
    rowCountFromStatuses: number;
    rowCountFromTrades: number;
    costFromStatuses: number;
    costFromTrades: number;
  };
};

export const UNSPECIFIED_TRADE_LABEL = "Unspecified";

/**
 * The banner shown when the two aggregates behind this summary disagree. It
 * blocks Export rather than letting a figure nobody can reproduce leave the
 * building as a CSV or a PDF.
 */
export const RECONCILIATION_BANNER =
  "The per-trade rows do not add up to the totals for this window. Export is disabled until this is resolved.";
export const RECONCILIATION_EXPORT_REASON = "Rows do not sum to the totals";

/** A roster row with no trade recorded is NAMED, never blank and never dropped. */
export function tradeLabel(trade: string | null | undefined): string {
  const value = trade?.trim();
  return value ? value : UNSPECIFIED_TRADE_LABEL;
}

/**
 * "0" for a real measured zero, "–" for no figure at all. These are different
 * facts -- "nobody was absent" and "we do not know" -- and a table that renders
 * them identically is lying about one of them.
 */
export function countCell(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/** As countCell, but money: a null cost is "–", a zero cost is a real "0.00". */
export function moneyCell(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${currency}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * "19 people on site — Electrician 6 · Mason 12". Bodies on site means present
 * plus half day; an absence is not a body. A window with nobody says so in
 * words rather than showing a bare "0".
 */
export function headlineSentence(headcount: number, rows: AttendanceSummaryRow[]): string {
  if (headcount === 0) return "Nobody on site in this window";
  const parts = rows
    .filter((r) => r.present + r.halfDay > 0)
    .map((r) => `${r.trade} ${countCell(r.present + r.halfDay)}`)
    .join(" · ");
  const head = `${countCell(headcount)} ${headcount === 1 ? "person" : "people"} on site`;
  return parts ? `${head} — ${parts}` : head;
}

export type RangePreset = "today" | "week" | "month";

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
};

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The date window each preset covers, anchored on a given day (the panel
 * anchors on the date control, which defaults to today -- so the panel is
 * populated by pressing nothing).
 *
 * "This week" runs Monday to Sunday. That is a choice, not a universal: it
 * matches the ISO week this codebase already uses for weeklyProjectReport's
 * weekStart, so a week on this panel and a week in that report are the same
 * seven days.
 */
export function presetRange(preset: RangePreset, anchorIso: string): { from: string; to: string } {
  const anchor = new Date(`${anchorIso}T00:00:00.000Z`);
  if (preset === "today") return { from: anchorIso, to: anchorIso };
  if (preset === "week") {
    const day = anchor.getUTCDay(); // 0 = Sunday
    const daysSinceMonday = (day + 6) % 7;
    const monday = new Date(anchor.getTime() - daysSinceMonday * 86400000);
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    return { from: iso(monday), to: iso(sunday) };
  }
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const last = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  return { from: iso(first), to: iso(last) };
}

export const CSV_HEADER = ["Trade", "Present", "Half day", "Absent", "Worker-days", "Cost"] as const;

/**
 * The CSV is built from the rows ON SCREEN -- same values, same order, same
 * grand total. Built here so the export cannot silently diverge from what the
 * user was looking at when they clicked it.
 */
export function summaryToCsv(rows: AttendanceSummaryRow[], totals: AttendanceSummaryTotals): string {
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push([row.trade, row.present, row.halfDay, row.absent, row.workerDays, row.cost].map(escape).join(","));
  }
  lines.push(["Total", totals.present, totals.halfDay, totals.absent, totals.workerDays, totals.cost].map(escape).join(","));
  return lines.join("\n");
}
