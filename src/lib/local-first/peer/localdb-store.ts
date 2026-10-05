// LOCAL-FIRST PEERS: the PeerStore of protocol.ts over the person's own local database (local-db.ts, schema 5).
//
// What may leave this laptop is decided by local-db.ts's own isShareable(): a row with a server signature and key id and no
// pending local edit -- and (AUDIT-100 B8) not a row a peer said the server deleted, until the server has been asked (PEER_SUSPECT_KEY).
// What comes in is written with `fromServer: true`, so local-db.ts's own rules still hold even in a race (a row that became dirty between
// the check and the write is parked in serverCopy, never overwritten; a row whose id has a tombstone at that version or newer is never stored).

import {
  PEER_SUSPECT_KEY, SUSPECT_MAX, SUSPECT_TTL_MS, isShareable, peerTouchedKey, tombstoneBlocks, type LocalDb, type LocalRecord, type PeerSuspect,
} from "../local-db";
import { digestOf, type PeerStore, type ProjectSummary } from "./protocol";
import type { SignedRow } from "./verify";

function rawId(r: LocalRecord): string {
  return r.id.startsWith(`${r.type}:`) ? r.id.slice(r.type.length + 1) : r.id;
}

function toSigned(r: LocalRecord): SignedRow | null {
  if (!isShareable(r) || r.projectId === null || r.serverVersion === undefined || !r.serverUpdatedAt) return null;
  return { project: r.projectId, kind: r.type, id: rawId(r), version: r.serverVersion, updated_at: r.serverUpdatedAt, data: r.data, sig: r.sig!, kid: r.kid!, ...(r.sig3 ? { sig3: r.sig3 } : {}) };
}

/** A tombstone of unknown version is sent in `known` as this (no real version reaches it), so a peer sends nothing older. */
const ANY_VERSION = Number.MAX_SAFE_INTEGER;

export function createLocalDbPeerStore(db: LocalDb, orgId: string, now: () => number = () => Date.now()): PeerStore {
  async function suspects(): Promise<Set<string>> {
    const list = (await db.getMeta<PeerSuspect[] | null>(PEER_SUSPECT_KEY)) ?? [];
    return new Set(list.filter((s) => now() - s.at < SUSPECT_TTL_MS).map((s) => `${s.kind}:${s.id}`));
  }
  async function projectRows(project: string): Promise<LocalRecord[]> {
    return (await db.listByOrg(orgId)).filter((r) => r.projectId === project);
  }
  return {
    async summary(project) {
      const held = await suspects();
      const byKind = new Map<string, Array<[string, number]>>();
      for (const r of await projectRows(project)) {
        const s = held.has(r.id) ? null : toSigned(r);
        if (!s) continue;
        let list = byKind.get(s.kind);
        if (!list) byKind.set(s.kind, (list = []));
        list.push([s.id, s.version]);
      }
      const out: ProjectSummary = {};
      for (const [kind, list] of byKind) out[kind] = { n: list.length, digest: await digestOf(list) };
      return out;
    },
    async known(project, kind) {
      const rows = (await db.listByProject(orgId, kind, project)).map((r) => [rawId(r), r.serverVersion ?? -1] as [string, number]);
      // AUDIT-100 B8: what the server deleted is "known" at the deleted version, so a peer does not even send its older copy
      const have = new Set(rows.map(([id]) => id));
      for (const t of await db.listTombstones(orgId, kind, project)) {
        const id = t.id.slice(kind.length + 1);
        if (!have.has(id)) rows.push([id, t.version ?? ANY_VERSION]);
      }
      return rows;
    },
    async shareable(project, kind) {
      const held = await suspects();
      const out: SignedRow[] = [];
      for (const r of await db.listByProject(orgId, kind, project)) {
        if (held.has(r.id)) continue; // a peer said the server deleted it: not handed on before the server has been asked
        const s = toSigned(r);
        if (s) out.push(s);
      }
      return out;
    },
    async local(kind, id) {
      const r = await db.getRecord(kind, id);
      if (!r) return null;
      return { dirty: !!r.dirty, serverVersion: r.serverVersion ?? null };
    },
    async deleted(kind, id) {
      const t = (await db.getTombstones([`${kind}:${id}`])).get(`${kind}:${id}`);
      return t && t.orgId === orgId ? { version: t.version } : null;
    },
    async tombstones(project, kind) {
      return (await db.listTombstones(orgId, kind, project)).map((t) => [t.id.slice(kind.length + 1), t.version] as [string, number | null]);
    },
    async suspect(project, kind, ids) {
      if (ids.length === 0) return;
      // only rows this laptop actually holds, at a version the peer's tombstone covers; nothing is deleted here
      const held = await db.getRecordsByIds(ids.map(([id]) => `${kind}:${id}`));
      const fresh: PeerSuspect[] = [];
      for (const [id, version] of ids) {
        const r = held.get(`${kind}:${id}`);
        if (!r || r.orgId !== orgId || r.projectId !== project || r.dirty) continue;
        if (!tombstoneBlocks({ version }, r.serverVersion)) continue;
        fresh.push({ project, kind, id, at: now() });
      }
      if (fresh.length === 0) return;
      const list = ((await db.getMeta<PeerSuspect[] | null>(PEER_SUSPECT_KEY)) ?? []).filter((s) => now() - s.at < SUSPECT_TTL_MS);
      const keys = new Set(list.map((s) => `${s.project}|${s.kind}|${s.id}`));
      for (const s of fresh) if (!keys.has(`${s.project}|${s.kind}|${s.id}`)) list.push(s);
      await db.setMeta(PEER_SUSPECT_KEY, list.slice(-SUSPECT_MAX)); // bounded: the oldest hints go first
    },
    async apply(rows) {
      // one write per (project, kind), so each pair that really took rows is marked for its id-list check (AUDIT-100 B8)
      const groups = new Map<string, SignedRow[]>();
      for (const r of rows) groups.set(`${r.project}|${r.kind}`, [...(groups.get(`${r.project}|${r.kind}`) ?? []), r]);
      let written = 0;
      for (const group of groups.values()) {
        const n = await db.putRecords(
          group.map((r) => ({
            id: `${r.kind}:${r.id}`, type: r.kind, orgId, projectId: r.project, data: r.data,
            updatedAt: Date.parse(r.updated_at) || Date.now(),
            serverUpdatedAt: r.updated_at, serverVersion: r.version, sig: r.sig, kid: r.kid, ...(r.sig3 ? { sig3: r.sig3 } : {}),
          })),
          { fromServer: true },
        );
        if (n > 0) await db.setMeta(peerTouchedKey(group[0]!.project, group[0]!.kind), { at: now() });
        written += n;
      }
      return written;
    },
  };
}
