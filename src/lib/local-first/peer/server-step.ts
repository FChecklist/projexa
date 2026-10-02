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
//   * heads mode (`heads` given, on top of project mode; package FC, review cost:COST-03 / wire:F07; what peer-shared.ts wires): ONE
//     `GET /heads` per run answers "did anything I may see change?" for every project at once (backend drizzle/0686). Then
//       - `projects_etag` differs from the stored one   -> a whole sync (the manifest: a project given or taken away);
//       - `view_class` or `epoch` differs                -> `resetCopy` (the copy was taken under another role's redaction, or the
//                                                           server's version tables were re-created) and a whole sync;
//       - `org_view_class` differs / the "__org__" head  -> handed to `onOrgClassChanged` / `onOrgHead` (EXTENSION POINT for package
//                                                           E7, which adds the organisation kinds; nothing here reads them yet);
//       - a project's head is past its stored feed cursor -> that project's one-project run (/changes from the cursor, then a pull by
//                                                           ids of only what moved) -- and NOTHING for the projects that did not move.
//     Nothing changed: the run cost exactly one request. A whole sync still runs at least every `headsFullEveryMs` (default a day)
//     for the spread delete repair. An OLDER service without /heads (404) is remembered for `headsRetryMs` (default a day) and the
//     step falls back to project mode meanwhile; any other failure of /heads throws (the scheduler counts the server as unreachable).
//
// COST, measured by cost/harness.ts (COST_MODEL.md): head mode sent one call per project per run AND re-ran the whole sync on
// any movement; project mode sends one call per run for the open project and one per project per hour for the rest; heads
// mode sends one call per run, plus a feed read only for a project that really moved.
// It also refreshes the peer attestation when it is close to expiry (attest.ts), so peers keep working through a later outage.

import { changeCursorKey } from "../local-db";
import { LAST_SYNC_KEY, MANIFEST_KEY, type StoredManifest } from "../replica";
import { ORG_HEAD_KEY, SyncError, type HeadsAnswer } from "../sync-client";
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
  /**
   * The replica's one-project run (Replica.syncProject without a kind). Given: project mode. Heads mode passes `{ moved: true }`
   * (the project's head DID move): the replica must not skip it on its "read a moment ago" shortcut.
   */
  syncProject?: (projectId: string, options?: { moved?: boolean }) => Promise<StepReport>;
  /** The project the person has open now (the shell's remembered selection); checked on every run. */
  activeProject?: () => string | null;
  now?: () => number;
  /** Project mode: every other project's feed is read at most this often. Default one hour. */
  othersEveryMs?: number;
  /** Project mode: a whole sync at least this often (new projects, lost projects, the id repair). Default six hours. */
  fullEveryMs?: number;
  /** Refreshes the attestation when needed (attest.ts AttestationSource.refresh); optional. */
  refreshAttestation?: () => Promise<unknown>;
  /** Heads mode (needs `syncProject`): the one-call poll, a SyncClient's `heads`. */
  heads?: () => Promise<HeadsAnswer>;
  /** Heads mode: drops the copy's non-dirty rows and positions (reset-copy.ts) before the whole sync that rebuilds it. */
  resetCopy?: () => Promise<void>;
  /** EXTENSION POINT (package E7): the organisation feed's head, every heads run (the organisation kinds are E7's to pull). */
  onOrgHead?: (head: number) => Promise<void> | void;
  /** EXTENSION POINT (package E7): the organisation view class changed (E7 resets its organisation copy). */
  onOrgClassChanged?: (orgViewClass: string | null) => Promise<void> | void;
  /** Heads mode: a whole sync at least this often (the spread delete repair). Default one day. */
  headsFullEveryMs?: number;
  /** Heads mode: after a 404 (an older service) /heads is not asked again for this long. Default one day. */
  headsRetryMs?: number;
};

