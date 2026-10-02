// LOCAL-FIRST AUTO-SYNC: the server half of one scheduled run, built to cost almost nothing when nothing changed.
//
// Before any pull it asks each project's change feed for its head only (`POST /changes {after_seq: null}`: one tiny row of SQL,
// no data) and compares it with the position the replica has stored (meta `sync:changes:<project>`). Only when a head moved, a
// project is new, or no manifest is stored yet does it run the real replica sync (which itself only pulls what changed).
// It also refreshes the peer attestation when it is close to expiry (attest.ts), so peers keep working through a later outage.

import { changeCursorKey } from "../local-db";
import { MANIFEST_KEY, type StoredManifest } from "../replica";
import type { StepResult } from "./scheduler";
import type { MetaStore } from "./verify";

export type ServerStepOptions = {
  meta: MetaStore;
  /** The head check: a SyncClient's `changes` call. */
  changes: (req: { projectId: string; afterSeq: number | null; limit?: number }) => Promise<{ head_seq: number }>;
  /** The full (incremental) replica sync. */
  sync: () => Promise<{ status: string }>;
  /** Refreshes the attestation when needed (attest.ts AttestationSource.refresh); optional. */
  refreshAttestation?: () => Promise<unknown>;
};

export function createServerStep(o: ServerStepOptions): () => Promise<StepResult> {
  return async () => {
    const att = o.refreshAttestation ? o.refreshAttestation().catch(() => null) : null;
    try {
      const manifest = await o.meta.getMeta<StoredManifest>(MANIFEST_KEY);
      let moved = !manifest || !Array.isArray(manifest.projectIds) || manifest.projectIds.length === 0;
      if (!moved) {
        for (const projectId of manifest!.projectIds) {
          const stored = await o.meta.getMeta<{ seq: number } | null>(changeCursorKey(projectId));
          if (!stored || typeof stored.seq !== "number") { moved = true; break; }
          const head = await o.changes({ projectId, afterSeq: null });
          if (head.head_seq > stored.seq) { moved = true; break; }
        }
      }
      if (!moved) return { changed: false };
      const report = await o.sync();
      if (report.status === "error" || report.status === "signed_out" || report.status === "update_required") throw new Error(`sync ${report.status}`);
      return { changed: true };
    } finally {
      await att;
    }
  };
}
