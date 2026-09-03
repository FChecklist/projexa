// R67 E-16 (R-150). THE RULES BEHIND DESIGN STUDIO > COST ANALYSIS.
//
// compliance-tracker's designerTimesheetReport has computed four Budget-vs-
// Actual breakdowns since PR #597 -- by category, by designer, by project and
// by designer status -- and not one PROJEXA screen showed any of them. The
// figures existed; nobody could read them.
//
// What is genuinely a DECISION rather than a rendering lives here, pure and
// tested, because these are the three places this screen could quietly lie:
//
//   1. A row with NO budget is not a row that is 100 % under budget. The
//      by-category breakdown has no budget dimension at all in the source
//      (pms_budget_line_items carries kind/userId, never a category -- the
//      service returns budget: null for every category row and says so in its
//      own comment). A bar drawn at zero for that is a fabricated comparison.
//   2. A bar's DIRECTION must be readable without colour: the word "over" or
//      "under" and an arrow glyph, never a red bar and nothing else.
//   3. Sorting. "Sorted horizontal bars" is worthless if the sort key is the
//      row's label; the reader came to see the worst overrun first.
//
// Every figure below arrives already computed by the report. Nothing here
// re-derives money.

/** One row of any of the four breakdowns, reduced to the four numbers the table prints. */
export type CostAnalysisRow = {
  /** Stable key for React and for the click-through filter. */
  key: string;
  label: string;
  /** null means "there is no budget figure for this row", never zero. */
  budget: number | null;
  actual: number;
  /** Hours only exist on the category and designer cuts; null elsewhere. */
  hours: number | null;
};

/** What a section's bar pair says, in words, so colour is never the only carrier. */
export type VarianceVerdict =
  | { kind: "over"; glyph: "▲"; word: "over"; amount: number }
  | { kind: "under"; glyph: "▼"; word: "under"; amount: number }
  | { kind: "on"; glyph: "="; word: "on budget"; amount: 0 }
  | { kind: "no-budget"; glyph: "–"; word: "no budget set"; amount: 0 };

/**
 * Variance is ACTUAL against BUDGET, positive meaning over -- the same sign
 * convention item E-08's Revenue/Budget/Actual view uses, so a reader moving
 * between the two screens never has to re-learn which way is bad.
 */
export function varianceVerdict(row: CostAnalysisRow): VarianceVerdict {
  if (row.budget === null) return { kind: "no-budget", glyph: "–", word: "no budget set", amount: 0 };
  const delta = Math.round((row.actual - row.budget) * 100) / 100;
  if (delta > 0) return { kind: "over", glyph: "▲", word: "over", amount: delta };
  if (delta < 0) return { kind: "under", glyph: "▼", word: "under", amount: Math.abs(delta) };
  return { kind: "on", glyph: "=", word: "on budget", amount: 0 };
}

/**
 * Worst first. A row with no budget cannot be ranked against one that has a
 * variance, so it sinks to the bottom in its own alphabetical order rather than
 * being scattered through the ranking by a variance nobody computed.
 */
export function sortByVariance(rows: readonly CostAnalysisRow[]): CostAnalysisRow[] {
  return [...rows].sort((a, b) => {
    const av = a.budget === null ? null : a.actual - a.budget;
    const bv = b.budget === null ? null : b.actual - b.budget;
    if (av === null && bv === null) return a.label.localeCompare(b.label);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (bv !== av) return bv - av;
    return a.label.localeCompare(b.label);
  });
}

/**
 * The width of a bar, as a percentage of the widest figure in its own section.
 * Scaled per section, not globally: a designer's hours and a project's budget
 * are not comparable magnitudes, and one huge project would flatten every other
 * bar into an unreadable sliver.
 */
export function barScale(rows: readonly CostAnalysisRow[]): number {
  let max = 0;
  for (const r of rows) {
    if (r.budget !== null && r.budget > max) max = r.budget;
    if (r.actual > max) max = r.actual;
  }
  return max;
}

