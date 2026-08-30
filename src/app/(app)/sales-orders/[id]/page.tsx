import SalesOrderObjectClient from "@/components/SalesOrderObjectClient";

export default async function SalesOrderObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <SalesOrderObjectClient salesOrderId={id} />
    </div>
  );
}
