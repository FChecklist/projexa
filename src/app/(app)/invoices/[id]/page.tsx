import InvoiceObjectClient from "@/components/InvoiceObjectClient";

export default async function InvoiceObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <InvoiceObjectClient invoiceId={id} />
    </div>
  );
}
