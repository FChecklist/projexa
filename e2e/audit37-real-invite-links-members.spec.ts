import { existsSync, readFileSync } from "node:fs";
import { signInByCode, realTestCode } from "./support/sign-in";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// AUDIT-100 (link-invited-members): EVERY MEMBER GETS THEIR OWN VERIDIAN USER, END TO END against the REAL backend
// (playwright.audit37-real.config.ts, by hand, not in CI): a production build of PROJEXA served by `next start`, the real PROJEXA Supabase
// project (Auth, public.accept_org_invite, memberships), the real `projexa-api` Edge Function (POST /link-member, compliance-tracker
// supabase/functions/projexa-api/member-link.ts), the real `ai-work-link` Edge Function and the real VERIDIAN database
// (public.projexa_ensure_member_user, drizzle/0728). Nothing is stubbed. NO e-mail is sent: the server runs without RESEND_API_KEY (the
// welcome e-mail still mints the person's link, then its send is skipped -- that mint is itself proof the person is linked).
//
//   1. A throwaway org owner invites three people through the real route: pm, site_engineer, client_viewer.
//   2. Each invitee signs in from the invitation and accepts in the browser. Re-read: exactly ONE VERIDIAN user per person, in the org's
//      VERIDIAN organisation, with the MAPPED role (pm -> manager, site_engineer -> member, client_viewer -> client_viewer), and the welcome
//      mint made a link at the role's level (1, 1, 0).
//   3. pm and site_engineer click the real "AI prompt" button (the in-app Copy AI prompt): it mints; re-read: one active user link, level 1.
//   4. client_viewer: the button is replaced by the role note; the same service mints for their own session a level 0 link, and a write
//      through it is refused (403, no write counted, no intent, no project made).
//   5. A member who joined BEFORE the fix (membership made directly, no accept): the first click on the button heals them lazily (re-read:
//      a VERIDIAN user with role member) and the mint succeeds.
//   6. Idempotent: /link-member called again for each person answers already_linked and writes nothing; accepting an invitation a second
//      time is refused and adds nothing.
//   Cleanup: every throwaway row in both projects is deleted (a USED link is revoked and kept: the call log is append-only by design).
//
// ENV (never printed, never committed): SUPABASE_SERVICE_ROLE_KEY (PROJEXA, fixtures and re-reads), SUPABASE_ACCESS_TOKEN (management API:
// SQL on the VERIDIAN project). NEXT_PUBLIC_SUPABASE_ANON_KEY (public) is read from the environment or this checkout's .env.local.
//   AUDIT37_SKIP_BUILD=1 AUDIT37_PORT=3156 bunx playwright test -c playwright.audit37-real.config.ts audit37-real-invite-links-members
// The two Edge Functions answer CORS only for http://localhost:3100 among local origins; on any other port the in-app button's browser call
// is blocked by CORS ("Could not reach the AI work link service"). Serve on 3100, or (as the 2026-10-06 run did, 3100 being held by another
// session) run Microsoft Edge with --disable-web-security: only the browser's CORS check is lifted, every request still reaches the real
// services with the real session. See ai-os/audit37/evidence/link-members-README.md.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://evpckeuxgvahguwsaeul.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const VERIDIAN_REF = "pcrjmlpuqsbocqfwoxod";
// Written out in full on purpose (as e2e/ai-link-mint.spec.ts does): the spec must fail if the app names a different address.
const AWL_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link";
const MEMBER_LINK_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api/link-member";

function anonKey(): string {
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!existsSync(".env.local")) return "";
  const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY="));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
}
const ANON_KEY = anonKey();

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `AUDIT100 Link Members Test Org ${RUN}`;
const pin = () => String(100000 + Math.floor(Math.random() * 900000));

type Role = "owner" | "pm" | "site_engineer" | "client_viewer" | "member";
type Account = { key: string; role: Role; email: string; password: string; id: string; inviteToken: string };
const acct = (key: string, role: Role): Account => ({ key, role, email: `audit100-lm-${RUN}-${key}@invite.e2e-test.projexa-ai.com`, password: pin(), id: "", inviteToken: "" });
const owner = acct("owner", "owner");
const pm = acct("pm", "pm");
const se = acct("se", "site_engineer");
const cv = acct("cv", "client_viewer");
const legacy = acct("legacy", "member"); // joined before the fix: membership made directly, never through an accept
const invitees = [pm, se, cv];
const everyone = [owner, pm, se, cv, legacy];
const EXPECTED: Record<string, { role: string; level: number }> = { pm: { role: "manager", level: 1 }, se: { role: "member", level: 1 }, cv: { role: "client_viewer", level: 0 }, legacy: { role: "member", level: 1 } };