export const OTHERS_EVERY_MS = 60 * 60_000;
export const FULL_EVERY_MS = 6 * 60 * 60_000;
export const HEADS_FULL_EVERY_MS = 24 * 60 * 60_000;
export const HEADS_RETRY_MS = 24 * 60 * 60_000;
/** What the last /heads run settled on (meta key): the etag, the classes and the epoch the laptop's copy was made under. */
export const HEADS_KEY = "sync:heads";
export type StoredHeads = { etag: string | null; viewClass: string | null; orgViewClass: string | null; epoch: string | null; at: number };

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

  const headsFullEveryMs = o.headsFullEveryMs ?? HEADS_FULL_EVERY_MS;
  const headsRetryMs = o.headsRetryMs ?? HEADS_RETRY_MS;
  /** Set when the service answered /heads with 404 (an older service): project mode until then. Memory only. */
  let headsUnsupportedUntil = Number.NEGATIVE_INFINITY;

  const changedClass = (stored: string | null | undefined, now: string | null) => stored !== undefined && stored !== null && now !== null && stored !== now;

  async function headsMode(manifest: StoredManifest | undefined, answer: HeadsAnswer): Promise<StepResult> {
    const stored = (await o.meta.getMeta<StoredHeads>(HEADS_KEY)) ?? null;
    const settle = () => o.meta.setMeta(HEADS_KEY, {
      etag: answer.projects_etag, viewClass: answer.view_class, orgViewClass: answer.org_view_class, epoch: answer.epoch, at: now(),
    } satisfies StoredHeads);

    // E7's half first: the organisation feed and class are reported, never acted on here.
    if (o.onOrgClassChanged && changedClass(stored?.orgViewClass, answer.org_view_class)) await o.onOrgClassChanged(answer.org_view_class);
    const orgHead = answer.heads[ORG_HEAD_KEY];
    if (o.onOrgHead && typeof orgHead === "number") await o.onOrgHead(orgHead);

    const projectIds = manifest && Array.isArray(manifest.projectIds) ? manifest.projectIds : [];
    const last = await o.meta.getMeta<{ at: number } | null>(LAST_SYNC_KEY);
    // The copy was made under another redaction (a role or cost-visibility change) or another state of the server's version tables:
    // what is stored can no longer be trusted, so it is dropped (pending edits stay) and rebuilt.
    if (changedClass(stored?.viewClass, answer.view_class) || changedClass(stored?.epoch, answer.epoch)) {
      await o.resetCopy?.();
      await wholeSync(projectIds);
      await settle();
      return { changed: true };
    }
    // Nothing copied yet, the projects list changed (given or taken away), or the daily repair is due: a whole sync.
    const etagMoved = stored !== null && stored.etag !== answer.projects_etag;
    if (projectIds.length === 0 || !last || typeof last.at !== "number" || now() - last.at >= headsFullEveryMs || etagMoved) {
      const r = await wholeSync(projectIds);
      await settle();
      return r;
    }
    // The first /heads answer after a recent whole sync (the first copy, an update from an older build): it describes the copy just
    // made, so it is adopted as the baseline instead of paying for another whole sync.
    if (stored === null) await settle();
    let changed = false;
    for (const projectId of projectIds) {
      const head = answer.heads[projectId];
      const cursor = await o.meta.getMeta<{ seq: number } | null>(changeCursorKey(projectId));
      // A project the answer does not name (the etag should have said so) or one never given a feed position: rebuild properly.
      if (typeof head !== "number" || !cursor || typeof cursor.seq !== "number") {
        const r = await wholeSync(projectIds);
        await settle();
        return r;
      }
      if (head <= cursor.seq) continue; // nothing new in this project: not one request for it
      const report = await o.syncProject!(projectId, { moved: true });
      if (failed(report.status)) throw new Error(`sync ${report.status}`);
      checkedAt.set(projectId, now());
      changed = changed || moved(report);
    }
    return { changed };
  }

  return async () => {
    const att = o.refreshAttestation ? o.refreshAttestation().catch(() => null) : null;
    try {
      const manifest = await o.meta.getMeta<StoredManifest>(MANIFEST_KEY);
      if (o.heads && o.syncProject && now() >= headsUnsupportedUntil) {
        let answer: HeadsAnswer | null = null;
        try {
          answer = await o.heads();
        } catch (err) {
          if (!(err instanceof SyncError && err.kind === "not_found")) throw err;
          headsUnsupportedUntil = now() + headsRetryMs; // an older service: fall back below, ask again tomorrow
        }
        if (answer) return await headsMode(manifest, answer);
      }
      return o.syncProject ? await projectMode(manifest) : await headMode(manifest);
    } finally {
      await att;
    }
  };
}
