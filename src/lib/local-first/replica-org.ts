// LOCAL-FIRST ORGANISATION KINDS (package lf-e7, requirements R4 / G5: "the complete database of that user AND THEIR ORGANISATION as
// per role"). The backend serves nine organisation kinds beside the 28 project kinds (drizzle/0684: vendors, customers, companies,
// boq_categories, currencies, exchange_rates, departments, org_people, cost_visibility), role-gated and column-redacted on the server,
// under the sentinel project "__org__" (ORG_PROJECT). The replica (replica.ts) copies them exactly like a project's kinds -- the same
// keyset pull and cursor, the same pull by ids, the same id-inventory repair for deletes, the same change feed (/changes with project
// "__org__": updates and tombstones of only the kinds the role may read), the same version and dirty-row rules, and each row keeps its
// server signature (signed with project "__org__", so the peer layer verifies it like any other row). This file holds the two pieces
// that differ:
//
//   * orgKindsOf(manifest): which organisation kinds to copy (only those the manifest lists: the role decides on the server; a viewer
//     gets cost_visibility only, an older service none), which of them the feed carries deletes for, and which must never move laptop
//     to laptop (`peer_shareable: false`: org_people carries the person's own unmasked email);
//   * checkOrganisation(...): the organisation's share of a scheduler round. COST: at most once per `everyMs` (default one hour) a
//     one-project run sends ONE GET /heads (drizzle/0686) -- which also names the person's classes and the epoch, so a role change, a
//     cost-visibility change or a restored database is noticed within the hour without asking for the manifest -- and a /changes for
//     the organisation ONLY when its head moved. With an older service (no /heads: 404) it sends the one /changes instead. Nothing
//     happens before a whole run has copied the organisation once (that run also takes the feed position).

import { changeCursorKey, type LocalDb } from "./local-db";
import { ORG_CHECK_KEY, classKey, classSignal, noteEpoch, type StoredClass } from "./replica-class";
import { ORG_PROJECT, SyncError, type HeadsAnswer, type SyncClient, type SyncManifest } from "./sync-client";

export { ORG_PROJECT };

export const ORG_CHECK_EVERY_MS = 60 * 60_000;

/** Kinds that never move between laptops whatever the manifest says (handler README "Peers": the person's own row is unmasked). */
export const NEVER_PEER_KINDS: readonly string[] = ["org_people"];

export type OrgKinds = { kinds: string[]; feedKinds: string[]; noPeerKinds: string[] };

/** The organisation kinds of a manifest: only well-formed, non-project entries, never one of the project kinds' names. Pure. */
export function orgKindsOf(manifest: Pick<SyncManifest, "org_kinds" | "kinds">): OrgKinds {
  const projectKinds = new Set(manifest.kinds.map((k) => k.kind));
  const list = (manifest.org_kinds ?? []).filter((k) => typeof k.kind === "string" && k.kind !== "" && !projectKinds.has(k.kind));
  const kinds = [...new Set(list.map((k) => k.kind))];
  return {
    kinds,
    feedKinds: list.filter((k) => k.deletes_supported === true).map((k) => k.kind),
    noPeerKinds: [...new Set([...list.filter((k) => k.peer_shareable === false).map((k) => k.kind), ...NEVER_PEER_KINDS])],
  };
}

export type OrgCheckDeps = {
  db: LocalDb;
  client: SyncClient;
  signal: AbortSignal;
  now: number;
  everyMs: number;
  /** The projects whose recorded class /heads is compared with. */
  projectIds: readonly string[];
  /** Reads the organisation's change feed from the stored position (replica.ts applyChanges for ORG_PROJECT). */
  applyOrgFeed: () => Promise<void>;
};

export type OrgCheckResult = "not_due" | "not_copied" | "unchanged" | "applied";

/** Remembered per page load: this service has no /heads (404), so the organisation check uses the feed directly. */
let headsMissing = false;
/** Tests only. */
export function resetOrgCheckMemory(): void {
  headsMissing = false;
}

/**
 * The organisation's share of a one-project run (see the header). Throws a class signal (replica-class.ts) when /heads names another
 * class or epoch than the ones the rows here were pulled under; the replica then resets and runs again.
 */
export async function checkOrganisation(d: OrgCheckDeps): Promise<OrgCheckResult> {
  const last = await d.db.getMeta<{ at: number } | null>(ORG_CHECK_KEY);
  if (last && typeof last.at === "number" && d.now - last.at < d.everyMs) return "not_due";
  const position = await d.db.getMeta<{ seq: number } | null>(changeCursorKey(ORG_PROJECT));
  if (!position || typeof position.seq !== "number") return "not_copied"; // the next whole run copies it

  let heads: HeadsAnswer | null = null;
  if (!headsMissing && typeof d.client.heads === "function") {
    try {
      heads = await d.client.heads(d.signal);
    } catch (err) {
      if (!(err instanceof SyncError && err.kind === "not_found")) throw err;
      headsMissing = true;
    }
  }
  if (heads) {
    if ((await noteEpoch(d.db, heads.epoch)) === "changed") throw classSignal("epoch_changed", { epoch: heads.epoch ?? undefined });
    const compare: Array<[string, string | null]> = [[ORG_PROJECT, heads.org_view_class], ...d.projectIds.map((p): [string, string | null] => [p, heads!.view_class])];
    for (const [projectId, cls] of compare) {
      if (!cls) continue;
      const stored = await d.db.getMeta<StoredClass | null>(classKey(projectId));
      if (stored && typeof stored.view === "string" && stored.view !== cls) throw classSignal("class_changed", { projectId });
    }
    const head = heads.heads[ORG_PROJECT];
    if (head === undefined || head <= position.seq) {
      await d.db.setMeta(ORG_CHECK_KEY, { at: d.now });
      return "unchanged";
    }
  }
  await d.applyOrgFeed();
  await d.db.setMeta(ORG_CHECK_KEY, { at: d.now });
  return "applied";
}