let orgId = "";
let veridianOrgId = "";
let veridianKeyId = "";

// ---- PROJEXA: Supabase admin / service-role REST (fixtures and re-reads only) ----
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
      if ((err as { status?: number }).status !== undefined || attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
    }
  }
}
const rest = (path: string, init: RequestInit = {}) => svc(`/rest/v1/${path}`, init);

/** A real PROJEXA session for a throwaway account (password grant against the real Auth project, public anon key). */
async function sessionToken(who: Account): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: who.email, password: who.password }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { access_token?: string };
  if (!res.ok || !body.access_token) throw new Error(`sign-in for ${who.key} -> ${res.status}`);
  return body.access_token;
}

// ---- VERIDIAN: SQL through the management API. Values are passed as literals made safe below. ----
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
async function vsql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${VERIDIAN_REF}/database/query`, {
        method: "POST",
        headers: { authorization: `Bearer ${ACCESS_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      if (!res.ok) throw Object.assign(new Error(`VERIDIAN SQL -> ${res.status} ${text.slice(0, 200)}`), { status: res.status });
      return JSON.parse(text) as T[];
    } catch (err) {
      if (((err as { status?: number }).status ?? 0) < 500 && (err as { status?: number }).status !== undefined) throw err;
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 3_000 * (attempt + 1)));
    }
  }
}
type VUser = { id: string; org_id: string; role: string; is_active: boolean; email: string };
const vusersOf = (who: Account) => vsql<VUser>(`select id, org_id, role::text as role, is_active, email from compliance.users where auth_user_id = ${lit(who.id)}::uuid`);
type LinkRow = { id: string; status: string; scope: string; label: string | null; authority_level: number; write_count: number };
const activeLinksOf = (userId: string) =>
  vsql<LinkRow>(`select id, status, scope, label, authority_level, write_count from platform.user_ai_links where user_id = ${lit(userId)} and status = 'active' and revoked_at is null and expires_at > now() order by created_at`);

// ---- browser helpers (the same as audit37-real-b55-welcome-email.spec.ts) ----
async function newLaptop(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.addInitScript(() => { try { localStorage.setItem("px-local-first-off", "1"); } catch { /* ignore */ } });
  return { context, page: await context.newPage() };
}
async function submitLogin(page: Page, who: Account, leaves: (u: URL) => boolean): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await signInByCode(page, who.email, { code: realTestCode, stayOnPage: true, leaves, timeoutMs: 60_000 });
      return;
    } catch (err) {
      if (attempt >= 4 || !(await page.locator("form").innerText().catch(() => "")).match(/fetch|network|timed? ?out/i)) throw err;
      await page.waitForTimeout(5_000);
      await page.reload();
    }
  }
}
/** Clicks the in-app "AI prompt" button (the user-wide Copy AI prompt, AiWorkLinkCompact in the shell) and waits for its answer. */
async function clickCopyAiPrompt(page: Page): Promise<"copied" | string> {
  const trigger = page.getByTestId("awl-compact-trigger").filter({ hasText: /AI prompt/ }).first();
  await trigger.waitFor({ state: "visible", timeout: 90_000 });
  await trigger.click();
  const done = page.getByTestId("awl-compact-confirm").first();
  const failed = page.getByTestId("awl-compact-error").first();
  await expect(done.or(failed)).toBeAttached({ timeout: 90_000 });
  return (await done.count()) > 0 ? "copied" : String(await failed.textContent());
}

test.describe.configure({ mode: "serial" });
const laptops: Record<string, { context: BrowserContext; page: Page }> = {};

