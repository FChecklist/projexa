import { PageHeading } from "@/components/PageHeading";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import BudgetsClient, { type RegistryColumn } from "@/components/BudgetsClient";

// R46 P8 seq133 (registry-model proof, same shape as R43 seq2's
// resolvePermitsListColumns, R46 P8 seq134's resolveVariationsListColumns,
// and R46 P8 seq128's resolveDocumentsListColumns): resolved server-side so
// BudgetsClient (a client component) never needs its own
// Bearer-key-authenticated fetch. A missing or errored registry row is NOT
// fatal -- BudgetsClient falls back to its own hardcoded COLUMNS when this
// is null. Unlike documents/change-orders/drawings, Budgets is org-wide
// rather than project-scoped (no resolveSelectedProject here) -- only
// organizationId is needed to resolve the row.
async function resolveBudgetsListColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/budget.list", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[budgets/page] screen_definitions resolve failed, falling back to hardcoded columns:", err instanceof Error ? err.message : err);
    return null;
  }
}

// R67 lane D22 (item D-41, recs R-107/R-113): MOVED HERE INTACT from
// /budgets. The route labelled "Budget" was this org-wide fiscal-year ERP
// ledger, while Sumeet's Budget (6.png II) is a per-scope-line attribute of
// one project's BOQ -- so a user looking for their project's budget landed on
// an empty ledger reading "No budgets found." /budgets is now the project BOQ
// budget screen; this ledger keeps every one of its own screens (list, create,
// object page) unchanged under Accounting, per correction C-15's rule that the
// ERP Budgets route and its disabled-with-reason banner must NOT be deleted.
export default async function AnnualBudgetsPage() {
  const organizationId = await getServerOrganizationId();
  const registryColumns = await resolveBudgetsListColumns(organizationId);

  return (
    <>
      <div className="flex-1 space-y-6 p-6">
        <PageHeading title="Annual Budgets" />
        <BudgetsClient registryColumns={registryColumns} />
      </div>
    </>
  );
}
