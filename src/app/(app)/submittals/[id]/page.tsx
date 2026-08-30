import SubmittalObjectClient from "@/components/SubmittalObjectClient";

export default async function SubmittalObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <SubmittalObjectClient submittalId={id} />
    </div>
  );
}
