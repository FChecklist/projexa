// LOCAL-FIRST: the one outbox a signed-in browser tab uses, wired to the real sync service and to the person's own
// Supabase session (the same arrangement replica-shared.ts makes for the replica). Creating it also resumes what a
// reload left behind: the ops are in IndexedDB, so the first flush sends them (with their original op_ids), and a
// browser `online` event flushes again.

import { createOutbox, type Outbox } from "./outbox";
import { setActiveLocalUser } from "./local-reader";
import { createSharedSyncClient } from "./shared-client";

const outboxes = new Map<string, Outbox>();
const onlineHandlers = new Map<string, () => void>();

const DEVICE_KEY = "px-device-id";
let memoryDeviceId: string | null = null;

/** A stable id for this browser, sent with every push (so the server's history says which laptop did what). */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return (memoryDeviceId ??= crypto.randomUUID());
  }
}

/** navigator.storage.persist(), asked through the PWA's own once-per-laptop rule (persistence.ts). */
async function requestPersistentStorage(): Promise<string> {
  if (typeof navigator === "undefined" || !navigator.storage) return "unsupported";
  const [{ ensurePersistence }, { deviceMetaStore }] = await Promise.all([import("./persistence"), import("./device-meta")]);
  return ensurePersistence({ storage: navigator.storage, meta: deviceMetaStore() });
}

/** The (memoised) outbox for this person. Calling it also marks them as the laptop's active local user. */
export function getSharedOutbox(userId: string): Outbox {
  setActiveLocalUser(userId);
  let outbox = outboxes.get(userId);
  if (!outbox) {
    const created = createOutbox({
      userId, deviceId: getDeviceId(), client: createSharedSyncClient({ timeoutMs: 20_000, maxRetries: 1 }),
      // Before the first edit is stored only on this laptop, ask the browser to keep the site's storage (data:F13). Loaded
      // lazily: the release/boot modules behind it are not needed until a person actually edits something.
      requestPersistence: requestPersistentStorage,
    });
    outbox = created;
    outboxes.set(userId, created);
    if (typeof window !== "undefined") {
      const handler = () => { void created.flush(); };
      onlineHandlers.set(userId, handler);
      window.addEventListener("online", handler);
    }
    // Resume whatever a reload (or a closed tab) left in the outbox.
    void created.refresh().then(() => created.flush());
  }
  return outbox;
}

/** The outbox if one exists already; never creates one. */
export function peekSharedOutbox(userId: string): Outbox | null {
  return outboxes.get(userId) ?? null;
}

/** Stops this person's outbox (sign-out). Stored ops are untouched. */
export function releaseSharedOutbox(userId: string): void {
  outboxes.get(userId)?.dispose();
  outboxes.delete(userId);
  const handler = onlineHandlers.get(userId);
  if (handler && typeof window !== "undefined") window.removeEventListener("online", handler);
  onlineHandlers.delete(userId);
}

/** Starts the outbox for a signed-in person (resumes pending ops). Safe to call again. */
export function startOutbox(userId: string): void {
  getSharedOutbox(userId);
}
