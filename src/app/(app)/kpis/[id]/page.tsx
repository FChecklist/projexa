import KpiObjectClient from "@/components/KpiObjectClient";

export default async function KpiObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <KpiObjectClient definitionId={id} />
    </div>
  );
}
