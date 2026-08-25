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
//
// Post-audit fix (PR #54 review): every function below now takes an
// explicit `scope` -- the authenticated user's Supabase auth id, supplied
// by the caller (WorkProgressClient resolves it via supabase.auth.getUser()).
// This used to be a single global `createStore("projexa-offline", ...)`
// shared by the whole browser origin, so on a shared/handed-off field
// tablet a second user logging in would see and auto-sync the first user's
// still-queued entries (POST /api/work-progress attributes the sync to
// whoever's session cookie is active at sync time, not to any per-entry
// field). Requiring `scope` on every call -- there is no fallback
// "unscoped" store -- means a session can only ever read/drain the
// IndexedDB store keyed to its own user id; another user's queued entries
// live in a different, never-referenced store and are neither visible nor
// synced until that same user is the one signed in again.
import { createStore, del, entries, get, set, type UseStore } from "idb-keyval";

const storesByScope = new Map<string, UseStore>();

function storeForScope(scope: string): UseStore {
  let store = storesByScope.get(scope);
  if (!store) {
    store = createStore(`projexa-offline-work-progress::${scope}`, "queue");
    storesByScope.set(scope, store);
  }
  return store;
}

export type QueuedPhoto = { blob: Blob; name: string; type: string };

// "failed" (post-audit fix, follow-up item) is distinct from "error": an
// "error" entry has failed fewer than MAX_SYNC_ATTEMPTS times and is still
// retried on the next sync; a "failed" entry has hit the cap and is
// permanently excluded from automatic retries (e.g. its activityId was
// deleted server-side -- retrying forever against a real 4xx rejection
// just wastes every future `online` event for no chance of success).
export type QueuedWorkProgressEntry = {
  localId: string;
  projectId: string;
  activityId: string;
  entryDate: string;
  quantityDone: number;
  percentComplete: number;
  // R47 (fault R47_OFFLINE_QUEUE_DROPS_FIELDS_01): these two were MISSING from
  // this type and from the sync payload, so every entry recorded offline
  // reached the server with no BOQ line link and no basis. The form was always
  // passing both -- handleSubmit spreads its full payload in here -- so they
  // were sitting in IndexedDB the whole time and were simply never POSTed.
  // Declared explicitly now so they are carried by contract rather than by the
  // accident of an object spread.
  //
  // Optional on purpose: entries queued by an older build are already sitting
  // in real browsers without these fields, and they must still sync rather
  // than throw. A missing boqLineItemId then means what it has always meant --
  // no BOQ link -- and a missing entryBasis falls back to the server default.
  boqLineItemId?: string;
  entryBasis?: "DELTA" | "SNAPSHOT";
  remarks?: string;
  photo?: QueuedPhoto | null;
  status: "pending" | "syncing" | "error" | "failed";
  error?: string;
  attempts: number;
  queuedAt: string;
};

export type NewWorkProgressEntry = Omit<QueuedWorkProgressEntry, "localId" | "status" | "error" | "attempts" | "queuedAt">;

const MAX_SYNC_ATTEMPTS = 5;

