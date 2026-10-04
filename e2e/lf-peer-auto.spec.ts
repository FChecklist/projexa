import { test, expect } from "@playwright/test";
import { laptop, outsideRequests, relay, T1 } from "./support/lf-peer-browser";
import { createTestServer } from "./support/lf-peer-sign";

// lf-e9: the automatic side of laptop-to-laptop sync in a REAL browser, rows and tokens signed by the backend's own code.
//   (g) the whole auto-sync assembly (auto-sync.ts: cached attestation -> signalling -> network -> scheduler) with OUR server unreachable:
//       two laptops started at the SAME moment find each other (the "two laptops starting together no longer miss each other" fix), and a
//       laptop that comes online later catches up from its neighbour -- with zero requests to any server;
//   (h) organisation kinds (vendors, departments, org people, cost visibility) travel only between laptops whose server-attested
//       ORGANISATION view class is equal; org_people never travels; today's /attest (no org_view claim) moves none.
// Run: bunx playwright test -c playwright.peer.config.ts

const VIEW = "v-site";
const ORG = "__org__";

async function att(server: Awaited<ReturnType<typeof createTestServer>>, sub: string) {
  const token = await server.attestToken({ sub, org: "o1", view: VIEW, projects: ["p1"] });
  return { token, expiresAt: Date.now() + 86_400_000, viewClass: VIEW, projects: ["p1"], channel: "chan-o1" };
}

test("(g) two laptops started at the same moment find each other and converge with no server call at all", async ({ browser }) => {
  const server = await createTestServer();
  const A = await laptop(browser);
  const B = await laptop(browser);
  await relay({ ua: A, ub: B });
  await A.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows: [await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "from-a", version: 3, updated_at: T1, data: { subject: "Lift shaft" } })] });
  await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [await server.signedRow("o1", VIEW, { project: "p1", kind: "tasks", id: "from-b", version: 1, updated_at: T1, data: { title: "Shuttering" } })] });
  const [aa, ab] = [await att(server, "ua"), await att(server, "ub")];
  // the same moment: neither has heard the other's first announce
  await Promise.all([A.evaluate((o) => window.pxPeerLf!.startAuto({ attestation: o }), aa), B.evaluate((o) => window.pxPeerLf!.startAuto({ attestation: o }), ab)]);

  await expect.poll(() => B.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 20_000 }).toEqual(["rfis:from-a@3", "tasks:from-b@1"]);
  await expect.poll(() => A.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 20_000 }).toEqual(["rfis:from-a@3", "tasks:from-b@1"]);
  expect((await B.evaluate(() => window.pxPeerLf!.rec("rfis", "from-a")))?.data).toEqual({ subject: "Lift shaft" });
  expect(await A.evaluate(() => window.pxPeerLf!.peers())).toBe(1);
  // our server was never reached: no request left either page, and the scheduler's server attempts all failed (the server is down)
  for (const p of [A, B]) {
    expect(outsideRequests(p)).toEqual([]);
    expect((await p.evaluate(() => window.pxPeerLf!.counters())).fetch).toBe(0);
  }
  for (const p of [A, B]) await p.evaluate(() => window.pxPeerLf!.stop());
});

