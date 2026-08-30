import GoodsReceiptObjectClient from "@/components/GoodsReceiptObjectClient";

export default async function GoodsReceiptObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <GoodsReceiptObjectClient receiptId={id} />
    </div>
  );
}
