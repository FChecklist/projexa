import OpportunityObjectClient from "@/components/OpportunityObjectClient";

export default async function OpportunityObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <OpportunityObjectClient opportunityId={id} />
    </div>
  );
}
