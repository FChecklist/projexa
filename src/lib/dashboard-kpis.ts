// R67 E-19 (R-180). What each of the home dashboard's four KPI tiles is
// allowed to say.
//
// R-180's complaint about them is precise: a tile showed a value and nothing
// else. No comparison, so "AED 412,000 of expenses" answered no question; no
// destination, so a reader who doubted the number had nowhere to go and check
// it; and "TOTAL BUDGET AED 0" for an org whose Cost Variance report read
// 2,193.75, which is what made a QS stop believing the screen.
//
// So a tile here carries THREE things, and this module is where they are
// decided rather than assembled in JSX where nothing can assert them:
//
//   1. a VALUE,
//   2. a BASELINE it is compared against, in words and in the org's money,
//      plus the DIRECTION of that comparison as a word ("over" / "under") --
//      the glyph beside it in the view is a second, redundant carrier, never
//      the only one,
//   3. a real DESTINATION, named in words ("Open budget"), so the tile is a
//      way in rather than a dead end.
//
// TWO RULES THIS MODULE WILL NOT BREAK:
//
//  - A BASELINE IS ONLY DRAWN FROM A FIGURE THAT EXISTS. Where the comparison
//    figure is null -- no BOQ, or redacted for this reader's role -- the tile
//    says WHICH of those it is and carries no direction at all. Inventing
//    "vs last month" would need a prior-period figure the org dashboard
//    payload does not carry, and a made-up comparison is worse than none.
//  - NO MONEY TILE EVER RENDERS A FABRICATED ZERO. Absent is the en dash and
//    a sentence; zero is a number that was really measured.

import type { DashboardProject } from "@/lib/dashboard-rows";

/** The en dash. "We do not have this figure" is not "this figure is zero". */
export const EN_DASH = "–";

/**
 * The sentence a budget tile shows instead of a figure when nobody has entered
 * one. R-180 quotes the defect as "TOTAL BUDGET AED 0" and the fix as this.
 *
 * ASCII HYPHEN, deliberately, and the one place in this lane that is not the
 * typographic dash used everywhere else: item E-19's acceptance quotes this
 * string verbatim ("assert an org with no budget shows the text 'Budget - not
 * entered'"), and an exact-text assertion against the item is how the owner
 * checks it. The clause separator after it stays an em dash -- that half is
 * this lane's own copy, not quoted by anyone.
 */
export const BUDGET_NOT_ENTERED = "Budget - not entered";

export type KpiDirection = "over" | "under" | "level";

export type DashboardKpi = {
  key: "projects" | "budget" | "revenue" | "expenses";
  /** The tile's own heading. */
  title: string;
  /** Already formatted -- the caller's org money formatter did it, so a tile cannot guess a currency. */
  value: string;
  /** The comparison, in words. Never null: a tile with nothing to compare says so. */
  baseline: string;
  /**
   * The direction of that comparison, or null when there is no real figure to
   * compare against. The VIEW renders the word plus a glyph; the word is what
   * survives a greyscale print.
   */
  direction: KpiDirection | null;
  href: string;
  hrefLabel: string;
};

export type KpiTotals = {
  totalProjects: number;
  /** BOQ-derived, summed across projects. null = no BOQ anywhere, or redacted. */
  totalBudget: number | null;
  /** The ERP annual ledger sum, under its own name -- a different concept from the BOQ budget. */
  totalLedgerBudget?: number | null;
  totalRevenue: number;
  totalExpenses: number;
  /** True when this reader's role had the money redacted, which is a different null from "no BOQ". */
  financialsRedacted?: boolean;
};

/** over / under / level, or null when there is nothing real to compare against. */
export function compareTo(value: number, baseline: number | null | undefined): KpiDirection | null {
  if (baseline === null || baseline === undefined) return null;
  if (value > baseline) return "over";
  if (value < baseline) return "under";
  return "level";
}

/** The portfolio contract value: the sum of the BOQ root totals that EXIST. null when none does. */
export function portfolioContractValue(projects: readonly DashboardProject[]): number | null {
  const scoped = projects.filter((p) => p.value !== null && p.value !== undefined);
  if (scoped.length === 0) return null;
  return scoped.reduce((sum, p) => sum + (p.value ?? 0), 0);
}

