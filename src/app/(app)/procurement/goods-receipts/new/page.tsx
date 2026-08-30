import GoodsReceiptCreateClient from "@/components/GoodsReceiptCreateClient";

export default async function GoodsReceiptNewPage({ searchParams }: { searchParams: Promise<{ poId?: string }> }) {
  const { poId } = await searchParams;
  return (
    <div className="flex-1">
      <GoodsReceiptCreateClient poId={poId} />
    </div>
  );
}
