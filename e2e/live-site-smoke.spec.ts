import { test, expect, type Page } from "@playwright/test";

// AUDIT-100 B1 + B16 against the DEPLOYED site (playwright.live-smoke.config.ts). No account is signed in: the 6-digit sign-in itself needs a
// real mailbox (the e-mailed 6-digit code) and stays an owner-run step (AUDIT_100_CHECKLIST B1). What is proven here, on the real site, in real Chromium:
//  B16  the site serves the build of the latest main (the live /sw.js is stamped with the commit it was built from), the sign-in page renders,
//       every script the page loads is served as JavaScript (the shell bundle loads), and a protected page sends a signed-out visitor to /login.
//  B1   (P1) the sign-in form is the e-mail form followed by a 6-digit code box (no password field anywhere; /signup is the same door), and a
//       wrong code is refused with a plain message and leaves the person on /login (a real "check the code" call to the real sign-in service
//       with an address that is not an account; the "send the code" call is answered inside the browser so no mail is sent, no account is made).
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
  await expect(page.locator("#password")).toHaveCount(0);
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

// ---- B1 (P1) ----
// Each check is a function so the same code runs twice: against the real live page (it must pass) and, in the CONTROL tests below, against
// the real live page with ONE named thing broken in the browser (it must fail). A control passes only when its check fails, so a check that
// cannot see the break it is meant to catch turns this file red. The breaks are made in the page after it has rendered (an attribute is changed
// or the sign-in answer is faked), which proves the CHECK can fail; it does not edit the site's code.
//   M1 maxlength 6 -> 8           : checkCodeField fails on B1-a
//   M2 length limit removed       : checkCodeTyping fails on B1-c (the box keeps all 9 digits)
//   M3 sign-in service says 200   : checkWrongCodeRefused fails on B1-d/e (no refusal message; the made-up session is never sent anywhere)

const NOBODY = "audit100-nobody@example.invalid";
const CORS_JSON = { "access-control-allow-origin": "*", "content-type": "application/json" };

/** Answers "send the code" inside the browser: no mail is sent and no account is created on the real service. */
async function answerSendCodeLocally(page: Page) {
  await page.route(/\/auth\/v1\/otp/, (route) => route.fulfill({ status: 200, headers: CORS_JSON, body: "{}" }));
}

/** Types an address that is not an account and gets to the code box. */
async function openCodeBox(page: Page, timeout?: number) {
  await answerSendCodeLocally(page);
  await page.goto("/login");
  await page.locator("#email").fill(NOBODY);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#code"), "the code box appears after the e-mail is sent").toBeVisible({ timeout: timeout ?? 30_000 });
}

async function checkCodeField(page: Page, timeout?: number, tamper?: (page: Page) => Promise<void>) {
  await openCodeBox(page, timeout);
  if (tamper) await tamper(page);
  const box = page.locator("#code");
  await expect(box, "B1-a: the code box takes at most 6 characters").toHaveAttribute("maxlength", "6", { timeout });
  await expect(box, "B1-b: the code box is a one-time-code box").toHaveAttribute("autocomplete", "one-time-code", { timeout });
  await expect(page.locator("#password"), "B1-f: there is no password box").toHaveCount(0);
  await checkCodeTyping(page);
}

/** B1-c on its own: what the box keeps when 9 digits are typed into it (the browser's own enforcement, not the attribute's text). */
async function checkCodeTyping(page: Page) {
  const box = page.locator("#code");
  await box.pressSequentially("123456789");
  expect((await box.inputValue()).length, "B1-c: typing 9 digits keeps at most 6").toBeLessThanOrEqual(6);
}

async function checkWrongCodeRefused(page: Page, timeout?: number) {
  await openCodeBox(page, timeout);
  await page.locator("#code").fill("000000");
  await expect(page.locator("form"), "B1-d: a wrong code is refused with a plain message").toContainText(/not right|expired|already used|too many/i, { timeout: timeout ?? 30_000 });
  expect(new URL(page.url()).pathname, "B1-e: after a wrong code the person is still on /login").toBe("/login");
}

test("B1: the e-mail form leads to a 6-digit code box and there is no password anywhere", async ({ page }) => {
  await checkCodeField(page);
});

test("B1: /signup is the same door as /login", async ({ page }) => {
  await page.goto("/signup");
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
  await expect(page.locator("#password")).toHaveCount(0);
});

test("B1: a wrong code is refused with a plain message and the person stays on /login", async ({ page }) => {
  await checkWrongCodeRefused(page);
});

test("B1 CONTROL (mutation M1, maxlength 6 -> 8): the code-box check fails on B1-a", async ({ page }) => {
  await expect(checkCodeField(page, 5_000, (p) => p.locator("#code").evaluate((el) => el.setAttribute("maxlength", "8")))).rejects.toThrow(/B1-a/);
});

test("B1 CONTROL (mutation M2, the length limit removed): the typing check fails on B1-c (the box keeps all 9 digits)", async ({ page }) => {
  await openCodeBox(page);
  await page.locator("#code").evaluate((el) => el.removeAttribute("maxlength"));
  await expect(checkCodeTyping(page)).rejects.toThrow(/B1-c/);
});

test("B1 CONTROL (mutation M3, the sign-in service says yes to the wrong code): the wrong-code check fails", async ({ page }) => {
  // The "check the code" call is answered HERE with a 200 and a made-up session (nothing reaches the real service); the app's follow-up reads are
  // answered empty here too, and every page it then opens is a local placeholder, so no made-up token ever reaches the live site or Supabase.
  let checks = 0;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: NOBODY };
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, aud: "authenticated", role: "authenticated", exp: now + 3600, email: NOBODY })}.c2lnbmF0dXJl`;
  await page.route(/\/auth\/v1\/verify/, (route) => {
    checks += 1;
    return route.fulfill({ status: 200, headers: CORS_JSON, body: JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "control-refresh", user }) });
  });
  await page.route(/\.supabase\.co\/(rest|auth)\/v1\/(?!verify|otp)/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: route.request().url().includes("/rest/") ? "null" : "{}" }));
  const live = new URL(test.info().project.use.baseURL ?? "https://projexa-ai.com").origin;
  await page.route((url) => url.origin === live && !url.pathname.startsWith("/_next/static"), (route) => {
    if (checks === 0) return route.fallback(); // before the made-up sign-in: the real live site
    const doc = route.request().resourceType() === "document";
    return route.fulfill({ status: 200, contentType: doc ? "text/html" : "application/json", body: doc ? "<!doctype html><title>placeholder</title><p>placeholder after the control sign-in</p>" : "{}" });
  });
  await expect(checkWrongCodeRefused(page, 8_000)).rejects.toThrow(/B1-d|B1-e/);
  expect(checks, "the code check was answered by the control").toBeGreaterThan(0);
});
