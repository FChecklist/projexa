// LOCAL-FIRST ORGANISATION READS (package lf-e7): the laptop's own copy of the organisation kinds (replica-org.ts), for the screens.
//
//   loadOrgLocal(kind, options)   -> { state: "not_allowed" }                the person's role may not read this kind (the server sends
//                                                                              nothing of it, e.g. vendors to a viewer): say so calmly
//                                   { state: "not_synced" }                 not on this laptop yet (never synced, or an older service)
//                                   { state: "local", rows, syncedAt }      every row of that kind of the person's organisation
//
// It reads ONLY the local database, never the server. Rows are untrusted input: anything that is not a plain object with a string `id`
// is left out, never cast. "Synced" means the replica pulled that kind to the end at least once (replica.ts doneKey under ORG_PROJECT):
// a half-copied vendor list is not shown as the whole one. What the role may read is what the server decided (`org_kinds` of the last
// manifest, which replica-class.ts keeps the laptop in step with): this file adds no rule of its own, it only refuses to show what
// the last manifest did not list.

import { localDbNameFor, openLocalDb, type LocalDb } from "./local-db";
import { resolveLocalUserId, type LocalAccess } from "./local-reader";
import { MANIFEST_KEY, doneKey, type DoneMarker, type StoredManifest } from "./replica";
import { ORG_PROJECT } from "./sync-client";

export type OrgRow = Record<string, unknown> & { id: string };

export type OrgLocalResult<T extends OrgRow = OrgRow> =
  | { state: "not_allowed" }
  | { state: "not_synced" }
  | { state: "local"; rows: T[]; syncedAt: number; hiddenFields: string[] };

export type LoadOrgOptions<T extends OrgRow> = LocalAccess & {
  filter?: (row: T) => boolean;
  sort?: (a: T, b: T) => number;
  limit?: number;
};

function isOrgRow(v: unknown): v is OrgRow {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { id?: unknown }).id === "string";
}

async function withDb<T>(access: LocalAccess, fn: (db: LocalDb) => Promise<T>): Promise<T | null> {
  if (access.db) return fn(access.db);
  const userId = access.userId ?? (await resolveLocalUserId());
  if (!userId) return null;
  const idb = access.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb) return null;
  const db = await openLocalDb(idb, localDbNameFor(userId));
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

/** The organisation's rows of one kind from this laptop, or why there are none (see the header). Never throws: a failed read is "not_synced". */
export async function loadOrgLocal<T extends OrgRow = OrgRow>(kind: string, options: LoadOrgOptions<T> = {}): Promise<OrgLocalResult<T>> {
  try {
    const out = await withDb(options, async (db): Promise<OrgLocalResult<T>> => {
      const manifest = await db.getMeta<StoredManifest | null>(MANIFEST_KEY);
      if (!manifest || !Array.isArray(manifest.orgKinds)) return { state: "not_synced" };
      if (!manifest.orgKinds.includes(kind)) return { state: "not_allowed" };
      const done = await db.getMeta<DoneMarker | null>(doneKey(ORG_PROJECT, kind));
      if (!done) return { state: "not_synced" };
      const records = await db.listByProject(manifest.orgId, kind, ORG_PROJECT);
      let rows = records.map((r) => r.data).filter(isOrgRow) as T[];
      if (options.filter) rows = rows.filter(options.filter);
      if (options.sort) rows = [...rows].sort(options.sort);
      if (options.limit !== undefined) rows = rows.slice(0, Math.max(0, options.limit));
      return { state: "local", rows, syncedAt: done.at, hiddenFields: Array.isArray(done.hiddenFields) ? done.hiddenFields : [] };
    });
    return out ?? { state: "not_synced" };
  } catch {
    return { state: "not_synced" };
  }
}

/** Plain words for a screen, for each state that has no rows. */
export function orgStateWords(state: "not_allowed" | "not_synced", what: string): string {
  return state === "not_allowed"
    ? `Your role does not include the organisation's ${what}, so they are not on this laptop.`
    : `The organisation's ${what} are not on this laptop yet. They arrive with the next sync.`;
}
