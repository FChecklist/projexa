import { test, expect } from "@playwright/test";
import { laptop, outsideRequests, relay, T1 } from "./support/lf-peer-browser";
import { createTestServer, type SignedRow } from "./support/lf-peer-sign";

// lf-e9: laptop-to-laptop sync in a REAL browser with rows and tokens signed by the BACKEND's own signing code (compliance-tracker sign.ts,
// copied in e2e/support/lf-peer-sign.ts): genuine ES256 key record, genuine px2 + px3 row signatures, genuine /attest tokens. Two (or three)
// browser contexts are three laptops with their own IndexedDB; a real WebRTC data channel over loopback carries the rows; no server at all.
//   (a) B, with no server, receives A's rows, every signature verifies on B (production verify.ts), the values are A's;
//   (b) a row with changed data, a row cut for ANOTHER view class, a row signed by an unknown key are REFUSED and counted (network.stats());
//   (c) a laptop of another organisation (a valid token for ITS org) is refused and none of its rows land;
//   (d) an expired (> 24 h) attestation is refused.
// Run: bunx playwright test -c playwright.peer.config.ts

const VIEW = "v-site";

test("(a) B, with no server, receives A's rows; every px2 and px3 signature verifies on B; the values are A's", async ({ browser }) => {
  const server = await createTestServer();
  const A = await laptop(browser);
  const B = await laptop(browser);
  await relay({ ua: A, ub: B });
  const rows = [
    await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "rfi-7", version: 3, updated_at: T1, data: { subject: "Door frame height", status: "open" } }),
    await server.signedRow("o1", VIEW, { project: "p1", kind: "tasks", id: "t-12", version: 8, updated_at: T1, data: { title: "Pour slab L2", percent: 40 } }),
    await server.signedRow("o1", VIEW, { project: "p2", kind: "boq_items", id: "b-1", version: 2, updated_at: T1, data: { description: "M25 concrete", quantity: 120.5, unit: "m3" } }),
  ];
  await A.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows });
  await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [] });
  const tokA = await server.attestToken({ sub: "ua", org: "o1", view: VIEW, projects: ["p1", "p2"] });
  const tokB = await server.attestToken({ sub: "ub", org: "o1", view: VIEW, projects: ["p1", "p2"] });
  await A.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), tokA);
  await B.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), tokB);

  await expect.poll(() => B.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 20_000 }).toEqual(["boq_items:b-1@2", "rfis:rfi-7@3", "tasks:t-12@8"]);
  expect(await B.evaluate(() => window.pxPeerLf!.rec("boq_items", "b-1"))).toEqual({ data: { description: "M25 concrete", quantity: 120.5, unit: "m3" }, version: 2, dirty: null, sig: true, sig3: true, kid: server.rec.kid });
  expect((await B.evaluate(() => window.pxPeerLf!.rec("tasks", "t-12")))?.data).toEqual({ title: "Pour slab L2", percent: 40 });
  // B re-verifies everything it now holds with its own cached keys: genuine px2 for the org, genuine px3 for ITS view class
  expect(await B.evaluate((v) => window.pxPeerLf!.verifyAll("o1", v), VIEW)).toEqual({
    "boq_items:b-1": { px2: true, px3: true }, "rfis:rfi-7": { px2: true, px3: true }, "tasks:t-12": { px2: true, px3: true },
  });
  expect(await B.evaluate(() => window.pxPeerLf!.stats())).toMatchObject({ accepted: 3, rejected: {}, refused: {} });
  // no server: neither laptop made a single request beyond loading its page
  expect(outsideRequests(A)).toEqual([]);
  expect(outsideRequests(B)).toEqual([]);
  expect(await B.evaluate(() => window.pxPeerLf!.counters().fetch)).toBe(0);
});

