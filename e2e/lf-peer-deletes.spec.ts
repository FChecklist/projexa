import { test, expect } from "@playwright/test";
import { laptop, relay, T1 } from "./support/lf-peer-browser";
import { createTestServer } from "./support/lf-peer-sign";

// AUDIT-100 B8 (deletes), laptop leg, in a REAL browser: two laptops, each its own browser context (its own real IndexedDB), a real WebRTC
// data channel between them, rows signed by the backend's own signing code, and the REAL replica (replica.ts) syncing against a stub
// sync service for the server side of the delete (src/lib/local-first/peer/__fixtures__/stub-service.ts). No app server, no network.
//
// Laptop A copied meeting m1 at version 1 and has not synced since. Laptop B also held it; the server deletes it (a D in the change feed);
// B syncs and drops it. Then A -- stale -- links with B. Before the fix B stored A's old signed copy again (no tombstone, and the peer
// protocol refused an older row only when a local row existed) and kept it for good. Now: B keeps a tombstone and the row never comes
// back; A is told (an unsigned HINT), stops sharing the row, and drops it when the SERVER confirms at its next sync.
// Run: bunx playwright test -c playwright.peer.config.ts e2e/lf-peer-deletes.spec.ts

const VIEW = "v-site";

test("B8: a record the server deleted is not handed back by a stale peer; the stale laptop drops it once the server confirms", async ({ browser }) => {
  const server = await createTestServer();
  const A = await laptop(browser);
  const B = await laptop(browser);
  await relay({ ua: A, ub: B });
  const m1 = await server.signedRow("o1", VIEW, { project: "p1", kind: "meetings", id: "m1", version: 1, updated_at: T1, data: { title: "Site review" } });
  const keep = await server.signedRow("o1", VIEW, { project: "p1", kind: "meetings", id: "keep", version: 4, updated_at: T1, data: { title: "Weekly" } });

  // A copied both meetings earlier (and has not synced since)
  await A.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows: [m1, keep] });
  // B gets them through a real sync of its replica
  await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [] });
  await B.evaluate(() => window.pxPeerLf!.stubInit({ projects: ["p1"], kinds: ["meetings"] }));
  await B.evaluate((rows) => { for (const r of rows) window.pxPeerLf!.stubPut(r); }, [m1, keep]);
  expect(await B.evaluate(() => window.pxPeerLf!.serverSync())).toEqual({ status: "done", issues: [] });
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["meetings:keep@4", "meetings:m1@1"]);

  // the server deletes m1; B's next sync reads the D from the change feed and drops it -- keeping a tombstone of the delete
  await B.evaluate(() => window.pxPeerLf!.stubRemove("p1", "meetings", "m1", 2));
  expect(await B.evaluate(() => window.pxPeerLf!.serverSync())).toEqual({ status: "done", issues: [] });
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["meetings:keep@4"]);

  // A, still holding the old signed m1, links with B over the real data channel; both exchange to the end
  const tok = (sub: string) => server.attestToken({ sub, org: "o1", view: VIEW, projects: ["p1"] });
  await A.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await tok("ua"));
  await B.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await tok("ub"));
  await expect.poll(() => B.evaluate(() => window.pxPeerLf!.peers()), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => A.evaluate(() => window.pxPeerLf!.peers()), { timeout: 20_000 }).toBe(1);
  // B's resync resolves once every `want` it sent has ended, i.e. after it processed whatever A sent: B's copy is final here
  await A.evaluate(() => window.pxPeerLf!.syncAll());
  await B.evaluate(() => window.pxPeerLf!.syncAll());

  // re-read B's own database: the deleted meeting did NOT come back (before the fix: ["meetings:keep@4", "meetings:m1@1"]), the live one is
  // untouched, and B's tombstone of the server's delete is still there
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["meetings:keep@4"]);
  expect(await B.evaluate(() => window.pxPeerLf!.rec("meetings", "m1"))).toBeNull();
  expect(await B.evaluate(() => window.pxPeerLf!.tombstones("meetings", "p1"))).toEqual(["meetings:m1@2"]);
  // A has been told (a hint it must check with the server)
  await expect.poll(() => A.evaluate(() => window.pxPeerLf!.suspects()), { timeout: 20_000 }).toEqual(["meetings:m1"]);
  // a peer's word deletes nothing: A still holds m1 until the server confirms
  expect(await A.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["meetings:keep@4", "meetings:m1@1"]);

  // A's next server sync (its feed has moved on past the D, so only the hint can tell it) asks about m1 by id and drops it with a tombstone
  await A.evaluate(() => window.pxPeerLf!.stubInit({ projects: ["p1"], kinds: ["meetings"] }));
  await A.evaluate((rows) => { for (const r of rows) window.pxPeerLf!.stubPut(r); }, [m1, keep]);
  await A.evaluate(() => { window.pxPeerLf!.stubRemove("p1", "meetings", "m1", 2); window.pxPeerLf!.stubAdvance("p1", 300); });
  expect(await A.evaluate(() => window.pxPeerLf!.serverSync())).toEqual({ status: "done", issues: [] });
  expect(await A.evaluate(() => window.pxPeerLf!.stubCalls())).toContain("/pull-ids p1 meetings");
  expect(await A.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["meetings:keep@4"]);
  expect(await A.evaluate(() => window.pxPeerLf!.tombstones("meetings", "p1"))).toEqual(["meetings:m1@1"]);
  expect(await A.evaluate(() => window.pxPeerLf!.suspects())).toEqual([]);
});
