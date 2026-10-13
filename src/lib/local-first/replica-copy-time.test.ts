import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "./__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "./local-db";
import { createReplica, doneKey, type DoneMarker } from "./replica";

// UAT 2026-10-13, F60 / checklist 2.22: "last copied 12-10-2026 23:51" stayed on a project's screens ALL DAY. The label is the pair's done
// marker (replica.ts DoneMarker.at), written only when a pair is pulled from its cursor to the end. A pair the change feed keeps current is
// never pulled again, so after the first copy the marker never moved, although every later run read the feed and brought the project up to
// date. A run that has read the feed to its end now moves the marker of every feed-covered pair (keeping its redaction), so the screens show
// the time the laptop really last caught up.

const noYield = async () => {};
const MIN = 60_000;
const row = (kind: string, id: string, project = "p1") => ({ kind, projectId: project, id, data: { name: id } });

function setup() {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ projects: ["p1"] });
  const clock = { now: 9_000_000_000 };
  const replica = createReplica({ userId: "u1", client: server.client, idb, yieldFn: noYield, now: () => clock.now });
  const marker = async (kind: string, project = "p1") => {
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    try {
      return await db.getMeta<DoneMarker | null>(doneKey(project, kind));
    } finally {
      db.close();
    }
  };
  return { idb, server, clock, replica, marker };
}

describe("'last copied' moves when the laptop catches up through the change feed", () => {
  test("a whole sync an hour after the first copy, with a change in between: the time on every feed-covered kind is the new one", async () => {
    const r = setup();
    r.server.upsert(row("progress", "e1"));
    r.server.upsert(row("rfis", "a"));
    expect((await r.replica.sync()).status).toBe("done");
    const first = r.clock.now;
    expect((await r.marker("progress"))?.at).toBe(first);

    r.clock.now += 60 * MIN;
    r.server.upsert(row("progress", "e2"));
    const report = await r.replica.sync();
    expect(report.status).toBe("done");
    expect(report.changesApplied).toBeGreaterThan(0); // the data DID arrive through the feed
    expect((await r.marker("progress"))?.at).toBe(r.clock.now);
    expect((await r.marker("rfis"))?.at).toBe(r.clock.now); // a kind that did not change is just as current
  });

  test("a one-project run (the background refresh) moves it too, and keeps what the server hid for this role", async () => {
    const r = setup();
    r.server.upsert(row("progress", "e1"));
    await r.replica.sync();
    const db = await openLocalDb(r.idb, localDbNameFor("u1"));
    const before = (await db.getMeta<DoneMarker>(doneKey("p1", "progress")))!;
    await db.setMeta(doneKey("p1", "progress"), { ...before, redacted: true, hiddenFields: ["amount"] });
    db.close();

    r.clock.now += 30 * MIN;
    expect((await r.replica.syncProject("p1", undefined, undefined, { moved: true })).status).toBe("done");
    expect(await r.marker("progress")).toEqual({ at: r.clock.now, redacted: true, hiddenFields: ["amount"] });
  });

  test("a pair that was never copied to the end does not get a time it has not earned", async () => {
    const r = setup();
    r.server.upsert(row("progress", "e1"));
    await r.replica.sync();
    const db = await openLocalDb(r.idb, localDbNameFor("u1"));
    await db.setMeta(doneKey("p1", "rfis"), null); // never completed
    db.close();
    r.clock.now += 30 * MIN;
    await r.replica.syncProject("p1", "progress", undefined, { moved: true });
    expect((await r.marker("progress"))?.at).toBe(r.clock.now);
    expect(await r.marker("rfis")).toBeNull();
  });
});
