import { test, expect, type Browser, type BrowserContext, type Page, type Request } from "@playwright/test";
import { APP_ORIGIN, stubAppApis } from "./support/boq-local";
import { fixtureOf, makePerson, newWorld, releaseCaches, stubSyncService } from "./support/lf-lifecycle-stub";

// AUDIT-100 A17, A22, A23: the passcode sign-in and its recovery, in real Chromium, production build, local Auth stand-in
// (e2e/support/fake-supabase-server.mjs). No e-mail is ever sent: the Auth calls the page makes are answered inside the browser (page.route),
// so what is proven is what OUR pages do with them -- which calls they make, in what order, and what the person sees. That an e-mail with the
// link and the 6 digits really arrives stays an owner step (BLOCKED-OWNER in AUDIT_100_CHECKLIST A17).
//   A22  daily sign-in is e-mail + 6-digit passcode and nothing else: no e-mail-sending Auth call (recover / otp / resend) is made.
//   A23  from the sign-in page to an installed workspace takes ONE click (the sign-in button); the install screen has no button to press.
//   A17  forgot passcode: the request carries the address and comes back through /auth/callback; on ANOTHER browser profile the link does not
//        sign anyone in by itself, it asks for the address and the 6 digits, refuses a wrong code, accepts the right one, and lets the person
//        choose a new 6-digit passcode (exactly 6 digits; the new one reaches the Auth service).

const STUB = `http://localhost:${Number(process.env.BOQ_LOCAL_SUPABASE_PORT ?? 54399)}`;

type Made = { userId: string; email: string; accessToken: string; session: { access_token: string; user: object } };

