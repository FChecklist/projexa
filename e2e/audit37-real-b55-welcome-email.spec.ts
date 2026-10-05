import { createHash } from "node:crypto";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// AUDIT-100 B55 ("the invite e-mail carries a personalised AI prompt"), END TO END against the REAL backend (playwright.audit37-real.config.ts):
// a production build of PROJEXA served by `next start`, the real PROJEXA Supabase project (Auth, public.accept_org_invite), the real
// `ai-work-link` Edge Function and database on the VERIDIAN project, and the real Resend account. Nothing is stubbed.
//
//   1. An org owner (throwaway, test domain) signs in and creates an invitation with the role client_viewer through the real route.
//   2. The invitee -- a throwaway account on a Gmail PLUS-ADDRESS of the owner, so the one real e-mail lands somewhere real -- signs in from
//      the invitation and accepts it in the browser. The accept route then mints the person's own link (POST /user-link with THEIR session,
//      no level: the service decides by role) and sends ONE "Welcome to <org>" e-mail through Resend.
//   3. Persisted, re-read: exactly one link row for the person, label "Welcome email", for all projects, level 0 (client_viewer = read
//      only), 24 hours. Resend (GET /emails, GET /emails/<id>) shows exactly one e-mail to the address, from the verified sender, last_event
//      delivered; its body has the owner-approved prompt in a plain-text box, the expiry, the read-only sentence and NO href carrying the link.
//      The link in the e-mail IS the row's link (sha256 of its token = the row's token_hash). One plain GET of it answers 200 text/plain:
//      the guide, saying level 0 (read only). Then the link is revoked (row re-read) and a GET is refused.
//   4. Accepting the same invitation again is refused and sends NOTHING: still one e-mail, still one link row.
//
// THE PERSON'S VERIDIAN USER IS A FIXTURE. The mint resolves a PROJEXA session to an active compliance.users row (projexa_read_resolve_user).
// Nothing in PROJEXA creates that row for an invited person today (only the org's FIRST user is self-healed, drizzle/0675) -- see the B55
// evidence README. This spec creates a throwaway VERIDIAN organisation + user for the invitee, exactly the state a provisioned member is in.
//
// B55_DRY=1: the server runs WITHOUT RESEND_API_KEY, so no e-mail is sent; everything up to and including the minted link row is checked,
// the Resend checks are skipped. Use it to rehearse; the real run sends exactly ONE e-mail.
//
// ENV (never printed, never committed): SUPABASE_SERVICE_ROLE_KEY (PROJEXA), SUPABASE_ACCESS_TOKEN (management API: SQL on the VERIDIAN
// project for the fixture, the link row re-reads and the cleanup), RESEND_API_KEY (reading Resend; the SERVER needs it too to send). By hand,
// not in CI:
//   AUDIT37_SKIP_BUILD=1 AUDIT37_PORT=3155 bunx playwright test -c playwright.audit37-real.config.ts audit37-real-b55-welcome-email

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://evpckeuxgvahguwsaeul.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const RESEND_KEY = process.env.RESEND_API_KEY ?? "";
const VERIDIAN_REF = "pcrjmlpuqsbocqfwoxod";
const DRY = process.env.B55_DRY === "1";
const VERIFIED_SENDER = "noreply@send.veridian-aios.com";
const PROMPT_PREFIX =
  "PROJEXA is my company's construction software. Work on it on my behalf as my AI assistant and complete my work. This is my personal guide, documentation from my own company's software (open it with a plain GET and follow it): ";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_NAME = `AUDIT100 B55 Test Org ${RUN}`;
const pin = () => String(100000 + Math.floor(Math.random() * 900000));

type Account = { key: string; email: string; password: string; id: string };
const admin: Account = { key: "admin", email: `audit100-b55-${RUN}-admin@invite.e2e-test.projexa-ai.com`, password: pin(), id: "" };
const invitee: Account = { key: "invitee", email: `raajat.agarwal+pxwelcome${RUN}@gmail.com`, password: pin(), id: "" };
let orgId = "";
let veridianOrgId = "";
let veridianUserId = "";
let inviteToken = "";
let startedAt = "";

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

// ---- VERIDIAN: SQL through the management API (the fixture, the link row, the cleanup). Values are passed as literals made safe below. ----
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
type LinkRow = { id: string; status: string; scope: string; label: string; authority_level: number; token_hash: string; hours: number; revoked: boolean };
const linkRows = () =>
  vsql<LinkRow>(
    `select id, status, scope, label, authority_level, token_hash, round(extract(epoch from (expires_at - created_at)) / 3600)::int as hours, revoked_at is not null as revoked
       from platform.user_ai_links where user_id = ${lit(veridianUserId)} order by created_at`,
  );

