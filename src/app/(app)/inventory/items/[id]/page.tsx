import ItemObjectClient from "@/components/ItemObjectClient";

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <ItemObjectClient itemId={id} />
    </div>
  );
}
