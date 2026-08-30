import WikiObjectClient from "@/components/WikiObjectClient";

export default async function WikiObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <WikiObjectClient pageId={id} />
    </div>
  );
}
