import { test, expect, type Browser, type BrowserContext, type Page, type Response } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AUDIT-100 A17 ("forgot passcode: e-mail link plus 6 digits, on a NEW laptop") and A18 ("nothing lost after reset"), END TO END against the
// REAL backend (see playwright.audit37-real.config.ts): a production build of PROJEXA served by `next start`, the REAL PROJEXA Supabase Auth
// (evpckeuxgvahguwsaeul) sending a REAL e-mail through its own mailer, real Chromium. Nothing is stubbed. e2e/lf-lifecycle-passcode.spec.ts
// proves the same screens with the Auth endpoints answered inside the browser; this file is the part that stub cannot prove: the e-mail really
// arrives, carries the link and the 6 digits, and they really complete the reset on a machine that never asked for it.
//
//   1. Laptop 1 (a fresh profile) opens /forgot-password and asks for the reset ONCE. The Auth answer is recorded (200 = sent; the page shows
//      the same sentence for every outcome, on purpose, so the page alone cannot tell) and the account's recovery_sent_at is re-read.
//   2. The e-mail is read from the recipient's real mailbox by the operator (Gmail) and handed to this run through a drop file (A17_MAIL_DROP,
//      plain text of the message). The spec parses it: the link must be <site>/auth/callback?token_hash=..&type=recovery, and a 6-digit code
//      must be in it. The drop file is deleted as soon as it is read.
//   3. Laptop 2 (a NEW, empty profile) opens the link: it does NOT sign anyone in by itself (no /verify call), it asks for the address and the
//      6 digits. SEEN TO FAIL: a wrong 6-digit code is refused, the page stays on the code form, and the OLD passcode still signs in (re-read by
//      a real sign-in on a third empty profile) -- the passcode was not changed.
//   4. The right code -> /reset-password -> a new 6-digit passcode -> into the product. Re-read by real sign-ins on fresh profiles: the NEW
//      passcode signs in, the OLD one is refused by Supabase (400) and the page stays on /login.
//   5. SEEN TO FAIL: the used link opened again -- on another new laptop (address + the same code -> refused) and on laptop 1, the machine that
//      asked (it tries the link directly -> "Sign-in link could not be used") -- the plain refusal; the new passcode still works.
//
// Fixture: ONE throwaway confirmed account created through the Supabase admin API, with a known throwaway 6-digit passcode, whose address is a
// plus-address of the recipient (A17_EMAIL; the project's built-in mailer only delivers to the project's team addresses), deleted again in
// afterAll with a re-read that nothing is left. Exactly ONE reset e-mail is requested per run; the project allows 2 e-mails an hour.
//
// Needs SUPABASE_SERVICE_ROLE_KEY of the PROJEXA project in the environment of the test process (never printed, never committed). Not part of
// any CI config: it needs live credentials and a person/agent to read the mailbox, like every other audit37-real spec.
//
//   A17_EMAIL=<owner>+pxa17<random>@gmail.com SUPABASE_SERVICE_ROLE_KEY=... AUDIT37_PORT=3107 AUDIT37_SKIP_BUILD=1 \
//     bunx playwright test -c playwright.audit37-real.config.ts audit37-real-a17-forgot-passcode
//   ...then, when the e-mail arrives, write its plain-text body to the drop file the run prints (A17_MAIL_DROP).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://evpckeuxgvahguwsaeul.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BASE_URL = `http://localhost:${process.env.AUDIT37_PORT ?? 3100}`;
const SITE_URL = process.env.A17_SITE_URL ?? "https://projexa-ai.com"; // the project's Auth site_url: the recovery template builds the link on it
const EMAIL = (process.env.A17_EMAIL ?? "").toLowerCase();
const MAIL_DROP = process.env.A17_MAIL_DROP ?? join(tmpdir(), "px-a17-mail-drop.txt");
const MAIL_WAIT_MS = Number(process.env.A17_MAIL_WAIT_MS ?? 600_000);
// "email" (default): the real e-mail. "admin": a re-run that sends NO e-mail -- the same one-time credential is minted by the admin API
// (generate_link), for re-checking the screens and the refusals without spending the project's 2-an-hour e-mail allowance.
const CREDENTIAL = process.env.A17_CREDENTIAL === "admin" ? "admin" : "email";

const pin = () => String(100000 + Math.floor(Math.random() * 900000));
const OLD_PASSCODE = pin();
let NEW_PASSCODE = pin();
while (NEW_PASSCODE === OLD_PASSCODE) NEW_PASSCODE = pin();

