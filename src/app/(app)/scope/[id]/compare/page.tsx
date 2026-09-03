import ScopeCompareClient from "@/components/ScopeCompareClient";
import { getScreenColumns } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";

// Real-screen conversion (2026-08-30): replaces the old "Compare" Dialog
// popup with a real route. Thin pass-through, same pattern as
// permits/[id]/page.tsx. Registry-driven column labels (boq.compare) now
// resolved server-side here too. R67 F-18 moved that helper out of
// scope/page.tsx into src/lib/module-list-source.ts (getScreenColumns), where
// it is cached per org for an hour -- importing a page module for a data
// helper also pulled that whole page's component tree in with it.
export default async function ScopeComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = await getServerOrganizationId();
  const compareColumns = await getScreenColumns("boq.compare", organizationId);
  return (
    <div className="flex-1">
      <ScopeCompareClient boqId={id} compareColumns={compareColumns} />
    </div>
  );
}
