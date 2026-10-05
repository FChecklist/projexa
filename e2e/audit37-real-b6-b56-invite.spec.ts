import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// AUDIT-100 B6 ("an account gets its org attached without manual SQL") and B56 ("invite accept attaches the org and starts the install"),
// END TO END against the REAL backend (see playwright.audit37-real.config.ts): a production build of PROJEXA served by `next start`, the real
// PROJEXA Supabase project (Auth + Postgres + public.accept_org_invite from drizzle/0015_org_invites.sql), real Chromium. Nothing is stubbed.
//
//   1. An administrator of a TEST organisation signs in through the real form, opens Settings and creates an invitation in OrgInvitesCard with a
//      non-default role (pm). The invitation row is re-read from the database.
//   2. A brand-new account that belongs to NO organisation opens /invite/<token> signed out, is sent to sign in, comes BACK to the invitation
//      (the sign-in form used to drop ?redirectTo and land on /dashboard -- fixed in this PR, see src/lib/safe-redirect.ts), accepts, and is
//      attached to the organisation with the invited role -- re-read from public.memberships, nobody ran SQL for it -- and the install starts
//      on the laptop (the "Preparing your PROJEXA workspace" screen, the worker registered, the person's own projexa-local:<userId> database).
//   3. The used link, a wrong link and an expired link are each refused with the plain message, and attach nothing (memberships re-read).
//
// Fixtures: the throwaway accounts and the test organisation are created through the Supabase admin API (accounts confirmed directly, so no
// e-mail is ever sent; addresses are on the e2e-test.projexa-ai.com test domain) and EVERYTHING is deleted again in afterAll (the run prints what
// it deleted). Writes go only to the test organisation this file creates. The organisation itself is a fixture, not the thing under test: the
// claim is that the INVITEE gets attached without SQL.
//
// Needs SUPABASE_SERVICE_ROLE_KEY of the PROJEXA project in the environment of the test process (never printed, never committed). Not part of
// any CI config: it needs live credentials, like every other audit37-real spec.
//
//   SUPABASE_SERVICE_ROLE_KEY=... AUDIT37_PORT=3102 bunx playwright test -c playwright.audit37-real.config.ts audit37-real-b6-b56-invite

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://evpckeuxgvahguwsaeul.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BASE_URL = `http://localhost:${process.env.AUDIT37_PORT ?? 3100}`;

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DOMAIN = "invite.e2e-test.projexa-ai.com";
const ORG_NAME = `AUDIT100 B56 Test Org ${RUN}`;
const pin = () => String(100000 + Math.floor(Math.random() * 900000));

type Account = { key: string; email: string; password: string; id: string };
const accounts: Record<"admin" | "invitee" | "stranger", Account> = {
  admin: { key: "admin", email: `audit100-b56-${RUN}-admin@${DOMAIN}`, password: pin(), id: "" },
  invitee: { key: "invitee", email: `audit100-b56-${RUN}-invitee@${DOMAIN}`, password: pin(), id: "" },
  stranger: { key: "stranger", email: `audit100-b56-${RUN}-stranger@${DOMAIN}`, password: pin(), id: "" },
};
let orgId = "";

// ---- Supabase admin / service-role REST (fixtures and persisted re-reads only; the flow under test goes through the app) ----
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
      // only a transport failure is retried (this laptop's link drops now and then), never an answer from the server
      if ((err as { status?: number }).status !== undefined || attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
    }
  }
}
const rest = (path: string, init: RequestInit = {}) => svc(`/rest/v1/${path}`, init);
const membershipsOf = (userId: string): Promise<Array<{ organization_id: string; role: string }>> =>
  rest(`memberships?user_id=eq.${userId}&select=organization_id,role`);
const invitesFor = (email: string): Promise<Array<{ id: string; role: string; token: string; accepted_at: string | null; accepted_by: string | null; expires_at: string }>> =>
  rest(`org_invites?organization_id=eq.${orgId}&email=eq.${encodeURIComponent(email)}&select=id,role,token,accepted_at,accepted_by,expires_at&order=created_at.desc`);

// ---- browser helpers ----
async function newLaptop(browser: Browser, { localFirst }: { localFirst: boolean }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ serviceWorkers: "allow", baseURL: BASE_URL });
  // The administrator's browser opts out of the laptop install so the "Preparing your workspace" screen does not sit over Settings; the
  // invitee's browser keeps the default (on), because the install starting for the invitee is part of what B56 proves.
  if (!localFirst) await context.addInitScript(() => { try { localStorage.setItem("px-local-first-off", "1"); } catch { /* ignore */ } });
  return { context, page: await context.newPage() };
}

