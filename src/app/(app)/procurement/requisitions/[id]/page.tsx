import RequisitionObjectClient from "@/components/RequisitionObjectClient";

export default async function RequisitionObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <RequisitionObjectClient requisitionId={id} />
    </div>
  );
}