function newLocalId(): string {
  return `local-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export async function enqueueWorkProgressEntry(scope: string, entry: NewWorkProgressEntry): Promise<QueuedWorkProgressEntry> {
  const record: QueuedWorkProgressEntry = {
    ...entry,
    localId: newLocalId(),
    status: "pending",
    attempts: 0,
    queuedAt: new Date().toISOString(),
  };
  await set(record.localId, record, storeForScope(scope));
  return record;
}

export async function listQueuedWorkProgressEntries(scope: string): Promise<QueuedWorkProgressEntry[]> {
  const rows = await entries<string, QueuedWorkProgressEntry>(storeForScope(scope));
  return rows.map(([, value]) => value).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function removeQueuedWorkProgressEntry(scope: string, localId: string): Promise<void> {
  await del(localId, storeForScope(scope));
}

async function patchEntry(scope: string, localId: string, patch: Partial<QueuedWorkProgressEntry>) {
  const store = storeForScope(scope);
  const existing = await get<QueuedWorkProgressEntry>(localId, store);
  if (!existing) return;
  await set(localId, { ...existing, ...patch }, store);
}

// Closes the disclosed gap documented above: uploads a photo to the real
// /api/work-progress/photos route (Supabase Storage-backed, see
// drizzle/0013) once its entry has actually been created. Deliberately
// best-effort and separate from the main sync try/catch below -- a photo
// upload failure must not resurrect an already-synced entry (flip it back
// to "error"/retry) or change the synced/failed counters the mutex/dedupe
// tests above assert on; it's a real follow-up write, not a gate on the
// entry's own sync success.
//
// R42 seq22 finding: exported (was module-private) because the ONLINE
// immediate-submit path (WorkProgressFormClient.tsx) had never called this
// at all -- a photo attached while online was silently dropped, only ever
// uploaded via the offline-queue sync path below. Same function, same
// contract, for both callers -- generalising the one real implementation
// (GLOBAL's own instruction) rather than writing a second copy.
export async function uploadQueuedPhoto(veridianEntryId: string, photo: QueuedPhoto): Promise<void> {
  const formData = new FormData();
  formData.append("veridianEntryId", veridianEntryId);
  formData.append("file", photo.blob, photo.name);
  const res = await fetch("/api/work-progress/photos", { method: "POST", body: formData });
  if (!res.ok) throw new Error(`Photo upload rejected (status ${res.status})`);
}

export type SyncEvent = { localId: string; phase: "syncing" | "synced" | "error" | "failed"; error?: string };

// Post-audit fix (PR #54 review): keyed by `scope` so two overlapping
// `syncQueuedWorkProgressEntries(scope)` calls for the SAME user (a
// component remount racing the 'online' event, or a flaky connection
// firing 'online' more than once) share one real in-flight drain instead
// of both listing the same pending entries and double-POSTing them. This
// is a genuine mutex, not a best-effort status flag: the lock is written
// to `syncLocks` synchronously, before the async drain body reaches its
// first `await`, so a second call made immediately after the first (e.g.
// from Promise.all) is guaranteed to observe it and reuse the same
// in-flight promise rather than starting its own drain loop.
const syncLocks = new Map<string, Promise<{ synced: number; failed: number }>>();

/**
 * Drains the queue against the real /api/work-progress route. Entries that
 * sync successfully are removed; entries that fail (still offline, or a
 * real server-side rejection) are left queued with status "error" and are
 * retried on the next call. Safe to call repeatedly and concurrently for
 * the same scope (e.g. on every `online` event) -- overlapping calls
 * dedupe onto a single in-flight drain (see `syncLocks` above).
 */
export function syncQueuedWorkProgressEntries(scope: string, onEvent?: (event: SyncEvent) => void): Promise<{ synced: number; failed: number }> {
  const inFlight = syncLocks.get(scope);
  if (inFlight) return inFlight;

  const run = (async () => {
    // "failed" entries have already hit MAX_SYNC_ATTEMPTS and are
    // permanently excluded here -- they no longer retry on every `online`
    // event (the audit's disclosed follow-up: previously nothing capped
    // retries on a permanently-invalid entry, e.g. one whose activityId
    // was deleted server-side).
    const queued = (await listQueuedWorkProgressEntries(scope)).filter((e) => e.status !== "syncing" && e.status !== "failed");
    let synced = 0;
    let failed = 0;

    for (const entry of queued) {
      await patchEntry(scope, entry.localId, { status: "syncing" });
      onEvent?.({ localId: entry.localId, phase: "syncing" });
      try {
        const res = await fetch("/api/work-progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: entry.projectId,
            activityId: entry.activityId,
            // R47_OFFLINE_QUEUE_DROPS_FIELDS_01: both of these used to be
            // absent here, so an offline entry synced with a NULL BOQ line
            // link -- recorded, but contributing nothing to that line's
            // earned value, and silent about it -- and with the basis
            // defaulted, which for a SNAPSHOT entry corrupts the running
            // total rather than merely mislabelling it (M25: quantity SUMS,
            // percent REPLACES).
            boqLineItemId: entry.boqLineItemId || undefined,
            entryBasis: entry.entryBasis || undefined,
            entryDate: entry.entryDate,
            quantityDone: entry.quantityDone,
            percentComplete: entry.percentComplete,
            remarks: entry.remarks || undefined,
          }),
        });
        if (!res.ok) throw new Error(`Server rejected sync (status ${res.status})`);
        const created = (await res.json().catch(() => null)) as { id?: string } | null;
        await removeQueuedWorkProgressEntry(scope, entry.localId);
        synced += 1;
        onEvent?.({ localId: entry.localId, phase: "synced" });
        if (entry.photo && created?.id) {
          uploadQueuedPhoto(created.id, entry.photo).catch((photoErr) => {
            console.warn(`[work-progress-queue] photo upload failed for synced entry ${created.id}:`, photoErr);
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sync failed";
        const attempts = entry.attempts + 1;
        const permanentlyFailed = attempts >= MAX_SYNC_ATTEMPTS;
        await patchEntry(scope, entry.localId, { status: permanentlyFailed ? "failed" : "error", error: message, attempts });
        failed += 1;
        onEvent?.({ localId: entry.localId, phase: permanentlyFailed ? "failed" : "error", error: message });
      }
    }

    return { synced, failed };
  })();

  syncLocks.set(scope, run);
  return run.finally(() => {
    syncLocks.delete(scope);
  });
}
