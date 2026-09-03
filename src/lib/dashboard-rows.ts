// R67 E-01 (R-007). The rules behind the home dashboard's project rows.
//
// Sumeet's home is a project list: one row per project, a bar filled to the
// project's % complete, the contract and the spend on the right, and a status
// word. Two of those are decisions rather than renderings -- which projects
// need the reader's attention, and in what order the rows appear -- so they
// live here, pure and tested, instead of inside the JSX where nothing can
// assert them.
//
// WHY A STATUS WORD AND A GLYPH, never a colour alone: the row has to survive
// a greyscale print, a projector and a colour-blind reader. The word carries
// the state; the dot or tick is a second, redundant carrier of the same fact.

/** The per-project shape the org dashboard payload delivers (see compliance-tracker getOrgDashboard). */
export type DashboardProject = {
  id: string;
  name: string;
  revenue: number | null;
  expenses: number | null;
  taskCount: number;
  delayedTaskCount: number;
  /** Latest non-superseded BOQ's root-line total -- the contract value. null (not 0) = no BOQ yet. */
  value: number | null;
  earnedValue: number | null;
  percentByValue: number | null;
  /** R67 E-01: the activity-log average, deliberately a different number from percentByValue. */
  percentByActivity?: number | null;
  /** R67 E-01: null when redacted for a non-manager, false when there is no contract value to exceed. */
  spendOverValue?: boolean | null;
  permitsExpiring30d?: number;
  /**
   * R67 E-06 (R-108) / E-19 (R-180): this project's BOQ-derived budget -- the
   * same sum(computedBudget over root lines) the Cost Variance report totals.
   * null (never 0) = no BOQ, or redacted for this reader's role.
   */
  budget?: number | null;
  /**
   * R67 E-19 (R-180): the date of the most recent work-progress entry,
   * YYYY-MM-DD. null = nothing has EVER been recorded, which is a different
   * state from "recorded, but a long time ago"; undefined = an older payload
   * that does not carry the field at all. Neither is treated as stalled.
   */
  lastProgressAt?: string | null;
};

/**
 * R67 E-19 (R-180): how long earned value may stand still before the home
 * screen says so. Thirty days is the item's own number, and it is a constant
 * rather than a literal because the row, the summary sentence and the test all
 * have to mean the same month.
 */
export const STALLED_AFTER_DAYS = 30;

/**
 * Whole days between two YYYY-MM-DD days, or null if either is unreadable.
 * Both are parsed as UTC midnight, so the answer is a count of calendar days
 * and no time zone can turn 30 into 29 -- the same discipline
 * compliance-tracker's isoDay applies on the other side of the wire.
 */
