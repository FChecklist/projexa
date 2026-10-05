import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { laptop, outsideRequests, relay, T1 } from "./support/lf-peer-browser";
import { createTestServer } from "./support/lf-peer-sign";
import { startTurnServer } from "./support/turn-server";

// AUDIT-100 B22: laptop-to-laptop sync when NO direct path exists (two laptops on different networks, one behind a symmetric /
// carrier-grade NAT). Only a TURN relay gets through there. In a REAL browser, with NO internet:
//   * a local TURN relay (support/turn-server.ts, long-term credentials, every request's integrity checked) runs on this machine;
//   * both laptops run the whole auto-sync assembly with iceTransportPolicy "relay": the browser gathers NO host and NO server-reflexive
//     candidates, so the two laptops are exactly as unreachable to each other as across two hostile NATs, and the ONLY possible path is
//     the relay;
//   (relay)   with the relay in their ICE servers they connect, swap signed rows, and both databases (re-read) hold both rows; the browser's
//             own getStats says the pair that carried them is relay<->relay, and the relay counted the packets it carried;
//   (control) the same relay-only laptops WITHOUT the relay in their ICE servers never connect: nothing moves, the relay is never asked,
//             and each laptop carries on quietly -- no dialog, no page error, its own database still writes and reads -- with ONE plain
//             sentence in the real peer marker (components/PeerSyncMarker.tsx).
// What this cannot prove here: two REAL laptops on two real networks with a real relay account (ai-os/audit37/PEER_DIFFERENT_NETWORKS_OWNER_SCRIPT.md).
// Run: bunx playwright test -c playwright.peer.config.ts lf-peer-relay

const VIEW = "v-site";
const UNREACHABLE = "Another laptop was found but could not be reached directly; your work is safe on this laptop.";

async function att(server: Awaited<ReturnType<typeof createTestServer>>, sub: string) {
  const token = await server.attestToken({ sub, org: "o1", view: VIEW, projects: ["p1"] });
  return { token, expiresAt: Date.now() + 86_400_000, viewClass: VIEW, projects: ["p1"], channel: "chan-o1" };
}

async function seed(server: Awaited<ReturnType<typeof createTestServer>>, A: Page, B: Page) {
  await A.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows: [await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "from-a", version: 3, updated_at: T1, data: { subject: "Lift shaft" } })] });
  await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [await server.signedRow("o1", VIEW, { project: "p1", kind: "tasks", id: "from-b", version: 1, updated_at: T1, data: { title: "Shuttering" } })] });
}

function watchForTrouble(p: Page) {
  const seen = { dialogs: 0, errors: [] as string[] };
  p.on("dialog", (d) => { seen.dialogs += 1; void d.dismiss(); });
  p.on("pageerror", (e) => seen.errors.push(String(e)));
  return seen;
}

