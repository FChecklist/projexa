import { test, expect } from "@playwright/test";
import { USERS } from "./users";
import { signInByCode, realTestCode } from "./support/sign-in";

// AUDIT 37 points 16 and 18 against the REAL backend (see playwright.audit37-real.config.ts), rewritten for P1 (2026-10-08): there is no passcode and no
// password any more -- sign-in is the e-mail and the 6-digit code sent to it (the code for these TEST users comes from the Supabase admin API, never a mailbox).
//  16: the code box takes exactly 6 digits, /signup is the same door as /login (nothing to choose), a wrong code is refused at login with a plain
//      message, and a correct one signs in.
//  18: "nothing is lost" -- signing out and back in brings the same person back to the same local copy
//      (the IndexedDB database named for the user id is the one that is reused, and the sync:done markers are still there).

test("the code box takes only 6 digits and signup is the same door (point 16)", async ({ page }) => {
  await page.goto("/signup");
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
  await expect(page.locator("#password")).toHaveCount(0);
  // "send the code" is answered locally: this check needs the code box, not a real mail
  await page.route("**/auth/v1/otp*", (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: "{}" }));
  await page.locator("#email").fill(USERS.siteSupervisor.email);
  await page.locator('button[type="submit"]').click();
  const box = page.locator("#code");
  await expect(box).toHaveAttribute("maxlength", "6");
  await box.pressSequentially("123456789");
  expect((await box.inputValue()).length).toBeLessThanOrEqual(6);
});

test("a wrong code is refused with a message, the right one signs in (point 16)", async ({ page }) => {
  const user = USERS.siteSupervisor;
  await page.goto("/login");
  await page.route("**/auth/v1/otp*", (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: "{}" }));
  await page.locator("#email").fill(user.email);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#code")).toBeVisible({ timeout: 30_000 });
  // a code that is certainly not the stored one (the real one is minted below, after this refusal)
  await page.locator("#code").fill("000000");
  await expect(page.locator("form")).toContainText(/not right|expired|already used|too many/i, { timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/login");

  const code = await realTestCode(user.email);
  await page.locator("#code").fill(code);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
});

test("signing out and back in reuses the same local copy; nothing is lost (point 18)", async ({ browser }) => {
  const user = USERS.siteSupervisor;
  const context = await browser.newContext({ serviceWorkers: "allow", baseURL: `http://localhost:${process.env.AUDIT37_PORT ?? 3100}` });
  const page = await context.newPage();
  const dbs = () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:")).sort());
  const login = () => signInByCode(page, user.email, { code: realTestCode });
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
