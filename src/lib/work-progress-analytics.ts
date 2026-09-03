// R67 E-24 (R-210). The Analytics tab showed one category bar and three KPI
// tags, and the numbers on screen contradicted each other -- 42% on a tag,
// 60% on a bar, 0% earned -- with nothing saying they were three different
// measures. This module holds the two measures, the rule for when they
// disagree, and the sentence that explains it. Pure, so all three are tested
// without a DOM.
//
// THE TWO MEASURES, and why they are genuinely different:
//   * LOGGED % is /api/reports/category-progress -- the latest percentage
//     recorded against each activity in the category, averaged. It answers
//     "how far along does the site say this trade is?".
//   * EARNED % is the Work Progress Report's own byCategory roll-up -- the
//     BOQ value completed in that category as a share of its BOQ value. It
//     answers "how much of the contract has this trade delivered?".
// A crew can log 60% against activities and earn 0% because no entry is
// linked to a BOQ line. That is not a bug in either number; it is a real,
// fixable data state, and the screen now says which fix.

export type Measure = "logged" | "earned";

export const MEASURE_LABEL: Record<Measure, string> = {
  logged: "Logged %",
  earned: "Earned %",
};

/** Said once, under the tags, when the two measures disagree in the one way that has a fix. */
export const UNLINKED_PROGRESS_NOTE =
  "Logged progress is not yet linked to BOQ lines, so earned value is 0% - link entries to BOQ lines when recording progress.";

export type LoggedCategory = { categoryId: string; name: string; percentComplete: number };
/** The WPR roll-up's own shape: `key` is a category id or a `name:<lowercased>` fallback. */
export type EarnedCategory = { key?: unknown; name: string; percentage?: { total?: number } };

export type CategoryMeasureRow = {
  /** The category-progress id when there is one -- what the drill uses. */
  categoryId: string | null;
  name: string;
  loggedPercent: number;
  /** null when the Work Progress Report has not answered yet; 0 is a real earned zero. */
  earnedPercent: number | null;
};

/**
 * One row per category, carrying BOTH measures. Categories are matched by
 * NAME, case-insensitively: the two endpoints group by different keys (one by
 * constructionCategories id, the other by id-or-name), and the name is the
 * only thing both are guaranteed to agree on -- it is also what the reader
 * sees and what the drill filters by.
 *
 * A category the Work Progress Report knows about but category-progress does
 * not is still listed, at 0% logged: dropping it would hide BOQ value from a
 * chart about BOQ value.
 */
export function mergeCategoryMeasures(
  logged: LoggedCategory[],
  earned: EarnedCategory[] | null
): CategoryMeasureRow[] {
  const earnedByName = new Map((earned ?? []).map((e) => [e.name.trim().toLowerCase(), e]));
  const rows: CategoryMeasureRow[] = logged.map((c) => {
    const match = earnedByName.get(c.name.trim().toLowerCase());
    return {
      categoryId: c.categoryId,
      name: c.name,
      loggedPercent: Number(c.percentComplete) || 0,
      earnedPercent: earned === null ? null : Number(match?.percentage?.total ?? 0),
    };
  });

  const seen = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  for (const e of earned ?? []) {
    const key = e.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    rows.push({ categoryId: null, name: e.name, loggedPercent: 0, earnedPercent: Number(e.percentage?.total ?? 0) });
    seen.add(key);
  }
  return rows;
}

/** Descending by the chosen measure. A null earned value sorts last -- unknown is not zero. */
export function sortByMeasure(rows: CategoryMeasureRow[], measure: Measure): CategoryMeasureRow[] {
  return rows.slice().sort((a, b) => {
    const av = measure === "logged" ? a.loggedPercent : a.earnedPercent ?? -1;
    const bv = measure === "logged" ? b.loggedPercent : b.earnedPercent ?? -1;
    return bv - av;
  });
}

/**
 * True for the ONE disagreement that has a fix: the site has logged real
 * progress and not a single category has earned anything, which happens when
 * entries carry no BOQ line. Two measures that merely differ are expected and
 * get no sentence -- a note under every chart would be noise.
 */
export function measuresDisagree(rows: CategoryMeasureRow[]): boolean {
  if (rows.length === 0) return false;
  if (rows.some((r) => r.earnedPercent === null)) return false; // the report has not answered yet
  return rows.some((r) => r.loggedPercent > 0) && rows.every((r) => (r.earnedPercent ?? 0) === 0);
}

/**
 * The Work Progress Report needs a window. Defaults come from the DATA, not
 * from today's date: the earliest entry the project has, through today. A
 * project whose entries are all from August must not be reported on with a
 * September-only window that shows nothing.
 */
export function defaultReportRange(entries: { entryDate?: string | null }[], today = new Date()): { from: string; to: string } {
  const to = today.toISOString().slice(0, 10);
  const dates = entries
    .map((e) => (e.entryDate ? String(e.entryDate).slice(0, 10) : null))
    .filter((d): d is string => Boolean(d) && /^\d{4}-\d{2}-\d{2}$/.test(d!));
  const from = dates.length > 0 ? dates.reduce((min, d) => (d < min ? d : min)) : to;
  return { from, to };
}
