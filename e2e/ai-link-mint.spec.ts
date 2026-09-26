import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import { buildProjectFixture } from "./support/boq-fixture";
import { APP_ORIGIN, signInLocally, stubAppApis } from "./support/boq-local";

// PROJEXA-BUILD-002 WP-08, register row AW-405: a signed-in user opens a project, clicks "AI work link", chooses the level and the days,
// reads the warning, presses Create, gets the link ONCE with a Copy button, sees the link in the list and revokes it. The same file holds
// two runs of that path, told apart by the Playwright project the runner uses:
//
//   1. "boq-local"  (playwright.boq-local.config.ts, the config the register command uses). A local PROJEXA server, a synthetic signed-in
//      browser, and the Edge function ai-work-link ANSWERED IN THE BROWSER by the stub below, which follows the contract of
//      compliance-tracker supabase/functions/ai-work-link/mint.ts. It proves the screen: what it sends, what it shows, what it keeps.
//        bash scripts/verify/projexa-playwright.sh e2e/ai-link-mint.spec.ts
//        or, from a PROJEXA checkout:  bunx playwright test -c playwright.boq-local.config.ts e2e/ai-link-mint.spec.ts
//
//   2. "ai-link-live"  (playwright.ai-link-live.config.ts). A locally started PROJEXA (port 3100, its own .env.local pointing at the real
//      PROJEXA Supabase project) and the LIVE Edge function, with a real session for the demo user made the way e2e/demo-gate-smoke-env1.spec.ts
//      in compliance-tracker makes it (a minted token_hash exchanged for a session, then context.addCookies; no page javascript sets a
//      cookie). It proves the link itself: a minted link answers 200 at /context, is listed with no token, and answers 410 after Revoke.
//        bun run dev            (in the PROJEXA checkout, port 3100)
//        AWL_E2E_MINT_SECRET=<the mint-session secret> PROJEXA_SUPABASE_ANON_KEY=<the public anon key of the PROJEXA project> \
//          bunx playwright test -c playwright.ai-link-live.config.ts
//      Optional: AWL_E2E_PROJECT_ID (default: the first project of the demo user), PLAYWRIGHT_BASE_URL (default http://localhost:3100),
//      AWL_E2E_DEMO_EMAIL (default democeo@projexa-ai.com). Without the two required variables the live test skips and says why.
//      It makes one level 0 link (no write to any project) and revokes it before it ends.
//
// A test that runs in the other project skips itself, so each config counts one pass and one skip.

// Written out in full on purpose: the spec must fail if src/lib/ai-work-link-client.ts names a different address, so this is not imported.
const AWL_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link";
const AWL_PATH = "/functions/v1/ai-work-link";
const TOKEN_SHAPE = /pxa_[0-9a-f]{64}/;
const LINK_SHAPE = new RegExp(`^${AWL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pxa_[0-9a-f]{64}$`);

// ---- the stub Edge function (project "boq-local" only) ----

type StubLink = { id: string; token: string; projectId: string; label: string | null; level: number; days: number; createdAt: string; expiresAt: string; revokedAt: string | null };
type Seen = { method: string; path: string; authorization: string | undefined; cookie: string | undefined; body: unknown };

function cors(origin: string | undefined) {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-headers": "authorization, content-type, accept, link-token",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    vary: "Origin",
    "cache-control": "no-store",
  };
}

