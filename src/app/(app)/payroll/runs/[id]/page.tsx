import PayrollRunObjectClient from "@/components/PayrollRunObjectClient";

export default async function PayrollRunObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <PayrollRunObjectClient runId={id} />
    </div>
  );
}