test("(g) a laptop that comes online later catches up from its neighbour, still with no server call", async ({ browser }) => {
  const server = await createTestServer();
  const A = await laptop(browser);
  const B = await laptop(browser);
  const online = { ub: false };
  await relay({ ua: A, ub: B }, (id) => id !== "ub" || online.ub);
  const rows = [
    await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "r1", version: 4, updated_at: T1, data: { subject: "Fire door rating" } }),
    await server.signedRow("o1", VIEW, { project: "p1", kind: "boq_items", id: "b1", version: 6, updated_at: T1, data: { description: "Plaster", quantity: 310 } }),
  ];
  await A.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows });
  // B missed these updates: it still has r1 at version 2
  await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "r1", version: 2, updated_at: T1, data: { subject: "old" } })] });
  await A.evaluate((o) => window.pxPeerLf!.startAuto({ attestation: o }), await att(server, "ua"));
  await B.evaluate((o) => window.pxPeerLf!.startAuto({ attestation: o }), await att(server, "ub"));
  // B is offline: nothing can reach it
  await B.waitForTimeout(1500);
  expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["rfis:r1@2"]);
  // B comes back on the LAN; its scheduler runs (as the `online` event triggers it) and announces; A answers; the peer gives B the news
  online.ub = true;
  await B.evaluate(() => window.dispatchEvent(new Event("online")));
  await B.evaluate(() => window.pxPeerLf!.triggerAuto("online"));

  await expect.poll(() => B.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 20_000 }).toEqual(["boq_items:b1@6", "rfis:r1@4"]);
  expect((await B.evaluate(() => window.pxPeerLf!.rec("rfis", "r1")))?.data).toEqual({ subject: "Fire door rating" });
  expect((await B.evaluate(() => window.pxPeerLf!.rec("boq_items", "b1")))?.data).toEqual({ description: "Plaster", quantity: 310 });
  expect(outsideRequests(B)).toEqual([]);
  expect((await B.evaluate(() => window.pxPeerLf!.counters())).fetch).toBe(0);
  for (const p of [A, B]) await p.evaluate(() => window.pxPeerLf!.stop());
});

test("(h) organisation rows move only between equal organisation view classes; org_people never; today's tokens move none", async ({ browser }) => {
  const server = await createTestServer();
  const orgRows = [
    await server.signedRow("o1", "ov-cost", { project: ORG, kind: "vendors", id: "ven-1", version: 3, updated_at: T1, data: { id: "ven-1", supplier_name: "Ace Cement", credit_limit: 500000 } }),
    await server.signedRow("o1", "ov-cost", { project: ORG, kind: "departments", id: "dep-1", version: 1, updated_at: T1, data: { id: "dep-1", name: "Site execution" } }),
    await server.signedRow("o1", "ov-cost", { project: ORG, kind: "org_people", id: "u-a", version: 1, updated_at: T1, data: { id: "u-a", name: "Asha", email: "asha@example.test" } }),
  ];
  const pairOf = async (aOrgView: string | undefined, bOrgView: string | undefined) => {
    const A = await laptop(browser);
    const B = await laptop(browser);
    await relay({ ua: A, ub: B });
    await A.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows: orgRows });
    await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [] });
    await A.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await server.attestToken({ sub: "ua", org: "o1", view: VIEW, projects: ["p1"], orgView: aOrgView }));
    await B.evaluate((t) => window.pxPeerLf!.startNet({ token: t }), await server.attestToken({ sub: "ub", org: "o1", view: VIEW, projects: ["p1"], orgView: bOrgView }));
    await expect.poll(() => B.evaluate(() => window.pxPeerLf!.peers()), { timeout: 20_000 }).toBe(1);
    return { A, B };
  };

  // the same organisation view class (cost visible to both): vendors and departments move with their versions; org_people does not
  const same = await pairOf("ov-cost", "ov-cost");
  await expect.poll(() => same.B.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 20_000 }).toEqual(["departments:dep-1@1", "vendors:ven-1@3"]);
  expect((await same.B.evaluate(() => window.pxPeerLf!.rec("vendors", "ven-1")))?.data).toEqual({ id: "ven-1", supplier_name: "Ace Cement", credit_limit: 500000 });
  expect(await same.B.evaluate(() => window.pxPeerLf!.rec("org_people", "u-a"))).toBeNull();

  // a lower organisation class (no cost visibility): nothing of the organisation moves, though project sharing still verified the pair
  const lower = await pairOf("ov-cost", "ov-nocost");
  await lower.B.waitForTimeout(1000);
  await lower.B.evaluate(() => window.pxPeerLf!.syncAll());
  expect(await lower.B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual([]);

  // today's /attest sends no org_view claim at all: organisation rows never move (the backend gap listed in the lf-e7 / lf-e9 reports)
  const today = await pairOf(undefined, undefined);
  await today.B.waitForTimeout(1000);
  await today.B.evaluate(() => window.pxPeerLf!.syncAll());
  expect(await today.B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual([]);
});
