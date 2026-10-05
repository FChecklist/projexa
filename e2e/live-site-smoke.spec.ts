import { test, expect, type Page, type Route } from "@playwright/test";

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

// ---- B1 ----
// Each check is a function so the same code runs twice: against the real live page (it must pass) and, in the CONTROL tests below, against
// the real live page with ONE named thing broken in the browser (it must fail). A control passes only when its check fails, so a check that
// cannot see the break it is meant to catch turns this file red. SEEN (2026-10-05, Edge, against https://projexa-ai.com):
//   M1 maxlength 6 -> 8           : checkPasscodeField fails on B1-a (expected "6", received "8")
//   M2 pattern -> [0-9]{4,8}      : checkPasscodeField fails on B1-b
//   M3 length limit removed       : checkPasscodeTyping fails on B1-c (the field keeps all 9 digits)
//   M4 sign-in service says 200   : checkWrongPasscodeRefused fails on B1-d (no refusal message; the made-up session is never sent anywhere)
// and all four checks pass on the unbroken live site. The CORRECT-passcode sign-in needs a real passcode: owner step,
// docs/audit100/LIVE_PASSCODE_OWNER_SCRIPT.md.

async function checkPasscodeField(page: Page, timeout?: number) {
  await page.goto("/signup");
  const pin = page.locator("#password");
  await expect(pin, "B1-a: the signup passcode field takes at most 6 characters").toHaveAttribute("maxlength", "6", { timeout });
  await expect(pin, "B1-b: the signup passcode field takes only 6 digits").toHaveAttribute("pattern", "[0-9]{6}", { timeout });
  await checkPasscodeTyping(page);
}

/** B1-c on its own: what the field keeps when 9 digits are typed into it (the browser's own enforcement, not the attribute's text). */
async function checkPasscodeTyping(page: Page) {
  const pin = page.locator("#password");
  await pin.fill("123456789");
  expect((await pin.inputValue()).length, "B1-c: typing 9 digits keeps at most 6").toBeLessThanOrEqual(6);
}

async function checkWrongPasscodeRefused(page: Page, timeout?: number) {
  await page.goto("/login");
  await page.locator("#email").fill("audit100-nobody@example.invalid");
  await page.locator("#password").fill("000000");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("form"), "B1-d: a wrong passcode is refused with a plain message").toContainText(/invalid|incorrect|wrong|not match|failed|not found/i, { timeout: timeout ?? 30_000 });
  expect(new URL(page.url()).pathname, "B1-e: after a wrong passcode the person is still on /login").toBe("/login");
}

/**
 * Breaks the live signup form in THIS browser only: the server-rendered HTML of /signup (what the browser shows before React runs, and
 * keeps: hydration does not rewrite attributes) and the site's compiled JavaScript are both rewritten. Each `from` must be found in both,
 * else the control is void and fails loudly (the live code changed: re-read it and update LIVE_HTML / LIVE_JS).
 */
/** The live site over this laptop's connection drops a request now and then (ECONNRESET): a control must not fail for that. */
async function fetchWithRetry(route: Route) {
  for (let i = 0; ; i++) {
    try { return await route.fetch(); } catch (e) { if (i >= 2) throw e; }
  }
}

async function breakLiveSignup(page: Page, html: [string, string], js: [string, string]): Promise<{ html: number; js: number }> {
  const seen = { html: 0, js: 0 };
  await page.route(/\/signup(\?.*)?$/, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const res = await fetchWithRetry(route);
    const body = await res.text();
    if (body.includes(html[0])) seen.html += 1;
    return route.fulfill({ response: res, body: body.split(html[0]).join(html[1]) });
  });
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    const res = await fetchWithRetry(route);
    const body = await res.text();
    if (body.includes(js[0])) seen.js += 1;
    return route.fulfill({ response: res, body: body.split(js[0]).join(js[1]) });
  });
  return seen;
}

