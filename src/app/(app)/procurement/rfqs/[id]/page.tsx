import RfqObjectClient from "@/components/RfqObjectClient";

export default async function RfqObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <RfqObjectClient rfqId={id} />
    </div>
  );
}
