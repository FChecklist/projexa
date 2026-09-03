// R67 E-21 (R-195 / R-204 / R-205 / R-222, correction C-14). The arithmetic
// and the wording rules behind PROJEXA's home launchpad, kept out of the
// component so both can be tested without a DOM and so no screen re-derives
// them a second, slightly different way.
//
// WHAT CHANGED AND WHY. /dashboard used to be four tiles and a seven-column
// table. Three of the tiles did not navigate anywhere and the fourth
// navigated to the wrong screen (correction C-14), the greeting said "5 on
// track" for projects that had no schedule to be on track against, and the
// progress bars on the sibling /dashboard/overview page were built by calling
// GET /dashboard/{id} once per project from the browser. The backend now
// answers all of it in one call (construction-dashboard-service.ts
// getOrgDashboard, R67 E-21), so this module only has to read it honestly.
//
// THE THREE-STATE RULE, which most of this file exists to keep:
//   * a field that is a NUMBER is a figure, and 0 is a real figure;
//   * a field that is explicitly NULL is "we asked and there is none" and
//     reads "Not set" -- the org has no BOQ, no budget rows, or the caller's
//     role is not allowed the figure (the /dashboard route redacts money to
//     null for non-managers);
//   * a field that is MISSING from the payload is "this row's data did not
//     arrive", and the row says so and offers Retry rather than drawing a bar
//     for data it never received.

/** One project row as PROJEXA's `/api/v1/projexa/dashboard` sends it. */
export type LaunchpadProject = {
  id: string;
  name: string;
  revenue: number | null;
  expenses: number | null;
  taskCount: number;
  delayedTaskCount: number;
  value: number | null;
  earnedValue: number | null;
  percentByValue: number | null;
  // R67 E-21 additions. Optional at the TYPE level on purpose: `undefined`
  // is the wire's way of saying an older/partial backend did not send this
  // row's figures, which is a different fact from `null`. See the header.
  spent?: number | null;
  contractValue?: number | null;
  earnedValuePrevWeek?: number | null;
  progressPercent?: number | null;
  budget?: number | null;
  /** R67 E-29: the BOQ-derived budget (root line amount x budget %), for the per-project bars. */
  boqBudget?: number | null;
  tasksDue?: number;
  tasksLate?: number;
  hasSchedule?: boolean;
};

/**
 * A label that still carries a test marker must never reach a customer's
 * screen. The live registry row for this screen reads "ACTIVE PROJECTS
 * (HARD-STOP TEST)" and it is rendered verbatim on the product's landing
 * page (R-222). The row itself is platform data that only exists in Supabase,
 * so the screen ALSO refuses it here: a parenthesised group containing the
 * word TEST is stripped, and a label that still shouts TEST after stripping
 * is dropped for the code's own fallback rather than shown.
 */
export function sanitizeScreenLabel(label: string | null | undefined, fallback: string): string {
  if (!label) return fallback;
  const stripped = label.replace(/\s*\((?=[^)]*\bTEST\b)[^)]*\)/g, "").trim();
  if (stripped.length === 0) return fallback;
  if (/\bTEST\b/.test(stripped)) return fallback;
  return stripped;
}

/** True when this row's own figures arrived at all -- see the three-state rule. */
export function rowDataArrived(project: LaunchpadProject): boolean {
  return project.contractValue !== undefined && project.earnedValue !== undefined;
}

/** The contract value to draw a bar against: the BOQ-derived one, falling back to the roots-only total the same query already produced. */
export function rowContractValue(project: LaunchpadProject): number | null {
  return project.contractValue ?? project.value ?? null;
}

/**
 * Percent complete BY VALUE for one row. null when there is no contract value
 * to divide by -- never a fabricated 0, which would draw an empty bar against
 * a project that simply has no BOQ yet.
 */
export function rowPercentByValue(project: LaunchpadProject): number | null {
  if (typeof project.percentByValue === "number") return project.percentByValue;
  const contract = rowContractValue(project);
  if (contract === null || contract <= 0 || typeof project.earnedValue !== "number") return null;
  return Math.round((project.earnedValue / contract) * 10000) / 100;
}

export type PortfolioProgress = {
  earned: number;
  contract: number;
  earnedPrevWeek: number;
  /** null when no project has a contract value -- nothing to be a percentage OF. */
  percent: number | null;
  percentPrevWeek: number | null;
  /** Percentage points gained since the baseline; null when either end is unknown. */
  deltaPercentagePoints: number | null;
  /** How many rows actually contributed, so the caller can say so. */
  projectsCounted: number;
};

/**
 * The ONE dominant number: portfolio earned value against portfolio contract
 * value. Rows whose data did not arrive, or that carry no contract value, are
 * left out of BOTH sides rather than counted as zero -- adding a project with
 * no BOQ as "0 of 0" would drag the headline percentage down with a project
 * that has nothing to complete.
 */
