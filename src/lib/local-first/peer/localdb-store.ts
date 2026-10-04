// LOCAL-FIRST PEERS: the PeerStore of protocol.ts over the person's own local database (local-db.ts, schema 3).
//
// What may leave this laptop is decided by local-db.ts's own isShareable(): a row with a server signature and key id and no
// pending local edit. What comes in is written with `fromServer: true`, so local-db.ts's own rule still holds even in a race
// (a row that became dirty between the check and the write is parked in serverCopy, never overwritten).

import { isShareable, type LocalDb, type LocalRecord } from "../local-db";
import { digestOf, type PeerStore, type ProjectSummary } from "./protocol";
import type { SignedRow } from "./verify";

function rawId(r: LocalRecord): string {
  return r.id.startsWith(`${r.type}:`) ? r.id.slice(r.type.length + 1) : r.id;
}

function toSigned(r: LocalRecord): SignedRow | null {
  if (!isShareable(r) || r.projectId === null || r.serverVersion === undefined || !r.serverUpdatedAt) return null;
  return { project: r.projectId, kind: r.type, id: rawId(r), version: r.serverVersion, updated_at: r.serverUpdatedAt, data: r.data, sig: r.sig!, kid: r.kid!, ...(r.sig3 ? { sig3: r.sig3 } : {}) };
}

export function createLocalDbPeerStore(db: LocalDb, orgId: string): PeerStore {
  async function projectRows(project: string): Promise<LocalRecord[]> {
    return (await db.listByOrg(orgId)).filter((r) => r.projectId === project);
  }
  return {
    async summary(project) {
      const byKind = new Map<string, Array<[string, number]>>();
      for (const r of await projectRows(project)) {
        const s = toSigned(r);
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
      return (await db.listByProject(orgId, kind, project)).map((r) => [rawId(r), r.serverVersion ?? -1] as [string, number]);
    },
    async shareable(project, kind) {
      const out: SignedRow[] = [];
      for (const r of await db.listByProject(orgId, kind, project)) {
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
    async apply(rows) {
      return db.putRecords(
        rows.map((r) => ({
          id: `${r.kind}:${r.id}`, type: r.kind, orgId, projectId: r.project, data: r.data,
          updatedAt: Date.parse(r.updated_at) || Date.now(),
          serverUpdatedAt: r.updated_at, serverVersion: r.version, sig: r.sig, kid: r.kid, ...(r.sig3 ? { sig3: r.sig3 } : {}),
        })),
        { fromServer: true },
      );
    },
  };
}
