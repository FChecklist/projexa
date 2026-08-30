import PolicyObjectClient from "@/components/PolicyObjectClient";

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <PolicyObjectClient policyId={id} />
    </div>
  );
}
