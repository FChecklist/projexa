import BudgetCreateClient from "@/components/BudgetCreateClient";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveBudgetLookups } from "@/lib/budget-lookups";

// Real-screen conversion (2026-08-30): replaces the old "New Budget" Dialog
// popup with a real create route.
//
// R67 F-08 (R-112). This page rendered four ENABLED selects and then visibly
// flipped them to disabled once its client-side lookups returned -- a form
// offering a control and then withdrawing it, after the user had already
// decided to click.
//
// Per D-04 the four lookups (fiscal years, cost centres, chart of accounts,
// companies) now run here, server-side, in ONE Promise.all behind a 300 s
// per-org cache, and are handed to the form as props. The form's very first
// rendered frame therefore already knows whether the org is set up: for a
// blocked org the fiscal-year select is disabled on frame one, with no
// transition to see.
//
// Deliberately NOT wrapped in <Suspense>: unlike a list, a create form has
// nothing honest to show before it knows which controls are usable. Streaming
// an enabled-looking skeleton would reintroduce the exact flip this removes.
export default async function BudgetNewPage() {
  const organizationId = await getServerOrganizationId();
  const lookups = await resolveBudgetLookups(organizationId);

  return (
    <div className="flex-1">
      <BudgetCreateClient initialLookups={lookups} />
    </div>
  );
}
