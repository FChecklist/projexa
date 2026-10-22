import { test, expect, type Page } from "@playwright/test";
import { signInByCode, realTestCode } from "./support/sign-in";
import { USERS } from "./users";
import { baseURL } from "./support/real-backend";

// GUIDED ERRORS, group G4, part 2: SESSIONS, ORGANISATION SET-UP, INVITATIONS, PAGES THAT ARE NOT THERE / NOT ALLOWED, AI UNAVAILABLE.
// Real Chromium, real PROJEXA (baseURL = AUDIT37_BASE_URL, default https://projexa-ai.com), the documented E2E test users (e2e/users.ts). The sign-in code
// comes from the Supabase admin API for TEST users only (SUPABASE_SERVICE_ROLE_KEY of the PROJEXA project in the environment; nothing is e-mailed).
// Nothing is deleted and no real person's data is touched: the only thing written is a form value that is never saved.
//   AUDIT37_BASE_URL=https://projexa-ai.com SUPABASE_SERVICE_ROLE_KEY=... bunx playwright test -c playwright.guided-g4.config.ts guided-g4-session
//
// Fault cases covered: sign-in ended while a form is open (the form comes back with its values), signed out in another tab (same mechanism: the cookie is
// shared, the next save is refused with 401 -- covered here by clearing the cookies of the shared context), deep link with a query while signed out,
// no organisation yet / set-up failed with Try again, invitation not valid / closed / for another e-mail, 404, no access (403) page, System log for a
// non-owner, AI unavailable (pill on /copilot, Discuss in the composer) with the matching ordinary screen.

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const NO_LOCAL = () => { try { localStorage.setItem("px-local-first-off", "1"); } catch { /* ignore */ } };

async function signIn(page: Page, who: keyof typeof USERS, opts: { stayOnPage?: boolean; leaves?: string | RegExp | ((u: URL) => boolean) | null } = {}) {
  await signInByCode(page, USERS[who].email, { code: realTestCode, timeoutMs: 90_000, ...opts });
}

async function firstProjectId(page: Page): Promise<string> {
  const res = await page.request.get(`${baseURL}/api/projects`);
  const body = (await res.json()) as { projects?: { id: string }[] } | { id: string }[];
  const list = Array.isArray(body) ? body : body.projects ?? [];
  if (!list[0]) throw new Error("the test organisation has no project");
  return list[0].id;
}

test.describe("G4 sessions", () => {
  test("sign-in ended while a form is open: the guide says so, Sign in again returns to the SAME page and the typed value comes back", async ({ browser }) => {
    const context = await browser.newContext({ baseURL });
    await context.addInitScript(NO_LOCAL);
    const page = await context.newPage();
    await signIn(page, "ceo");
    const pid = await firstProjectId(page);
    const formUrl = `/rfis/new?projectId=${pid}`;
    await page.goto(formUrl);
    const field = page.locator('main input[type="text"], main input:not([type]), main textarea').first();
    await expect(field).toBeVisible({ timeout: 60_000 });
    const typed = `G4 typed before the session ended ${Date.now()}`;
    await field.fill(typed);
    await page.locator("main textarea").first().fill("G4 question typed before the session ended"); // Save stays closed until the subject and the question are both there

    await context.clearCookies(); // the sign-in ends (expired, or signed out in another tab: the cookie is shared by every tab)
    await page.getByRole("button", { name: /^Save/ }).first().click();

    const panel = page.getByTestId("guided-error").first();
    await expect(panel.getByTestId("guided-error-title")).toContainText("You were signed out", { timeout: 60_000 });
    await expect(panel.getByTestId("guided-error-steps")).toContainText("straight back");
    const fix = panel.getByTestId("guided-error-fix");
    const href = new URL((await fix.getAttribute("href"))!, baseURL);
    expect(href.pathname).toBe("/login");
    expect(href.searchParams.get("redirectTo")).toBe(formUrl); // path AND query
    await fix.click();
    await page.waitForURL(/\/login/);
    await expect(page.getByTestId("login-continue")).toContainText("/rfis/new");

    await signIn(page, "ceo", { stayOnPage: true, leaves: (u) => u.pathname === "/rfis/new" });
    expect(new URL(page.url()).search).toContain(`projectId=${pid}`);
    await expect(page.getByTestId("session-restored")).toContainText("put back", { timeout: 60_000 });
    await expect(page.locator('main input[type="text"], main input:not([type]), main textarea').first()).toHaveValue(typed);
    await context.close();
  });

  test("deep link with a query while signed out: sent to sign-in with the whole address, lands on the same address after the code", async ({ browser }) => {
    const context = await browser.newContext({ baseURL });
    await context.addInitScript(NO_LOCAL);
    const page = await context.newPage();
    await page.goto("/work-progress?projectId=g4-deep-link&view=week");
    await page.waitForURL(/\/login/);
    const back = new URL(page.url()).searchParams.get("redirectTo");
    expect(back).toBe("/work-progress?projectId=g4-deep-link&view=week");
    await expect(page.getByTestId("login-continue")).toContainText("/work-progress");
    await signIn(page, "ceo", { stayOnPage: true, leaves: (u) => u.pathname === "/work-progress" });
    const landed = new URL(page.url());
    expect(landed.searchParams.get("projectId")).toBe("g4-deep-link");
    expect(landed.searchParams.get("view")).toBe("week");
    await context.close();
  });
});

