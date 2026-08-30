import ScopeReviseClient from "@/components/ScopeReviseClient";

// Real-screen conversion (2026-08-30): replaces the old "New Revision"
// Dialog popup with a real route. Thin pass-through, same pattern as
// permits/[id]/page.tsx.
export default async function ScopeRevisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <ScopeReviseClient boqId={id} />
    </div>
  );
}
