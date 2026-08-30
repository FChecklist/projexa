import JournalEntryObjectClient from "@/components/JournalEntryObjectClient";

// Real-screen conversion (2026-08-30): the General Ledger's first real
// Object Page — previously there was no detail/submit screen for a single
// journal entry at all. Thin pass-through, same pattern as permits/[id]/page.tsx.
export default async function JournalEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <JournalEntryObjectClient entryId={id} />
    </div>
  );
}