test.describe("G4 organisation set-up", () => {
  test("set-up fails: the full panel with Try again (not a thin bar); when the server answers, the panel goes away", async ({ browser }) => {
    const context = await browser.newContext({ baseURL });
    await context.addInitScript(NO_LOCAL);
    const page = await context.newPage();
    await signIn(page, "ceo");
    let healthy = false;
    await context.route("**/rest/v1/memberships*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]", headers: { "access-control-allow-origin": "*" } }));
    await context.route("**/api/shell*", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "No organization" }) }));
    await context.route("**/org/provision*", (route) =>
      healthy ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }), headers: { "access-control-allow-origin": "*" } }) : route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "provision down" }), headers: { "access-control-allow-origin": "*" } })
    );
    await page.goto("/dashboard");
    const panel = page.getByTestId("org-ensure").getByTestId("guided-error");
    await expect(panel.getByTestId("guided-error-title")).toContainText("Your workspace could not be set up", { timeout: 60_000 });
    await expect(panel.getByTestId("guided-error-steps").locator("li")).not.toHaveCount(0);
    healthy = true;
    await panel.getByTestId("guided-error-action-retry").click();
    await expect(page.getByTestId("org-ensure")).toHaveCount(0, { timeout: 60_000 });
    await context.close();
  });
});

test.describe("G4 invitations", () => {
  test("invitation link that does not exist: says the link is not valid and what to do", async ({ page }) => {
    await page.goto("/invite/g4-this-token-does-not-exist");
    const panel = page.getByTestId("invite-guided-error");
    await expect(panel.getByTestId("guided-error-title")).toContainText("This invitation link is not valid", { timeout: 60_000 });
    await expect(panel.getByTestId("guided-error-steps")).toContainText("ask the person who invited you");
  });

  test("invitation used or expired: 'no longer open', with sign-in link and who to ask", async ({ page }) => {
    await page.route("**/api/org/invites/preview*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invite: { organization_name: "Meridian", role: "member", expires_at: "2020-01-01", is_open: false } }) })
    );
    await page.goto("/invite/g4-closed");
    const panel = page.getByTestId("invite-guided-error");
    await expect(panel.getByTestId("guided-error-title")).toContainText("This invitation is no longer open", { timeout: 60_000 });
    await expect(panel.getByTestId("guided-error-steps")).toContainText("Owner or Admin");
  });

  test("invitation for another e-mail: signed in with the wrong address is told which, with the way out", async ({ browser }) => {
    const context = await browser.newContext({ baseURL });
    await context.addInitScript(NO_LOCAL);
    const page = await context.newPage();
    await signIn(page, "hr");
    await context.route("**/api/org/invites/preview*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invite: { organization_name: "Meridian", role: "member", expires_at: "2099-01-01", is_open: true } }) })
    );
    await context.route("**/api/org/invites/accept*", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "This invitation was sent to a different email address." }) })
    );
    await page.goto("/invite/g4-wrong-email");
    await page.getByRole("button", { name: /^Join / }).click();
    const panel = page.getByTestId("invite-guided-error");
    await expect(panel.getByTestId("guided-error-title")).toContainText("Sign in with the invited e-mail");
    await expect(panel.getByTestId("guided-error-steps")).toContainText("Sign out");
    await context.close();
  });
});

