import MaterialReceiptObjectClient from "@/components/MaterialReceiptObjectClient";

// R67 D-36: the inbound receipt object page. A receipt used to be write-once
// with no detail view at all, so a mis-keyed quantity could never be seen in
// full, let alone corrected.
export default async function MaterialReceiptObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <MaterialReceiptObjectClient receiptId={id} />
    </div>
  );
}
