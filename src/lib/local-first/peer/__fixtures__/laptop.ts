// TEST ONLY: a simulated laptop -- its own fake IndexedDB database, its own attestation, rows stored as a server pull stores them.

import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb, type LocalDb } from "../../local-db";
import { foreignOrg } from "../../replica";
import { createLocalDbPeerStore } from "../localdb-store";
import { createPeerSession, type PeerSession, type PeerSessionOptions } from "../protocol";
import { createMemoryLinkPair } from "../transport";
import { createKeyRing, verifyToken, type KeyRing, type PeerClaims, type SignedRow } from "../verify";
import type { TestSigner } from "./test-signer";

export type Laptop = {
  userId: string;
  org: string;
  /** This laptop's own IndexedDB factory (AUDIT-100 B8: a replica on the same laptop opens the same database). */
  idb: IDBFactory;
  db: LocalDb;
  keys: KeyRing;
  self: { token: string; claims: PeerClaims };
  /** Stores a server-signed row exactly as replica.ts would after a pull. */
  seed(row: Omit<SignedRow, "sig" | "kid">, opts?: { unsigned?: boolean; dirty?: string }): Promise<void>;
  get(kind: string, id: string): Promise<Awaited<ReturnType<LocalDb["getRecord"]>>>;
};

export async function makeLaptop(signer: TestSigner, o: { userId: string; org: string; view: string; projects: string[]; nowMs: number; exp?: number }): Promise<Laptop> {
  const idb = new IDBFactory();
  const db = await openLocalDb(idb, localDbNameFor(o.userId));
  const keys = createKeyRing(db);
  await keys.replace([signer.publicKey]);
  const token = await signer.token({ sub: o.userId, org: o.org, view: o.view, projects: o.projects, exp: o.exp }, o.nowMs);
  const v = await verifyToken(token, keys, o.nowMs);
  const claims: PeerClaims = v.ok ? v.claims : { typ: "px-peer", v: 1, sub: o.userId, org: o.org, projects: o.projects, view: o.view, iat: 0, exp: 0 };
  return {
    userId: o.userId,
    org: o.org,
    idb,
    db,
    keys,
    self: { token, claims },
    async seed(row, opts = {}) {
      const signed = await signer.row(o.org, row);
      await db.putRecord({
        id: `${row.kind}:${row.id}`, type: row.kind, orgId: o.org, projectId: row.project, data: row.data,
        serverVersion: row.version, serverUpdatedAt: row.updated_at,
        ...(opts.unsigned ? {} : { sig: signed.sig, kid: signed.kid }),
        ...(opts.dirty ? { dirty: opts.dirty } : {}),
      });
    },
    get: (kind, id) => db.getRecord(kind, id),
  };
}

export type Pair = { a: PeerSession; b: PeerSession; refusedA: string[]; refusedB: string[] };

/** Connects two laptops over the in-memory transport and runs one exchange to the end. */
export async function connect(x: Laptop, y: Laptop, extra: { nowMs: number; tapAtoB?: (t: string) => string | null; tapBtoA?: (t: string) => string | null; a?: Partial<PeerSessionOptions>; b?: Partial<PeerSessionOptions> }): Promise<Pair> {
  const [la, lb] = createMemoryLinkPair({ tapAtoB: extra.tapAtoB, tapBtoA: extra.tapBtoA });
  const refusedA: string[] = [];
  const refusedB: string[] = [];
  const a = createPeerSession({ link: la, self: x.self, keys: x.keys, store: createLocalDbPeerStore(x.db, x.org), now: () => extra.nowMs, foreignOrg, onRefused: (r) => refusedA.push(r), ...extra.a });
  const b = createPeerSession({ link: lb, self: y.self, keys: y.keys, store: createLocalDbPeerStore(y.db, y.org), now: () => extra.nowMs, foreignOrg, onRefused: (r) => refusedB.push(r), ...extra.b });
  await Promise.race([Promise.all([a.ready, b.ready]), new Promise((r) => setTimeout(r, 3000))]);
  // let the last in-flight messages land
  await new Promise((r) => setTimeout(r, 20));
  return { a, b, refusedA, refusedB };
}
