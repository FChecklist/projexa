import LeadObjectClient from "@/components/LeadObjectClient";

export default async function LeadObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <LeadObjectClient leadId={id} />
    </div>
  );
}
