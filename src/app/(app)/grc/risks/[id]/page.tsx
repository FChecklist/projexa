import RiskObjectClient from "@/components/RiskObjectClient";

export default async function RiskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <RiskObjectClient riskId={id} />
    </div>
  );
}
