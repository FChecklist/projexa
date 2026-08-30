import SalesQuotationObjectClient from "@/components/SalesQuotationObjectClient";

export default async function QuotationObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <SalesQuotationObjectClient quotationId={id} />
    </div>
  );
}
