import { test, expect } from "@playwright/test";
import { laptop, relay, T1, T2 } from "./support/lf-peer-browser";
import { createTestServer } from "./support/lf-peer-sign";

// lf-e9: which copy wins when two laptops hold different versions of a row, in a REAL browser over a real WebRTC data channel, rows signed
// by the backend's own signing code (e2e/support/lf-peer-sign.ts).
//   (e) a higher version replaces, an older one does not (both directions in one exchange), a row with a pending local edit (dirty, in the
//       outbox) is neither overwritten nor sent; a deletion does NOT travel laptop to laptop (CONTRACT.md section 4: peers never deliver
//       tombstones; AUDIT-100 B8 adds only an unsigned `gone` HINT the receiver checks with the server, and a local tombstone that stops a
//       stale peer re-delivering a row the server deleted: e2e/lf-peer-deletes.spec.ts);
//   (f) a /heads answer with another epoch (the server's version tables were re-created) makes the laptop drop its copy (pending edits kept)
//       and take a fresh one, through the REAL server step and reset-copy.
// Run: bunx playwright test -c playwright.peer.config.ts

const VIEW = "v-site";

test("(e) higher version replaces, older does not, both ways in one exchange; a dirty row is kept and never sent", async ({ browser }) => {
  const server = await createTestServer();
  const A = await laptop(browser);
  const B = await laptop(browser);
  await relay({ ua: A, ub: B });
  const row = (id: string, version: number, data: unknown, at = T1) => server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id, version, updated_at: at, data });
  await A.evaluate((o) => window.pxPeerLf!.setup(o), {
    userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows: [
      await row("newer-on-A", 5, { subject: "A at v5" }, T2),
      await row("newer-on-B", 2, { subject: "A at v2" }),
      await row("dirty-on-B", 6, { subject: "server v6 via A" }, T2),
      { ...(await row("dirty-on-A", 1, { subject: "A's own unsent edit" })), dirty: "op-a-1" },
    ],
  });
  await B.evaluate((o) => window.pxPeerLf!.setup(o), {
    userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [
      await row("newer-on-A", 3, { subject: "B at v3" }),
      await row("newer-on-B", 4, { subject: "B at v4" }, T2),
      { ...(await row("dirty-on-B", 1, { subject: "B's own unsent edit" })), dirty: "op-b-1" },
      await row("dirty-on-A", 7, { subject: "server v7 via B" }, T2),
    ],
  });
  const tok = (sub: string) => server.attestToken({ sub, org: "o1", view: VIEW, projects: ["p1"] });
  await A.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await tok("ua"));
  await B.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await tok("ub"));

  await expect.poll(() => B.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 20_000 }).toEqual(["rfis:dirty-on-A@7", "rfis:dirty-on-B@1*", "rfis:newer-on-A@5", "rfis:newer-on-B@4"]);
  await expect.poll(() => A.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 20_000 }).toEqual(["rfis:dirty-on-A@1*", "rfis:dirty-on-B@6", "rfis:newer-on-A@5", "rfis:newer-on-B@4"]);
  // the values, not just the versions: the newer side's data replaced, the dirty side's own text survived
  expect((await B.evaluate(() => window.pxPeerLf!.rec("rfis", "newer-on-A")))?.data).toEqual({ subject: "A at v5" });
  expect((await A.evaluate(() => window.pxPeerLf!.rec("rfis", "newer-on-B")))?.data).toEqual({ subject: "B at v4" });
  expect(await B.evaluate(() => window.pxPeerLf!.rec("rfis", "dirty-on-B"))).toMatchObject({ data: { subject: "B's own unsent edit" }, version: 1, dirty: "op-b-1" });
  expect(await A.evaluate(() => window.pxPeerLf!.rec("rfis", "dirty-on-A"))).toMatchObject({ data: { subject: "A's own unsent edit" }, version: 1, dirty: "op-a-1" });
  // each side: one newer row accepted; it sent its newer row AND the newer server version of the row the other side has dirty, which the
  // other side refused as `dirty` (its pending edit wins until the outbox and the server settle it); a dirty row itself was never sent
  await expect.poll(() => B.evaluate(() => window.pxPeerLf!.stats()), { timeout: 10_000 }).toEqual({ accepted: 1, sent: 2, rejected: { dirty: 1 }, refused: {} });
  await expect.poll(() => A.evaluate(() => window.pxPeerLf!.stats()), { timeout: 10_000 }).toEqual({ accepted: 1, sent: 2, rejected: { dirty: 1 }, refused: {} });
});

