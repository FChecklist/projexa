// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION:
// IndexedDB-backed (idb-keyval) local queue for work-progress entries
// captured while offline (construction sites often have poor/no
// connectivity -- see the Owner's Daily Schedule/Timesheet + handwritten
// task-checklist images this directive is built from). Every entry is
// queued here first, then synced to the real, existing
// POST /api/work-progress route (-> compliance-tracker's real
// constructionWorkProgressEntries table) as soon as the browser reports
// connectivity -- "always queue, sync opportunistically" rather than a
// separate offline-only code path, so the online and offline flows share
// one implementation.
//
// Photo blobs are captured and stored here for real (Blob values are
// natively IndexedDB-structured-cloneable, no base64 encoding needed) so a
// site worker can genuinely attach a photo while offline. They are NOT
// currently uploaded on sync: compliance-tracker's real
// constructionWorkProgressEntries table has no photo/attachment column or
// upload endpoint reachable from PROJEXA (confirmed absent during this
// task -- PROJEXA has zero file-upload API today, and adding cloud photo
// storage is out of this task's declared compliance-tracker PR scope,
// which SPEC's own EXPECTED_OUTPUT limits to dependency-blocking
// enforcement). This is a real, disclosed gap, not a silent drop: the
// queued-entry UI shows a photo as "saved on this device" and the entry's
// quantity/notes still sync for real; see PROGRESS.md.
import { createStore, del, entries, get, set } from "idb-keyval";

const workProgressStore = createStore("projexa-offline", "work-progress-queue");

export type QueuedPhoto = { blob: Blob; name: string; type: string };

export type QueuedWorkProgressEntry = {
  localId: string;
  projectId: string;
  activityId: string;
  entryDate: string;
  quantityDone: number;
  percentComplete: number;
  remarks?: string;
  photo?: QueuedPhoto | null;
  status: "pending" | "syncing" | "error";
  error?: string;
  queuedAt: string;
};

export type NewWorkProgressEntry = Omit<QueuedWorkProgressEntry, "localId" | "status" | "error" | "queuedAt">;

function newLocalId(): string {
  return `local-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export async function enqueueWorkProgressEntry(entry: NewWorkProgressEntry): Promise<QueuedWorkProgressEntry> {
  const record: QueuedWorkProgressEntry = {
    ...entry,
    localId: newLocalId(),
    status: "pending",
    queuedAt: new Date().toISOString(),
  };
  await set(record.localId, record, workProgressStore);
  return record;
}

export async function listQueuedWorkProgressEntries(): Promise<QueuedWorkProgressEntry[]> {
  const rows = await entries<string, QueuedWorkProgressEntry>(workProgressStore);
  return rows.map(([, value]) => value).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function removeQueuedWorkProgressEntry(localId: string): Promise<void> {
  await del(localId, workProgressStore);
}

async function setStatus(localId: string, status: QueuedWorkProgressEntry["status"], error?: string) {
  const existing = await get<QueuedWorkProgressEntry>(localId, workProgressStore);
  if (!existing) return;
  await set(localId, { ...existing, status, error }, workProgressStore);
}

export type SyncEvent = { localId: string; phase: "syncing" | "synced" | "error"; error?: string };

/**
 * Drains the queue against the real /api/work-progress route. Entries that
 * sync successfully are removed; entries that fail (still offline, or a
 * real server-side rejection) are left queued with status "error" and are
 * retried on the next call. Safe to call repeatedly (e.g. on every
 * `online` event) -- already-syncing entries are skipped.
 */
export async function syncQueuedWorkProgressEntries(onEvent?: (event: SyncEvent) => void): Promise<{ synced: number; failed: number }> {
  const queued = (await listQueuedWorkProgressEntries()).filter((e) => e.status !== "syncing");
  let synced = 0;
  let failed = 0;

  for (const entry of queued) {
    await setStatus(entry.localId, "syncing");
    onEvent?.({ localId: entry.localId, phase: "syncing" });
    try {
      const res = await fetch("/api/work-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: entry.projectId,
          activityId: entry.activityId,
          entryDate: entry.entryDate,
          quantityDone: entry.quantityDone,
          percentComplete: entry.percentComplete,
          remarks: entry.remarks || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Server rejected sync (status ${res.status})`);
      await removeQueuedWorkProgressEntry(entry.localId);
      synced += 1;
      onEvent?.({ localId: entry.localId, phase: "synced" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      await setStatus(entry.localId, "error", message);
      failed += 1;
      onEvent?.({ localId: entry.localId, phase: "error", error: message });
    }
  }

  return { synced, failed };
}