test.beforeAll(async () => {
  if (!SERVICE_KEY || !ACCESS_TOKEN || !ANON_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY (PROJEXA), SUPABASE_ACCESS_TOKEN and the PROJEXA anon key are required");
  for (const a of everyone) {
    const u = await svc("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: a.email, password: a.password, email_confirm: true, user_metadata: { name: `AUDIT100 LM ${a.key}` } }) });
    a.id = u.id ?? u.user?.id;
    expect(a.id).toBeTruthy();
  }
  // the VERIDIAN side of a provisioned org: an organisation and an active key (a hash nobody holds: never usable)
  const [vorg] = await vsql<{ id: string }>(`insert into compliance.organisations (name, slug) values (${lit(`AUDIT100 LM Test ${RUN}`)}, ${lit(`audit100-lm-${RUN}`)}) returning id`);
  veridianOrgId = vorg.id;
  const [key] = await vsql<{ id: string }>(
    `insert into compliance.api_keys (name, key_hash, key_prefix, org_id) values (${lit(`audit100 lm ${RUN}`)}, encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'), 'vk_test', ${lit(veridianOrgId)}) returning id`,
  );
  veridianKeyId = key.id;
  // the PROJEXA org, its owner, its veridian_credentials row (the org id is what /link-member reads; the key string is never used by it)
  const [org] = await rest("organizations", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ name: ORG_NAME, slug: `audit100-lm-${RUN}` }) });
  orgId = org.id;
  await rest("veridian_credentials", { method: "POST", body: JSON.stringify({ organization_id: orgId, veridian_org_id: veridianOrgId, veridian_api_key: `vk_unused_audit100_${RUN}` }) });
  await rest("memberships", { method: "POST", body: JSON.stringify({ user_id: owner.id, organization_id: orgId, role: "owner" }) });
  await rest("memberships", { method: "POST", body: JSON.stringify({ user_id: legacy.id, organization_id: orgId, role: "member" }) });
  // before: nobody of this run has a VERIDIAN user
  for (const a of everyone) expect(await vusersOf(a), `${a.key} already had a VERIDIAN user`).toEqual([]);
});

test.afterAll(async () => {
  for (const l of Object.values(laptops)) await l.context.close().catch(() => {});
  const deleted: string[] = [];
  const step = async (what: string, fn: () => Promise<unknown>) => fn().then(() => deleted.push(what)).catch((e) => deleted.push(`FAILED ${what}: ${(e as Error).message}`));
  if (veridianOrgId) {
    const users = `select id from compliance.users where org_id = ${lit(veridianOrgId)}`;
    await step("VERIDIAN: revoke every link of the run's users", () => vsql(`update platform.user_ai_links set status = 'revoked', revoked_at = coalesce(revoked_at, now()) where user_id in (${users})`));
    await step("VERIDIAN: delete the run's links that were never used", () =>
      vsql(`delete from platform.user_ai_links l where l.user_id in (${users}) and not exists (select 1 from platform.ai_work_link_call c where c.link_id = l.id) and not exists (select 1 from platform.ai_work_link_intent i where i.link_id = l.id)`));
    await step("VERIDIAN compliance.projects of the run's org (none expected)", () => vsql(`delete from compliance.projects where org_id = ${lit(veridianOrgId)}`));
    await step("VERIDIAN compliance.users of the run's org", () => vsql(`delete from compliance.users where org_id = ${lit(veridianOrgId)}`));
    if (veridianKeyId) await step(`VERIDIAN compliance.api_keys ${veridianKeyId}`, () => vsql(`delete from compliance.api_keys where id = ${lit(veridianKeyId)}`));
    await step(`VERIDIAN compliance.organisations ${veridianOrgId}`, () => vsql(`delete from compliance.organisations where id = ${lit(veridianOrgId)}`));
  }
  if (orgId) await step(`PROJEXA organization ${orgId} (+ memberships, org_invites, veridian_credentials: ON DELETE CASCADE)`, () => rest(`organizations?id=eq.${orgId}`, { method: "DELETE" }));
  const ids = everyone.map((a) => a.id).filter(Boolean);
  if (ids.length) await step("PROJEXA security_audit_log rows of the throwaway accounts", () => rest(`security_audit_log?target_user_id=in.(${ids.join(",")})`, { method: "DELETE" }));
  for (const a of everyone) if (a.id) await step(`PROJEXA auth user ${a.key} ${a.id} (+ profile)`, () => svc(`/auth/v1/admin/users/${a.id}`, { method: "DELETE" }));
  const left = {
    organizations: orgId ? (await rest(`organizations?id=eq.${orgId}&select=id`)).length : 0,
    credentials: orgId ? (await rest(`veridian_credentials?organization_id=eq.${orgId}&select=organization_id`)).length : 0,
    profiles: ids.length ? (await rest(`profiles?id=in.(${ids.join(",")})&select=id`)).length : 0,
    memberships: ids.length ? (await rest(`memberships?user_id=in.(${ids.join(",")})&select=id`)).length : 0,
    veridian: veridianOrgId
      ? Number(
          (
            await vsql<{ n: number }>(
              `select (select count(*) from compliance.organisations where id = ${lit(veridianOrgId)}) + (select count(*) from compliance.users where org_id = ${lit(veridianOrgId)}${ids.length ? ` or auth_user_id in (${ids.map((i) => `${lit(i)}::uuid`).join(",")})` : ""}) + (select count(*) from compliance.api_keys where org_id = ${lit(veridianOrgId)}) + (select count(*) from platform.user_ai_links where org_id = ${lit(veridianOrgId)} and status <> 'revoked') as n`,
            )
          )[0].n,
        )
      : 0,
    retainedRevokedLinks: veridianOrgId ? Number((await vsql<{ n: number }>(`select count(*) as n from platform.user_ai_links where org_id = ${lit(veridianOrgId)} and status = 'revoked'`))[0].n) : 0,
  };
  console.log(`[link-members cleanup] run ${RUN}:\n  - ${deleted.join("\n  - ")}\n  left behind: ${JSON.stringify(left)}`);
  expect(left.organizations + left.credentials + left.profiles + left.memberships + left.veridian, "the cleanup left rows behind").toBe(0);
});

