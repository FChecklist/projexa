import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { OUTBOX_NOTICES_KEY, localDbNameFor, openLocalDb } from "./local-db";
import { createOutbox } from "./outbox";
import { keptWorkOnSignOut } from "./outbox-signout";
import { createReplica } from "./replica";

// FB data:F2: an edit the server REFUSED during the sign-out flush (so nothing is pending any more) must not vanish with the
// database in silence. keptWorkOnSignOut is what sign-out.ts asks before deleting (see that file's header for the change).

async function signOutFlushRefuses() {
  const idb = new IDBFactory();
  const server = createFakeSyncServer();
  server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  const outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "d", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => "op-1" });
  await outbox.enqueue({ functionId: "update_task", projectId: "p1", params: { issueId: "t1", title: " ", description: "typed before signing out" }, label: "Your change to this task", record: { kind: "tasks", id: "t1", baseVersion: 1 } });
  await outbox.flush(); // the sign-out flush: refused
  expect(await outbox.pendingCount()).toBe(0); // nothing pending: the old sign-out would delete the database silently
  return { idb, outbox };
}

describe("keptWorkOnSignOut (data:F2)", () => {
  test("a refusal during the sign-out flush: the database is KEPT (it holds the person's text) and the sign-out says what was not saved", async () => {
    const { idb } = await signOutFlushRefuses();
    const kept = await keptWorkOnSignOut(idb, localDbNameFor("u1"));
    expect(kept.keep).toBe(true);
    expect(kept.drafts).toBe(1);
    expect(kept.notice).toContain("Your change to this task was not saved.");
    expect(kept.notice).toContain("What you typed is kept on this laptop: sign in again to send it again or discard it.");
  });

  test("once the person discarded the draft there is nothing to keep, and nothing to say", async () => {
    const { idb, outbox } = await signOutFlushRefuses();
    await outbox.discardDraft("op-1");
    expect(await keptWorkOnSignOut(idb, localDbNameFor("u1"))).toEqual({ keep: false, drafts: 0, refused: [], notice: null });
  });

  test("a notice without a draft (an older app) is still SAID, though there is no text to keep", async () => {
    const idb = new IDBFactory();
    const db = await openLocalDb(idb, localDbNameFor("u2"));
    await db.setMeta(OUTBOX_NOTICES_KEY, [{ opId: "x", functionId: "update_task", message: "A change was not saved.", at: 1 }]);
    db.close();
    expect(await keptWorkOnSignOut(idb, localDbNameFor("u2"))).toEqual({ keep: false, drafts: 0, refused: ["A change was not saved."], notice: "A change was not saved." });
  });
});