let userId = "";
let link = ""; // the e-mailed link, re-pointed at the local build (same path + query; the token_hash is the credential, not the host)
let code = "";

// ---- Supabase admin REST (fixture + persisted re-reads only; the flow under test goes through the app) ----
async function svc(path: string, init: RequestInit = {}): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}${path}`, {
        ...init,
        headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      if (!res.ok) throw Object.assign(new Error(`${init.method ?? "GET"} ${path.split("?")[0]} -> ${res.status} ${text.slice(0, 200)}`), { status: res.status });
      return text ? JSON.parse(text) : null;
    } catch (err) {
      if ((err as { status?: number }).status !== undefined || attempt >= 4) throw err; // only transport failures are retried
      await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
    }
  }
}

/** A NEW laptop: an empty browser profile (no cookies, no storage). The laptop install is switched off so the sign-in checks stay light. */
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

const isPasswordGrant = (r: Response) => r.url().includes("/auth/v1/token") && r.url().includes("grant_type=password") && r.request().method() === "POST";

/** A real sign-in through the real form on a fresh profile; returns Supabase's answer and where the page ended up. */
async function signIn(browser: Browser, passcode: string): Promise<{ status: number; leftLogin: boolean; alert: string }> {
  const { context, page } = await newLaptop(browser);
  try {
    for (let attempt = 0; ; attempt++) {
      await page.goto("/login");
      await page.locator("#email").fill(EMAIL);
      await page.locator("#password").fill(passcode);
      const answer = page.waitForResponse(isPasswordGrant, { timeout: 60_000 }).catch(() => null);
      await page.locator('button[type="submit"]').click();
      const res = await answer;
      if (!res) {
        if (attempt >= 3) throw new Error("the sign-in never reached Supabase");
        await page.waitForTimeout(5_000);
        continue; // this laptop's link drops now and then: ask again, like a person would
      }
      if (res.status() === 200) {
        await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
        return { status: 200, leftLogin: true, alert: "" };
      }
      // the sign-in form's own error line (not Next's empty route announcer, which also carries role=alert)
      const alert = page.locator("form p.text-px-error");
      await expect(alert).toBeVisible({ timeout: 30_000 });
      return { status: res.status(), leftLogin: !new URL(page.url()).pathname.startsWith("/login"), alert: await alert.innerText() };
    }
  } finally {
    await context.close();
  }
}

/** Parses the plain text of the reset e-mail: the link (built on the project's site URL) and the 6-digit code. */
function parseMail(text: string): { link: string; code: string } {
  const m = text.match(/https?:\/\/[^\s<>"')\]]*\/auth\/callback\?[^\s<>"')\]]*/);
  if (!m) throw new Error("the e-mail has no /auth/callback link");
  const url = new URL(m[0].replace(/&amp;/g, "&"));
  expect(url.origin, "the link is built on the project's site URL").toBe(SITE_URL);
  expect(url.searchParams.get("type")).toBe("recovery");
  expect(url.searchParams.get("token_hash"), "the link carries a token_hash").toBeTruthy();
  expect(url.searchParams.get("redirectTo")).toBe("/reset-password");
  const codes = [...text.replace(/https?:\/\/\S+/g, " ").matchAll(/(?<![0-9A-Za-z])(\d{6})(?![0-9A-Za-z])/g)].map((x) => x[1]);
  expect(codes.length, "the e-mail carries exactly one 6-digit code").toBe(1);
  return { link: `${BASE_URL}${url.pathname}${url.search}`, code: codes[0] };
}

test.describe.configure({ mode: "serial" });

let laptop1: { context: BrowserContext; page: Page };

test.beforeAll(async ({ browser }) => {
  if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY (PROJEXA project) is not set: this spec creates and deletes its own throwaway account");
  if (!/^[^@+\s]+\+[a-z0-9]+@[^@\s]+$/.test(EMAIL)) throw new Error("A17_EMAIL must be a plus-address of a mailbox the operator can read");
  const u = await svc("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: OLD_PASSCODE, email_confirm: true, user_metadata: { name: "AUDIT100 A17 throwaway" } }),
  });
  userId = u.id ?? u.user?.id;
  expect(userId, "admin API did not return an id").toBeTruthy();
  rmSync(MAIL_DROP, { force: true });
  laptop1 = await newLaptop(browser);
});

test.afterAll(async () => {
  await laptop1?.context.close().catch(() => {});
  rmSync(MAIL_DROP, { force: true });
  if (!userId) return;
  const deleted: string[] = [];
  await svc(`/rest/v1/security_audit_log?target_user_id=eq.${userId}`, { method: "DELETE" })
    .then(() => deleted.push("security_audit_log rows of the throwaway account"))
    .catch((e) => deleted.push(`security_audit_log rows NOT deleted: ${e.message}`));
  await svc(`/auth/v1/admin/users/${userId}`, { method: "DELETE" })
    .then(() => deleted.push(`auth user ${userId} (+ profile, ON DELETE CASCADE)`))
    .catch((e) => deleted.push(`FAILED auth user: ${e.message}`));
  const leftProfiles = await svc(`/rest/v1/profiles?id=eq.${userId}&select=id`);
  const leftMemberships = await svc(`/rest/v1/memberships?user_id=eq.${userId}&select=id`);
  const leftUser = await svc(`/auth/v1/admin/users/${userId}`).then(() => 1).catch((e) => ((e as { status?: number }).status === 404 ? 0 : 1));
  console.log(`[a17 cleanup]\n  - ${deleted.join("\n  - ")}\n  left behind: auth.users=${leftUser} profiles=${leftProfiles.length} memberships=${leftMemberships.length}`);
  expect(leftUser + leftProfiles.length + leftMemberships.length, "the cleanup left rows behind").toBe(0);
});

test("laptop 1 asks for the reset ONCE; the real Supabase Auth accepts it and records the send (A17)", async () => {
  const { page } = laptop1;
  await page.goto("/forgot-password");
  if (CREDENTIAL === "admin") {
    // re-run mode: NO e-mail. Laptop 1 is marked as the machine that asked (what the form stores), and the same one-time credential the e-mail
    // carries (token_hash for the link, the 6-digit code) is minted by the admin API, which sends nothing.
    await page.evaluate((e) => localStorage.setItem("projexa_recovery_email", e), EMAIL);
    const g = await svc("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "recovery", email: EMAIL }) });
    const p = g.properties ?? g;
    expect(p.hashed_token && p.email_otp, "generate_link returned no credential").toBeTruthy();
    link = `${BASE_URL}/auth/callback?token_hash=${p.hashed_token}&type=recovery&redirectTo=/reset-password`;
    code = String(p.email_otp);
    expect(code).toMatch(/^\d{6}$/);
    console.log("[a17] A17_CREDENTIAL=admin: credential minted by the admin API, no e-mail sent (values not printed)");
    return;
  }
  await page.locator("#email").fill(EMAIL);
  const recover = page.waitForResponse((r) => r.url().includes("/auth/v1/recover") && r.request().method() === "POST", { timeout: 60_000 });
  await page.locator('button[type="submit"]').click();
  const res = await recover;
  const body = await res.text();
  console.log(`[a17] /auth/v1/recover -> ${res.status()} ${res.status() === 200 ? "" : body.slice(0, 200)}`);
  expect(res.status(), `Supabase refused to send the reset e-mail: ${body.slice(0, 200)}`).toBe(200);
  await expect(page.getByRole("status")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("projexa_recovery_email"))).toBe(EMAIL);
  // persisted: Supabase stamped the send on the account
  const u = await svc(`/auth/v1/admin/users/${userId}`);
  expect(u.recovery_sent_at, "recovery_sent_at was not set").toBeTruthy();
  expect(Date.now() - Date.parse(u.recovery_sent_at)).toBeLessThan(5 * 60_000);
});

test("the real e-mail arrives with the link and a 6-digit code (A17)", async () => {
  test.skip(CREDENTIAL === "admin", "A17_CREDENTIAL=admin: no e-mail in this run");
  test.setTimeout(MAIL_WAIT_MS + 60_000);
  console.log(`[a17] waiting up to ${MAIL_WAIT_MS / 60_000} min for the e-mail to ${EMAIL}: write its plain-text body to ${MAIL_DROP}`);
  const deadline = Date.now() + MAIL_WAIT_MS;
  while (!existsSync(MAIL_DROP)) {
    if (Date.now() > deadline) throw new Error(`no reset e-mail was handed over within ${MAIL_WAIT_MS / 60_000} minutes`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  await new Promise((r) => setTimeout(r, 1_000)); // let the writer finish
  const text = readFileSync(MAIL_DROP, "utf8");
  rmSync(MAIL_DROP, { force: true }); // a one-time credential: do not leave it on disk
  ({ link, code } = parseMail(text));
  console.log("[a17] e-mail parsed: link to /auth/callback (type=recovery, token_hash present) and one 6-digit code (values not printed)");
});

let laptop2: { context: BrowserContext; page: Page };

test("on a NEW laptop the link signs nobody in by itself and asks for the address + 6 digits; a WRONG code is refused and the passcode is unchanged (A17, seen to fail)", async ({ browser }) => {
  laptop2 = await newLaptop(browser);
  const { page } = laptop2;
  const verifyCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/auth/v1/verify")) verifyCalls.push(r.method());
  });
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Confirm it is you" })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2_000);
  expect(verifyCalls, "the link must not sign anyone in by itself on a machine that did not ask").toEqual([]);
  const cookies = (await laptop2.context.cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(cookies, "no session on the new laptop yet").toEqual([]);

  const wrong = String((Number(code) + 111111) % 1000000).padStart(6, "0");
  await page.getByPlaceholder("Email").fill(EMAIL);
  await page.getByPlaceholder("6-digit code").fill(wrong);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("p[role=alert]")).toContainText(/invalid|expired/i, { timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/auth/callback");
  expect((await laptop2.context.cookies()).filter((c) => c.name.startsWith("sb-")), "a wrong code must not give a session").toEqual([]);

  // re-read: the passcode was NOT changed -- the old one still signs in for real, the never-set new one does not
  const old = await signIn(browser, OLD_PASSCODE);
  expect(old, "after a wrong code the OLD passcode must still work").toMatchObject({ status: 200, leftLogin: true });
});

test("the RIGHT code on the new laptop -> a new 6-digit passcode; the new one signs in, the old one is refused (A17, A18)", async ({ browser }) => {
  const { page } = laptop2;
  await page.getByPlaceholder("Email").fill(EMAIL);
  await page.getByPlaceholder("6-digit code").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((u) => u.pathname === "/reset-password", { timeout: 60_000 });
  await expect(page.locator("#password")).toHaveAttribute("maxlength", "6");
  await page.locator("#password").fill(NEW_PASSCODE);
  await page.locator("#confirm").fill(NEW_PASSCODE);
  const put = page.waitForResponse((r) => r.url().includes("/auth/v1/user") && r.request().method() === "PUT", { timeout: 60_000 });
  await page.locator('button[type="submit"]').click();
  expect((await put).status(), "Supabase did not accept the new passcode").toBe(200);
  await page.waitForURL((u) => u.pathname !== "/reset-password", { timeout: 60_000 });

  // re-read by real sign-ins on fresh profiles (not a toast): the new passcode works, the old one is refused
  const fresh = await signIn(browser, NEW_PASSCODE);
  expect(fresh, "the NEW passcode must sign in").toMatchObject({ status: 200, leftLogin: true });
  const old = await signIn(browser, OLD_PASSCODE);
  expect(old.status, "the OLD passcode must be refused by Supabase").toBe(400);
  expect(old.leftLogin).toBe(false);
  expect(old.alert).toMatch(/invalid/i);
  await laptop2.context.close();
});

test("the USED link is refused plainly on another new laptop and on the laptop that asked; the new passcode still works (A17, seen to fail)", async ({ browser }) => {
  // another new laptop: the same link + the same (now used) code
  const l3 = await newLaptop(browser);
  try {
    await l3.page.goto(link);
    await expect(l3.page.getByRole("heading", { name: "Confirm it is you" })).toBeVisible({ timeout: 60_000 });
    await l3.page.getByPlaceholder("Email").fill(EMAIL);
    await l3.page.getByPlaceholder("6-digit code").fill(code);
    await l3.page.getByRole("button", { name: "Continue" }).click();
    await expect(l3.page.locator("p[role=alert]")).toContainText(/invalid|expired/i, { timeout: 30_000 });
    expect(new URL(l3.page.url()).pathname).toBe("/auth/callback");
    expect((await l3.context.cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);
  } finally {
    await l3.context.close();
  }

  // laptop 1, which asked for the reset: there the link is used directly (no code form) -- a used link gives the plain refusal page
  const { page } = laptop1;
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Sign-in link could not be used" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("main [role=alert]")).toContainText(/invalid|expired/i);
  expect(new URL(page.url()).pathname).toBe("/auth/callback");

  const still = await signIn(browser, NEW_PASSCODE);
  expect(still, "the new passcode is unchanged by the refused attempts").toMatchObject({ status: 200, leftLogin: true });
});
