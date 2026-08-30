import KnowledgeBaseObjectClient from "@/components/KnowledgeBaseObjectClient";

export default async function KnowledgeBaseObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <KnowledgeBaseObjectClient pageId={id} />
    </div>
  );
}
