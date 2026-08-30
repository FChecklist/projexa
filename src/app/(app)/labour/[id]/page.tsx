import RosterObjectClient from "@/components/RosterObjectClient";

export default async function RosterObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <RosterObjectClient rosterId={id} />
    </div>
  );
}
