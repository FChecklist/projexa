import FraudCaseObjectClient from "@/components/FraudCaseObjectClient";

export default async function FraudCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <FraudCaseObjectClient caseId={id} />
    </div>
  );
}
