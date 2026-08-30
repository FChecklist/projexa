import PunchListObjectClient from "@/components/PunchListObjectClient";

export default async function PunchListObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <PunchListObjectClient itemId={id} />
    </div>
  );
}
