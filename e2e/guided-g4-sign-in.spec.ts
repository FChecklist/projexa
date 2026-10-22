import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { STUB_CODE, stubAuthOtp } from "./support/sign-in";

// GUIDED ERRORS, group G4, part 1: THE SIGN-IN PAGE. Every way a real person can fail to get in, in Chromium, against the page of a running PROJEXA
// (baseURL; run against https://projexa-ai.com with `bunx playwright test -c playwright.guided-g4.config.ts guided-g4-sign-in`). Nothing here signs in
// for real and nothing is e-mailed: the Supabase Auth calls ("send the code" /auth/v1/otp, "check the code" /auth/v1/verify) are answered in the
// browser, the way Auth itself answers (support/sign-in.ts stubAuthOtp). Every test asserts the four parts of the guide -- title, what, why, the
// numbered steps (and where the Fix button goes) -- the way the person reads them, and that what was typed is still there afterwards.
//
// Fault cases covered here: wrong / expired / used code, mistyped e-mail, empty e-mail, empty code, code not arriving (resend cooldown, spam hint,
// change e-mail), too many wrong tries (15-minute pause that survives a reload), Auth rate limit (429), the code could not be sent (500), offline
// at the first sign-in, and the redirectTo return path with a query.

const EMAIL = "pat.surveyor@meridian-construction.e2e-test.projexa-ai.com";
const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };

async function open(context: BrowserContext, search = ""): Promise<Page> {
  await context.addInitScript(() => {
    try { localStorage.setItem("px-local-first-off", "1"); } catch { /* ignore */ }
  });
  const page = await context.newPage();
  await page.goto(`/login${search}`);
  await expect(page.locator("#email")).toBeVisible({ timeout: 60_000 });
  return page;
}

/** The four parts of the guide, as the person reads them. */
async function expectGuide(page: Page, parts: { title: RegExp | string; what?: RegExp | string; why?: RegExp | string; steps?: number; testId?: string }) {
  const panel = page.getByTestId(parts.testId ?? "login-guided-error");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("guided-error-title")).toContainText(parts.title);
  if (parts.what) await expect(panel.getByTestId("guided-error-what")).toContainText(parts.what);
  if (parts.why) await expect(panel.getByTestId("guided-error-why")).toContainText(parts.why);
  const steps = panel.getByTestId("guided-error-steps").locator("li");
  expect(await steps.count()).toBeGreaterThanOrEqual(1);
  if (parts.steps) expect(await steps.count()).toBe(parts.steps);
  return panel;
}

async function sendCode(page: Page, email = EMAIL) {
  await page.locator("#email").fill(email);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#code")).toBeVisible({ timeout: 30_000 });
}

