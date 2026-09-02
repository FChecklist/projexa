import BudgetCreateClient from "@/components/BudgetCreateClient";
import { VERIDIAN_ORIGIN } from "@/lib/veridian-client";

// Real-screen conversion (2026-08-30): replaces the old "New Budget" Dialog
// popup with a real create route.
//
// R67 D-62: moved here from /budgets/new. This is the ERP's fiscal-year budget,
// not a project's budget -- the project one is /scope?tab=budget -- and putting
// it under /finance says so before the user meets its fiscal-year precondition.
// /budgets/new is kept as a redirect onto this route.
//
// VERIDIAN_ORIGIN is resolved HERE because veridian-client is a server-only
// module: it is the origin of the ERP app whose setup screen the blocked banner
// links to (correction C-15).
export default function BudgetNewPage() {
  return (
    <div className="flex-1">
      <BudgetCreateClient veridianOrigin={VERIDIAN_ORIGIN} />
    </div>
  );
}
