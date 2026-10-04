import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { USERS } from "./users";

// AUDIT 37, points 6, 7/8 (wiring), 15, 25, 26, 33 -- against the REAL backend (see playwright.audit37-real.config.ts).
// One real seeded member logs in through the real form, the laptop prepares itself, then:
//   (25) the network is cut and the app still opens from the laptop's own copy;
//   (26) the network is back but every Supabase request is refused ("our side is down") and the app still opens;
//   (7/8) the auto-sync / peer leader lock is held by the tab (startPeerSync is running);
//   (33) an error thrown in the page reaches /api/local-first/client-error, and is buffered while offline.
// Every assertion reads the persisted state (IndexedDB, Cache Storage, Web Locks, the server's response), not a success message.

const user = USERS.siteSupervisor;

async function localDbNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:")));
}

test.describe.configure({ mode: "serial" });

// ONE browser profile for the whole journey (a fresh Playwright context per test would be a different laptop each time)
let context: BrowserContext;
let page: Page;
test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ serviceWorkers: "allow", baseURL: `http://localhost:${process.env.AUDIT37_PORT ?? 3118}` });
  page = await context.newPage();
});
test.afterAll(async () => { await context.close(); });

test("real login installs PROJEXA on this laptop (points 6, 15)", async () => {
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(dashboard|local|scope|prepare)/, { timeout: 60_000 });

  await expect
    .poll(async () => (await localDbNames(page)).length, { timeout: 300_000, message: "no projexa-local:<userId> IndexedDB database appeared" })
    .toBeGreaterThan(0);
  await expect
    .poll(
      () => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("px-release-")).length),
      { timeout: 300_000, message: "no px-release-<version> cache: the app bundle was never stored on the laptop" }
    )
    .toBe(1);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 60_000, message: "no service worker controls the page" })
    .toBe(true);
});

test("the tab holds the sync/peer leader lock (points 7, 8)", async () => {
  await page.goto("/local/");
  const [dbName] = await localDbNames(page);
  const userId = dbName.split(":")[1];
  await expect
    .poll(
      async () => page.evaluate(async () => (await navigator.locks.query()).held?.map((l) => l.name) ?? []),
      { timeout: 60_000, message: "px-peer-leader:<userId> is not held: startPeerSync is not running" }
    )
    .toContain(`px-peer-leader:${userId}`);
});

test("works with the network cut (point 25)", async () => {
  await page.goto("/local/");
  await context.setOffline(true);
  try {
    await page.goto("/local/");
    await expect(page.locator("body")).not.toContainText(/ERR_INTERNET_DISCONNECTED|This site can.t be reached/i);
    await expect(page.locator("main, [data-testid], nav").first()).toBeVisible({ timeout: 30_000 });
    // really offline, really the PROJEXA shell (not a browser error page), really served from the laptop's own copy
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(await page.title()).toMatch(/PROJEXA/i);
    await expect.poll(async () => (await page.locator("body").innerText()).length, { timeout: 45_000, message: "the offline page stayed blank" }).toBeGreaterThan(100);
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect(await page.evaluate(() => fetch("https://example.com/", { mode: "no-cors" }).then(() => "reached", () => "refused"))).toBe("refused");
    await page.screenshot({ path: "test-results/audit37-offline.png" });
  } finally {
    await context.setOffline(false);
  }
});

test("works with our side (Supabase) unreachable but the internet up (point 26)", async () => {
  await context.route(/supabase\.co/, (r) => r.abort("connectionrefused"));
  await page.goto("/local/");
  await expect(page.locator("main, [data-testid], nav").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("body")).not.toContainText(/ERR_|This site can.t be reached/i);
  expect(await page.title()).toMatch(/PROJEXA/i);
  await expect.poll(async () => (await page.locator("body").innerText()).length, { timeout: 45_000, message: "the page stayed blank" }).toBeGreaterThan(100);
  const supabaseUrl = await page.evaluate(() => (window as unknown as { __NEXT_DATA__?: unknown }) && "https://x.supabase.co/auth/v1/health");
  expect(await page.evaluate((u) => fetch(u, { mode: "no-cors" }).then(() => "reached", () => "refused"), supabaseUrl)).toBe("refused");
  await context.unroute(/supabase\.co/);
});

test("a page error reaches us, buffered while offline (point 33)", async () => {
  await page.goto("/local/");
  await page.evaluate(() => localStorage.removeItem("px-client-errors-pending"));
  await context.setOffline(true);
  await page.evaluate(() => setTimeout(() => { throw new Error("audit37-offline-probe"); }, 0));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("px-client-errors-pending")), { message: "the error was not buffered while offline" })
    .toContain("audit37-offline-probe");
  const sent = page.waitForResponse((r) => r.url().endsWith("/api/local-first/client-error") && r.status() === 204, { timeout: 60_000 });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await sent;
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("px-client-errors-pending")), { message: "the buffer was not cleared after the server took it" })
    .toBeNull();
});