export function daysBetween(from: string | null | undefined, to: string): number | null {
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export type ProjectRowStatus = {
  /** The word. Read aloud, this is the whole state. */
  label: "needs you" | "on track";
  needsYou: boolean;
  /** Why it needs you, in words -- shown beside the label so the row says what to do, not just that something is wrong. */
  reasons: string[];
};

/** The bar's own state. "No BOQ yet" is not 0 % -- a hatched bar says so. */
export type ProgressBarState =
  | { kind: "value"; percent: number }
  | { kind: "unknown"; label: "No BOQ yet" };

export function progressBarState(project: DashboardProject): ProgressBarState {
  // percentByValue is null exactly when there is no BOQ to weight against.
  // Rendering that as a 0 % bar tells a reader the job has not started, which
  // is a different and usually false statement.
  if (project.percentByValue === null || project.percentByValue === undefined) {
    return { kind: "unknown", label: "No BOQ yet" };
  }
  // Clamped so a data anomaly cannot draw a bar past its track.
  return { kind: "value", percent: Math.max(0, Math.min(100, project.percentByValue)) };
}

/**
 * "Needs you" is not a mood: it is a list of specific, actionable facts.
 * R67 E-01 shipped two of them -- money has passed the contract value, or a
 * permit expires inside 30 days. R67 E-19 (R-180) adds the two signals the
 * item names for the home screen's summary sentence: spend past the BOQ
 * budget, and earned value that has not moved in 30 days. Anything else is
 * "on track".
 *
 * ORDER IS THE READING ORDER: money first (it is the one that costs), then the
 * stall, then the permits, then the schedule -- so a row that trips several
 * signals still leads with the one a QS would act on.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO:
 *
 *  - It does not compare spend to REVENUE, which the item lists as an
 *    alternative. `revenue` here is VERIDIAN ERP sales invoices, and this
 *    screen's own footer says out loud that a construction org which does not
 *    invoice through VERIDIAN shows zero. "Spend over revenue" would therefore
 *    flag every project in such an org, permanently, off a number that means
 *    nothing here -- an alarm that is always on is not a signal.
 *  - It does not treat lastProgressAt === null as stalled. null means NOTHING
 *    has ever been recorded, and a project created last week has not stalled;
 *    with no start date on the payload there is no honest number of days to
 *    put in the sentence, so the row says "No activity logged yet" instead.
 *
 * spendOverValue === null means the figure was REDACTED for this reader's role
 * (the org dashboard route withholds it alongside revenue/expenses), not that
 * spend is fine. A redacted fact never contributes a reason in either
 * direction -- claiming "on track" off a number you were not allowed to see is
 * the same class of lie as claiming the opposite. The same rule governs the
 * budget comparison, whose two operands are redacted together.
 */
export function projectRowStatus(project: DashboardProject, today?: string): ProjectRowStatus {
  const reasons: string[] = [];
  if (project.spendOverValue === true) reasons.push("spend over contract value");
  if (
    project.expenses !== null && project.expenses !== undefined &&
    project.budget !== null && project.budget !== undefined &&
    project.expenses > project.budget
  ) {
    reasons.push("spend over budget");
  }
  const stalled = today ? daysBetween(project.lastProgressAt, today) : null;
  if (stalled !== null && stalled >= STALLED_AFTER_DAYS) {
    reasons.push(`no progress recorded for ${stalled} days`);
  }
  const permits = project.permitsExpiring30d ?? 0;
  if (permits > 0) reasons.push(permits === 1 ? "1 permit expiring in 30 days" : `${permits} permits expiring in 30 days`);
  if (project.delayedTaskCount > 0) {
    reasons.push(project.delayedTaskCount === 1 ? "1 delayed task" : `${project.delayedTaskCount} delayed tasks`);
  }
  return { label: reasons.length > 0 ? "needs you" : "on track", needsYou: reasons.length > 0, reasons };
}

/**
 * Needs-you first, then the rest. Within each group the order is the payload's
 * own, which is the projects table's order -- deliberately NOT re-sorted by
 * percentage or money, so a reader who learned where a project sits does not
 * have to find it again every time a number moves.
 *
 * Returns a new array; the caller's payload is never mutated.
 */
export function sortProjectRows<T extends DashboardProject>(projects: readonly T[], today?: string): T[] {
  return [...projects].sort(
    (a, b) => Number(projectRowStatus(b, today).needsYou) - Number(projectRowStatus(a, today).needsYou)
  );
}

/**
 * The one-line summary the home page prints above the rows. Named, because
 * "3 projects need attention" sends a reader hunting; "Cedar Heights Villa
 * needs you" does not.
 *
 * R67 E-19 (R-180): it now carries the leading REASON as well as the name. A
 * reader who is told which project needs them still has to open it to find out
 * why; being told "Cedar Heights Villa - Phase 1 needs you - spend over
 * budget." lets them decide whether it can wait, which is the whole point of a
 * summary sentence on a screen full of numbers.
 */
export function needsYouSummary(projects: readonly DashboardProject[], today?: string): string | null {
  const flagged = projects
    .map((p) => ({ project: p, status: projectRowStatus(p, today) }))
    .filter((f) => f.status.needsYou);
  if (flagged.length === 0) return null;
  const lead = flagged[0];
  const why = lead.status.reasons[0] ? ` — ${lead.status.reasons[0]}` : "";
  if (flagged.length === 1) return `${lead.project.name} needs you${why}.`;
  const others = flagged.length - 1;
  return `${lead.project.name} and ${others} other ${others === 1 ? "project" : "projects"} need you${why}.`;
}
