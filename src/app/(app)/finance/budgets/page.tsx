import { Suspense } from "react";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns } from "@/lib/screen-definitions";
import { resolveBudgetCompanies } from "@/lib/budget-lookups";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import BudgetsClient, { BUDGETS_FALLBACK_COLUMN_LABELS, type RegistryColumn } from "@/components/BudgetsClient";

// R46 P8 seq133 (registry-model proof, same shape as R43 seq2's
// resolvePermitsListColumns and R46 P8 seq128's resolveDocumentsListColumns):
// resolved server-side so BudgetsClient (a client component) never needs its
// own Bearer-key-authenticated fetch. A missing or errored registry row is NOT
// fatal -- BudgetsClient falls back to its own hardcoded COLUMNS when this is
// null. Unlike documents/change-orders/drawings, Budgets is org-wide rather
// than project-scoped (no resolveSelectedProject here).
//
// R67 F-08 (R-112). /budgets painted at 616 ms but was still idle at 3061 ms
// behind a bare spinner: the column labels were resolved on every navigation,
// and the companies list -- the options for the list's own filter -- was a
// second client-side fetch after hydration.
//
//   1. the heading streams first; the data-dependent subtree sits behind
//      <Suspense> with a fallback carrying the REAL headers, so
//      "Annual Amount" is on screen at first paint instead of a spinner;
//   2. the registry row and the companies list resolve in ONE Promise.all,
//      both memoised per org (budget.list for 10 minutes -- it is a registry
//      row; companies for 300 s, the reference-data TTL);
//   3. per D-04 both stay in the server component, so the VERIDIAN key never
//      reaches the browser and the client makes ONE request (the budgets
//      themselves) rather than three.
//
// R67 MERGE (D-11, lane D1 x lane F1, 2026-09-03) -- WHY F-08's WORK IS HERE.
// F-08 landed all of the above on src/app/(app)/budgets/page.tsx. D-62 had
// already moved the real ERP budgets screen to THIS path and left /budgets as a
// redirect shim, so taking D1's side of that file would have silently thrown
// F-08's streaming rewrite away -- git showed the conflict on the shim, not on
// the screen. The local resolveBudgetsListColumns() helper this file used to
// carry is gone with it: resolveRegistryColumns() is the memoised shared reader
// F-08 introduced, and keeping both would have been two ways to read one
// registry row.
const BUDGET_COLUMNS_TTL_SECONDS = 600;

export default async function BudgetsPage() {
  // R67 D-43: no <PageHeading title="Budgets" /> here -- BudgetsClient renders
  // the kit's own ScreenFrame header (breadcrumb + Filter | Export | + New in
  // that fixed order), the same way PermitsListClient does, so this module's
  // header cannot drift from every other module's. Two headings would also
  // have made the streaming frame below draw a title the real screen then drew
  // again.
  //
  // R67 F-08: the data-dependent subtree stays behind <Suspense>, so the frame
  // -- carrying the REAL column headers -- is in the first flush of HTML while
  // the registry row and the companies list are still being read.
  return (
    <div className="flex-1 space-y-6 p-6">
      <Suspense
        fallback={
          <TableLoadingRows
            headers={BUDGETS_FALLBACK_COLUMN_LABELS}
            rows={3}
            caption="Loading budgets…"
            // 0, not 150: this fallback only shows while the server component
            // is genuinely still fetching, so there is nothing to debounce.
            delayMs={0}
          />
        }
      >
        <BudgetsSection />
      </Suspense>
    </div>
  );
}

async function BudgetsSection() {
  const organizationId = await getServerOrganizationId();
  const [registryColumns, companies] = await Promise.all([
    resolveRegistryColumns("budget.list", organizationId, BUDGET_COLUMNS_TTL_SECONDS) as Promise<RegistryColumn[] | null>,
    resolveBudgetCompanies(organizationId),
  ]);

  return <BudgetsClient registryColumns={registryColumns} companies={companies} />;
}
