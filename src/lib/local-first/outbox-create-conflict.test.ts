// A CREATE that the server answers `conflict` (outbox.ts flush). The real service never does this (compliance-tracker drizzle/0681: a
// conflict needs a base version, and a create carries none), but a newer or broken server could -- and before lf-e10a (2026-10-02) the
// outbox did nothing with it: the op stayed due and was re-sent in a tight loop (502 pushes in 5 s in a real Chromium,
// e2e/lf-delivery-writes.spec.ts "a conflict answer to a create ..."), hammering the server and never telling the person. It is now
// settled like a rejection: dropped, the optimistic row undone, the person told in words, what they typed kept as a draft.

import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "./local-db";
import { createOutbox } from "./outbox";
import { MANIFEST_KEY } from "./replica";
import type { PushResult, SyncClient } from "./sync-client";

const LIMIT = 25; // a client that stops answering after this many pushes, so the pre-fix loop ends and the test can report it

async function setup() {
  const idb = new IDBFactory();
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: ["material_issues"], at: 1 });
  db.close();
  let pushes = 0;
  const client: Pick<SyncClient, "push" | "pullIds"> = {
    pullIds: async () => ({ ids: [], has_more: false, next_id: null }) as never,
    push: async (req) => {
      pushes += 1;
      if (pushes > LIMIT) throw new Error("the outbox kept re-sending the same create");
      return { results: req.ops.map((o): PushResult => ({ op_id: o.op_id, status: "conflict", version: 2 })) };
    },
  };
  let n = 0;
  const outbox = createOutbox({
    userId: "u1", client, deviceId: "dev-1", idb, now: () => 1_800_000_000_000, sleep: async () => {}, autoFlush: false, newOpId: () => `op-${++n}`, locks: null,
  } as Parameters<typeof createOutbox>[0]);
  return { idb, outbox, pushes: () => pushes };
}

describe("a create answered `conflict`", () => {
  test("is sent once, not again and again; the person is told; the text is kept; the waiting row is undone", async () => {
    const { idb, outbox, pushes } = await setup();
    await outbox.enqueue({
      functionId: "record_material_issue", projectId: "p1", label: "Material issue",
      params: { projectId: "p1", materialId: "m1", quantity: 5, issuedDate: "2026-10-02", issuedTo: "Joseph" },
      creates: { kind: "material_issues", id: "local-1" },
      optimistic: async (tx) => {
        await tx.putRecord({ id: "material_issues:local-1", type: "material_issues", orgId: "orgA", projectId: "p1", data: { id: "local-1", quantity: 5 } });
      },
    });
    await outbox.flush().catch(() => {});
    await outbox.flush().catch(() => {});
    expect(pushes()).toBe(1);

    const state = await outbox.refresh();
    expect(state.pending).toBe(0);
    expect(state.drafts.map((d) => [d.opId, d.params.issuedTo, d.params.quantity])).toEqual([["op-1", "Joseph", 5]]);
    expect(state.notices.map((n) => n.message)).toEqual([expect.stringContaining("Material issue was not saved.")]);

    const db = await openLocalDb(idb, localDbNameFor("u1"));
    try {
      expect(await db.getRecord("material_issues", "local-1")).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
