// TEST ONLY (AUDIT-100 B8): a tiny in-memory stand-in for the PROJEXA sync service, enough for the REAL replica (replica.ts) to copy rows,
// read the change feed (with its D tombstones), fetch rows by id and list ids. The rows it serves are signed by the test's own signer
// (the same rows the peer laptops hold), so what the replica stores can be handed on over the peer link exactly as in production.
// Used by the unit tests (bun, fake-indexeddb) and by the browser harness (e2e-harness-lf.ts, real Chromium IndexedDB).

import type { ChangesPage, SyncChange, SyncClient, SyncManifest, SyncPage } from "../../sync-client";
import type { SignedRow } from "../verify";

export type StubRow = SignedRow & { deleted?: boolean };

export type StubService = {
  /** The client one laptop's replica uses (the manifest names `userId`). */
  client(userId: string): SyncClient;
  /** A live row (signed by the caller), logged as an I/U change. */
  put(row: SignedRow): void;
  /** The server deletes the row at `version` (a D change in the feed); /pull and /ids stop serving it. */
  remove(project: string, kind: string, id: string, version: number): void;
  /** `n` changes of a kind no laptop syncs: moves the feed head so an older D falls out of a laptop's re-read window. */
  advance(project: string, n: number): void;
  /** Every request, as "path project kind" (the tests count /ids). */
  readonly calls: string[];
};

export function createStubService(o: { org: string; projects: string[]; kinds: string[]; startSeq?: number }): StubService {
  const rows = new Map<string, StubRow>();
  const log: Array<SyncChange & { project: string }> = [];
  let seq = o.startSeq ?? 10;
  const calls: string[] = [];
  const key = (p: string, k: string, id: string) => `${p}|${k}|${id}`;
  const live = (p: string, k: string) => [...rows.values()].filter((r) => r.project === p && r.kind === k && !r.deleted).sort((a, b) => (a.id < b.id ? -1 : 1));
  const item = (r: StubRow) => ({ id: r.id, updated_at: r.updated_at, data: r.data, version: r.version, sig: r.sig, ...(r.sig3 ? { sig3: r.sig3 } : {}) });
  const page = (list: StubRow[], next: string | null): SyncPage => ({ items: list.map(item), kid: list[0]?.kid ?? null, next_cursor: next, has_more: false, hidden_fields: [], redacted: false });

  return {
    calls,
    put(row) {
      rows.set(key(row.project, row.kind, row.id), { ...row });
      seq += 1;
      log.push({ project: row.project, seq, kind: row.kind, id: row.id, version: row.version, op: "U" });
    },
    remove(project, kind, id, version) {
      const r = rows.get(key(project, kind, id));
      if (r) rows.set(key(project, kind, id), { ...r, deleted: true, version });
      seq += 1;
      log.push({ project, seq, kind, id, version, op: "D" });
    },
    advance(project, n) {
      for (let i = 0; i < n; i += 1) { seq += 1; log.push({ project, seq, kind: "__filler__", id: `f${i}`, version: 1, op: "U" }); }
    },
    client(userId) {
      return {
        async manifest() {
          calls.push("/manifest");
          return {
            user: { id: userId, org_id: o.org }, projects: o.projects.map((id) => ({ id, name: id })),
            kinds: o.kinds.map((kind) => ({ kind, project_scoped: true, deletes_supported: true })),
          } as unknown as SyncManifest;
        },
        async pull(req) {
          calls.push(`/pull ${req.projectId} ${req.kind}`);
          return req.after === null ? page(live(req.projectId, req.kind), "end") : page([], null);
        },
        async pullIds(req) {
          calls.push(`/pull-ids ${req.projectId} ${req.kind}`);
          return page(live(req.projectId, req.kind).filter((r) => req.ids.includes(r.id)), null);
        },
        async changes(req): Promise<ChangesPage> {
          calls.push(`/changes ${req.projectId}`);
          if (req.afterSeq === null) return { changes: [], next_seq: seq, has_more: false, head_seq: seq } as ChangesPage;
          const after = req.afterSeq;
          const list = log.filter((c) => c.project === req.projectId && c.seq > after).map(({ project: _p, ...c }) => c);
          return { changes: list, next_seq: Math.max(after, ...list.map((c) => c.seq)), has_more: false, head_seq: seq } as ChangesPage;
        },
        async ids(req) {
          calls.push(`/ids ${req.projectId} ${req.kind}`);
          return { ids: live(req.projectId, req.kind).map((r) => r.id), has_more: false, next_id: null };
        },
      } as unknown as SyncClient;
    },
  };
}
