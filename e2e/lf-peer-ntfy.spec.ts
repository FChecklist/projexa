import { test, expect, type Browser, type Page } from "@playwright/test";
import http from "node:http";
import net from "node:net";
import type { Socket } from "node:net";
import { harnessBundle, T1 } from "./support/lf-peer-browser";
import { createTestServer } from "./support/lf-peer-sign";

// AUDIT-100 B21: laptop-to-laptop sync while SUPABASE IS DOWN, in a REAL browser, through the app's REAL signalling providers -- not the
// test bridge the other lf-peer specs use. Each laptop runs the whole auto-sync assembly with remoteSignalProviders() (the exact list
// peer-shared.ts races in the app: Supabase Realtime, then ntfy.sh):
//   * Supabase Realtime: a real supabase-js client pointed at a local port where nothing listens -> its websocket is refused (Supabase down);
//   * ntfy: the real provider (real EventSource for SSE, real fetch for publish), pointed at a local ntfy stand-in that speaks ntfy.sh's
//     wire format (GET /<topic>/sse, POST /<topic>, `{"event":"message","message":...}`). The public ntfy.sh is not used: a test must not
//     depend on, or write to, a public service.
// The two laptops find each other over ntfy, open a real WebRTC data channel, and swap signed rows; the stand-in only ever carries small,
// AES-GCM-encrypted signalling (no row, no subject, no person id in clear), and our server is never reached.
// Run: bunx playwright test -c playwright.peer.config.ts lf-peer-ntfy

const VIEW = "v-site";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  });
}

