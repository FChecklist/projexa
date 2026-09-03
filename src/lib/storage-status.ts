// R67 D-78 (audit R-294/R-295). "Can this server accept a file at all?" --
// asked once, server-side, before the user picks one.
//
// THE DEFECT. Every upload path in VERIDIAN resolves its Supabase admin client
// with two non-null assertions and no check. On a deployment where the
// service-role key is missing, or where the bucket does not exist, nothing says
// so until a user has chosen a file, filled in a create form and pressed Save --
// and the failure they then get is the flat sentence "Failed to upload file".
// They are told their permit did not save. They are not told that no permit
// could ever have saved, which is the fact, and which is the difference between
// retrying uselessly and calling someone.
//
// The probe itself lives in compliance-tracker (src/lib/storage-config.ts) and
// is cached 60 s there; this is the read side. Deliberately server-only: it goes
// through veridian-client, which holds the org's Bearer key and must never reach
// the browser.
import { callVeridian } from "@/lib/veridian-client";
import { unstable_cache } from "next/cache";

// The two sentences the upload screens show live in src/lib/file-limits.ts,
// which is import-safe from a client component (this module is not: it reaches
// veridian-client, which reads the database and holds the org's Bearer key).
// Re-exported here so a server caller can take both the status and the wording
// from one place.
export { STORAGE_UNAVAILABLE_BANNER, STORAGE_UNAVAILABLE_REASON } from "@/lib/file-limits";

export type StorageStatus = { storageConfigured: boolean; reason?: string };

// unstable_cache, org-keyed, 60 s -- the same pattern and the same reasoning as
// veridian-client's createCachedVeridianGet (see its SECURITY note: Next's own
// fetch cache keys on URL and method only, NOT on the Bearer header, so a naive
// cache would serve one org's answer to another). Defined once at module scope,
// never re-wrapped per request.
const readStorageStatus = unstable_cache(
  (organizationId: string) => callVeridian<StorageStatus>("/storage-status", { organizationId }),
  ["storage-status", "/storage-status"],
  { revalidate: 60, tags: ["storage-status"] }
);

/**
 * FAILS OPEN, on purpose. If this call itself fails -- VERIDIAN slow, the route
 * not deployed yet, no credentials row -- the answer is "configured", and the
 * upload screens render normally.
 *
 * A guard that turns its own outage into "file storage is not configured on this
 * server" would be telling the user something it does not know, on the strength
 * of a failure that has nothing to do with storage. The upload would then be
 * blocked by a screen that was wrong, which is worse than the defect this item
 * fixes: an upload that fails at the end is at least a real answer about the
 * real upload. The failure is logged so the operator can see it.
 */
/**
 * unstable_cache needs Next's incremental cache, which only exists inside a
 * request or a render. Outside one -- a unit test, a build-time evaluation -- it
 * throws its OWN invariant before the wrapped function is ever called. That is a
 * different failure from "the probe failed", and treating it as one would mean
 * this guard silently never fires anywhere the cache is absent.
 */
function isDataCacheUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("incrementalCache") || message.includes("unstable_cache");
}

export async function getStorageStatus(organizationId: string | null): Promise<boolean> {
  if (!organizationId) return true;
  try {
    let status: StorageStatus;
    try {
      status = await readStorageStatus(organizationId);
    } catch (cacheErr) {
      if (!isDataCacheUnavailable(cacheErr)) throw cacheErr;
      // The answer is still right; it is just not cached this time.
      status = await callVeridian<StorageStatus>("/storage-status", { organizationId });
    }
    return status.storageConfigured !== false;
  } catch (err) {
    console.error(
      "[storage-status] could not read VERIDIAN's storage status -- treating storage as available:",
      err instanceof Error ? err.message : err
    );
    return true;
  }
}
