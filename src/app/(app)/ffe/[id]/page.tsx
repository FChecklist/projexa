import FfeObjectClient from "@/components/FfeObjectClient";

// Real-screen conversion (2026-08-30): the FF&E module's first Object Page
// -- previously description/vendor/SKU/lead-time/dimensions were never
// shown anywhere. Thin pass-through, same pattern as permits/[id]/page.tsx.
export default async function FfeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <FfeObjectClient itemId={id} />
    </div>
  );
}