test("(b) changed data, a row cut for another view class and an unknown key are refused and counted; the genuine row beside them lands", async ({ browser }) => {
  const server = await createTestServer();
  const stranger = await createTestServer(); // a key B was never given by our server
  const A = await laptop(browser);
  const B = await laptop(browser);
  await relay({ ua: A, ub: B });
  const good = await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "good", version: 2, updated_at: T1, data: { subject: "Window sill" } });
  const signedThenChanged: SignedRow = { ...(await server.signedRow("o1", VIEW, { project: "p1", kind: "boq_items", id: "b-1", version: 4, updated_at: T1, data: { quantity: 100 } })), data: { quantity: 1000 } };
  // the server cut this one for the money-seeing class: genuine px2 (which does not commit to the class) and a genuine px3 over "v-money"
  const otherClass = await server.signedRow("o1", "v-money", { project: "p1", kind: "boq_items", id: "b-2", version: 5, updated_at: T1, data: { quantity: 10, rate: 5400, amount: 54000 } });
  const unknownKey = await stranger.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "forged", version: 9, updated_at: T1, data: { subject: "Approved by owner" } });
  await A.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows: [good, signedThenChanged, otherClass, unknownKey] });
  await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [] });
  await A.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await server.attestToken({ sub: "ua", org: "o1", view: VIEW, projects: ["p1"] }));
  await B.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await server.attestToken({ sub: "ub", org: "o1", view: VIEW, projects: ["p1"] }));

  await expect.poll(() => B.evaluate(() => window.pxPeerLf!.stats()?.rejected), { timeout: 20_000 }).toEqual({ bad_signature: 2, wrong_view: 1 });
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["rfis:good@2"]);
  expect(await B.evaluate(() => window.pxPeerLf!.rec("boq_items", "b-1"))).toBeNull();
  expect(await B.evaluate(() => window.pxPeerLf!.rec("boq_items", "b-2"))).toBeNull();
  expect(await B.evaluate(() => window.pxPeerLf!.rec("rfis", "forged"))).toBeNull();
  expect((await B.evaluate(() => window.pxPeerLf!.stats()))?.accepted).toBe(1);
});

test("(c) a laptop of ANOTHER organisation with a valid token for its own org is refused both ways; none of its rows land", async ({ browser }) => {
  const server = await createTestServer();
  const B = await laptop(browser);
  const X = await laptop(browser);
  await relay({ ub: B, ux: X });
  const mine = await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "r-b", version: 1, updated_at: T1, data: { subject: "Ours" } });
  const theirs = await server.signedRow("o2", VIEW, { project: "p1", kind: "rfis", id: "r-x", version: 9, updated_at: T1, data: { subject: "Theirs" } });
  await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [mine] });
  await X.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ux", org: "o2", keys: [server.publicKeyInfo], rows: [theirs] });
  // same project id, same view class, same signing key: only the organisation differs
  await B.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await server.attestToken({ sub: "ub", org: "o1", view: VIEW, projects: ["p1"] }));
  await X.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await server.attestToken({ sub: "ux", org: "o2", view: VIEW, projects: ["p1"] }));

  await expect.poll(() => B.evaluate(() => window.pxPeerLf!.refusals()), { timeout: 20_000 }).toContainEqual({ peer: "ux", reason: "wrong_org" });
  await expect.poll(() => X.evaluate(() => window.pxPeerLf!.refusals()), { timeout: 20_000 }).toContainEqual({ peer: "ub", reason: "wrong_org" });
  expect(await B.evaluate(() => window.pxPeerLf!.peers())).toBe(0);
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["rfis:r-b@1"]);
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o2"))).toEqual([]);
  expect(await B.evaluate(() => window.pxPeerLf!.rec("rfis", "r-x"))).toBeNull();
  expect(await X.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual([]);
  expect((await B.evaluate(() => window.pxPeerLf!.stats()))?.sent).toBe(0);
});

test("(d) an attestation older than 24 hours is refused and the laptop presenting it gets nothing", async ({ browser }) => {
  const server = await createTestServer();
  const A = await laptop(browser);
  const B = await laptop(browser);
  await relay({ ua: A, ub: B });
  const row = await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "r1", version: 1, updated_at: T1, data: { subject: "Kept from a stale laptop" } });
  await A.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows: [] });
  await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [row] });
  const iat = Math.floor(Date.now() / 1000) - 25 * 3600; // issued 25 h ago with the server's 24 h lifetime: expired an hour ago
  await A.evaluate((t) => window.pxPeerLf!.startNet({ token: t, presentAnyway: true }), await server.attestToken({ sub: "ua", org: "o1", view: VIEW, projects: ["p1"], iat }));
  await B.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await server.attestToken({ sub: "ub", org: "o1", view: VIEW, projects: ["p1"] }));

  await expect.poll(() => B.evaluate(() => window.pxPeerLf!.refusals()), { timeout: 20_000 }).toContainEqual({ peer: "ua", reason: "expired" });
  expect(await B.evaluate(() => window.pxPeerLf!.stats())).toMatchObject({ sent: 0, refused: { expired: 1 } });
  expect(await A.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual([]);
  expect(await B.evaluate(() => window.pxPeerLf!.peers())).toBe(0);
});
