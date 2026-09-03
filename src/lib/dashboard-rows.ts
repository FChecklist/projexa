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
};

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
 * "Needs you" is not a mood: it is two specific, actionable facts -- money has
 * passed the contract value, or a permit expires inside 30 days. Anything else
 * is "on track".
 *
 * spendOverValue === null means the figure was REDACTED for this reader's role
 * (the org dashboard route withholds it alongside revenue/expenses), not that
 * spend is fine. A redacted fact never contributes a reason in either
 * direction -- claiming "on track" off a number you were not allowed to see is
 * the same class of lie as claiming the opposite.
 */
export function projectRowStatus(project: DashboardProject): ProjectRowStatus {
  const reasons: string[] = [];
  if (project.spendOverValue === true) reasons.push("spend over contract value");
  const permits = project.permitsExpiring30d ?? 0;
  if (permits > 0) reasons.push(permits === 1 ? "1 permit expiring in 30 days" : `${permits} permits expiring in 30 days`);
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
export function sortProjectRows<T extends DashboardProject>(projects: readonly T[]): T[] {
  return [...projects].sort((a, b) => Number(projectRowStatus(b).needsYou) - Number(projectRowStatus(a).needsYou));
}

/**
 * The one-line summary the home page prints above the rows. Named, because
 * "3 projects need attention" sends a reader hunting; "Cedar Heights Villa
 * needs you" does not.
 */
export function needsYouSummary(projects: readonly DashboardProject[]): string | null {
  const flagged = projects.filter((p) => projectRowStatus(p).needsYou);
  if (flagged.length === 0) return null;
  if (flagged.length === 1) return `${flagged[0].name} needs you.`;
  return `${flagged[0].name} and ${flagged.length - 1} other ${flagged.length - 1 === 1 ? "project" : "projects"} need you.`;
}