test("the org owner invites a pm, a site_engineer and a client_viewer through the real route", async ({ browser }) => {
  laptops.owner = await newLaptop(browser);
  const { page } = laptops.owner;
  await page.goto("/login");
  await submitLogin(page, owner, (u) => !u.pathname.startsWith("/login"));
  for (const a of invitees) {
    const created = await page.evaluate(async ({ email, role }) => {
      const r = await fetch("/api/org/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
      return { status: r.status, body: await r.json() };
    }, { email: a.email, role: a.role });
    expect(created.status, a.key).toBe(201);
    a.inviteToken = created.body.invite.token as string;
    expect(await rest(`org_invites?token=eq.${a.inviteToken}&select=role,accepted_at`)).toEqual([{ role: a.role, accepted_at: null }]);
  }
  await laptops.owner.context.close();
  delete laptops.owner;
});

for (const a of invitees) {
  test(`${a.role} accepts in the browser and is linked: ONE VERIDIAN user with role ${EXPECTED[a.key].role}`, async ({ browser }) => {
    laptops[a.key] = await newLaptop(browser);
    const { page } = laptops[a.key];
    await page.goto(`/invite/${a.inviteToken}`);
    await page.getByRole("button", { name: "Sign in to accept" }).click({ timeout: 60_000 });
    await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
    await submitLogin(page, a, (u) => !u.pathname.startsWith("/login"));
    await expect(page).toHaveURL(new RegExp(`/invite/${a.inviteToken}$`), { timeout: 30_000 });
    await page.getByRole("button", { name: `Join ${ORG_NAME}` }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 90_000 });

    expect(await rest(`memberships?user_id=eq.${a.id}&select=organization_id,role`)).toEqual([{ organization_id: orgId, role: a.role }]);
    const vusers = await vusersOf(a);
    expect(vusers.map(({ id: _i, ...u }) => u)).toEqual([{ org_id: veridianOrgId, role: EXPECTED[a.key].role, is_active: true, email: a.email.toLowerCase() }]);
    // the welcome e-mail's mint ran for the person AFTER the link (its send is skipped: no RESEND_API_KEY): one link at the role's level
    const links = await activeLinksOf(vusers[0].id);
    expect(links.map((l) => [l.scope, l.label, l.authority_level])).toEqual([["user", "Welcome email", EXPECTED[a.key].level]]);
    console.log(`[link-members] ${a.role}: VERIDIAN role ${vusers[0].role}, welcome link level ${links[0].authority_level}`);
  });
}

