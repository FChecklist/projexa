import BudgetCreateClient, { type BudgetLookups } from "@/components/BudgetCreateClient";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { VeridianApiError, createCachedVeridianGet } from "@/lib/veridian-client";

// Real-screen conversion (2026-08-30): replaces the old "New Budget" Dialog
// popup with a real create route.
//
// R67 E-06 (R-108). THE FORM RENDERS ONCE, IN ITS TRUE STATE.
//
// The four reference lookups used to run from BudgetCreateClient's mount
// effect, so the create form always painted EMPTY first -- "No fiscal years
// found in VERIDIAN", Save blocked with a paragraph explaining this org
// cannot create a budget -- and then repainted with the real lists a moment
// later. The first paint was a false statement about the org.
//
// They are resolved here instead, server-side, in ONE Promise.all: four
// requests in parallel rather than four serial round trips from the browser,
// and no VERIDIAN key ever reaching it (decision D-04, option A).
//
// FIVE-MINUTE PER-ORG CACHE. createCachedVeridianGet keys on the
// organizationId argument, so one org's fiscal years can never be served to
// another (the security note on that helper). Fiscal years, cost centres,
// accounts and companies are ERP setup data an org edits about once a year,
// which is what makes 300 s honest here where it would not be for a figure.
// The sibling proxy routes already cache the same four reads at 60 s for the
// same reason; this is the same rule, at the longer horizon the item names.
const LOOKUP_TTL_SECONDS = 300;

const getFiscalYears = createCachedVeridianGet<{ fiscalYears?: BudgetLookups["fiscalYears"] }>("veridian-fiscal-years-5m", "/fiscal-years", LOOKUP_TTL_SECONDS);
const getCostCenters = createCachedVeridianGet<{ costCenters?: BudgetLookups["costCenters"] }>("veridian-cost-centers-5m", "/cost-centers", LOOKUP_TTL_SECONDS);
const getAccounts = createCachedVeridianGet<{ accounts?: BudgetLookups["accounts"] }>("veridian-accounts-5m", "/accounts", LOOKUP_TTL_SECONDS);
const getCompanies = createCachedVeridianGet<{ companies?: BudgetLookups["companies"] }>("veridian-companies-5m", "/companies", LOOKUP_TTL_SECONDS);

async function resolveBudgetLookups(organizationId: string | null): Promise<BudgetLookups> {
  const empty: BudgetLookups = { fiscalYears: [], costCenters: [], accounts: [], companies: [], errorMessage: null };
  if (!organizationId) {
    return { ...empty, errorMessage: "No organisation is linked to this account." };
  }
  try {
    const [fy, cc, ac, co] = await Promise.all([
      getFiscalYears(organizationId),
      getCostCenters(organizationId),
      getAccounts(organizationId),
      getCompanies(organizationId),
    ]);
    return {
      fiscalYears: fy.fiscalYears ?? [],
      costCenters: cc.costCenters ?? [],
      accounts: ac.accounts ?? [],
      companies: co.companies ?? [],
      errorMessage: null,
    };
  } catch (err) {
    // The backend's own sentence, carried to the form -- which then says it
    // could not ASK, instead of claiming the org has no fiscal years.
    console.error("[budgets/new] reference lookups failed:", err instanceof Error ? err.message : err);
    return { ...empty, errorMessage: err instanceof VeridianApiError ? err.message : "The VERIDIAN ERP service did not answer." };
  }
}

export default async function BudgetNewPage() {
  const organizationId = await getServerOrganizationId();
  const lookups = await resolveBudgetLookups(organizationId);

  return (
    <div className="flex-1">
      <BudgetCreateClient lookups={lookups} />
    </div>
  );
}
