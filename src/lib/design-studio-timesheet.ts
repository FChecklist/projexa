// R67 WS-H (items H-01/H-02/H-03/H-04, decision D-07). Every string, label,
// total and validation rule the Design Studio timesheet shows, as PURE
// functions with no React and no fetch, so the sentences the audit quotes
// verbatim are pinned by unit tests instead of by a screenshot.
//
// This exists because the item specifies EXACT user-facing wording -- "Total
// today: 7.50 h", "Submit today (4 rows, 7.50 h)", "No hours logged for 2 Sep
// 2026. Add a row below.", "Hours must be more than 0" -- and wording that
// only lives inside JSX drifts the first time somebody reformats a component.

import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";

/**
 * The fixed Category list item H-03 specifies, in its order. Deliberately a
 * constant in PROJEXA rather than a lookup: VERIDIAN stores
 * pms_time_entries.activity_type as free text ("admin-configurable, not a
 * fixed enum" -- its own schema comment), so there is no server list to read,
 * and inventing an endpoint to serve seven hardcoded words would be worse
 * than the constant.
 */
export const DESIGN_STUDIO_CATEGORIES = [
  "Concept",
  "Design development",
  "Drawings",
  "Site visit",
  "Client meeting",
  "Revisions",
  "Admin",
] as const;

export type TimesheetApprovalStatus = "draft" | "submitted" | "approved" | "rejected";

/**
 * The row-level chip vocabulary of D-07: Draft / Submitted / Approved / Sent
 * back. `tone` picks the kit StatusBadge's glyph, so the state is never
 * carried by colour alone (that component owns the glyph+colour pairing).
 *
 * "Sent back" rather than "Rejected" is deliberate and is D-07's own word:
 * on the designer's own grid the entry has come BACK to them to fix, which
 * is the action, whereas the object page header states the decision that was
 * made -- see headerStatusLabel below.
 */
const ROW_STATUS: Record<TimesheetApprovalStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "waiting" },
  approved: { label: "Approved", tone: "done" },
  rejected: { label: "Sent back", tone: "needs-you" },
};

const HEADER_STATUS_LABEL: Record<TimesheetApprovalStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * The states a designer can still act on themselves: a draft they have not
 * sent yet, and one their manager sent back. Mirrors VERIDIAN's own
 * RESUBMITTABLE_STATUSES in pms-time-service.ts -- an APPROVED entry is
 * deliberately not in the set, because it has already been counted as cost.
 */
export const RESUBMITTABLE_STATUSES = ["draft", "rejected"] as const;

export function isResubmittable(status: string): boolean {
  return (RESUBMITTABLE_STATUSES as readonly string[]).includes(status);
}

export function rowStatus(status: string): { label: string; tone: StatusTone } {
  return ROW_STATUS[status as TimesheetApprovalStatus] ?? { label: status, tone: "neutral" };
}

export function headerStatus(status: string): { label: string; tone: StatusTone } {
  const known = HEADER_STATUS_LABEL[status as TimesheetApprovalStatus];
  return { label: known ?? status, tone: rowStatus(status).tone };
}

/** "7.50" -- always two decimals, so a 0.25-step grid never mixes 7.5 with 7.50. */
export function formatHours(hours: number | string): string {
  const n = Number(hours);
  return Number.isFinite(n) ? n.toFixed(2) : String(hours);
}

export function totalHours(entries: Array<{ hours: number | string }>): number {
  return entries.reduce((sum, e) => sum + (Number.isFinite(Number(e.hours)) ? Number(e.hours) : 0), 0);
}

