import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { USERS } from "./users";

// AUDIT 37 point 7 against the REAL backend: two different people of the SAME organisation (two separate browser profiles = two laptops)
// log in, open the offline shell, and find each other directly (signalling through the real Supabase Realtime / ntfy, data over WebRTC).
// The proof is the calm "Synced with N laptop(s)" line each laptop shows (data-testid="peer-sync"), which only renders when a peer link is up.

async function laptop(browser: import("@playwright/test").Browser, who: keyof typeof USERS): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ serviceWorkers: "allow", baseURL: `http://localhost:${process.env.AUDIT37_PORT ?? 3100}` });
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator("#email").fill(USERS[who].email);
  await page.locator("#password").fill(USERS[who].password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(dashboard|local|scope|prepare)/, { timeout: 60_000 });
  await expect
    .poll(async () => page.evaluate(async () => (await indexedDB.databases()).filter((d) => d.name?.startsWith("projexa-local:")).length), { timeout: 300_000 })
    .toBeGreaterThan(0);
  await page.goto("/local/");
  return { context, page };
}

test("two laptops of one organisation find each other (point 7)", async ({ browser }) => {
  const a = await laptop(browser, "siteSupervisor");
  const b = await laptop(browser, "finance");
  try {
    for (const l of [a, b]) {
      await expect
        .poll(async () => (await l.page.evaluate(async () => (await navigator.locks.query()).held?.map((x) => x.name) ?? [])).some((n) => n?.startsWith("px-peer-leader:")), {
          timeout: 60_000, message: "a laptop is not running peer sync",
        })
        .toBe(true);
    }
    await expect(a.page.getByTestId("peer-sync"), "laptop A never showed a connected peer").toBeVisible({ timeout: 180_000 });
    await expect(b.page.getByTestId("peer-sync"), "laptop B never showed a connected peer").toBeVisible({ timeout: 180_000 });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