/** A local stand-in for ntfy.sh: SSE subscribe per topic, plain-text publish fanned out to every subscriber of the topic. */
async function ntfyStandIn(harnessJs: string) {
  const subs = new Map<string, Set<http.ServerResponse>>();
  const posts: Array<{ topic: string; body: string }> = [];
  const sockets = new Set<Socket>();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    // the laptop page itself (see laptop() below for why it is served from here)
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><meta charset="utf-8"><title>laptop</title><script src="/harness.js"></script>`); return; }
    if (req.method === "GET" && url.pathname === "/harness.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(harnessJs); return; }
    if (req.method === "GET" && parts.length === 2 && parts[1] === "sse") {
      res.writeHead(200, { ...cors, "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`data: ${JSON.stringify({ event: "open", topic: parts[0] })}\n\n`);
      const set = subs.get(parts[0]) ?? new Set();
      set.add(res);
      subs.set(parts[0], set);
      req.on("close", () => set.delete(res));
      return;
    }
    if (req.method === "POST" && parts.length === 1) {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        posts.push({ topic: parts[0], body });
        for (const r of subs.get(parts[0]) ?? []) r.write(`data: ${JSON.stringify({ id: String(posts.length), event: "message", topic: parts[0], message: body })}\n\n`);
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ event: "message", topic: parts[0] }));
      });
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    posts,
    subscribers: () => [...subs.values()].reduce((n, s) => n + s.size, 0),
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}

/**
 * One laptop: a fresh context whose page is served by the ntfy stand-in (a REAL local server). Not lf-peer-browser.ts's page.route-served
 * page: from a page answered by page.route, Chromium refused every real request to a local server (measured: net::ERR_FAILED, nothing
 * arrived; most likely Private Network Access, as such a page has no address of its own), so the real EventSource could never reach the
 * stand-in. Every request to any OTHER
 * http(s) address is refused here; websocket attempts (Supabase Realtime) are recorded.
 */
async function laptop(browser: Browser, base: string): Promise<Page & { seenUrls: string[]; sockets: string[] }> {
  const ctx = await browser.newContext();
  const page = (await ctx.newPage()) as Page & { seenUrls: string[]; sockets: string[] };
  page.seenUrls = [];
  page.sockets = [];
  page.on("request", (r) => page.seenUrls.push(r.url()));
  page.on("websocket", (ws) => page.sockets.push(ws.url()));
  await page.route((url) => !url.href.startsWith(base), (route) => route.abort("connectionrefused"));
  await page.goto(`${base}/`);
  await page.waitForFunction(() => !!window.pxPeerLf);
  return page;
}

test("(B21) Supabase down: two laptops find each other over the ntfy fallback and converge; ntfy carries only encrypted signalling", async ({ browser }) => {
  const server = await createTestServer();
  const ntfy = await ntfyStandIn(await harnessBundle());
  const deadPort = await freePort(); // nothing listens here: Supabase Realtime is refused
  const supabaseUrl = `http://127.0.0.1:${deadPort}`;
  try {
    const A = await laptop(browser, ntfy.base);
    const B = await laptop(browser, ntfy.base);
    await A.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ua", org: "o1", keys: [server.publicKeyInfo], rows: [await server.signedRow("o1", VIEW, { project: "p1", kind: "rfis", id: "from-a", version: 3, updated_at: T1, data: { subject: "Lift shaft" } })] });
    await B.evaluate((o) => window.pxPeerLf!.setup(o), { userId: "ub", org: "o1", keys: [server.publicKeyInfo], rows: [await server.signedRow("o1", VIEW, { project: "p1", kind: "tasks", id: "from-b", version: 1, updated_at: T1, data: { title: "Shuttering" } })] });
    const att = async (sub: string) => ({ token: await server.attestToken({ sub, org: "o1", view: VIEW, projects: ["p1"] }), expiresAt: Date.now() + 86_400_000, viewClass: VIEW, projects: ["p1"], channel: "chan-o1" });
    const [aa, ab] = [await att("ua"), await att("ub")];
    await A.evaluate((o) => window.pxPeerLf!.startAutoReal(o), { attestation: aa, supabaseUrl, ntfyBase: ntfy.base });
    await B.evaluate((o) => window.pxPeerLf!.startAutoReal(o), { attestation: ab, supabaseUrl, ntfyBase: ntfy.base });

    // converged: each laptop holds both rows, with the other laptop's words
    try {
      await expect.poll(() => B.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 30_000 }).toEqual(["rfis:from-a@3", "tasks:from-b@1"]);
    } catch (err) {
      const diag = { a: await A.evaluate(() => ({ p: window.pxPeerLf!.providers(), peers: window.pxPeerLf!.peers(), stats: window.pxPeerLf!.stats(), refusals: window.pxPeerLf!.refusals() })), b: await B.evaluate(() => ({ p: window.pxPeerLf!.providers(), peers: window.pxPeerLf!.peers(), stats: window.pxPeerLf!.stats(), refusals: window.pxPeerLf!.refusals() })), posts: ntfy.posts.length, subscribers: ntfy.subscribers(), aUrls: A.seenUrls.slice(0, 8), aSockets: A.sockets };
      throw new Error(`the laptops never converged over ntfy: ${JSON.stringify(diag)}\n${String(err).slice(0, 300)}`);
    }
    await expect.poll(() => A.evaluate(() => window.pxPeerLf!.ids("o1")), { timeout: 30_000 }).toEqual(["rfis:from-a@3", "tasks:from-b@1"]);
    expect((await B.evaluate(() => window.pxPeerLf!.rec("rfis", "from-a")))?.data).toEqual({ subject: "Lift shaft" });
    expect((await A.evaluate(() => window.pxPeerLf!.rec("tasks", "from-b")))?.data).toEqual({ title: "Shuttering" });
    expect(await A.evaluate(() => window.pxPeerLf!.peers())).toBe(1);

    for (const p of [A, B]) {
      // ntfy won the race; Supabase was really tried (its websocket went to the dead port) and failed
      await expect.poll(() => p.evaluate(() => window.pxPeerLf!.providers()), { timeout: 20_000, message: "Supabase Realtime never reported its failure" })
        .toMatchObject({ connected: ["ntfy"], failed: [{ name: "supabase" }] });
      expect(p.sockets.some((u) => u.includes(`127.0.0.1:${deadPort}`)), `no Realtime websocket was attempted: ${JSON.stringify(p.sockets)}`).toBe(true);
      // our server was never reached: the only requests that left the harness page went to the ntfy stand-in
      expect(p.seenUrls.filter((u) => !u.startsWith(ntfy.base))).toEqual([]);
    }

    // what ntfy saw: signalling messages on ONE derived topic (not the channel name), each small and sealed -- no row content, no ids in clear
    expect(ntfy.posts.length, "nothing was signalled over ntfy").toBeGreaterThan(0);
    const topics = new Set(ntfy.posts.map((p) => p.topic));
    expect(topics.size).toBe(1);
    expect([...topics][0]).toMatch(/^px[0-9a-f]{40}$/);
    expect([...topics][0]).not.toContain("chan-o1");
    for (const p of ntfy.posts) {
      expect(p.body.length).toBeLessThan(4096 * 2);
      for (const clear of ["Lift shaft", "Shuttering", "from-a", "from-b", "\"ua\"", "\"ub\"", "announce", "offer", "candidate"]) expect(p.body).not.toContain(clear);
    }
    for (const p of [A, B]) await p.evaluate(() => window.pxPeerLf!.stop());
  } finally {
    await ntfy.close();
  }
});
