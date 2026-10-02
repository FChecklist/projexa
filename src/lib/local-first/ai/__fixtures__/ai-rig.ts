// Test rig for the browser AI surface: the shared fake sync server, a fake local database (fake-indexeddb) filled by
// the REAL replica, the REAL outbox, and the stored identity of a person with the role under test.

import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { createOutbox, type Outbox } from "../../outbox";
import { createReplica } from "../../replica";
import { createAiSurface, type AiSurface, type AiSurfaceDeps } from "../api";
import { AI_IDENTITY_KEY, type AiIdentity } from "../identity";

export type AiRig = {
  idb: IDBFactory;
  server: FakeSyncServer;
  outbox: Outbox;
  surface: AiSurface;
  enqueued: () => number;
  setIdentity: (patch: Partial<AiIdentity> | null) => Promise<void>;
};

export const KINDS = [{ kind: "tasks" }, { kind: "rfis" }, { kind: "boq_lines" }, { kind: "boqs" }, { kind: "material_receipts" }, { kind: "documents" }];

export function seed(s: FakeSyncServer) {
  s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Pour slab", statusId: "s1", priority: "medium", completionPercentage: 10 } });
  s.upsert({ kind: "tasks", projectId: "p2", id: "t2", data: { title: "Paint lobby", statusId: "s1", priority: "low", completionPercentage: 0 } });
  s.upsert({ kind: "rfis", projectId: "p1", id: "r1", data: { subject: "Door hardware", question: "Which hinge?", status: "open", answer: null } });
  s.upsert({ kind: "boqs", projectId: "p1", id: "b1", data: { status: "draft", version: 1 } });
  s.upsert({ kind: "material_receipts", projectId: "p1", id: "mr1", data: { number: "GRN-7", quantity: 40 } });
  // lf-e11: a removal that is NOT money-sensitive (dispose_document), so "act without asking" can be tested both ways.
  s.upsert({ kind: "documents", projectId: "p1", id: "d1", data: { name: "Old survey", category: "survey" } });
}

export async function makeRig(opts: { role?: string | null; actWithoutAsking?: boolean; sync?: boolean; deps?: Partial<AiSurfaceDeps> } = {}): Promise<AiRig> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ projects: ["p1", "p2"], kinds: KINDS });
  seed(server);
  if (opts.sync !== false) await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  let n = 0;
  const real = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++n}`, backoffBaseMs: 0, backoffMaxMs: 0 });
  let enqueued = 0;
  const outbox: Outbox = { ...real, enqueue: async (input) => { enqueued += 1; return real.enqueue(input); } };

  const setIdentity = async (patch: Partial<AiIdentity> | null) => {
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    try {
      if (patch === null) { await db.setMeta(AI_IDENTITY_KEY, undefined); return; }
      const base: AiIdentity = {
        userId: "u1", orgId: "orgA", name: "Asha", role: "member",
        projects: [{ id: "p1", name: "Harbor View" }, { id: "p2", name: "Cedar Villa" }],
        settings: { aiActWithoutAsking: false }, at: 1,
      };
      await db.setMeta(AI_IDENTITY_KEY, { ...base, ...patch });
    } finally {
      db.close();
    }
  };
  if (opts.sync !== false && opts.role !== null) await setIdentity({ role: opts.role ?? "member", settings: { aiActWithoutAsking: opts.actWithoutAsking === true } });

  let ids = 0;
  const surface = createAiSurface({ userId: "u1", idb, outbox, newId: () => `id${++ids}`, now: () => 1000, ...opts.deps });
  return { idb, server, outbox, surface, enqueued: () => enqueued, setIdentity };
}