for (const a of [pm, se]) {
  test(`${a.role}: the in-app "AI prompt" (Copy AI prompt) button mints their own level 1 link`, async () => {
    const { page } = laptops[a.key];
    expect(await clickCopyAiPrompt(page)).toBe("copied");
    const [vuser] = await vusersOf(a);
    const links = await activeLinksOf(vuser.id);
    // one user link per person: the button's link (the service's default label) replaced the welcome link
    expect(links.map((l) => [l.scope, l.label, l.authority_level])).toEqual([["user", "All my projects", 1]]);
  });
}

test("client_viewer: the button is replaced by the role note; their own session mints a READ-ONLY link and a write through it is refused", async () => {
  const { page } = laptops.cv;
  await expect(page.getByTestId("awl-compact-role-note").first()).toBeVisible({ timeout: 90_000 });
  expect(await page.getByTestId("awl-compact-trigger").filter({ hasText: /AI prompt/ }).count()).toBe(0);

  const token = await sessionToken(cv);
  const res = await fetch(`${AWL_URL}/user-link`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ days: 1 }) });
  const minted = (await res.json()) as { link_id?: string; level?: number; links?: { link?: string } };
  expect(res.status).toBe(201);
  expect(minted.level).toBe(0);
  const link = String(minted.links?.link ?? "");
  expect(link).toMatch(/\/ai-work-link\/pxa_[0-9a-f]{64}$/);

  const write = await fetch(`${link}/actions`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ function: "create_project", params: { name: `should never be written ${RUN}` } }) });
  const writeBody = (await write.json().catch(() => ({}))) as { code?: string };
  expect(write.status, `a client_viewer write answered ${write.status} ${writeBody.code ?? ""}`).toBe(403);
  console.log(`[link-members] client_viewer write through its link: ${write.status} ${writeBody.code ?? ""}`);
  const [row] = await vsql<LinkRow>(`select id, status, scope, label, authority_level, write_count from platform.user_ai_links where id = ${lit(String(minted.link_id))}`);
  expect([row.authority_level, row.write_count]).toEqual([0, 0]);
  expect(Number((await vsql<{ n: number }>(`select count(*) as n from platform.ai_work_link_intent where link_id = ${lit(row.id)}`))[0].n)).toBe(0);
  expect(Number((await vsql<{ n: number }>(`select count(*) as n from compliance.projects where org_id = ${lit(veridianOrgId)}`))[0].n)).toBe(0);
});

test("a member who joined BEFORE the fix (no accept, no VERIDIAN user) is healed by their first click on the button", async ({ browser }) => {
  expect(await vusersOf(legacy)).toEqual([]);
  laptops.legacy = await newLaptop(browser);
  const { page } = laptops.legacy;
  await page.goto("/login");
  await submitLogin(page, legacy, (u) => !u.pathname.startsWith("/login"));
  expect(await clickCopyAiPrompt(page)).toBe("copied");
  const vusers = await vusersOf(legacy);
  expect(vusers.map(({ id: _i, ...u }) => u)).toEqual([{ org_id: veridianOrgId, role: "member", is_active: true, email: legacy.email.toLowerCase() }]);
  expect((await activeLinksOf(vusers[0].id)).map((l) => [l.scope, l.label, l.authority_level])).toEqual([["user", "All my projects", 1]]);
});

test("idempotent: /link-member again answers already_linked and writes nothing; a second accept is refused and adds nothing", async () => {
  const before = await vsql<{ n: number }>(`select count(*) as n from compliance.users where org_id = ${lit(veridianOrgId)}`);
  expect(Number(before[0].n)).toBe(4);
  for (const a of [pm, se, cv, legacy]) {
    const token = await sessionToken(a);
    for (let i = 0; i < 2; i++) {
      const r = await fetch(MEMBER_LINK_URL, { method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ linked: true, outcome: "already_linked", role: EXPECTED[a.key].role });
    }
    expect((await vusersOf(a)).length, a.key).toBe(1);
  }
  const { page } = laptops.pm;
  const again = await page.evaluate(async (t) => {
    const res = await fetch("/api/org/invites/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t }) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { error?: string } };
  }, pm.inviteToken);
  expect(again.status).toBe(400);
  expect(again.body.error).toBe("This invitation has already been used.");
  const after = await vsql<{ n: number }>(`select count(*) as n from compliance.users where org_id = ${lit(veridianOrgId)}`);
  expect(Number(after[0].n)).toBe(4);
});