test("B1: the passcode is exactly 6 digits where a person chooses it", async ({ page }) => {
  await checkPasscodeField(page);
});

test("B1: a wrong passcode is refused with a plain message and the person stays on /login", async ({ page }) => {
  await checkWrongPasscodeRefused(page);
});

// The live signup field as served on 2026-10-05: HTML `id="password" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" minLength="6"`,
// compiled code `id:"password",type:"password",inputMode:"numeric",pattern:"[0-9]{6}",maxLength:6,minLength:6`.
const LIVE_HTML = 'pattern="[0-9]{6}" maxLength="6"';
const LIVE_JS = 'pattern:"[0-9]{6}",maxLength:6';

test("B1 CONTROL (mutation M1, maxlength 6 -> 8): the passcode-field check fails on B1-a", async ({ page }) => {
  const seen = await breakLiveSignup(page, [LIVE_HTML, 'pattern="[0-9]{6}" maxLength="8"'], [LIVE_JS, 'pattern:"[0-9]{6}",maxLength:8']);
  await expect(checkPasscodeField(page, 5_000)).rejects.toThrow(/B1-a/);
  expect(seen.html * seen.js, "the mutation was applied to the live signup page and code").toBeGreaterThan(0);
});

test("B1 CONTROL (mutation M2, pattern [0-9]{6} -> [0-9]{4,8}): the passcode-field check fails on B1-b", async ({ page }) => {
  const seen = await breakLiveSignup(page, [LIVE_HTML, 'pattern="[0-9]{4,8}" maxLength="6"'], [LIVE_JS, 'pattern:"[0-9]{4,8}",maxLength:6']);
  await expect(checkPasscodeField(page, 5_000)).rejects.toThrow(/B1-b/);
  expect(seen.html * seen.js, "the mutation was applied to the live signup page and code").toBeGreaterThan(0);
});

test("B1 CONTROL (mutation M3, the length limit removed): the typing check fails on B1-c (the field keeps all 9 digits)", async ({ page }) => {
  const seen = await breakLiveSignup(page, [LIVE_HTML, 'pattern="[0-9]{6}"'], [LIVE_JS, 'pattern:"[0-9]{6}"']);
  await page.goto("/signup");
  await expect(checkPasscodeTyping(page)).rejects.toThrow(/B1-c/);
  expect(seen.html * seen.js, "the mutation was applied to the live signup page and code").toBeGreaterThan(0);
});

test("B1 CONTROL (mutation M4, the sign-in service says yes to the wrong passcode): the wrong-passcode check fails", async ({ page }) => {
  // The sign-in call is answered HERE with a 200 and a made-up session (nothing reaches the real service); the app's follow-up reads are
  // answered empty here too, and every page it then opens is a local placeholder, so no made-up token ever reaches the live site or Supabase.
  let signins = 0;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", exp: now + 3600, email: "audit100-nobody@example.invalid" })}.c2lnbmF0dXJl`;
  await page.route(/\/auth\/v1\/token/, (route) => {
    signins += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "control-refresh", user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "audit100-nobody@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }) });
  });
  await page.route(/\.supabase\.co\/(rest|auth)\/v1\/(?!token)/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: route.request().url().includes("/rest/") ? "null" : "{}" }));
  const live = new URL(test.info().project.use.baseURL ?? "https://projexa-ai.com").origin;
  await page.route((url) => url.origin === live && !url.pathname.startsWith("/_next/static"), (route) => {
    if (signins === 0) return route.fallback(); // before the made-up sign-in: the real live site
    const doc = route.request().resourceType() === "document";
    return route.fulfill({ status: 200, contentType: doc ? "text/html" : "application/json", body: doc ? "<!doctype html><title>placeholder</title><p>placeholder after the control sign-in</p>" : "{}" });
  });
  await expect(checkWrongPasscodeRefused(page, 8_000)).rejects.toThrow(/B1-d/);
  expect(signins, "the sign-in call was answered by the control").toBeGreaterThan(0);
});