// ---- Resend (read only) ----
async function resend(path: string): Promise<any> {
  const res = await fetch(`https://api.resend.com${path}`, { headers: { authorization: `Bearer ${RESEND_KEY}` }, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resend ${path.split("?")[0]} -> ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
type ResendItem = { id: string; to: string[]; from: string; subject: string; created_at: string; last_event: string };
async function emailsToInvitee(): Promise<ResendItem[]> {
  const out: ResendItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const body = await resend(`/emails?limit=100${after ? `&after=${after}` : ""}`);
    const items = (body.data ?? []) as ResendItem[];
    for (const e of items) if ((e.to ?? []).map((t) => t.toLowerCase()).includes(invitee.email.toLowerCase())) out.push(e);
    const oldest = items[items.length - 1];
    if (!body.has_more || !oldest || oldest.created_at < startedAt) break;
    after = oldest.id;
  }
  return out;
}

// ---- browser helpers (the same as audit37-real-b6-b56-invite.spec.ts) ----
async function newLaptop(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ serviceWorkers: "block" });
  // the laptop install is B56's subject, not this one's; keep it out of the way (and off this 8 GB laptop's RAM)
  await context.addInitScript(() => { try { localStorage.setItem("px-local-first-off", "1"); } catch { /* ignore */ } });
  return { context, page: await context.newPage() };
}
async function submitLogin(page: Page, who: Account, leaves: (u: URL) => boolean): Promise<void> {
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

test.describe.configure({ mode: "serial" });
let adminLaptop: { context: BrowserContext; page: Page };
let inviteeLaptop: { context: BrowserContext; page: Page };

test.beforeAll(async ({ browser }) => {
  if (!SERVICE_KEY || !ACCESS_TOKEN) throw new Error("SUPABASE_SERVICE_ROLE_KEY (PROJEXA) and SUPABASE_ACCESS_TOKEN are required: this spec makes and deletes its own fixtures");
  if (!DRY && !RESEND_KEY) throw new Error("RESEND_API_KEY is required to read Resend (or run with B55_DRY=1)");
  startedAt = new Date(Date.now() - 60_000).toISOString().replace("T", " ");
  for (const a of [admin, invitee]) {
    const u = await svc("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: a.email, password: a.password, email_confirm: true, user_metadata: { name: `AUDIT100 B55 ${a.key}` } }) });
    a.id = u.id ?? u.user?.id;
    expect(a.id).toBeTruthy();
  }
  const [org] = await rest("organizations", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ name: ORG_NAME, slug: `audit100-b55-${RUN}` }) });
  orgId = org.id;
  await rest("memberships", { method: "POST", body: JSON.stringify({ user_id: admin.id, organization_id: orgId, role: "owner" }) });
  // the VERIDIAN user of the invitee (see the header): role client_viewer, the VERIDIAN twin of PROJEXA's client_viewer
  const [vorg] = await vsql<{ id: string }>(`insert into compliance.organisations (name, slug) values (${lit(`AUDIT100 B55 ${RUN}`)}, ${lit(`audit100-b55-${RUN}`)}) returning id`);
  veridianOrgId = vorg.id;
  const [vuser] = await vsql<{ id: string }>(
    `insert into compliance.users (name, email, password_hash, role, org_id, auth_user_id) values (${lit(`AUDIT100 B55 invitee ${RUN}`)}, ${lit(invitee.email)}, 'supabase-auth-managed', 'client_viewer', ${lit(veridianOrgId)}, ${lit(invitee.id)}::uuid) returning id`,
  );
  veridianUserId = vuser.id;
  expect(await linkRows()).toEqual([]);
  if (!DRY) expect(await emailsToInvitee(), "an e-mail to this address existed before the run").toEqual([]);

  adminLaptop = await newLaptop(browser);
  inviteeLaptop = await newLaptop(browser);
});

