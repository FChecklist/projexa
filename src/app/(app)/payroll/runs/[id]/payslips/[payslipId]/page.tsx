import PayslipObjectClient from "@/components/PayslipObjectClient";

export default async function PayslipObjectPage({ params }: { params: Promise<{ id: string; payslipId: string }> }) {
  const { id, payslipId } = await params;
  return (
    <div className="flex-1">
      <PayslipObjectClient runId={id} payslipId={payslipId} />
    </div>
  );
}
