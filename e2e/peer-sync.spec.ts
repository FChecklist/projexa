import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { createTestSigner } from "../src/lib/local-first/peer/__fixtures__/test-signer";

// LOCAL-FIRST PEERS (CONTRACT.md section 4), end to end in a real browser: two browser contexts (two "laptops": separate
// IndexedDB, separate RTCPeerConnection) on the same origin open a REAL WebRTC data channel over loopback and exchange
// server-signed rows. No app server and no sync server: the page is served by page.route, and signalling is relayed by this
// test (standing in for Supabase Realtime / ntfy, which carry only signalling, never rows).
//
// Self-contained: does not use baseURL and touches no live site. Run: bunx playwright test e2e/peer-sync.spec.ts

const ORIGIN = "http://localhost:4599"; // localhost is a secure context (WebCrypto); page.route answers, nothing listens
const T1 = "2026-10-01T10:00:00Z";

let bundle = "";

test.beforeAll(async () => {
  const out = await build({
    entryPoints: [path.join(__dirname, "../src/lib/local-first/peer/e2e-harness.ts")],
    bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
    alias: { "@": path.join(__dirname, "../src") },
  });
  bundle = out.outputFiles[0].text;
});

async function laptop(browser: import("@playwright/test").Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/harness.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><title>peer</title><script src="/harness.js"></script>` });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => !!window.pxPeerHarness);
  return page;
}

test("two laptops sync directly over WebRTC; a dirty row is neither sent nor overwritten; another org gets nothing", async ({ browser }) => {
  const signer = await createTestSigner();
  const now = Date.now();
  const tok = (sub: string, org: string) => signer.token({ sub, org, view: "v1", projects: ["p1"] }, now);

  const A = await laptop(browser);
  const B = await laptop(browser);
  const X = await laptop(browser);
  const pages: Record<string, Page> = { ua: A, ub: B, ux: X };
  for (const [id, p] of Object.entries(pages)) {
    // the test relays signalling between the three pages, exactly like a broadcast channel would
    await p.exposeFunction("pxSignalOut", async (json: string) => {
      for (const [other, q] of Object.entries(pages)) if (other !== id) await q.evaluate((j) => window.pxPeerHarness!.signalIn(j), json).catch(() => {});
    });
  }

  const rowsA = [
    await signer.row("o1", { project: "p1", kind: "rfis", id: "fromA", version: 3, updated_at: T1, data: { subject: "Door" } }),
    { ...(await signer.row("o1", { project: "p1", kind: "rfis", id: "mine", version: 1, updated_at: T1, data: { v: "A edit" } })), dirty: "op-a" },
  ];
  const rowsB = [
    await signer.row("o1", { project: "p1", kind: "tasks", id: "fromB", version: 2, updated_at: T1, data: { t: 1 } }),
    await signer.row("o1", { project: "p1", kind: "rfis", id: "mine", version: 5, updated_at: T1, data: { v: "server 5" } }),
  ];
  const rowsX = [await signer.row("o2", { project: "p1", kind: "rfis", id: "evil", version: 9, updated_at: T1, data: {} })];

  await A.evaluate((o) => window.pxPeerHarness!.setup(o), { userId: "ua", org: "o1", token: await tok("ua", "o1"), keys: [signer.publicKey], rows: rowsA });
  await B.evaluate((o) => window.pxPeerHarness!.setup(o), { userId: "ub", org: "o1", token: await tok("ub", "o1"), keys: [signer.publicKey], rows: rowsB });
  await X.evaluate((o) => window.pxPeerHarness!.setup(o), { userId: "ux", org: "o2", token: await tok("ux", "o2"), keys: [signer.publicKey], rows: rowsX });

  for (const p of [A, B, X]) await p.evaluate(() => window.pxPeerHarness!.start());

  await expect.poll(() => A.evaluate(() => window.pxPeerHarness!.peers()), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => B.evaluate(() => window.pxPeerHarness!.peers()), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => B.evaluate(() => window.pxPeerHarness!.ids("o1")), { timeout: 20_000 }).toEqual(["rfis:fromA@3", "rfis:mine@5", "tasks:fromB@2"]);
  // A keeps its pending edit of "mine" (dirty) rather than taking B's newer server row
  await expect.poll(() => A.evaluate(() => window.pxPeerHarness!.ids("o1")), { timeout: 20_000 }).toEqual(["rfis:fromA@3", "rfis:mine@1*", "tasks:fromB@2"]);
  // the other organisation's laptop never verified with anyone and received nothing
  expect(await X.evaluate(() => window.pxPeerHarness!.peers())).toBe(0);
  expect(await X.evaluate(() => window.pxPeerHarness!.ids("o1"))).toEqual([]);
});