test("(e) a row B holds that A never had (or A deleted) is handed to A as a signed row; no deletion ever travels between laptops", async ({ browser }) => {
  const server = await createTestServer();
  const A = await laptop(browser);
  const B = await laptop(browser);
  await relay({ ua: A, ub: B });
  const onlyB = await server.signedRow("o1", VIEW, { project: "p1", kind: "tasks", id: "only-b", version: 2, updated_at: T1, data: { title: "Scaffold" } });
  await A.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows: [] });
  await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [onlyB] });
  await A.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await server.attestToken({ sub: "ua", org: "o1", view: VIEW, projects: ["p1"] }));
  await B.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await server.attestToken({ sub: "ub", org: "o1", view: VIEW, projects: ["p1"] }));
  await expect.poll(() => A.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 20_000 }).toEqual(["tasks:only-b@2"]);
  // B still holds it: A's absence of the row never removed anything on B
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["tasks:only-b@2"]);
});

test("(f) a new server epoch makes B drop its copy (its pending edit kept) and take a fresh one through the real server step", async ({ browser }) => {
  const server = await createTestServer();
  const B = await laptop(browser);
  await relay({ ub: B });
  const at = Date.now();
  await B.evaluate((o) => window.pxPeerLf!.setup(o), {
    userId: "ub", org: "o1", keys: [server.publicKeyInfo],
    rows: [
      await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "old-1", version: 5, updated_at: T1, data: { subject: "from epoch E1" } }),
      await server.signedRow("o1", VIEW, { project: "p1", kind: "tasks", id: "old-2", version: 9, updated_at: T1, data: { title: "from epoch E1" } }),
      { ...(await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "mine", version: 2, updated_at: T1, data: { subject: "my unsent edit" } })), dirty: "op-b-7" },
    ],
    manifest: { userId: "ub", orgId: "o1", projectIds: ["p1"], kinds: ["rfis", "tasks"], at },
    heads: { etag: "e1", viewClass: VIEW, orgViewClass: null, epoch: "E1", at },
  });
  // same epoch: nothing is dropped
  expect(await B.evaluate((v) => window.pxPeerLf!.serverStepWithHeads({ epoch: "E1", view_class: v }), VIEW)).toMatchObject({ wholeSyncs: 0 });
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["rfis:mine@2*", "rfis:old-1@5", "tasks:old-2@9"]);
  // the server's version tables were re-created: every stored version is meaningless, so the copy is dropped and rebuilt (whole sync)
  expect(await B.evaluate((v) => window.pxPeerLf!.serverStepWithHeads({ epoch: "E2", view_class: v }), VIEW)).toEqual({ changed: true, wholeSyncs: 1 });
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["rfis:mine@2*"]);
  expect(await B.evaluate(() => window.pxPeerLf!.rec("rfis", "mine"))).toMatchObject({ data: { subject: "my unsent edit" }, dirty: "op-b-7" });
  // a role change (view class) does the same
  await B.evaluate(async (rows) => window.pxPeerLf!.addRows(rows), [await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "new-1", version: 1, updated_at: T2, data: { subject: "E2" } })]);
  expect(await B.evaluate(() => window.pxPeerLf!.serverStepWithHeads({ epoch: "E2", view_class: "v-money" }))).toEqual({ changed: true, wholeSyncs: 1 });
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["rfis:mine@2*"]);
});
