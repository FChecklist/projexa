// R67 D-02 (audit R-004/R-009). The arithmetic and the wording behind the
// home dashboard's KPI band, kept out of the component so both are provable
// without a DOM: a KPI that shows a number nobody set is the single defect
// this item exists to remove, and "renders null as words, never as 0" is a
// rule, not a rendering detail.
//
// Deliberately NOT "use client" and deliberately currency-agnostic -- the
// caller injects its own money formatter (the home resolves the org's base
// currency server-side; @/lib/currency is a client module). D-61 replaces
// that injection with one shared formatMoney(); until it lands, this module
// must not force a currency decision of its own.

export type PortfolioProject = {
  value: number | null;
  earnedValue: number | null;
};

export type PortfolioTotals = {
  /** Sum of every non-null earnedValue. null when no project has one. */
  earned: number | null;
  /** Sum of every non-null value (the contract total). null when no project has a BOQ. */
  contract: number | null;
  /** Whole-percent earned/contract. null unless BOTH sides are real and contract > 0. */
  percent: number | null;
};

/**
 * Portfolio earned value from the per-project rows the org dashboard already
 * returns. Nulls are SKIPPED, never coerced to 0: a project with no BOQ must
 * not drag the portfolio contract total down, and "no project has a BOQ" must
 * come back as null so the card can say so in words.
 */
export function portfolioTotals(projects: readonly PortfolioProject[]): PortfolioTotals {
  const values = projects.map((p) => p.value).filter((v): v is number => v !== null);
  const earnedValues = projects.map((p) => p.earnedValue).filter((v): v is number => v !== null);
  const contract = values.length > 0 ? values.reduce((s, v) => s + v, 0) : null;
  const earned = earnedValues.length > 0 ? earnedValues.reduce((s, v) => s + v, 0) : null;
  const percent = contract !== null && contract > 0 && earned !== null ? Math.round((earned / contract) * 100) : null;
  return { earned, contract, percent };
}

/**
 * The Spend card's baseline line. A budget nobody has set is stated as such --
 * "budget AED 0" reads as an approved budget of zero and is exactly the
 * fabricated figure this item removes.
 */
export function budgetBaseline(budget: number | null, money: (n: number) => string): string {
  return budget === null ? "budget not set" : `budget ${money(budget)}`;
}

/**
 * A budget figure for display. Null renders as the words "Not set" -- never
 * "0", and never a currency-prefixed zero.
 */
export function formatBudgetValue(budget: number | null, money: (n: number) => string): string {
  return budget === null ? "Not set" : money(budget);
}

/**
 * "Over budget" is only sayable when a budget exists. With no budget there is
 * nothing to be over, so the card stays in the neutral context tone.
 */
export function spendTone(budget: number | null, spend: number): "late" | "context" {
  return budget !== null && spend > budget ? "late" : "context";
}
