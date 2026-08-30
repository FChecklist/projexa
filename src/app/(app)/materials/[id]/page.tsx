import MaterialObjectClient from "@/components/MaterialObjectClient";

export default async function MaterialObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <MaterialObjectClient materialId={id} />
    </div>
  );
}