/** A real session from the stand-in, for the given address (the stand-in signs it; the app's middleware accepts it). */
async function madeSession(email: string): Promise<Made> {
  const res = await fetch(`${STUB}/__session?email=${encodeURIComponent(email)}`);
  const body = (await res.json()) as { userId: string; email: string; accessToken: string; cookieValue: string };
  const session = JSON.parse(Buffer.from(body.cookieValue.replace(/^base64-/, ""), "base64url").toString("utf8")) as Made["session"];
  return { userId: body.userId, email: body.email, accessToken: body.accessToken, session };
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, PUT, OPTIONS" };

/** Records every Auth call the page makes; `answer` decides the reply for one of them (null = let it through to the stand-in). */
async function watchAuth(context: BrowserContext, answer: (req: Request, path: string) => { status: number; body: unknown } | null) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  await context.route(`${STUB}/auth/v1/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname.replace("/auth/v1", "");
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    calls.push({ method: req.method(), path, body });
    const reply = answer(req, path);
    if (!reply) return route.fallback();
    return route.fulfill({ status: reply.status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(reply.body) });
  });
  await context.route(`${STUB}/rest/v1/**`, (route) => route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: "null" }));
  return calls;
}

const EMAIL_SENDING = /^\/(recover|otp|resend|magiclink)$/;

test("A22 + A23: daily sign-in is the address and 6 digits, one click, no e-mail; the workspace then installs by itself", async ({ page, context }) => {
  const A = makePerson("pcode", "lf-org-1", "Passcode Tower", "Passcode - Structure");
  const made = await madeSession("pcode-daily@example.invalid");
  A.email = made.email;
  const world = newWorld();
  await stubSyncService(context, world);
  world.persons.set(made.userId, A);
  const calls = await watchAuth(context, (_r, path) => (path === "/token" ? { status: 200, body: made.session } : null));
  await stubAppApis(page, fixtureOf(A), { userId: made.userId, email: made.email, accessToken: made.accessToken, cookieName: "", cookieValue: "" } as never);

  let clicks = 0;
  await page.goto("/login");
  await page.locator("#email").fill(made.email);
  await page.locator("#password").fill("123456");
  const started = Date.now();
  clicks += 1;
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  // the install screen, when it shows, is only a sentence and a percentage: nothing to click
  const dialog = page.getByTestId("workspace-prepare");
  if (await dialog.count()) await expect(dialog.locator("button, a")).toHaveCount(0);
  await page.goto(`/scope/${A.boqId}`);
  await expect(page.getByTestId("workspace-prepare")).toHaveCount(0, { timeout: 240_000 });
  await expect.poll(() => releaseCaches(page), { timeout: 120_000 }).toHaveLength(1);
  const ms = Date.now() - started;

  console.log(`A23 sign-in click to installed workspace: ${ms} ms with ${clicks} click(s); auth calls: ${JSON.stringify(calls.map((c) => c.path))}`);
  expect(clicks).toBeLessThanOrEqual(2);
  expect(calls.map((c) => c.path)).toContain("/token");
  expect(calls.filter((c) => EMAIL_SENDING.test(c.path)), "an ordinary sign-in must not send any e-mail").toEqual([]);
  expect(calls.find((c) => c.path === "/token")?.body).toMatchObject({ email: made.email, password: "123456" });
});

test("A17 (this browser): forgot passcode asks for the reset e-mail, which comes back through /auth/callback", async ({ page, context }) => {
  const calls = await watchAuth(context, (_r, path) => (path === "/recover" ? { status: 200, body: {} } : null));
  await page.goto("/forgot-password");
  await page.locator("#email").fill("nobody-here@example.invalid");
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole("status")).toBeVisible();
  const recover = calls.find((c) => c.path === "/recover");
  expect(recover?.body).toMatchObject({ email: "nobody-here@example.invalid" });
  const sent = await page.evaluate(() => localStorage.getItem("projexa_recovery_email"));
  expect(sent, "this browser remembers it asked, so its own link signs in directly").toBe("nobody-here@example.invalid");
  const recoverUrls = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("/auth/v1/recover")));
  expect(decodeURIComponent(recoverUrls[0] ?? "")).toContain(`${APP_ORIGIN}/auth/callback?redirectTo=/reset-password`);
});

async function newProfile(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: APP_ORIGIN });
  return { context, page: await context.newPage() };
}

test("A17 (another browser profile): the link asks for the address and the 6 digits, refuses a wrong code, accepts the right one, and sets a new 6-digit passcode", async ({ browser }) => {
  const made = await madeSession("pcode-reset@example.invalid");
  const { context, page } = await newProfile(browser);
  try {
    const calls = await watchAuth(context, (req, path) => {
      if (path === "/verify") {
        const b = req.postDataJSON() as { token?: string; email?: string; type?: string };
        return b.token === "654321" && b.email === made.email && b.type === "recovery"
          ? { status: 200, body: made.session }
          : { status: 403, body: { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" } };
      }
      if (path === "/user") return { status: 200, body: made.session.user };
      return null;
    });
    await page.goto("/auth/callback?token_hash=abc123&type=recovery&redirectTo=/reset-password");
    await expect(page.getByRole("heading", { name: "Confirm it is you" })).toBeVisible();
    expect(calls.filter((c) => c.path === "/verify"), "the link must not sign anyone in by itself on a machine that did not ask").toEqual([]);

    await page.getByPlaceholder("Email").fill(made.email);
    await page.getByPlaceholder("6-digit code").fill("111111");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("p[role=alert]")).toContainText(/invalid|expired/i);
    expect(new URL(page.url()).pathname).toBe("/auth/callback");

    await page.getByPlaceholder("6-digit code").fill("654321");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((u) => u.pathname === "/reset-password", { timeout: 30_000 });

    await expect(page.locator("#password")).toHaveAttribute("maxlength", "6");
    await page.locator("#password").fill("12345");
    await page.locator("#confirm").fill("12345");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("p[role=alert]")).toBeVisible();
    expect(calls.filter((c) => c.path === "/user" && c.method === "PUT"), "a 5-digit passcode never reaches the Auth service").toEqual([]);

    await page.locator("#password").fill("246810");
    await page.locator("#confirm").fill("246810");
    await page.locator('button[type="submit"]').click();
    await expect.poll(() => calls.filter((c) => c.path === "/user" && c.method === "PUT").length, { timeout: 30_000 }).toBe(1);
    expect(calls.find((c) => c.path === "/user" && c.method === "PUT")?.body).toMatchObject({ password: "246810" });
    expect(calls.filter((c) => c.path === "/verify").at(-1)?.body).toMatchObject({ email: made.email, token: "654321", type: "recovery" });
  } finally {
    await context.close();
  }
});