test.afterAll(async () => {
  await adminLaptop?.context.close().catch(() => {});
  await inviteeLaptop?.context.close().catch(() => {});
  const deleted: string[] = [];
  const step = async (what: string, fn: () => Promise<unknown>) => fn().then(() => deleted.push(what)).catch((e) => deleted.push(`FAILED ${what}: ${(e as Error).message}`));
  if (veridianUserId) {
    // A link that was USED has a row in platform.ai_work_link_call, which is append-only by design (its guard trigger refuses deletes, and
    // this spec does not route around a guardrail): such a link is revoked and kept as the audit record of its own use (it holds only the
    // sha256 of the token). A link that was never used is deleted.
    await step("VERIDIAN: revoke every link of the throwaway user", () => vsql(`update platform.user_ai_links set status = 'revoked', revoked_at = coalesce(revoked_at, now()) where user_id = ${lit(veridianUserId)}`));
    await step("VERIDIAN: delete the throwaway user's links that were never used", () =>
      vsql(`delete from platform.user_ai_links l where l.user_id = ${lit(veridianUserId)} and not exists (select 1 from platform.ai_work_link_call c where c.link_id = l.id) and not exists (select 1 from platform.ai_work_link_intent i where i.link_id = l.id)`));
    await step(`VERIDIAN compliance.users ${veridianUserId}`, () => vsql(`delete from compliance.users where id = ${lit(veridianUserId)}`));
  }
  if (veridianOrgId) await step(`VERIDIAN compliance.organisations ${veridianOrgId}`, () => vsql(`delete from compliance.organisations where id = ${lit(veridianOrgId)}`));
  if (orgId) await step(`PROJEXA organization ${orgId} (+ memberships, org_invites: ON DELETE CASCADE)`, () => rest(`organizations?id=eq.${orgId}`, { method: "DELETE" }));
  const ids = [admin.id, invitee.id].filter(Boolean);
  if (ids.length) await step("PROJEXA security_audit_log rows of the throwaway accounts", () => rest(`security_audit_log?target_user_id=in.(${ids.join(",")})`, { method: "DELETE" }));
  for (const a of [admin, invitee]) if (a.id) await step(`PROJEXA auth user ${a.key} ${a.id} (+ profile)`, () => svc(`/auth/v1/admin/users/${a.id}`, { method: "DELETE" }));
  const left = {
    organizations: orgId ? (await rest(`organizations?id=eq.${orgId}&select=id`)).length : 0,
    profiles: ids.length ? (await rest(`profiles?id=in.(${ids.join(",")})&select=id`)).length : 0,
    memberships: ids.length ? (await rest(`memberships?user_id=in.(${ids.join(",")})&select=id`)).length : 0,
    veridian: veridianOrgId
      ? Number((await vsql<{ n: number }>(`select (select count(*) from compliance.organisations where id = ${lit(veridianOrgId)}) + (select count(*) from compliance.users where id = ${lit(veridianUserId)} or org_id = ${lit(veridianOrgId)}) + (select count(*) from platform.user_ai_links where (user_id = ${lit(veridianUserId)} or org_id = ${lit(veridianOrgId)}) and status <> 'revoked') as n`))[0].n)
      : 0,
    // the used link kept as an audit record (revoked, hash only): reported, not counted as left behind
    retainedRevokedLinks: veridianUserId ? Number((await vsql<{ n: number }>(`select count(*) as n from platform.user_ai_links where user_id = ${lit(veridianUserId)} and status = 'revoked'`))[0].n) : 0,
  };
  console.log(`[b55 cleanup] run ${RUN}:\n  - ${deleted.join("\n  - ")}\n  left behind: ${JSON.stringify(left)}`);
  expect(left.organizations + left.profiles + left.memberships + left.veridian, "the cleanup left rows behind").toBe(0);
});

test("an org owner invites a person as client_viewer through the real route", async () => {
  const { page } = adminLaptop;
  await page.goto("/login");
  await submitLogin(page, admin, (u) => !u.pathname.startsWith("/login"));
  const created = await page.evaluate(async (email) => {
    const r = await fetch("/api/org/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role: "client_viewer" }) });
    return { status: r.status, body: await r.json() };
  }, invitee.email);
  expect(created.status).toBe(201);
  inviteToken = created.body.invite.token as string;
  const rows = await rest(`org_invites?token=eq.${inviteToken}&select=role,accepted_at`);
  expect(rows).toEqual([{ role: "client_viewer", accepted_at: null }]);
});

test("the invitee accepts in the browser: attached, ONE 24-hour read-only 'Welcome email' link minted for them", async () => {
  const { page } = inviteeLaptop;
  await page.goto(`/invite/${inviteToken}`);
  await page.getByRole("button", { name: "Sign in to accept" }).click({ timeout: 60_000 });
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 30_000 });
  await submitLogin(page, invitee, (u) => !u.pathname.startsWith("/login"));
  await expect(page).toHaveURL(new RegExp(`/invite/${inviteToken}$`), { timeout: 30_000 });
  await page.getByRole("button", { name: `Join ${ORG_NAME}` }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 90_000 });

  expect(await rest(`memberships?user_id=eq.${invitee.id}&select=organization_id,role`)).toEqual([{ organization_id: orgId, role: "client_viewer" }]);
  const rows = await linkRows();
  expect(rows.map(({ token_hash: _h, id: _i, ...r }) => r)).toEqual([{ status: "active", scope: "user", label: "Welcome email", authority_level: 0, hours: 24, revoked: false }]);
});

