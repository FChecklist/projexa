import ScopeCompareClient from "@/components/ScopeCompareClient";
import { resolveRegistryColumns } from "@/app/(app)/scope/page";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// Real-screen conversion (2026-08-30): replaces the old "Compare" Dialog
// popup with a real route. Thin pass-through, same pattern as
// permits/[id]/page.tsx. Registry-driven column labels (boq.compare) now
// resolved server-side here too, reusing scope/page.tsx's own helper --
// same resolve-once-on-the-server principle as every other converted screen.
export default async function ScopeComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = await getServerOrganizationId();
  const compareColumns = await resolveRegistryColumns("boq.compare", organizationId);
  return (
    <div className="flex-1">
      <ScopeCompareClient boqId={id} compareColumns={compareColumns} />
    </div>
  );
}