// Pinned month names rather than toLocaleDateString, for the same reason
// src/lib/format-date.ts pins its locale and time zone: a date rendered on
// the server and again on the client must be the same string, and an ISO
// date has no time zone to shift it by if it is never turned into a Date.
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-09-02" -> "2 Sep 2026". Returns the input unchanged if it is not an ISO date. */
export function formatDayLabel(spentOn: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(spentOn);
  if (!m) return spentOn;
  const month = SHORT_MONTHS[Number(m[2]) - 1];
  if (!month) return spentOn;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** Today as an ISO date, in the same UTC frame VERIDIAN stores spent_on in. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** "Total today: 7.50 h" on today, "Total for 1 Sep 2026: 7.50 h" on any other day. */
export function dayTotalLabel(hours: number, spentOn: string, today: string): string {
  return spentOn === today
    ? `Total today: ${formatHours(hours)} h`
    : `Total for ${formatDayLabel(spentOn)}: ${formatHours(hours)} h`;
}

/** "Submit today (4 rows, 7.50 h)" / "Submit day (4 rows, 7.50 h)". */
export function submitDayLabel(rows: number, hours: number, spentOn: string, today: string): string {
  const verb = spentOn === today ? "Submit today" : "Submit day";
  return `${verb} (${rows} row${rows === 1 ? "" : "s"}, ${formatHours(hours)} h)`;
}

/** "No hours logged for 2 Sep 2026. Add a row below." */
export function emptyDayMessage(spentOn: string): string {
  return `No hours logged for ${formatDayLabel(spentOn)}. Add a row below.`;
}

export const HOURS_TOO_SMALL = "Hours must be more than 0";
export const HOURS_OVER_DAY = "Total for the day would exceed 24 hours";
export const HOURS_MAX = 24;

/**
 * Per-field validation for the Hours cell. Returns the message to show under
 * the field, or null. `otherHoursToday` lets the caller pass the rest of the
 * day so the 24-hour rule is about the DAY, not about one row.
 */
export function validateHours(raw: string, otherHoursToday = 0): string | null {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n <= 0) return HOURS_TOO_SMALL;
  if (n > HOURS_MAX) return HOURS_OVER_DAY;
  if (otherHoursToday + n > HOURS_MAX) return HOURS_OVER_DAY;
  return null;
}

/**
 * The create screen's primary, disabled-with-reason and naming what is
 * missing: "Save (2 required: Task, Hours)" -- the /labour/new pattern
 * correction C-11 names as this product's good one.
 */
export function requiredReason(missing: string[]): string | undefined {
  if (missing.length === 0) return undefined;
  return `${missing.length} required: ${missing.join(", ")}`;
}

export function saveLabel(missing: string[]): string {
  const reason = requiredReason(missing);
  return reason ? `Save (${reason})` : "Save";
}

export type DeletableEntry = {
  ref: string;
  hours: number | string;
  spentOn: string;
  approvalStatus: string;
  issue?: { number: number | null; title: string } | null;
};

/**
 * The Delete confirmation, with the blast radius spelled out rather than
 * "Are you sure?":
 *
 *   "Delete entry TS-000123 - 3.00 h on #12 Joinery shop drawings, 2 Sep
 *    2026? It is Submitted; your manager will no longer see it."
 *
 * The second sentence changes with the state, because the consequence does:
 * a draft nobody has seen is not the same deletion as an approved entry that
 * has already been counted as cost.
 */
export function deleteConfirmation(entry: DeletableEntry): string {
  const task = entry.issue
    ? entry.issue.number !== null ? `#${entry.issue.number} ${entry.issue.title}` : entry.issue.title
    : "this task";
  const head = `Delete entry ${entry.ref} - ${formatHours(entry.hours)} h on ${task}, ${formatDayLabel(entry.spentOn)}?`;
  const status = headerStatus(entry.approvalStatus).label;
  switch (entry.approvalStatus) {
    case "submitted":
      return `${head} It is ${status}; your manager will no longer see it.`;
    case "approved":
      return `${head} It is ${status}; the hours will stop counting towards this project's cost.`;
    case "rejected":
      return `${head} It is ${status}; the reason your manager gave goes with it.`;
    default:
      return `${head} It is ${status}; nobody else has seen it yet.`;
  }
}

