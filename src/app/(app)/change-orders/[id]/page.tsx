import ChangeOrderObjectClient from "@/components/ChangeOrderObjectClient";

// Real-screen conversion (2026-08-30): the Change Orders module's first
// Object Page — "reason" was previously not shown anywhere. Thin
// pass-through, same pattern as permits/[id]/page.tsx.
export default async function ChangeOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <ChangeOrderObjectClient changeOrderId={id} />
    </div>
  );
}