function randomToken(): string {
  return `pxa_${Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
}

async function stubEdge(page: Page, sessionToken: string, project: { id: string; name: string }) {
  const links: StubLink[] = [];
  const seen: Seen[] = [];
  const json = (route: Route, origin: string | undefined, status: number, body: unknown) =>
    route.fulfill({ status, headers: { ...cors(origin), "content-type": "application/json" }, body: JSON.stringify(body) });
  const rowOf = (l: StubLink) => ({
    id: l.id, project_id: l.projectId, project_name: project.name, label: l.label, level: l.level, allowed_functions: [], hide_personal: true,
    created_at: l.createdAt, expires_at: l.expiresAt, revoked_at: l.revokedAt, last_used_at: null, call_count: 0, write_count: 0,
    active: l.revokedAt === null && Date.parse(l.expiresAt) > Date.now(),
  });

  await page.route(`${AWL_URL}**`, async (route, request) => {
    const origin = request.headers()["origin"];
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(origin) });
    const url = new URL(request.url());
    const path = url.pathname.slice(AWL_PATH.length);
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    const headers = request.headers();
    seen.push({ method: request.method(), path: path + url.search, authorization: headers["authorization"], cookie: headers["cookie"], body });
    if (headers["authorization"] !== `Bearer ${sessionToken}`) return json(route, origin, 401, { error: "Your session is not valid. Sign in again.", status: 401, code: "SESSION_INVALID" });

    if (request.method() === "GET" && path === "/warning") {
      const level = Number(url.searchParams.get("level"));
      return json(route, origin, 200, {
        project: { id: project.id, name: project.name }, lines: 12, tasks: 3, people: 2, money_visible: true, level, can_record: false, writes_enabled: false, rank: 3, max_level: 1, functions: [],
        sentence: `STUB WARNING for ${project.name} at level ${level}: 12 BOQ lines, 3 tasks, 2 people.`,
      });
    }
    if (request.method() === "POST" && path === "/mint") {
      const created = new Date();
      const link: StubLink = {
        id: `lnk_${links.length + 1}`, token: randomToken(), projectId: body.projectId, label: body.label ?? null, level: body.level, days: body.days,
        createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + body.days * 86_400_000).toISOString(), revokedAt: null,
      };
      // one active link per person and project: the earlier one is switched off in the same step
      for (const earlier of links) if (earlier.projectId === link.projectId && earlier.revokedAt === null) earlier.revokedAt = created.toISOString();
      links.unshift(link);
      return json(route, origin, 201, {
        link_id: link.id, level: link.level, allowed_functions: [], hide_personal: true, label: link.label, expires_at: link.expiresAt, project: { id: project.id, name: project.name },
        token: link.token, links: { link: `${AWL_URL}/${link.token}`, header_base: `${AWL_URL}/header`, inbox: null },
        notice: "This is the only time the link is shown. Copy it now and paste it into an assistant that only you use.",
      });
    }
    if (request.method() === "GET" && path === "/links") return json(route, origin, 200, { links: links.filter((l) => l.projectId === url.searchParams.get("project")).map(rowOf) });
    const revoke = /^\/links\/([^/]+)\/revoke$/.exec(path);
    if (request.method() === "POST" && revoke) {
      const link = links.find((l) => l.id === decodeURIComponent(revoke[1]));
      if (!link) return json(route, origin, 404, { error: "No such link.", status: 404, code: "LINK_NOT_FOUND" });
      const already = link.revokedAt !== null;
      link.revokedAt ??= new Date().toISOString();
      return json(route, origin, 200, { link_id: link.id, revoked: true, already });
    }
    return json(route, origin, 404, { error: "No such path", status: 404, code: "NOT_FOUND" });
  });
  return { links, seen };
}

// ---- what the browser must not keep ----

/** The token must be in the dialog's input and nowhere else the browser can look: the page, the address, storage, cookies. */
async function expectTokenNowhere(page: Page, context: BrowserContext, token: string) {
  expect(page.url()).not.toContain(token);
  expect(await page.content()).not.toContain(token);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain(token);
  expect(JSON.stringify(await context.cookies())).not.toContain(token);
}

// ---- run 1: the screen, against the stub ----

test("AW-405 (screen): open, read the warning, Create, see the link once, Copy, list it, Revoke", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "boq-local", "this run is for playwright.boq-local.config.ts (the stubbed Edge function)");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_ORIGIN });
  const fixture = buildProjectFixture();
  const session = await signInLocally(context);
  await stubAppApis(page, fixture, session);
  const project = { id: fixture.projectId, name: "Fixture Tower" };
  const edge = await stubEdge(page, session.accessToken, project);

  await test.step("the button is in the top rail for a member role, on the project named in the address", async () => {
    await page.goto(`/projects?projectId=${encodeURIComponent(project.id)}`);
    await expect(page.getByTestId("ai-work-link-open")).toBeEnabled({ timeout: 120_000 });
    await expect(page.getByTestId("ai-new-project-open")).toBeVisible();
  });

  await test.step("the dialog shows the sentence the service sent, before any link exists", async () => {
    await page.getByTestId("ai-work-link-open").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `AI work link for ${project.name}` })).toBeVisible();
    await expect(dialog.getByText(`STUB WARNING for ${project.name} at level 0: 12 BOQ lines, 3 tasks, 2 people.`)).toBeVisible();
    await expect(dialog.getByTestId("awl-create")).toBeEnabled();
    expect(edge.seen.filter((s) => s.path === "/mint")).toHaveLength(0);
    // a level 1 choice asks the service again and shows its sentence, not a fixed one
    await dialog.getByLabel(/Direct entries/).check();
    await expect(dialog.getByText(`STUB WARNING for ${project.name} at level 1`)).toBeVisible();
    await dialog.getByLabel(/Read and draft/).check();
    await expect(dialog.getByText(`STUB WARNING for ${project.name} at level 0`)).toBeVisible();
  });

  let link = "";
  await test.step("Create shows the link once, in the right shape, made with the person's own token and nothing else", async () => {
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("1 day").check();
    await dialog.getByLabel(/Name for this link/).fill("spec assistant");
    await dialog.getByTestId("awl-create").click();
    const input = dialog.getByTestId("awl-link");
    await expect(input).toBeVisible();
    link = await input.inputValue();
    expect(link).toMatch(LINK_SHAPE);
    await expect(dialog.getByTestId("awl-instruction")).toContainText("Paste this link into your AI assistant");

    const mints = edge.seen.filter((s) => s.path === "/mint");
    expect(mints).toHaveLength(1);
    expect(mints[0].body).toEqual({ projectId: project.id, level: 0, days: 1, label: "spec assistant" });
    for (const call of edge.seen) {
      expect(call.authorization).toBe(`Bearer ${session.accessToken}`);
      expect(call.cookie).toBeUndefined();
      expect(call.path).not.toMatch(TOKEN_SHAPE);
    }
  });

  await test.step("Copy puts exactly that link on the clipboard", async () => {
    await page.getByTestId("awl-copy").click();
    await expect(page.getByTestId("awl-status")).toHaveText("Link copied.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  });

  await test.step("the service has the link (re-read from it), and the list of the dialog shows it without a token", async () => {
    const token = link.slice(link.lastIndexOf("/") + 1);
    expect(edge.links.filter((l) => l.revokedAt === null)).toHaveLength(1);
    expect(edge.links[0].token).toBe(token);
    const row = page.getByTestId("awl-link-row");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-status", "active");
    await expect(row).toContainText("spec assistant");
    await expect(row).toContainText("Read and draft");
  });

  await test.step("closing the dialog removes the link from the page, the address, storage and cookies", async () => {
    const token = link.slice(link.lastIndexOf("/") + 1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectTokenNowhere(page, context, token);
    // and a second open shows the options again, not the link
    await page.getByTestId("ai-work-link-open").click();
    await expect(page.getByTestId("awl-create")).toBeEnabled();
    await expect(page.getByTestId("awl-link")).toHaveCount(0);
    await expectTokenNowhere(page, context, token);
  });

  await test.step("Revoke switches the link off at the service, and the list re-read shows it revoked", async () => {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Revoke link spec assistant" }).click();
    await expect(dialog.getByTestId("awl-link-row")).toHaveAttribute("data-status", "revoked");
    await expect(dialog.getByRole("button", { name: /Revoke link/ })).toHaveCount(0);
    expect(edge.links[0].revokedAt).not.toBeNull();
    expect(edge.seen.filter((s) => s.path.endsWith("/revoke"))).toHaveLength(1);
  });
});

// ---- run 2: the link itself, against the live Edge function ----

const LIVE_SUPABASE_URL = "https://evpckeuxgvahguwsaeul.supabase.co";

test("AW-405 (live): a link made in the dialog answers at /context, is listed without a token, and answers 410 after Revoke", async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== "ai-link-live", "this run is for playwright.ai-link-live.config.ts (a local PROJEXA and the live Edge function)");
  const mintSecret = process.env.AWL_E2E_MINT_SECRET;
  const anonKey = process.env.PROJEXA_SUPABASE_ANON_KEY;
  test.skip(!mintSecret || !anonKey, "set AWL_E2E_MINT_SECRET and PROJEXA_SUPABASE_ANON_KEY to run against the live Edge function");
  const demoEmail = process.env.AWL_E2E_DEMO_EMAIL ?? "democeo@projexa-ai.com";
  const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

  // A real session for the demo user: a minted token_hash exchanged at the Auth service. Nothing here types or stores a password.
  const minted = await request.get(`${LIVE_SUPABASE_URL}/functions/v1/mint-session-r33`, { headers: { Authorization: `Bearer ${anonKey}` }, params: { email: demoEmail, secret: mintSecret! } });
  expect(minted.ok(), "the session-minting function must be reachable").toBeTruthy();
  const { token_hash } = await minted.json();
  const exchanged = await request.post(`${LIVE_SUPABASE_URL}/auth/v1/verify`, { headers: { apikey: anonKey!, "Content-Type": "application/json" }, data: { type: "magiclink", token_hash } });
  expect(exchanged.ok(), "the token_hash exchange must succeed").toBeTruthy();
  const session = await exchanged.json();
  expect(session.access_token).toBeTruthy();

  const runLabel = `spec ${Date.now()}`;
  let createdIn = "";
  const context = await browser.newContext({ baseURL: origin });
  try {
    await context.addCookies([{ name: "sb-evpckeuxgvahguwsaeul-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`, domain: new URL(origin).hostname, path: "/" }]);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    const page = await context.newPage();

    let projectId = process.env.AWL_E2E_PROJECT_ID ?? "";
    if (!projectId) {
      const listed = await context.request.get("/api/projects");
      expect(listed.ok(), "the demo session must resolve to a real organisation").toBeTruthy();
      const body = await listed.json();
      projectId = (body.projects ?? body)[0]?.id ?? "";
    }
    expect(projectId, "the demo user must have a project").toBeTruthy();
    const label = runLabel;
    createdIn = projectId;
    const awlGet = (path: string) => request.get(`${AWL_URL}${path}`, { headers: { Authorization: `Bearer ${session.access_token}` } });

    await page.goto(`/workspace/${encodeURIComponent(projectId)}`);
    // the top rail has one of these buttons too; the workspace header's is the last in the page
    const open = page.getByTestId("ai-work-link-open").last();
    await expect(open).toBeEnabled({ timeout: 60_000 });
    await open.click();
    const dialog = page.getByRole("dialog");

    // the real sentence of the database: its own closing words, not text of this app
    await expect(dialog.getByText(/Use it only in an assistant that you alone use\./)).toBeVisible({ timeout: 30_000 });
    await dialog.getByLabel("7 days").check();
    await dialog.getByLabel(/Name for this link/).fill(label);
    await dialog.getByTestId("awl-create").click();
    const input = dialog.getByTestId("awl-link");
    await expect(input).toBeVisible({ timeout: 30_000 });
    const link = await input.inputValue();
    expect(link).toMatch(LINK_SHAPE);
    const token = link.slice(link.lastIndexOf("/") + 1);

    await dialog.getByTestId("awl-copy").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

    // the link works for an AI, with no session at all
    const context200 = await request.get(`${link}/context`);
    expect(context200.status()).toBe(200);

    // re-read from the service: the link is listed, active, and no token or hash is in the answer
    const listed = await awlGet(`/links?project=${encodeURIComponent(projectId)}`);
    expect(listed.status()).toBe(200);
    const listedText = await listed.text();
    expect(listedText).not.toContain(token);
    const row = (JSON.parse(listedText).links as Array<Record<string, unknown>>).find((l) => l.label === label);
    expect(row, "the new link must be in the list").toBeTruthy();
    expect(row!.active).toBe(true);
    expect(Object.keys(row!).filter((k) => /token|hash/i.test(k))).toEqual([]);

    // while the dialog is open the input holds the token by design: the check that matters is after Escape
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectTokenNowhere(page, context, token);

    // Revoke through the dialog, then read it back from the service and from the link itself
    await open.click();
    await page.getByRole("dialog").getByRole("button", { name: `Revoke link ${label}` }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: `Revoke link ${label}` })).toHaveCount(0, { timeout: 30_000 });
    const after = await awlGet(`/links?project=${encodeURIComponent(projectId)}`);
    const afterRow = ((await after.json()).links as Array<Record<string, unknown>>).find((l) => l.label === label);
    expect(afterRow!.revoked_at).not.toBeNull();
    expect(afterRow!.active).toBe(false);
    expect((await request.get(`${link}/context`)).status()).toBe(410);
  } finally {
    // Whatever happened above, leave no live link behind: revoke every link this run made (found by its label).
    try {
      const rows = await request.get(`${AWL_URL}/links?project=${encodeURIComponent(createdIn)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const mine = ((await rows.json()).links as Array<{ id: string; label: string | null; active: boolean }>).filter((l) => l.label === runLabel && l.active);
      for (const l of mine) await request.post(`${AWL_URL}/links/${encodeURIComponent(l.id)}/revoke`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    } catch {
      // nothing was created, or the service is unreachable: there is nothing more to clean up from here
    }
    await context.close();
  }
});
