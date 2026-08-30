import MoMObjectClient from "@/components/MoMObjectClient";

export default async function MoMObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <MoMObjectClient meetingId={id} />
    </div>
  );
}
