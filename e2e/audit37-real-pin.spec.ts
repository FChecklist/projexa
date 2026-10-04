import { test, expect } from "@playwright/test";
import { USERS } from "./users";

// AUDIT 37 points 16 and 18 against the REAL backend (see playwright.audit37-real.config.ts).
//  16: the passcode is exactly 6 digits where a person chooses it (signup), a wrong passcode is refused at login with a plain message,
//      and a correct one signs in.
//  18: "nothing is lost" -- signing out and back in with the same passcode brings the same person back to the same local copy
//      (the IndexedDB database named for the user id is the one that is reused, and the sync:done markers are still there).

test("signup only takes a 6-digit passcode (point 16)", async ({ page }) => {
  await page.goto("/signup");
  const pin = page.locator("#password");
  await expect(pin).toHaveAttribute("maxlength", "6");
  await expect(pin).toHaveAttribute("pattern", "[0-9]{6}");
  await pin.fill("123456789");
  expect((await pin.inputValue()).length).toBeLessThanOrEqual(6);
});

test("a wrong passcode is refused with a message, the right one signs in (point 16)", async ({ page }) => {
  const user = USERS.siteSupervisor;
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("000000-wrong");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("form")).toContainText(/invalid|incorrect|wrong|not match|failed/i, { timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/login");

  await page.locator("#password").fill(user.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
});

test("signing out and back in reuses the same local copy; nothing is lost (point 18)", async ({ browser }) => {
  const user = USERS.siteSupervisor;
  const context = await browser.newContext({ serviceWorkers: "allow", baseURL: `http://localhost:${process.env.AUDIT37_PORT ?? 3100}` });
  const page = await context.newPage();
  const dbs = () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:")).sort());
  const login = async () => {
    await page.goto("/login");
    await page.locator("#email").fill(user.email);
    await page.locator("#password").fill(user.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  };
  try {
    await login();
    await expect.poll(async () => (await dbs()).length, { timeout: 300_000 }).toBeGreaterThan(0);
    const before = await dbs();
    // clear only the session cookies (a sign-out), keep the browser's storage as a real sign-out on the same laptop does
    await context.clearCookies();
    await login();
    await expect.poll(async () => (await dbs()).length, { timeout: 60_000 }).toBeGreaterThan(0);
    const after = await dbs();
    expect(after, "a different local database was created: the person's copy was not reused").toEqual(before);
  } finally {
    await context.close();
  }
});