export function barWidthPercent(value: number | null, scale: number): number {
  if (value === null || scale <= 0) return 0;
  return Math.max(0, Math.min(100, (value / scale) * 100));
}

/**
 * The four sections, in the order the item names them. `heading` is the
 * section's title; `itemLabel` is what its table's FIRST COLUMN is called, and
 * it is stated rather than derived from the heading -- "Designer Status" minus
 * a "By " prefix is still "Designer Status", so a derived label would print the
 * section's own title twice on one card.
 */
export const COST_ANALYSIS_SECTIONS = [
  { id: "category", heading: "By Category", itemLabel: "Category" },
  { id: "designer", heading: "By Designer", itemLabel: "Designer" },
  { id: "project", heading: "By Project", itemLabel: "Project" },
  { id: "status", heading: "Designer Status", itemLabel: "Status" },
] as const;

export type CostAnalysisSectionId = (typeof COST_ANALYSIS_SECTIONS)[number]["id"];

/** The payload shape compliance-tracker's designerTimesheetReport returns. */
export type DesignerTimesheetPayload = {
  period?: { from: string | null; to: string | null };
  projectScoped: {
    byUser: { userId: string; userName: string; totalHours: number }[];
    byCategory: { category: string; hours: number; actual: number; budget: number | null }[];
    byDesignerStatus: { status: string; budget: number; actual: number; variance: number }[];
    overallBudget: number;
    overallActual: number;
    overallVariance: number;
  };
  orgWide: {
    byDesigner: { userId: string; userName: string; hours: number; budget: number; actual: number; variance: number }[];
    byProject: { projectId: string; projectName: string; budget: number; actual: number; variance: number }[];
  };
};

/**
 * The payload's four cuts, each reduced to CostAnalysisRow. byCategory's budget
 * stays null because the source has no per-category budget -- see this file's
 * header. byDesigner's hours come from the org-wide cut it belongs to; byUser
 * (the project-scoped hours) is folded onto it where the ids match, so a
 * designer's row can show the hours they logged HERE beside the budget they
 * carry across the org, each labelled for what it is by the section's own note.
 */
export function costAnalysisSection(
  payload: DesignerTimesheetPayload,
  section: CostAnalysisSectionId
): CostAnalysisRow[] {
  switch (section) {
    case "category":
      return payload.projectScoped.byCategory.map((c) => ({
        key: c.category,
        label: c.category,
        budget: c.budget,
        actual: c.actual,
        hours: c.hours,
      }));
    case "designer": {
      const hoursHere = new Map(payload.projectScoped.byUser.map((u) => [u.userId, u.totalHours]));
      return payload.orgWide.byDesigner.map((d) => ({
        key: d.userId,
        label: d.userName,
        budget: d.budget,
        actual: d.actual,
        hours: hoursHere.get(d.userId) ?? d.hours,
      }));
    }
    case "project":
      return payload.orgWide.byProject.map((p) => ({
        key: p.projectId,
        label: p.projectName,
        budget: p.budget,
        actual: p.actual,
        hours: null,
      }));
    case "status":
      return payload.projectScoped.byDesignerStatus.map((s) => ({
        key: s.status,
        label: s.status === "active" ? "Active designers" : "Inactive designers",
        budget: s.budget,
        actual: s.actual,
        hours: null,
      }));
  }
}

/**
 * The sentence a section shows instead of an empty card. R-150's own wording
 * for the budget case; the other two states are genuinely different facts and
 * say so rather than being flattened into one shrug.
 */
export const NO_BUDGET_LINES = "No designer budget lines for this project — set them under Budgets";
export const NO_HOURS_LOGGED = "No approved hours in this period — widen the dates, or approve the pending entries";

export function sectionEmptyMessage(rows: readonly CostAnalysisRow[], hasAnyBudget: boolean): string | null {
  if (rows.length > 0) return null;
  return hasAnyBudget ? NO_HOURS_LOGGED : NO_BUDGET_LINES;
}

/** Month-to-date, the period the screen opens on when the URL names none. */
export function currentMonth(today: Date = new Date()): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: iso(today) };
}
