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
  /**
   * R67 D-62: renamed from `value`. The field was always the active BOQ's
   * root-line total -- the CONTRACT value -- but "value" is also the word the
   * project dashboard used for a completely different figure (the entered / PO
   * project value), which is how one project came to tell three money stories.
   * compliance-tracker's getOrgDashboard now returns this under its real name;
   * `value` survives there only as a deprecated alias.
   */
  contractValue: number | null;
  earnedValue: number | null;
};

/** R67 D-62: which source a project's commercial value came from, mirrored from getOrgDashboard. */
export type ProjectValueSource = "entered" | "purchase_orders" | null;

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
  const values = projects.map((p) => p.contractValue).filter((v): v is number => v !== null);
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
 * R67 D-62. The project's COMMERCIAL value, in the one wording every screen
 * uses. Same rule as the budget: a value nobody has set reads "Not set", never
 * "AED 0.00" -- and never the BOQ total borrowed from the next column along,
 * which is the substitution this item exists to stop.
 */
export function formatProjectValue(projectValue: number | null, money: (n: number) => string): string {
  return projectValue === null ? "Not set" : money(projectValue);
}

/**
 * R67 D-62. Where that figure came from, said in the user's words, so a derived
 * number is never presented as one somebody typed. Returned as a caption, not
 * baked into the value, so a table cell stays a number.
 */
export function projectValueCaption(source: ProjectValueSource): string {
  if (source === "entered") return "entered";
  if (source === "purchase_orders") return "from purchase orders";
  return "no value set";
}

/**
 * "Over budget" is only sayable when a budget exists. With no budget there is
 * nothing to be over, so the card stays in the neutral context tone.
 */
export function spendTone(budget: number | null, spend: number): "late" | "context" {
  return budget !== null && spend > budget ? "late" : "context";
}
