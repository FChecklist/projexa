// LOCAL-FIRST AUTO-SYNC: the server half of one scheduled run, built to cost almost nothing when nothing changed.
//
// TWO MODES.
//   * project mode (`syncProject` given; what peer-shared.ts wires since package lf-e6): every run reads the change feed of
//     the project the person has OPEN (`activeProject`), and of every other project at most once per `othersEveryMs`
//     (default one hour), through the replica's one-project run -- which, for a project already copied, is ONE
//     `POST /changes {after_seq: <stored>}` (plus a pull by ids only for what the feed names). That single call is both the
//     head check and the catch-up, so a moved head costs nothing extra. A WHOLE replica sync (manifest + every project's
//     feed + the spread id repair) runs when nothing is stored yet, when a project has no feed position, or when the last
//     whole sync is older than `fullEveryMs` (default six hours): that is how a project newly given to the person arrives.
//   * head mode (no `syncProject`; the original behaviour, kept for callers that pass only `changes` and `sync`): it asks
//     each project's change feed for its head only (`after_seq: null`) and runs the whole sync when a head moved.
//
// COST, measured by cost/harness.ts (COST_MODEL.md): head mode sent one call per project per run AND re-ran the whole sync on
// any movement; project mode sends one call per run for the open project and one per project per hour for the rest.
// It also refreshes the peer attestation when it is close to expiry (attest.ts), so peers keep working through a later outage.

import { changeCursorKey } from "../local-db";
import { LAST_SYNC_KEY, MANIFEST_KEY, type StoredManifest } from "../replica";
import type { StepResult } from "./scheduler";
import type { MetaStore } from "./verify";

/** What a replica run reports, as far as this step reads it. */
export type StepReport = { status: string; changesApplied?: number; itemsStored?: number; itemsRemoved?: number };

export type ServerStepOptions = {
  meta: MetaStore;
  /** The head check: a SyncClient's `changes` call (head mode only). */
  changes: (req: { projectId: string; afterSeq: number | null; limit?: number }) => Promise<{ head_seq: number }>;
  /** The full (incremental) replica sync. */
  sync: () => Promise<StepReport>;
  /** The replica's one-project run (Replica.syncProject without a kind). Given: project mode. */
  syncProject?: (projectId: string) => Promise<StepReport>;
  /** The project the person has open now (the shell's remembered selection); checked on every run. */
  activeProject?: () => string | null;
  now?: () => number;
  /** Project mode: every other project's feed is read at most this often. Default one hour. */
  othersEveryMs?: number;
  /** Project mode: a whole sync at least this often (new projects, lost projects, the id repair). Default six hours. */
  fullEveryMs?: number;
  /** Refreshes the attestation when needed (attest.ts AttestationSource.refresh); optional. */
  refreshAttestation?: () => Promise<unknown>;
};

export const OTHERS_EVERY_MS = 60 * 60_000;
export const FULL_EVERY_MS = 6 * 60 * 60_000;

const failed = (status: string) => status === "error" || status === "signed_out" || status === "update_required";
const moved = (r: StepReport) => (r.changesApplied ?? 0) + (r.itemsStored ?? 0) + (r.itemsRemoved ?? 0) > 0;

export function createServerStep(o: ServerStepOptions): () => Promise<StepResult> {
  const now = o.now ?? (() => Date.now());
  const othersEveryMs = o.othersEveryMs ?? OTHERS_EVERY_MS;
  const fullEveryMs = o.fullEveryMs ?? FULL_EVERY_MS;
  /** When this step last read each project's feed (memory: an app reload reads each once more). */
  const checkedAt = new Map<string, number>();

  async function wholeSync(projectIds: readonly string[]): Promise<StepResult> {
    const report = await o.sync();
    if (failed(report.status)) throw new Error(`sync ${report.status}`);
    const t = now();
    for (const p of projectIds) checkedAt.set(p, t);
    return { changed: o.syncProject ? moved(report) : true };
  }

  async function projectMode(manifest: StoredManifest | undefined): Promise<StepResult> {
    const projectIds = manifest && Array.isArray(manifest.projectIds) ? manifest.projectIds : [];
    const last = await o.meta.getMeta<{ at: number } | null>(LAST_SYNC_KEY);
    if (projectIds.length === 0 || !last || typeof last.at !== "number" || now() - last.at >= fullEveryMs) return wholeSync(projectIds);

    const active = o.activeProject?.() ?? null;
    const due = projectIds.filter((p) => p === active || now() - (checkedAt.get(p) ?? Number.NEGATIVE_INFINITY) >= othersEveryMs);
    let changed = false;
    for (const projectId of due) {
      const stored = await o.meta.getMeta<{ seq: number } | null>(changeCursorKey(projectId));
      if (!stored || typeof stored.seq !== "number") return wholeSync(projectIds);
      const report = await o.syncProject!(projectId);
      if (failed(report.status)) throw new Error(`sync ${report.status}`);
      checkedAt.set(projectId, now());
      changed = changed || moved(report);
    }
    return { changed };
  }

  async function headMode(manifest: StoredManifest | undefined): Promise<StepResult> {
    let isMoved = !manifest || !Array.isArray(manifest.projectIds) || manifest.projectIds.length === 0;
    if (!isMoved) {
      for (const projectId of manifest!.projectIds) {
        const stored = await o.meta.getMeta<{ seq: number } | null>(changeCursorKey(projectId));
        if (!stored || typeof stored.seq !== "number") { isMoved = true; break; }
        const head = await o.changes({ projectId, afterSeq: null });
        if (head.head_seq > stored.seq) { isMoved = true; break; }
      }
    }
    if (!isMoved) return { changed: false };
    return wholeSync(manifest?.projectIds ?? []);
  }

  return async () => {
    const att = o.refreshAttestation ? o.refreshAttestation().catch(() => null) : null;
    try {
      const manifest = await o.meta.getMeta<StoredManifest>(MANIFEST_KEY);
      return o.syncProject ? await projectMode(manifest) : await headMode(manifest);
    } finally {
      await att;
    }
  };
}
