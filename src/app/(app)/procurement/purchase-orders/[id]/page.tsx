import PurchaseOrderObjectClient from "@/components/PurchaseOrderObjectClient";

export default async function PurchaseOrderObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <PurchaseOrderObjectClient poId={id} />
    </div>
  );
}
