import BudgetCreateClient from "@/components/BudgetCreateClient";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import { resolveBudgetLookups } from "@/lib/budget-lookups";
import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";

// Real-screen conversion (2026-08-30): replaces the old "New Budget" Dialog
// popup with a real create route.
//
// R67 D-62: moved here from /budgets/new. This is the ERP's fiscal-year budget,
// not a project's budget -- the project one is /scope?tab=budget -- and putting
// it under /finance says so before the user meets its fiscal-year precondition.
// /budgets/new is kept as a redirect onto this route.
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
//
// R67 MERGE (D-11, lane D1 x lane F1, 2026-09-03): F-08 landed the paragraph
// above on src/app/(app)/budgets/new/page.tsx, which D-62 had already turned
// into a redirect shim -- so git raised the conflict on the shim and not on the
// screen, and taking D1's side there alone would have dropped the prefetch
// entirely. Both props are passed here now: F-08's initialLookups AND D1's
// veridianOrigin, which is resolved in this server component because
// veridian-client is server-only and the blocked banner's "Set up in VERIDIAN"
// link (correction C-15) needs a real origin rather than a hardcoded host.
export default async function BudgetNewPage() {
  const organizationId = await getServerOrganizationId();
  const lookups = await resolveBudgetLookups(organizationId);

  return (
    <div className="flex-1">
      <BudgetCreateClient initialLookups={lookups} veridianOrigin={VERIDIAN_ORIGIN} />
    </div>
  );
}
