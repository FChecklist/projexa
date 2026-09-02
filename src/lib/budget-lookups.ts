import { createCachedVeridianGet, VeridianApiError } from "@/lib/veridian-client";
import type { Company } from "@/components/company-scope";

// R67 F-08 (R-112). /budgets/new rendered four ENABLED selects and then, once
// its own client-side lookups returned, visibly flipped them to disabled with
// "No fiscal years found in VERIDIAN" inside them. A form that offers a
// control and then withdraws it is worse than one that never offered it: the
// user has already decided to click.
//
// Per D-04 the four lookups move into the server component, so the form's very
// first rendered frame already knows whether the org is set up -- there is no
// enabled-then-disabled transition to see. The VERIDIAN key stays server-side,
// which is the whole reason the browser could not do this itself.
//
// All four are reference data an org configures once: fiscal years, cost
// centres, the chart of accounts, legal entities. 300 s per org is the
// programme's stated TTL for exactly this class. Each cached getter is created
// ONCE at module scope, as unstable_cache requires, and is org-scoped both by
// key part and by argument -- see createCachedVeridianGet's own comment for
// the cross-tenant leak that shape prevents.
export type FiscalYear = { id: string; yearName: string; startDate: string; endDate: string; isClosed: boolean };
export type CostCenter = { id: string; name: string; projectId: string | null };
export type Account = { id: string; accountName: string; accountNumber: string | null };
export type { Company };

export const BUDGET_LOOKUPS_TTL_SECONDS = 300;

const getFiscalYears = createCachedVeridianGet<{ fiscalYears?: FiscalYear[] }>("budget-fiscal-years", "/fiscal-years", BUDGET_LOOKUPS_TTL_SECONDS);
const getCostCenters = createCachedVeridianGet<{ costCenters?: CostCenter[] }>("budget-cost-centers", "/cost-centers", BUDGET_LOOKUPS_TTL_SECONDS);
const getAccounts = createCachedVeridianGet<{ accounts?: Account[] }>("budget-accounts", "/accounts", BUDGET_LOOKUPS_TTL_SECONDS);
const getCompanies = createCachedVeridianGet<{ companies?: Company[] }>("budget-companies", "/companies", BUDGET_LOOKUPS_TTL_SECONDS);

export type BudgetLookups = {
  fiscalYears: FiscalYear[];
  costCenters: CostCenter[];
  accounts: Account[];
  companies: Company[];
  /**
   * The backend's own words for whichever lookups failed, or null.
   *
   * Kept SEPARATE from the empty lists on purpose. "This org has no fiscal
   * years" and "we could not ask" look identical in the data and mean opposite
   * things to the user -- the first is a setup task, the second is a retry --
   * so the form must be able to tell them apart. See BudgetCreateClient, which
   * shows a Reload lists control for the second and a setup message for the
   * first.
   */
  errorMessage: string | null;
};

export const EMPTY_BUDGET_LOOKUPS: BudgetLookups = {
  fiscalYears: [],
  costCenters: [],
  accounts: [],
  companies: [],
  errorMessage: null,
};

function reason(result: PromiseRejectedResult): string {
  const err = result.reason;
  if (err instanceof VeridianApiError) return err.message;
  return err instanceof Error && err.message ? err.message : "an unknown error";
}

/**
 * All four lookups in one parallel pass. Never throws: a failed lookup yields
 * an empty list plus a message naming what could not be loaded, so the page
 * still renders and the form still tells the truth about why a select is
 * empty.
 */
export async function resolveBudgetLookups(organizationId: string | null): Promise<BudgetLookups> {
  if (!organizationId) return EMPTY_BUDGET_LOOKUPS;

  const [fy, cc, ac, co] = await Promise.allSettled([
    getFiscalYears(organizationId),
    getCostCenters(organizationId),
    getAccounts(organizationId),
    getCompanies(organizationId),
  ]);

  const failures: string[] = [];
  if (fy.status === "rejected") failures.push(`fiscal years (${reason(fy)})`);
  if (cc.status === "rejected") failures.push(`cost centres (${reason(cc)})`);
  if (ac.status === "rejected") failures.push(`the chart of accounts (${reason(ac)})`);
  if (co.status === "rejected") failures.push(`companies (${reason(co)})`);

  if (failures.length > 0) {
    console.error("[budget-lookups] VERIDIAN lookup failed:", failures.join("; "));
  }

  return {
    fiscalYears: fy.status === "fulfilled" ? fy.value.fiscalYears ?? [] : [],
    costCenters: cc.status === "fulfilled" ? cc.value.costCenters ?? [] : [],
    accounts: ac.status === "fulfilled" ? ac.value.accounts ?? [] : [],
    companies: co.status === "fulfilled" ? co.value.companies ?? [] : [],
    errorMessage: failures.length > 0 ? `Couldn't load ${failures.join(", ")}` : null,
  };
}

/** Just the companies list, for the Budgets LIST screen's company filter. */
export async function resolveBudgetCompanies(organizationId: string | null): Promise<Company[]> {
  if (!organizationId) return [];
  try {
    const data = await getCompanies(organizationId);
    return data.companies ?? [];
  } catch (err) {
    // Non-fatal: CompanySelector renders nothing when the list is empty, and a
    // budget list must not fail to render because a filter's options did.
    console.error("[budget-lookups] companies lookup failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
