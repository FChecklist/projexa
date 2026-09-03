// R67 E-23 (R-206). The arithmetic behind Sumeet's company chart: one row
// per project, three thin bars per row (Revenue, Budget, Earned value), all
// measured against ONE shared axis so a bar in one row is comparable to a bar
// in another. Pure, so the scale and the sort are testable without a DOM.
//
// WHY ONE AXIS. Small multiples with a per-row axis look tidy and lie: a
// 40,000 bar and a 4,000,000 bar both fill their row, so the eye reads two
// projects as equal. The whole point of stacking the rows is the comparison
// between them, so the scale is the maximum across every bar in every row.

export type ProjectBarSource = {
  id: string;
  name: string;
  revenue?: number | null;
  /** BOQ-derived budget: root line amount x budget %. Not date-filtered. */
  boqBudget?: number | null;
  /** ERP cost-centre budget -- the fallback when the BOQ carries no budget percentages. */
  budget?: number | null;
  earnedValue?: number | null;
  progressPercent?: number | null;
  percentByValue?: number | null;
};

export type ProjectBar = {
  key: "revenue" | "budget" | "earnedValue";
  label: string;
  /** null = this project has no such figure. The row shows the words, never a zero-width bar pretending to be zero. */
  value: number | null;
  /** 0..100, for the bar's width. 0 when the value is null. */
  widthPercent: number;
  /** The CSS custom property this series is painted with -- WS-G's tokens, never a recharts default. */
  colorVar: string;
};

export type ProjectBarRow = {
  id: string;
  name: string;
  href: string;
  bars: ProjectBar[];
  /** Which budget the row is actually showing, so the caption can say which. */
  budgetSource: "boq" | "erp" | "none";
};

/** WS-G's tokens: dusty blue for revenue, grey for budget, sage for earned value. */
export const BAR_COLOR_VARS = {
  revenue: "var(--color-chart-1)",
  budget: "var(--color-chart-5)",
  earnedValue: "var(--color-chart-2)",
} as const;

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Rows ordered by revenue descending -- the order Sumeet reads them in. A
 * project with no revenue figure at all sorts last rather than being treated
 * as a zero-revenue project.
 */
export function buildProjectBarRows(projects: ProjectBarSource[]): { rows: ProjectBarRow[]; axisMax: number } {
  const prepared = projects.map((p) => {
    const revenue = finite(p.revenue);
    const boqBudget = finite(p.boqBudget);
    const erpBudget = finite(p.budget);
    // The BOQ-derived budget is the one the chart is about; the ERP
    // cost-centre budget only stands in when the BOQ carries no percentages,
    // and the row says which is on screen.
    const budget = boqBudget !== null && boqBudget > 0 ? boqBudget : erpBudget;
    const budgetSource: ProjectBarRow["budgetSource"] =
      boqBudget !== null && boqBudget > 0 ? "boq" : erpBudget !== null ? "erp" : "none";
    return { p, revenue, budget, budgetSource, earned: finite(p.earnedValue) };
  });

  const axisMax = prepared.reduce((max, r) => {
    for (const v of [r.revenue, r.budget, r.earned]) if (v !== null && v > max) max = v;
    return max;
  }, 0);

  const width = (value: number | null) => (value === null || axisMax <= 0 ? 0 : Math.max(0.5, (value / axisMax) * 100));

  const rows: ProjectBarRow[] = prepared
    .slice()
    .sort((a, b) => (b.revenue ?? -1) - (a.revenue ?? -1))
    .map(({ p, revenue, budget, budgetSource, earned }) => ({
      id: p.id,
      name: p.name,
      href: `/dashboard/project?projectId=${encodeURIComponent(p.id)}`,
      budgetSource,
      bars: [
        { key: "revenue" as const, label: "Revenue", value: revenue, widthPercent: width(revenue), colorVar: BAR_COLOR_VARS.revenue },
        { key: "budget" as const, label: "Budget", value: budget, widthPercent: width(budget), colorVar: BAR_COLOR_VARS.budget },
        { key: "earnedValue" as const, label: "Progress (earned value)", value: earned, widthPercent: width(earned), colorVar: BAR_COLOR_VARS.earnedValue },
      ],
    }));

  return { rows, axisMax };
}

/**
 * The one sentence that goes above the chart when a date range is set. The
 * range narrows revenue and expenses; the budget is a property of a BOQ line,
 * not of a period, and saying so is the difference between a comparable chart
 * and a misleading one.
 */
export const BUDGET_NOT_DATE_FILTERED_NOTE = "Budget is BOQ x budget %, not date-filtered";

// ---------------------------------------------------------------------------
// R67 E-33 (R-265): the same chart, fed from a REPORT instead of a dashboard
// ---------------------------------------------------------------------------
//
// The Analytics tab mounts this chart from VERIDIAN's portfolio budget-vs-actual
// report -- the {columns, rows} contract E-32 gave every report -- rather than
// from the org dashboard payload the company screens read. Same component, same
// arithmetic, one adapter, because a second copy of "which budget is this?" is
// exactly how a caption comes to disagree with the bar it sits under.
//
// The server has ALREADY resolved which budget each row landed on and says so
// in `budgetSource`, so this maps that answer back onto the two fields
// buildProjectBarRows reads rather than re-deciding it here from a null check.

/** One row of VERIDIAN's portfolio budget-vs-actual report, as it arrives on the wire. */
export type PortfolioReportRow = {
  projectId?: unknown;
  project?: unknown;
  revenue?: unknown;
  budget?: unknown;
  earnedValue?: unknown;
  progressPct?: unknown;
  budgetSource?: unknown;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Report rows -> the shape buildProjectBarRows already knows.
 *
 * A row with no usable project id is DROPPED rather than rendered with a dead
 * link: every row of this chart is a door, and a door that goes nowhere is
 * worse than one row fewer.
 */
export function portfolioRowsToBarSources(rows: PortfolioReportRow[]): ProjectBarSource[] {
  const sources: ProjectBarSource[] = [];
  for (const row of rows) {
    const id = typeof row.projectId === "string" ? row.projectId : null;
    if (!id) continue;
    const budget = numberOrNull(row.budget);
    const fromBoq = row.budgetSource === "boq";
    sources.push({
      id,
      name: typeof row.project === "string" && row.project !== "" ? row.project : id,
      revenue: numberOrNull(row.revenue),
      // The server's own verdict, not a second guess at it.
      boqBudget: fromBoq ? budget : null,
      budget: fromBoq ? null : budget,
      earnedValue: numberOrNull(row.earnedValue),
      progressPercent: numberOrNull(row.progressPct),
    });
  }
  return sources;
}