test.describe("G4 sign-in faults", () => {
  test("empty e-mail: says what to type, the Fix button highlights the e-mail box", async ({ context }) => {
    await stubAuthOtp(context, null);
    const page = await open(context);
    await page.locator('button[type="submit"]').click();
    await expectGuide(page, { title: "Type your e-mail address", what: /e-mail box is empty/, why: /no password/i, steps: 3 });
    await expect(page.getByTestId("login-email-error")).toContainText("Type your e-mail here");
    await expect(page.locator("#email")).toHaveAttribute("aria-invalid", "true");
    await page.getByTestId("guided-error-fix").click();
    await expect(page.locator("#email")).toHaveAttribute("data-px-highlighted", "true");
    await expect(page.locator("#email")).toBeFocused();
  });

  test("mistyped e-mail (no @ / no ending): refused before anything is sent, typed text stays", async ({ context }) => {
    const seen = await stubAuthOtp(context, null);
    const page = await open(context);
    await page.locator("#email").fill("pat.surveyor@meridian");
    await page.locator('button[type="submit"]').click();
    await expectGuide(page, { title: "That e-mail does not look right", what: /incomplete/, why: /name@company\.com/ });
    await expect(page.locator("#email")).toHaveValue("pat.surveyor@meridian");
    expect(seen.otpRequests).toHaveLength(0);
  });

  test("a misspelled well-known service (gmial.com): warned on the code screen, Change e-mail keeps the text", async ({ context }) => {
    await stubAuthOtp(context, null);
    const page = await open(context);
    await sendCode(page, "pat.surveyor@gmial.com");
    const panel = await expectGuide(page, { title: "Is the e-mail spelled correctly?", what: /gmail\.com/, testId: "login-typo" });
    await panel.getByTestId("guided-error-action-change").click();
    await expect(page.locator("#email")).toHaveValue("pat.surveyor@gmial.com");
  });

  test("wrong / expired / used code: the code box empties, tries left are said, a new code can be asked for", async ({ context }) => {
    const seen = await stubAuthOtp(context, null);
    const page = await open(context);
    await sendCode(page);
    await page.locator("#code").fill("000000");
    const panel = await expectGuide(page, { title: "That code did not work", what: /5|4 tries left|tries/, why: /already used|10 minutes|replaced/ });
    await expect(panel.getByTestId("guided-error-what")).toContainText("4 tries left");
    await expect(page.locator("#code")).toHaveValue("");
    await expect(page.locator("#code")).toHaveAttribute("aria-invalid", "true");
    expect(seen.verifies.length).toBeGreaterThan(0);
    // "Send a new code" is the same button as Resend: not yet (60 s), and the label says how long
    await expect(panel.getByTestId("guided-error-action-resend")).toBeDisabled();
    await expect(panel.getByTestId("guided-error-action-resend")).toContainText(/in \d+s/);
  });

  test("empty code: the code box cannot be sent empty; pasting fewer than 6 digits keeps the button off and the box as typed", async ({ context }) => {
    await stubAuthOtp(context, null);
    const page = await open(context);
    await sendCode(page);
    await page.locator("#code").fill("123");
    await expect(page.locator("#code")).toHaveValue("123");
    await expect(page.getByRole("button", { name: /verify|sign in/i })).toBeDisabled();
  });

  test("code not arriving: after a minute the 'has the code not arrived' panel offers spam check, a new code and Change e-mail", async ({ context }) => {
    await stubAuthOtp(context, null);
    const page = await open(context);
    await sendCode(page);
    await expect(page.getByTestId("login-not-arrived")).toHaveCount(0);
    await page.waitForTimeout(62_000); // the page counts real seconds: a faked clock does not move its resend countdown
    const panel = await expectGuide(page, { title: "Has the code not arrived?", what: new RegExp(EMAIL.split("@")[0]!), why: /Spam|Junk/, testId: "login-not-arrived" });
    await expect(panel.getByTestId("guided-error-steps")).toContainText("Spam");
    await panel.getByTestId("guided-error-action-resend").click();
    await expect(page.getByTestId("login-not-arrived")).toHaveCount(0); // the cooldown starts again
    await page.getByRole("button", { name: /change e-?mail|different e-?mail/i }).click();
    await expect(page.locator("#email")).toHaveValue(EMAIL);
  });

  test("too many wrong tries: a 15-minute pause with the minutes left, kept across a reload", async ({ context }) => {
    await stubAuthOtp(context, null);
    const page = await open(context);
    await sendCode(page);
    for (let i = 0; i < 5; i++) {
      await page.locator("#code").fill(`00000${i}`);
      await expect(page.getByTestId("login-guided-error")).toBeVisible();
      if (i < 4) await expect(page.locator("#code")).toHaveValue("");
    }
    await expectGuide(page, { title: "Too many wrong tries, please wait", what: /15 minutes/, why: /guessing/ });
    await expect(page.getByTestId("guided-error-action-resend")).toBeDisabled();
    await page.reload();
    await expect(page.locator("#email")).toHaveValue(EMAIL); // typed e-mail survived the reload
    await sendCode(page);
    await page.locator("#code").fill("123456");
    await expectGuide(page, { title: "Too many wrong tries, please wait", what: /minutes/ });
  });

  test("Auth rate limit (429) when asking for a code: says wait, keeps the e-mail, Try again is offered", async ({ context }) => {
    await context.route("**/auth/v1/otp*", (route) => route.fulfill({ status: 429, headers: cors, body: JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" }) }));
    const page = await open(context);
    await page.locator("#email").fill(EMAIL);
    await page.locator('button[type="submit"]').click();
    const panel = await expectGuide(page, { title: "Too many requests, wait a few minutes", why: /protects your account/ });
    await expect(panel.getByTestId("guided-error-action-retry")).toBeVisible();
    await expect(page.locator("#email")).toHaveValue(EMAIL);
  });

  test("the code could not be sent (Auth 500): says so, nothing lost, Try again works once Auth answers", async ({ context }) => {
    let healthy = false;
    await context.route("**/auth/v1/otp*", (route) =>
      healthy ? route.fulfill({ status: 200, headers: cors, body: "{}" }) : route.fulfill({ status: 500, headers: cors, body: JSON.stringify({ msg: "Error sending magic link email" }) })
    );
    const page = await open(context);
    await page.locator("#email").fill(EMAIL);
    await page.locator('button[type="submit"]').click();
    const panel = await expectGuide(page, { title: "The code could not be sent", what: /Nothing was changed/ });
    healthy = true;
    await panel.getByTestId("guided-error-action-retry").click();
    await expect(page.locator("#code")).toBeVisible();
  });

  test("offline at the first sign-in: 'you need a connection', with what to do, and Try again after reconnecting", async ({ context }) => {
    await stubAuthOtp(context, null);
    const page = await open(context);
    await page.locator("#email").fill(EMAIL);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.locator('button[type="submit"]').click();
    const panel = await expectGuide(page, { title: "You need a connection to sign in", why: /first time needs the internet/ });
    await context.setOffline(false);
    await panel.getByTestId("guided-error-action-retry").click();
    await expect(page.locator("#code")).toBeVisible();
  });

  test("signed-out redirect keeps the page AND its query: the sign-in page says where you will land", async ({ context }) => {
    await stubAuthOtp(context, null);
    const page = await open(context, `?redirectTo=${encodeURIComponent("/scope/abc/budget?projectId=p1&line=l9")}&notice=session-ended`);
    const panel = await expectGuide(page, { title: "Sign in to carry on where you were", what: /\/scope\/abc\/budget/, testId: "login-continue" });
    await expect(panel.getByTestId("guided-error-steps")).toContainText("put back");
    // an unsafe address is never followed (open redirect): no panel names it
    const evil = await context.newPage();
    await evil.goto(`/login?redirectTo=${encodeURIComponent("//evil.example/x")}`);
    await expect(evil.getByTestId("login-continue")).toHaveCount(0);
  });
});

export { STUB_CODE };
