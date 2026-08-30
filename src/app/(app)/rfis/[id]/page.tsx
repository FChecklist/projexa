import RfiObjectClient from "@/components/RfiObjectClient";

export default async function RfiObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <RfiObjectClient rfiId={id} />
    </div>
  );
}
