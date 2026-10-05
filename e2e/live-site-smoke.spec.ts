import { test, expect } from "@playwright/test";

// AUDIT-100 B1 + B16 against the DEPLOYED site (playwright.live-smoke.config.ts). No account is signed in: the 6-digit sign-in itself needs a
// real passcode and stays an owner-run step (AUDIT_100_CHECKLIST B1). What is proven here, on the real site, in real Chromium:
//  B16  the site serves the build of the latest main (the live /sw.js is stamped with the commit it was built from), the sign-in page renders,
//       every script the page loads is served as JavaScript (the shell bundle loads), and a protected page sends a signed-out visitor to /login.
//  B1   the sign-in form is the e-mail + 6-digit passcode form (signup takes exactly 6 digits), and a wrong passcode is refused with a plain
//       message and leaves the person on /login (a real call to the real sign-in service with an address that is not an account).
// Measured 2026-10-05 against https://projexa-ai.com: /login 200 in about 0.4-1.8 s, /sw.js stamped bb83ec499c474bad7c17f875ee55f00fbb8819ac
// (= origin/main #374 = Vercel production deployment dpl_9QsVFDzAi3Hdw9rprCrAP1npiQHM, READY).

const SHA = /\b([0-9a-f]{40})\b/;

test("B16: the live site is stamped with the commit it was built from (and, when EXPECT_SHA is given, that is the latest main)", async ({ request }) => {
  const res = await request.get("/sw.js");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/javascript/);
  const body = await res.text();
  const stamped = body.match(new RegExp(`PROJEXA service worker "${SHA.source}"`))?.[1];
  expect(stamped, "the worker script carries the build commit").toBeTruthy();
  if (process.env.EXPECT_SHA) expect(stamped).toBe(process.env.EXPECT_SHA.toLowerCase());
});

test("B16: sign-in page renders and every script it loads is real JavaScript", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  const res = await page.goto("/login");
  expect(res?.status()).toBe(200);
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
  const srcs = await page.$$eval("script[src]", (els) => els.map((e) => (e as HTMLScriptElement).src));
  expect(srcs.length).toBeGreaterThan(3);
  for (const src of srcs) {
    const r = await request.get(src);
    expect(r.status(), src).toBe(200);
    expect(r.headers()["content-type"], src).toMatch(/javascript/);
  }
  expect(consoleErrors).toEqual([]);
});

test("B16: a protected page sends a signed-out visitor to /login", async ({ page }) => {
  await page.goto("/local");
  await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 30_000 });
  await expect(page.locator("#email")).toBeVisible();
});

test("B1: the passcode is exactly 6 digits where a person chooses it", async ({ page }) => {
  await page.goto("/signup");
  const pin = page.locator("#password");
  await expect(pin).toHaveAttribute("maxlength", "6");
  await expect(pin).toHaveAttribute("pattern", "[0-9]{6}");
  await pin.fill("123456789");
  expect((await pin.inputValue()).length).toBeLessThanOrEqual(6);
});

test("B1: a wrong passcode is refused with a plain message and the person stays on /login", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("audit100-nobody@example.invalid");
  await page.locator("#password").fill("000000");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("form")).toContainText(/invalid|incorrect|wrong|not match|failed|not found/i, { timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/login");
});