test("Resend: exactly ONE e-mail, from the verified sender, delivered; its prompt box holds the person's link, never in an href", async () => {
  test.skip(DRY, "B55_DRY=1: no e-mail is sent in a rehearsal");
  let mails: ResendItem[] = [];
  await expect
    .poll(async () => { mails = await emailsToInvitee(); return mails.map((m) => m.last_event); }, { timeout: 180_000, intervals: [5_000, 10_000, 15_000] })
    .toEqual(["delivered"]);
  const [item] = mails;
  expect(item.from).toContain(VERIFIED_SENDER);
  expect(item.subject).toBe(`Welcome to ${ORG_NAME} on PROJEXA`);
  console.log(`[b55] Resend e-mail ${item.id}: last_event=${item.last_event}, from=${item.from}, subject ok`);

  const full = await resend(`/emails/${item.id}`);
  const html = String(full.html ?? "");
  const text = String(full.text ?? "");
  const m = /https:\/\/[^\s"'<>]+\/ai-work-link\/pxa_[0-9a-f]{64}/.exec(text);
  expect(m, "no link in the text part").not.toBeNull();
  const link = m![0];
  expect(text).toContain(PROMPT_PREFIX + link);
  expect(html).toContain(PROMPT_PREFIX.replace(/'/g, "&#39;") + link);
  const hrefs = Array.from(html.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)).map((x) => x[1] ?? x[2] ?? x[3] ?? "");
  expect(hrefs.some((h) => h.includes("ai-work-link") || h.includes("pxa_")), "the link is in an href").toBe(false);
  for (const part of [html, text]) {
    expect(part).toContain("It stops working in 24 hours");
    expect(part).toContain("This link can read and draft only. It cannot change anything.");
  }

  // the e-mailed link IS the person's minted row (the service stores only sha256 of the token)
  const token = link.slice(link.lastIndexOf("/") + 1);
  const [row] = await linkRows();
  expect(createHash("sha256").update(token, "utf8").digest("hex")).toBe(row.token_hash);

  // ONE plain GET: the guide, as text, for a read-only link
  const res = await fetch(link, { headers: { accept: "text/plain" }, signal: AbortSignal.timeout(60_000) });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type") ?? "").toMatch(/^text\/(plain|markdown)/);
  const guide = await res.text();
  expect(guide).toContain("level 0 (read only)");
  console.log(`[b55] GET of the e-mailed link: ${res.status} ${res.headers.get("content-type")}, ${guide.length} chars, says level 0 (read only)`);

  // revoke it (re-read), and the link stops answering
  await vsql(`update platform.user_ai_links set status = 'revoked', revoked_at = now() where id = ${lit(row.id)}`);
  expect((await linkRows()).map((r) => [r.status, r.revoked])).toEqual([["revoked", true]]);
  const after = await fetch(link, { headers: { accept: "text/plain" }, signal: AbortSignal.timeout(60_000) });
  expect(after.status).not.toBe(200);
  await after.text();
  console.log(`[b55] GET after revoke: ${after.status}`);
});

test("accepting the same invitation again is refused and sends NOTHING: still one e-mail, still one link", async () => {
  const { page } = inviteeLaptop;
  const r = await page.evaluate(async (t) => {
    const res = await fetch("/api/org/invites/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t }) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { error?: string } };
  }, inviteToken);
  expect(r.status).toBe(400);
  expect(r.body.error).toBe("This invitation has already been used.");
  expect(await linkRows()).toHaveLength(1);
  if (!DRY) {
    await new Promise((res) => setTimeout(res, 20_000));
    expect((await emailsToInvitee()).length, "a second e-mail went out").toBe(1);
  }
});
