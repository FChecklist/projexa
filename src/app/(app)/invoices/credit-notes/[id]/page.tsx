import CreditNoteObjectClient from "@/components/CreditNoteObjectClient";

export default async function CreditNoteObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <CreditNoteObjectClient noteId={id} />
    </div>
  );
}
