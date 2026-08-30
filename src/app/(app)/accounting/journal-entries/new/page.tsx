import JournalEntryCreateClient from "@/components/JournalEntryCreateClient";

// Real-screen conversion (2026-08-30): replaces the old "New Journal Entry"
// Dialog popup with a real create route.
export default function JournalEntryNewPage() {
  return (
    <div className="flex-1">
      <JournalEntryCreateClient />
    </div>
  );
}