/** Fills and submits the real sign-in form that is already on screen; retries only when the form says the link to Supabase dropped. */
async function submitLogin(page: Page, who: Account, leaves: RegExp | ((u: URL) => boolean)): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    await page.locator("#email").fill(who.email);
    await page.locator("#password").fill(who.password);
    await page.locator('button[type="submit"]').click();
    try {
      await page.waitForURL(leaves, { timeout: 60_000 });
      return;
    } catch (err) {
      if (attempt >= 4 || !(await page.locator("form").innerText()).match(/fetch|network|timed? ?out/i)) throw err;
      await page.waitForTimeout(5_000);
    }
  }
}

async function postAccept(page: Page, token: string): Promise<{ status: number; error?: string }> {
  return page.evaluate(async (t) => {
    const r = await fetch("/api/org/invites/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t }) });
    const b = (await r.json().catch(() => ({}))) as { error?: string };
    return { status: r.status, error: b.error };
  }, token);
}

test.describe.configure({ mode: "serial" });

let admin: { context: BrowserContext; page: Page };
let invitee: { context: BrowserContext; page: Page };
let inviteToken = "";

test.beforeAll(async ({ browser }) => {
  if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY (PROJEXA project) is not set: this spec creates and deletes its own throwaway accounts");
  for (const a of Object.values(accounts)) {
    const u = await svc("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: a.email, password: a.password, email_confirm: true, user_metadata: { name: `AUDIT100 B56 ${a.key}` } }),
    });
    a.id = u.id ?? u.user?.id;
    expect(a.id, `admin API did not return an id for the ${a.key} account`).toBeTruthy();
  }
  const [org] = await rest("organizations", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name: ORG_NAME, slug: `audit100-b56-${RUN}` }),
  });
  orgId = org.id;
  await rest("memberships", { method: "POST", body: JSON.stringify({ user_id: accounts.admin.id, organization_id: orgId, role: "owner" }) });
  // the precondition every claim below rests on: the invitee and the stranger belong to nothing
  expect(await membershipsOf(accounts.invitee.id)).toEqual([]);
  expect(await membershipsOf(accounts.stranger.id)).toEqual([]);

  admin = await newLaptop(browser, { localFirst: false });
  invitee = await newLaptop(browser, { localFirst: true });
});

test.afterAll(async () => {
  await admin?.context.close().catch(() => {});
  await invitee?.context.close().catch(() => {});
  const deleted: string[] = [];
  const ids = Object.values(accounts).map((a) => a.id).filter(Boolean);
  if (orgId) {
    await rest(`organizations?id=eq.${orgId}`, { method: "DELETE" }).then(() => deleted.push(`organization ${orgId} (+ its memberships and org_invites, ON DELETE CASCADE)`)).catch((e) => deleted.push(`FAILED organization ${orgId}: ${e.message}`));
  }
  if (ids.length) {
    await rest(`security_audit_log?target_user_id=in.(${ids.join(",")})`, { method: "DELETE" }).then(() => deleted.push("security_audit_log rows of the throwaway accounts")).catch((e) => deleted.push(`security_audit_log rows NOT deleted: ${e.message}`));
  }
  for (const a of Object.values(accounts)) {
    if (!a.id) continue;
    await svc(`/auth/v1/admin/users/${a.id}`, { method: "DELETE" }).then(() => deleted.push(`auth user ${a.key} ${a.id} (+ profile, ON DELETE CASCADE)`)).catch((e) => deleted.push(`FAILED auth user ${a.key}: ${e.message}`));
  }
  // re-read: nothing of this run is left behind
  const leftOrgs = orgId ? await rest(`organizations?id=eq.${orgId}&select=id`) : [];
  const leftProfiles = ids.length ? await rest(`profiles?id=in.(${ids.join(",")})&select=id`) : [];
  const leftMemberships = ids.length ? await rest(`memberships?user_id=in.(${ids.join(",")})&select=id`) : [];
  console.log(`[b6-b56 cleanup] run ${RUN}:\n  - ${deleted.join("\n  - ")}\n  left behind: organizations=${leftOrgs.length} profiles=${leftProfiles.length} memberships=${leftMemberships.length}`);
  expect(leftOrgs.length + leftProfiles.length + leftMemberships.length, "the cleanup left rows behind").toBe(0);
});

test("an org administrator creates an invitation in Settings (OrgInvitesCard), role pm (B56)", async () => {
  const { page } = admin;
  await page.goto("/login");
  await submitLogin(page, accounts.admin, (u) => !u.pathname.startsWith("/login"));
  await page.goto("/settings");
  await page.locator("#invite-email").fill(accounts.invitee.email);
  await page.locator("#invite-role").click();
  await page.getByRole("option", { name: "pm", exact: true }).click();
  await expect(page.locator("#invite-role")).toContainText("pm");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: accounts.invitee.email })).toContainText("Pending", { timeout: 30_000 });

  // persisted: exactly one open invitation for that address in THIS organisation, with the role that was picked
  const rows = await invitesFor(accounts.invitee.email);
  expect(rows).toHaveLength(1);
  expect(rows[0].role).toBe("pm");
  expect(rows[0].accepted_at).toBeNull();
  inviteToken = rows[0].token;
  expect(inviteToken.length).toBeGreaterThan(30);
});

