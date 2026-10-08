import { expect, type BrowserContext, type Page } from "@playwright/test";

// P1 (2026-10-08): the ONE way the specs sign in now that /login is "e-mail, then the 6-digit code from the e-mail" (no password, no passcode).
//
//   signInByCode(page, email)                          stub rigs: the fixed STUB_CODE (the Auth stand-ins accept it, see stubAuthOtp and
//                                                      fake-supabase-server.mjs), nothing is e-mailed
//   signInByCode(page, email, { code: realTestCode })  real-backend specs: the code comes from the real project through the Supabase ADMIN API
//                                                      (service role key from the environment, generateLink type magiclink returns email_otp) and
//                                                      only for TEST users. The page's own "send the code" call is answered locally in that case, so
//                                                      no real mail is sent and no mailbox of a real person is ever read or written.
//
// The code box auto-submits on the sixth digit, so there is no button to press after typing it.

export const STUB_CODE = "123456";

/** Test users only: the documented E2E domain (e2e/users.ts, the invite/audit specs' throwaway accounts). Anything else is refused. */
const TEST_EMAIL = /@([a-z0-9-]+\.)*e2e-test\.projexa-ai\.com$/i;

export type CodeSource = string | ((email: string) => Promise<string>);

export type SignInOptions = {
  /** Default STUB_CODE. Use `realTestCode` against the real project. */
  code?: CodeSource;
  /** Answer POST /auth/v1/otp ("send the code") locally with 200 so nothing is e-mailed. Default: true when `code` is a function, else false. */
  suppressMail?: boolean;
  /** Where to wait for after the code is accepted. Default: leave /login. Pass null to not wait. */
  leaves?: string | RegExp | ((u: URL) => boolean) | null;
  /** Do not navigate to /login first (the page is already on it, e.g. after a redirect). */
  stayOnPage?: boolean;
  timeoutMs?: number;
};

/** Type the e-mail, ask for the code, type the code (it submits itself). Resolves once the page has left /login (or `leaves`). */
export async function signInByCode(page: Page, email: string, options: SignInOptions = {}): Promise<void> {
  const timeout = options.timeoutMs ?? 60_000;
  const source = options.code ?? STUB_CODE;
  const suppress = options.suppressMail ?? typeof source === "function";
  if (suppress) {
    await page.route("**/auth/v1/otp*", (route) =>
      route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: "{}" })
    );
  }
  if (!options.stayOnPage) await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#code")).toBeVisible({ timeout });
  // the real code is generated AFTER the page asked for one: generateLink replaces whatever code the project had stored
  const code = typeof source === "function" ? await source(email) : source;
  await page.locator("#code").fill(code);
  if (options.leaves !== null) await page.waitForURL(options.leaves ?? ((u) => !u.pathname.startsWith("/login")), { timeout });
}

/**
 * The 6-digit code of a TEST user from the real project, via the Supabase admin API. Never reads a mailbox. Refuses any address outside the
 * documented E2E test domain unless the caller names it in `allow` (a throwaway account the spec itself created).
 */
export function realTestCodeFor(allow: string[] = []): (email: string) => Promise<string> {
  return async (email) => {
    const e = email.trim().toLowerCase();
    if (!TEST_EMAIL.test(e) && !allow.map((a) => a.toLowerCase()).includes(e)) {
      throw new Error(`refusing to mint a sign-in code for ${e}: not an E2E test address`);
    }
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://evpckeuxgvahguwsaeul.supabase.co";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY (the PROJEXA project) is required to get a test sign-in code");
    const res = await fetch(`${base}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email: e }),
    });
    if (!res.ok) throw new Error(`generate_link answered ${res.status}`);
    const body = (await res.json()) as { email_otp?: string };
    if (!body.email_otp || !/^\d{6}$/.test(body.email_otp)) throw new Error("generate_link returned no 6-digit email_otp");
    return body.email_otp;
  };
}

/** Real-backend default: any E2E-domain test user. */
export const realTestCode = realTestCodeFor();

/**
 * Stub rigs that fulfil Auth calls per browser context: answers "send the code" (POST /auth/v1/otp) and "check the code" (POST /auth/v1/verify)
 * with `session` when the code is STUB_CODE, and with Auth's own refusal otherwise. Returns what was seen, for assertions.
 */
export async function stubAuthOtp(context: BrowserContext, session: unknown) {
  const seen = { otpRequests: [] as string[], verifies: [] as string[] };
  const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
  await context.route("**/auth/v1/otp*", async (route) => {
    seen.otpRequests.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, headers: cors, body: "{}" });
  });
  await context.route("**/auth/v1/verify*", async (route) => {
    const body = route.request().postData() ?? "";
    seen.verifies.push(body);
    const ok = (JSON.parse(body || "{}") as { token?: string }).token === STUB_CODE;
    await route.fulfill(
      ok
        ? { status: 200, headers: cors, body: JSON.stringify(session) }
        : { status: 403, headers: cors, body: JSON.stringify({ code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" }) }
    );
  });
  return seen;
}