export function portfolioProgress(projects: LaunchpadProject[]): PortfolioProgress {
  let earned = 0;
  let contract = 0;
  let earnedPrevWeek = 0;
  let projectsCounted = 0;

  for (const p of projects) {
    const c = rowContractValue(p);
    if (c === null || c <= 0 || typeof p.earnedValue !== "number") continue;
    contract += c;
    earned += p.earnedValue;
    earnedPrevWeek += typeof p.earnedValuePrevWeek === "number" ? p.earnedValuePrevWeek : p.earnedValue;
    projectsCounted += 1;
  }

  const pct = (n: number) => Math.round((n / contract) * 1000) / 10;
  const percent = contract > 0 ? pct(earned) : null;
  const percentPrevWeek = contract > 0 ? pct(earnedPrevWeek) : null;

  return {
    earned,
    contract,
    earnedPrevWeek,
    percent,
    percentPrevWeek,
    deltaPercentagePoints:
      percent === null || percentPrevWeek === null ? null : Math.round((percent - percentPrevWeek) * 10) / 10,
    projectsCounted,
  };
}

/**
 * R67 E-29 (R-255). THE ONE DOMINANT SENTENCE, at the top left of the home
 * screen: "Portfolio earned value AED 0 of AED 2,120,500 (0 %)".
 *
 * It is a SENTENCE and not a bare number on purpose. "AED 0" alone is
 * alarming and meaningless; "0 of AED 2,120,500" says what the zero is
 * measured against, and the percentage says how far through that is. The
 * space before the % is Sumeet's own writing, kept.
 *
 * `formatAmount` is passed in rather than imported so this stays pure and the
 * caller decides the currency and the number of decimals -- the headline shows
 * whole units, because the fraction is noise at three times body size.
 */
export function portfolioHeadline(
  portfolio: PortfolioProgress,
  formatAmount: (value: number) => string
): string {
  if (portfolio.percent === null) {
    // No project has a contract value: there is nothing to be a percentage OF,
    // and printing "0 %" would claim a project had done none of its work when
    // the truth is that no work has been priced yet.
    return "Portfolio earned value — no BOQ priced yet";
  }
  return `Portfolio earned value ${formatAmount(portfolio.earned)} of ${formatAmount(portfolio.contract)} (${portfolio.percent} %)`;
}

/**
 * The activity-log percentage for one row -- the SECOND, differently-derived
 * progress figure (a flat average of each activity's latest logged percent, no
 * BOQ scoping). Returned only when it says something the value-weighted figure
 * does not, so a row does not print two identical numbers.
 */
export function activityLogPercent(project: LaunchpadProject): number | null {
  if (typeof project.progressPercent !== "number") return null;
  const byValue = rowPercentByValue(project);
  if (byValue !== null && Math.round(byValue) === Math.round(project.progressPercent)) return null;
  return project.progressPercent;
}

export type ProjectVerdict = {
  /** "needs-you" and "done" are the kit's KpiTone words; "context" is the neutral one. */
  tone: "needs-you" | "done" | "context";
  /** The word a reader sees. Never colour alone. */
  word: string;
  glyph: string;
  needsYou: boolean;
};

/**
 * The status word for one row. "on track" is only ever said when the project
 * HAS a schedule: a project with no dated task is not on track, it is
 * unplanned, and R-222's whole complaint about the old greeting was that it
 * congratulated five projects for keeping to a plan none of them had.
 */
export function projectVerdict(project: LaunchpadProject): ProjectVerdict {
  if (!rowDataArrived(project)) return { tone: "context", word: "not loaded", glyph: "·", needsYou: false };

  const late = project.tasksLate ?? project.delayedTaskCount ?? 0;
  const contract = rowContractValue(project);
  const spent = typeof project.spent === "number" ? project.spent : project.expenses;
  const overSpent = contract !== null && contract > 0 && typeof spent === "number" && spent > contract;

  if (late > 0 || overSpent) return { tone: "needs-you", word: "needs you", glyph: "●", needsYou: true };
  if (project.hasSchedule === true) return { tone: "done", word: "on track", glyph: "✓", needsYou: false };
  return { tone: "context", word: "no schedule set", glyph: "·", needsYou: false };
}

/** Projects the reader has to do something about, in payload order. */
export function needsYouProjects(projects: LaunchpadProject[]): LaunchpadProject[] {
  return projects.filter((p) => projectVerdict(p).needsYou);
}

/** Projects that genuinely are on track -- scheduled, not late, not overspent. */
export function onTrackProjects(projects: LaunchpadProject[]): LaunchpadProject[] {
  return projects.filter((p) => projectVerdict(p).word === "on track");
}

export type BudgetVerdict = {
  /** Total ERP budget across the rows that have one; null when NOT ONE row has a budget. */
  budget: number | null;
  spent: number;
  tone: "needs-you" | "done" | "context";
  word: string;
  direction: "up" | "down" | "flat";
};

/**
 * Portfolio budget against portfolio spend. A null budget is the common case
 * for this product (a PROJEXA org need not run VERIDIAN's ERP budgets at
 * all), and it must NOT render as "over budget" against a target of zero --
 * that is the false alarm R-211 records on the project dashboard, and the
 * same rule applies here.
 */
export function budgetVerdict(projects: LaunchpadProject[]): BudgetVerdict {
  let budget: number | null = null;
  let spent = 0;
  for (const p of projects) {
    if (typeof p.budget === "number") budget = (budget ?? 0) + p.budget;
    const s = typeof p.spent === "number" ? p.spent : p.expenses;
    if (typeof s === "number") spent += s;
  }
  if (budget === null || budget <= 0) {
    return { budget, spent, tone: "context", word: "no budget set", direction: "flat" };
  }
  return spent > budget
    ? { budget, spent, tone: "needs-you", word: "over budget", direction: "up" }
    : { budget, spent, tone: "done", word: "within budget", direction: "down" };
}