/** "Timesheet entry TS-000123 saved" -- the create route's landing receipt. */
export function savedMessage(ref: string): string {
  return `Timesheet entry ${ref} saved`;
}

/**
 * Budget | Actual | Variance | Variance % for the Cost analysis tab.
 * Variance is budget - actual (positive = under budget), and the percentage
 * is null rather than 0 or Infinity when there is no budget to be a
 * percentage OF -- an unbudgeted line is not "0% over".
 */
export function variance(budget: number, actual: number): { variance: number; variancePercent: number | null } {
  const v = budget - actual;
  return { variance: v, variancePercent: budget === 0 ? null : (v / budget) * 100 };
}

export function formatVariancePercent(percent: number | null): string {
  if (percent === null) return "-";
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

/** The shape the grid, the object page and the review queue all read. */
export type TimesheetEntryLike = {
  id: string;
  spentOn: string;
  hours: number | string;
  approvalStatus: string;
  loggedBy?: { id: string; name: string } | null;
};

export type DesignerDayGroup<T extends TimesheetEntryLike> = {
  key: string;
  designerId: string;
  designerName: string;
  spentOn: string;
  entries: T[];
};

/**
 * The review queue's unit of decision: one designer's one day. A manager
 * approves a DAY, not thirteen rows, which is why the grouping happens
 * before anything is rendered rather than inside the JSX.
 *
 * Only SUBMITTED entries are grouped -- a draft is not the manager's to see
 * and an already-decided one is not theirs to decide again.
 */
export function groupSubmittedByDesignerDay<T extends TimesheetEntryLike>(entries: T[]): DesignerDayGroup<T>[] {
  const groups = new Map<string, DesignerDayGroup<T>>();
  for (const entry of entries) {
    if (entry.approvalStatus !== "submitted") continue;
    const designerId = entry.loggedBy?.id ?? "unknown";
    const key = `${designerId}|${entry.spentOn}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, designerId, designerName: entry.loggedBy?.name ?? "Unknown designer", spentOn: entry.spentOn, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  // Newest day first, then designers alphabetically inside a day -- a stable
  // order, so a re-render after one approval does not reshuffle the queue
  // under the manager's cursor.
  return [...groups.values()].sort((a, b) => (a.spentOn === b.spentOn ? a.designerName.localeCompare(b.designerName) : b.spentOn.localeCompare(a.spentOn)));
}

export type CostRow = { label: string; budget: number; actual: number };
export type CostGrouping = "category" | "designer" | "project";
export type DesignerTimesheetReportShape = {
  projectScoped?: { byCategory?: Array<{ category?: string; label?: string; budget: number; actual: number }> };
  orgWide?: {
    byDesigner?: Array<{ userName?: string; userId?: string; budget: number; actual: number }>;
    byProject?: Array<{ projectName?: string; projectId?: string; budget: number; actual: number }>;
  };
};

/**
 * Pulls the rows for one Cost analysis grouping out of VERIDIAN's existing
 * designerTimesheetReport WITHOUT re-deriving any figure -- the budget and
 * the actual are the report's own numbers, only relabelled. A bucket whose
 * name could not be resolved is named honestly rather than dropped: a
 * dropped row is money that stops adding up.
 */
export function costRowsFor(report: DesignerTimesheetReportShape | null, grouping: CostGrouping): CostRow[] {
  if (!report) return [];
  if (grouping === "category") {
    return (report.projectScoped?.byCategory ?? []).map((r) => ({ label: r.category ?? r.label ?? "Uncategorized", budget: r.budget, actual: r.actual }));
  }
  if (grouping === "designer") {
    return (report.orgWide?.byDesigner ?? []).map((r) => ({ label: r.userName ?? r.userId ?? "Unknown designer", budget: r.budget, actual: r.actual }));
  }
  return (report.orgWide?.byProject ?? []).map((r) => ({ label: r.projectName ?? r.projectId ?? "Unknown project", budget: r.budget, actual: r.actual }));
}
