// LOCAL-FIRST: the small marker a screen shows beside something the person changed on this laptop that the server
// has not confirmed yet. It disappears (the caller stops rendering it) the moment the outbox applies the change.
// The words are fixed so every screen says the same thing.

export const PENDING_SYNC_TEXT = "Saved on this laptop, syncing";

export function PendingSyncMarker({ className = "" }: { className?: string }) {
  return (
    <span role="status" data-testid="pending-sync" className={`inline-flex items-center gap-1 text-[11px] text-px-muted ${className}`}>
      <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-px-muted" />
      {PENDING_SYNC_TEXT}
    </span>
  );
}
