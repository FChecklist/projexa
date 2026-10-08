import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signInByCode, realTestCodeFor } from "./support/sign-in";

// AUDIT-100 A17/A18 (P1, 2026-10-08), replacing the old "forgot passcode" spec: there is no password or passcode to forget any more, so "forgot" is the
// same e-mailed 6-digit code as every other sign-in. Against the REAL backend (see playwright.audit37-real.config.ts): a production build of PROJEXA
// served by `next start`, the real PROJEXA Supabase Auth, real Chromium. The code for the throwaway TEST account comes from the Supabase admin API
// (support/sign-in.ts), never from a mailbox, and "send the code" is answered locally so no mail goes out.
//
//   1. A NEW laptop (an empty profile) signs in with the e-mail and the code: in.
//   2. SEEN TO FAIL: a wrong code is refused, the page stays on /login. The same code used a second time, on another new laptop, is refused (single use).
//   3. An OLD password-reset link (/auth/callback?type=recovery, and /reset-password) signs nobody in and lands on /login with the one plain sentence.
//
// Fixture: ONE throwaway confirmed account created through the Supabase admin API (test domain), deleted again in afterAll with a re-read that nothing
// is left. Needs SUPABASE_SERVICE_ROLE_KEY of the PROJEXA project in the environment (never printed, never committed). Not part of any CI config.
//
//   SUPABASE_SERVICE_ROLE_KEY=... AUDIT37_PORT=3107 AUDIT37_SKIP_BUILD=1 bunx playwright test -c playwright.audit37-real.config.ts audit37-real-a17-email-code

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://evpckeuxgvahguwsaeul.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BASE_URL = `http://localhost:${process.env.AUDIT37_PORT ?? 3100}`;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const EMAIL = `audit100-a17-${RUN}@invite.e2e-test.projexa-ai.com`;
let userId = "";

async function svc(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path.split("?")[0]} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** A NEW laptop: an empty browser profile. The laptop install is switched off so the sign-in checks stay light. */
async function newLaptop(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("px-local-first-off", "1");
    } catch {
      /* ignore */
    }
  });
  return { context, page: await context.newPage() };
}

const codeFor = realTestCodeFor();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY (PROJEXA project) is not set: this spec creates and deletes its own throwaway account");
  const u = await svc("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: EMAIL, email_confirm: true, user_metadata: { name: "AUDIT100 A17 code" } }) });
  userId = u.id ?? u.user?.id;
  expect(userId).toBeTruthy();
});

test.afterAll(async () => {
  if (!userId) return;
  await svc(`/auth/v1/admin/users/${userId}`, { method: "DELETE" }).catch(() => undefined);
  const left = await svc(`/auth/v1/admin/users?per_page=200`).catch(() => ({ users: [] }));
  expect((left.users ?? []).filter((x: { id: string }) => x.id === userId), "the throwaway account was not removed").toEqual([]);
});

test("a new laptop signs in with the e-mail and the code; a wrong code is refused and costs nothing; the same code cannot be used twice", async ({ browser }) => {
  const a = await newLaptop(browser);
  const b = await newLaptop(browser);
  try {
    // a wrong code on laptop A: refused in plain words, still on /login
    await a.page.route("**/auth/v1/otp*", (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: "{}" }));
    await a.page.goto("/login");
    await a.page.locator("#email").fill(EMAIL);
    await a.page.locator('button[type="submit"]').click();
    await expect(a.page.locator("#code")).toBeVisible({ timeout: 30_000 });
    await a.page.locator("#code").fill("000000");
    await expect(a.page.locator("form")).toContainText(/not right|expired|already used/i, { timeout: 30_000 });
    expect(new URL(a.page.url()).pathname).toBe("/login");

    // the right code signs in
    const code = await codeFor(EMAIL);
    await a.page.locator("#code").fill(code);
    await a.page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

    // the SAME code on another new laptop is refused: single use
    await b.page.route("**/auth/v1/otp*", (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: "{}" }));
    await b.page.goto("/login");
    await b.page.locator("#email").fill(EMAIL);
    await b.page.locator('button[type="submit"]').click();
    await expect(b.page.locator("#code")).toBeVisible({ timeout: 30_000 });
    await b.page.locator("#code").fill(code);
    await expect(b.page.locator("form")).toContainText(/not right|expired|already used/i, { timeout: 30_000 });
    expect(new URL(b.page.url()).pathname, "a used code signed someone in").toBe("/login");
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("an old password-reset link signs nobody in and lands on /login with one plain sentence", async ({ browser }) => {
  const { context, page } = await newLaptop(browser);
  try {
    await page.goto("/auth/callback?token_hash=abc123&type=recovery&redirectTo=/reset-password");
    await expect(page).toHaveURL(/\/login\?notice=no-password/, { timeout: 30_000 });
    await expect(page.getByTestId("login-notice")).toContainText("no longer uses a password");
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/login\?notice=no-password/, { timeout: 30_000 });
    // and nobody was signed in by it: a protected page still sends the visitor to /login
    await page.goto("/dashboard");
    await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 30_000 });
    // a normal sign-in still works from here
    await signInByCode(page, EMAIL, { code: codeFor, stayOnPage: true });
  } finally {
    await context.close();
  }
});