test("(B22 relay) relay-only laptops connect THROUGH a TURN relay and both databases hold both signed rows", async ({ browser }) => {
  const server = await createTestServer();
  const username = "b22-laptop";
  const password = randomBytes(16).toString("hex");
  const turn = await startTurnServer({ username, password });
  try {
    const A = await laptop(browser);
    const B = await laptop(browser);
    await relay({ ua: A, ub: B });
    await seed(server, A, B);
    for (const p of [A, B]) await p.evaluate(() => window.pxPeerLf!.mountMarker());
    const rtc = { iceServers: [{ urls: turn.url, username, credential: password }], iceTransportPolicy: "relay" as const, openTimeoutMs: 20_000 };
    await A.evaluate((o) => window.pxPeerLf!.startAuto(o), { attestation: await att(server, "ua"), rtc });
    await B.evaluate((o) => window.pxPeerLf!.startAuto(o), { attestation: await att(server, "ub"), rtc });

    // converged: re-read from each laptop's own database
    try {
      await expect.poll(() => B.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 30_000 }).toEqual(["rfis:from-a@3", "tasks:from-b@1"]);
    } catch (err) {
      const diag = { turn: turn.stats, url: turn.url, a: await A.evaluate(() => window.pxPeerLf!.selectedPairs()), b: await B.evaluate(() => window.pxPeerLf!.selectedPairs()), aStatus: await A.evaluate(() => window.pxPeerLf!.peerStatus()) };
      throw new Error(`the laptops never converged through the relay: ${JSON.stringify(diag)}\n${String(err).slice(0, 300)}`);
    }
    await expect.poll(() => A.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 30_000 }).toEqual(["rfis:from-a@3", "tasks:from-b@1"]);
    expect((await B.evaluate(() => window.pxPeerLf!.rec("rfis", "from-a")))).toMatchObject({ data: { subject: "Lift shaft" }, version: 3, sig: true, sig3: true });
    expect((await A.evaluate(() => window.pxPeerLf!.rec("tasks", "from-b")))).toMatchObject({ data: { title: "Shuttering" }, version: 1, sig: true, sig3: true });

    // the path really was the relay: the browser's own selected candidate pair is relay <-> relay on both laptops ...
    for (const p of [A, B]) {
      const pairs = await p.evaluate(() => window.pxPeerLf!.selectedPairs());
      const used = pairs.filter((x) => x.state === "connected");
      expect(used.length, JSON.stringify(pairs)).toBeGreaterThan(0);
      for (const x of used) expect(x, JSON.stringify(pairs)).toMatchObject({ local: "relay", remote: "relay" });
    }
    // ... and the relay counted what it carried, both ways, after challenging and authenticating both laptops
    expect(turn.stats.allocations).toBeGreaterThanOrEqual(2);
    expect(turn.stats.challenges).toBeGreaterThanOrEqual(2);
    expect(turn.stats.authFailures).toBe(0);
    expect(turn.stats.toPeer).toBeGreaterThan(10);
    expect(turn.stats.fromPeer).toBeGreaterThan(10);

    // the person sees the calm marker, and nothing left either page over HTTP
    await expect(A.getByTestId("peer-sync")).toHaveText("Synced with 1 laptop");
    for (const p of [A, B]) expect(outsideRequests(p)).toEqual([]);
    for (const p of [A, B]) await p.evaluate(() => window.pxPeerLf!.stop());
  } finally {
    await turn.close();
  }
});

test("(B22 control) the same relay-only laptops WITHOUT the relay configured never connect, and stay quiet and working", async ({ browser }) => {
  const server = await createTestServer();
  const turn = await startTurnServer({ username: "b22-laptop", password: randomBytes(16).toString("hex") }); // running, but NOT configured
  try {
    const A = await laptop(browser);
    const B = await laptop(browser);
    const troubleA = watchForTrouble(A);
    const troubleB = watchForTrouble(B);
    await relay({ ua: A, ub: B });
    await seed(server, A, B);
    for (const p of [A, B]) await p.evaluate(() => window.pxPeerLf!.mountMarker());
    const rtc = { iceServers: [], iceTransportPolicy: "relay" as const, openTimeoutMs: 6_000 };
    await A.evaluate((o) => window.pxPeerLf!.startAuto(o), { attestation: await att(server, "ua"), rtc });
    await B.evaluate((o) => window.pxPeerLf!.startAuto(o), { attestation: await att(server, "ub"), rtc });

    // they heard each other (signalling works) but no path opened: both say so, in one plain sentence, in the real marker
    for (const p of [A, B]) {
      await expect.poll(() => p.evaluate(() => window.pxPeerLf!.peerStatus()), { timeout: 30_000 }).toMatchObject({ peers: 0, unreachable: true });
      await expect(p.getByTestId("peer-sync")).toHaveText(UNREACHABLE);
      await expect(p.getByRole("status")).toHaveCount(1);
    }
    // nothing moved: each database (re-read) holds only its own row; the relay was never asked
    expect(await A.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["rfis:from-a@3"]);
    expect(await B.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["tasks:from-b@1"]);
    expect(await A.evaluate(() => window.pxPeerLf!.peers())).toBe(0);
    expect(turn.stats.allocations + turn.stats.challenges).toBe(0);
    for (const p of [A, B]) for (const x of await p.evaluate(() => window.pxPeerLf!.selectedPairs())) expect(x.local).toBeNull();

    // the app keeps working: a local edit is written and read back from this laptop's own database; no dialog, no page error
    expect(await A.evaluate(() => window.pxPeerLf!.writeLocal("rfis", "new-a", { subject: "Typed while alone" }))).toEqual({ subject: "Typed while alone" });
    expect(await A.evaluate(() => window.pxPeerLf!.ids("o1"))).toEqual(["rfis:from-a@3", "rfis:new-a@undefined*"]);
    expect(troubleA).toEqual({ dialogs: 0, errors: [] });
    expect(troubleB).toEqual({ dialogs: 0, errors: [] });
    for (const p of [A, B]) expect(outsideRequests(p)).toEqual([]);
    for (const p of [A, B]) await p.evaluate(() => window.pxPeerLf!.stop());
  } finally {
    await turn.close();
  }
});