test("a signed-out invitee is sent to sign in, comes back, accepts, gets the org with the invited role and the install starts (B6, B56)", async () => {
  const { page } = invitee;
  await page.goto(`/invite/${inviteToken}`);
  await expect(page.getByText(`Join ${ORG_NAME}`).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("main")).toContainText("Project Manager");

  await page.getByRole("button", { name: "Sign in to accept" }).click();
  await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("redirectTo") === `/invite/${inviteToken}`, { timeout: 30_000 });
  // back on the invitation after signing in -- not on /dashboard (where this account has no organisation at all)
  await submitLogin(page, accounts.invitee, (u) => !u.pathname.startsWith("/login"));
  await expect(page, "signing in did not bring the invitee back to the invitation").toHaveURL(new RegExp(`/invite/${inviteToken}$`), { timeout: 30_000 });
  expect(await membershipsOf(accounts.invitee.id), "attached before accepting").toEqual([]);

  await page.getByRole("button", { name: `Join ${ORG_NAME}` }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

  // persisted: the membership exists, in this organisation, with the invited role -- and the invitation is marked used by this person
  await expect.poll(() => membershipsOf(accounts.invitee.id), { timeout: 30_000 }).toEqual([{ organization_id: orgId, role: "pm" }]);
  const [inv] = await invitesFor(accounts.invitee.email);
  expect(inv.accepted_at).not.toBeNull();
  expect(inv.accepted_by).toBe(accounts.invitee.id);

  // the install starts on this laptop for this person: the preparing screen, the worker, and the person's own local database
  await expect(page.getByLabel("Preparing your PROJEXA workspace")).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active)), { timeout: 120_000, message: "the PROJEXA worker was never installed" })
    .toBe(true);
  const dbName = `projexa-local:${accounts.invitee.id}`;
  await expect
    .poll(() => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "")), { timeout: 300_000, message: `no ${dbName} database: the install never opened the person's local copy` })
    .toContain(dbName);
});

test("the used link is refused with the plain message and attaches nothing again (B56)", async () => {
  const { page } = invitee;
  await page.goto(`/invite/${inviteToken}`);
  await expect(page.locator("main").getByRole("alert")).toContainText("This invitation is no longer open", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^Join / })).toHaveCount(0);
  const r = await postAccept(page, inviteToken);
  expect(r.status).toBe(400);
  expect(r.error).toBe("This invitation has already been used.");
  expect(await membershipsOf(accounts.invitee.id)).toEqual([{ organization_id: orgId, role: "pm" }]);
});

test("a wrong link and an expired link are refused with the plain message; nothing is attached (B6, B56)", async ({ browser }) => {
  const stranger = await newLaptop(browser, { localFirst: false });
  try {
    const { page } = stranger;
    const bogus = `${inviteToken.slice(0, -6)}zzzzzz`;
    await page.goto(`/invite/${bogus}`);
    await expect(page.locator("main").getByRole("alert")).toContainText("This invitation link is not valid.", { timeout: 60_000 });

    // sign in from the invitation's own redirect and come back to it, then try to redeem the wrong token anyway
    await page.goto(`/login?redirectTo=${encodeURIComponent(`/invite/${bogus}`)}`);
    await submitLogin(page, accounts.stranger, (u) => !u.pathname.startsWith("/login"));
    await expect(page).toHaveURL(new RegExp(`/invite/${bogus}$`));
    const wrong = await postAccept(page, bogus);
    expect(wrong.status).toBe(404);
    expect(wrong.error).toBe("This invitation link is not valid.");
    expect(await membershipsOf(accounts.stranger.id)).toEqual([]);

    // an invitation for the stranger, created by the administrator through the real route, that has run out (expiry moved into the past)
    const created = await admin.page.evaluate(async (email) => {
      const r = await fetch("/api/org/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role: "member" }) });
      return { status: r.status, body: await r.json() };
    }, accounts.stranger.email);
    expect(created.status).toBe(201);
    const token = created.body.invite.token as string;
    await rest(`org_invites?token=eq.${token}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() - 60_000).toISOString() }) });

    await page.goto(`/invite/${token}`);
    await expect(page.locator("main").getByRole("alert")).toContainText("This invitation is no longer open", { timeout: 60_000 });
    const expired = await postAccept(page, token);
    expect(expired.status).toBe(400);
    expect(expired.error).toBe("This invitation has expired. Ask an administrator for a new one.");
    expect(await membershipsOf(accounts.stranger.id)).toEqual([]);
    const [inv] = await invitesFor(accounts.stranger.email);
    expect(inv.accepted_at).toBeNull();
  } finally {
    await stranger.context.close();
  }
});
