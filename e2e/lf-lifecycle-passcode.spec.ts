import { test, expect, type BrowserContext, type Request } from "@playwright/test";
import { stubAppApis } from "./support/boq-local";
import { fixtureOf, makePerson, newWorld, releaseCaches, stubSyncService } from "./support/lf-lifecycle-stub";
import { STUB_CODE } from "./support/sign-in";

// P1 (replaces AUDIT-100 A17/A22/A23's passcode specs): sign-in is the e-mail and the 6-digit code that was e-mailed, in real Chromium, production
// build, local Auth stand-in (e2e/support/fake-supabase-server.mjs). No e-mail is ever sent: the Auth calls the page makes are answered inside the
// browser (page.route), so what is proven is what OUR pages do with them -- which calls they make, in what order, and what the person sees. That an
// e-mail with the 6 digits really arrives stays an owner step.
//   A22  the Auth calls of a sign-in are "send the code" (/otp) and "check the code" (/verify): no password grant, no recover, no resend.
//   A23  from the sign-in page to an installed workspace needs no click beyond the code; the install screen has no button to press.
//   A17  there is no password to forget: /forgot-password, /reset-password and an old reset link on /auth/callback all land on /login (the last two
//        with one plain sentence) and make NO Auth call; on /login a wrong code is refused in plain words, the right one signs in.

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

const OTP = /^\/(otp|verify)$/;
const NOT_THE_CODE_FLOW = /^\/(recover|resend|magiclink)$/;

test("A22 + A23: sign-in is the address and the e-mailed 6 digits; the workspace then installs by itself", async ({ page, context }) => {
  const A = makePerson("pcode", "lf-org-1", "Code Tower", "Code - Structure");
  const made = await madeSession("pcode-daily@example.invalid");
  A.email = made.email;
  const world = newWorld();
  await stubSyncService(context, world);
  world.persons.set(made.userId, A);
  const calls = await watchAuth(context, (_r, path) => (path === "/otp" ? { status: 200, body: {} } : path === "/verify" ? { status: 200, body: made.session } : null));
  await stubAppApis(page, fixtureOf(A), { userId: made.userId, email: made.email, accessToken: made.accessToken, cookieName: "", cookieValue: "" } as never);

  await page.goto("/login");
  await page.locator("#email").fill(made.email);
  const started = Date.now();
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#code")).toBeVisible({ timeout: 30_000 });
  await page.locator("#code").fill(STUB_CODE); // the sixth digit submits by itself
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  // the install screen, when it shows, is only a sentence and a percentage: nothing to click
  const dialog = page.getByTestId("workspace-prepare");
  if (await dialog.count()) await expect(dialog.locator("button, a")).toHaveCount(0);
  await page.goto(`/scope/${A.boqId}`);
  await expect(page.getByTestId("workspace-prepare")).toHaveCount(0, { timeout: 240_000 });
  await expect.poll(() => releaseCaches(page), { timeout: 120_000 }).toHaveLength(1);
  const ms = Date.now() - started;

  console.log(`A23 send-code click to installed workspace: ${ms} ms; auth calls: ${JSON.stringify(calls.map((c) => c.path))}`);
  expect(calls.filter((c) => OTP.test(c.path)).map((c) => c.path).slice(0, 2)).toEqual(["/otp", "/verify"]);
  expect(calls.filter((c) => NOT_THE_CODE_FLOW.test(c.path)), "a code sign-in sends nothing but the code").toEqual([]);
  expect(calls.find((c) => c.path === "/otp")?.body).toMatchObject({ email: made.email, create_user: true });
  expect(calls.find((c) => c.path === "/verify")?.body).toMatchObject({ email: made.email, token: STUB_CODE });
});

test("A17 (P1): a wrong code is refused in plain words and costs nothing; the right one then signs in", async ({ page, context }) => {
  const made = await madeSession("pcode-wrong@example.invalid");
  const calls = await watchAuth(context, (req, path) => {
    if (path === "/otp") return { status: 200, body: {} };
    if (path === "/verify") {
      const b = req.postDataJSON() as { token?: string };
      return b.token === STUB_CODE ? { status: 200, body: made.session } : { status: 403, body: { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" } };
    }
    return null;
  });
  await page.goto("/login");
  await page.locator("#email").fill(made.email);
  await page.locator('button[type="submit"]').click();
  await page.locator("#code").fill("111111");
  await expect(page.locator("p[role=alert]")).toContainText(/code/i);
  expect(new URL(page.url()).pathname, "a wrong code must not sign anyone in").toBe("/login");
  expect(calls.some((c) => c.path === "/verify")).toBe(true);
  await expect(page.locator("#code")).toHaveValue("");
  await page.locator("#code").fill(STUB_CODE);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
});

test("A17 (P1): there is no password to forget: the old pages land on /login and make no Auth call", async ({ page, context }) => {
  const calls = await watchAuth(context, () => null);
  await page.goto("/forgot-password");
  expect(new URL(page.url()).pathname).toBe("/login");
  await page.goto("/reset-password");
  await expect(page).toHaveURL(/\/login\?notice=no-password/);
  await expect(page.getByTestId("login-notice")).toContainText("no longer uses a password");
  // an old reset e-mail link, in the query-string form and in the fragment form
  await page.goto("/auth/callback?token_hash=abc123&type=recovery&redirectTo=/reset-password");
  await expect(page).toHaveURL(/\/login\?notice=no-password/, { timeout: 30_000 });
  await page.goto("/auth/callback#access_token=a&refresh_token=b&type=recovery");
  await expect(page).toHaveURL(/\/login\?notice=no-password/, { timeout: 30_000 });
  expect(calls.filter((c) => c.path === "/verify" || c.path === "/recover" || c.method === "PUT"), "an old reset link must not sign anyone in or send anything").toEqual([]);
});