test.describe("G4 pages that are not there or not allowed", () => {
  test("404: says the address does not exist and gives Go back / Take me home", async ({ browser }) => {
    const context = await browser.newContext({ baseURL });
    await context.addInitScript(NO_LOCAL);
    const page = await context.newPage();
    await signIn(page, "ceo");
    await page.goto("/dashboard");
    await page.goto("/g4-no-such-page?x=1");
    const panel = page.getByTestId("not-found-page").getByTestId("guided-error");
    await expect(panel.getByTestId("guided-error-title")).toContainText("This page does not exist");
    await expect(panel.getByTestId("guided-error-what")).toContainText("/g4-no-such-page?x=1");
    await panel.getByTestId("guided-error-action-back").click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/g4-no-such-page");
    await page.getByTestId("guided-error-action-home").click();
    await page.waitForURL(/\/dashboard/);
    await context.close();
  });

  test("System log for someone who is not an owner or admin: a full panel naming who can open it, with the Settings link", async ({ browser }) => {
    const context = await browser.newContext({ baseURL });
    await context.addInitScript(NO_LOCAL);
    const page = await context.newPage();
    await signIn(page, "hr"); // role: member
    await page.goto("/system-log");
    const panel = page.getByTestId("system-log-not-allowed").getByTestId("guided-error");
    await expect(panel.getByTestId("guided-error-title")).toContainText("The system log is for owners and admins");
    await expect(panel.getByTestId("guided-error-steps")).toContainText("Owner or an Admin");
    const fix = panel.getByTestId("guided-error-fix");
    await expect(fix).toHaveAttribute("href", /^\/settings/);
    await fix.click();
    await page.waitForURL(/\/settings/);
    await context.close();
  });
});

test.describe("G4 AI unavailable", () => {
  test("a Copilot button that cannot be answered: 'AI unavailable', the matching ordinary screen, Try again", async ({ browser }) => {
    const context = await browser.newContext({ baseURL });
    await context.addInitScript(NO_LOCAL);
    const page = await context.newPage();
    await signIn(page, "ceo");
    const pid = await firstProjectId(page);
    await context.route("**/api/assistant", (route, request) => (request.method() === "POST" ? route.abort("failed") : route.continue()));
    await page.goto(`/copilot?projectId=${pid}`);
    await page.getByRole("button", { name: "Run" }).nth(1).click(); // "Budget Status"
    const panel = page.getByTestId("copilot-run-failure").getByTestId("guided-error");
    await expect(panel.getByTestId("guided-error-title")).toContainText("AI unavailable: Budget Status", { timeout: 60_000 });
    await expect(panel.getByTestId("guided-error-steps")).toContainText("same information");
    const fix = panel.getByTestId("guided-error-fix");
    await expect(fix).toHaveAttribute("href", `/budgets?projectId=${encodeURIComponent(pid)}`);
    await expect(panel.getByTestId("guided-error-action-retry")).toBeVisible();
    await fix.click();
    await page.waitForURL(/\/budgets/);
    await context.close();
  });
});
