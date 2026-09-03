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

export default async function BudgetsPage() {
  const organizationId = await getServerOrganizationId();
  const registryColumns = await resolveBudgetsListColumns(organizationId);

  // R67 D-43, carried here at the D1 x D3 merge: the bare
  // <PageHeading title="Budgets" /> is gone -- BudgetsClient renders the kit's
  // own ScreenFrame header (breadcrumb + Filter | Export | + New in that fixed
  // order), the same way PermitsListClient does, so this module's header cannot
  // drift from every other module's. D3 made this change on
  // src/app/(app)/budgets/page.tsx; D-62 had already moved the screen here, so
  // without this the moved page would have rendered TWO stacked headers and the
  // merge would have shown no conflict at all.
  return (
    <div className="flex-1 space-y-6 p-6">
      <BudgetsClient registryColumns={registryColumns} />
    </div>
  );
}