/**
 * The four tiles, in the order they are laid out. `money` is the org's own
 * formatter, passed in, so this module never has to know a currency code --
 * the rule R-260/G-05 made binding for the whole app.
 */
export function dashboardKpis(
  totals: KpiTotals,
  projects: readonly DashboardProject[],
  money: (value: number | null) => string
): DashboardKpi[] {
  const redacted = totals.financialsRedacted === true;
  const contract = portfolioContractValue(projects);
  const withBoq = projects.filter((p) => p.value !== null && p.value !== undefined).length;
  const needsYouCount = projects.filter((p) => p.delayedTaskCount > 0 || p.spendOverValue === true).length;

  // --- Active projects. A COUNT has no up or down, so it carries no
  // direction; its baseline is the split that actually tells a reader whether
  // the number is comfortable.
  const projectsTile: DashboardKpi = {
    key: "projects",
    title: "Active Projects",
    value: String(totals.totalProjects),
    baseline:
      totals.totalProjects === 0
        ? "No projects yet"
        : `${withBoq} of ${totals.totalProjects} with a BOQ · ${needsYouCount} need you`,
    direction: null,
    href: "/projects",
    hrefLabel: "Open projects",
  };

  // --- Budget. The tile R-180 is named after.
  const budgetEntered = totals.totalBudget !== null && totals.totalBudget !== undefined && totals.totalBudget > 0;
  const budgetTile: DashboardKpi = {
    key: "budget",
    title: "Total Budget",
    value: redacted ? EN_DASH : budgetEntered ? money(totals.totalBudget) : EN_DASH,
    baseline: redacted
      ? "Needs manager role"
      : !budgetEntered
        ? // Both nulls end at the same sentence, because both are "nobody has
          // entered a budget" -- but the second half says which, so the reader
          // knows whether to import a BOQ or to set percentages on the one
          // they have.
          `${BUDGET_NOT_ENTERED} — ${totals.totalBudget === null || totals.totalBudget === undefined ? "no BOQ imported yet" : "the BOQ carries no budget percentages"}`
        : contract === null
          ? `From the BOQ${ledgerNote(totals, money)}`
          : `${money(totals.totalBudget)} of ${money(contract)} contract value${ledgerNote(totals, money)}`,
    direction: redacted || !budgetEntered ? null : compareTo(totals.totalBudget ?? 0, contract),
    href: budgetEntered ? "/budgets" : "/scope",
    hrefLabel: budgetEntered ? "Open budget" : "Set budget",
  };

  // --- Revenue: what has been invoiced, against what was contracted. That is
  // the question a construction org asks of this number; "vs last month" is
  // not answerable from this payload and is not invented here.
  const revenueTile: DashboardKpi = {
    key: "revenue",
    title: "Total Revenue",
    value: redacted ? EN_DASH : money(totals.totalRevenue),
    baseline: redacted
      ? "Needs manager role"
      : contract === null
        ? "No contract value yet — import a BOQ"
        : `vs ${money(contract)} contract value`,
    direction: redacted ? null : compareTo(totals.totalRevenue, contract),
    href: "/invoices",
    hrefLabel: "Open invoices",
  };

  // --- Expenses against the BUDGET, which is the comparison that decides
  // whether the figure is bad news.
  const expensesTile: DashboardKpi = {
    key: "expenses",
    title: "Total Expenses",
    value: redacted ? EN_DASH : money(totals.totalExpenses),
    baseline: redacted
      ? "Needs manager role"
      : !budgetEntered
        ? `${BUDGET_NOT_ENTERED} — nothing to measure spend against`
        : `vs ${money(totals.totalBudget)} budget`,
    direction: redacted || !budgetEntered ? null : compareTo(totals.totalExpenses, totals.totalBudget),
    href: "/expenses",
    hrefLabel: "Open expenses",
  };

  return [projectsTile, budgetTile, revenueTile, expensesTile];
}

/** The ERP annual ledger sum, kept on screen under its OWN name -- the bug R67 E-06 fixed was one silently standing in for the other. */
function ledgerNote(totals: KpiTotals, money: (value: number | null) => string): string {
  const ledger = totals.totalLedgerBudget;
  if (ledger === null || ledger === undefined) return "";
  return ` · Annual ledger budget ${money(ledger)}`;
}
