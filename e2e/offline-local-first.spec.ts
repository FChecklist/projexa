import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import { signInLocally, stubAppApis, type AppStub, type LocalSession } from "./support/boq-local";
import type { FixtureLine, ProjectFixture } from "./support/boq-fixture";

// LOCAL-FIRST (R1, R2, R9, R10). PROJEXA keeps working on the laptop with NO internet, and with internet but OUR server down; a person who
// is signed in stays signed in; an edit made offline is sent when the connection is back.
//
// !! WRITTEN TO RUN IN CI, NEVER RUN WHERE IT WAS WRITTEN. The laptop it was authored on has too little free memory for a production build and a
// browser, so this file has been read and typechecked but NOT executed. If it fails, suspect the spec first (a selector, a timeout) and read the
// failure message: every wait below says what it was waiting for.
//
// Runs ONLY through playwright.local-first.config.ts: a PRODUCTION build (the service worker is never registered by `next dev`) with the
// release bundle made by scripts/make-release.mjs, the local Auth stand-in from e2e/support/fake-supabase-server.mjs, and the sync service
// (a Supabase Edge Function) plus every /api call of the page answered here with page.route. Nothing reaches Vercel or any real network.
//
//     bunx playwright test -c playwright.local-first.config.ts
//
// "Offline" means both the browser's own switch (context.setOffline) and this file refusing every stubbed request, because a route that
// fulfils a request answers even while the browser believes it is offline.

// Written out in full on purpose: the spec must fail if src/lib/local-first/sync-client.ts names a different address.
const SYNC_BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync";

const PROJECT_ID = "lf-project-1";
const PROJECT_NAME = "Cedar Heights Villa";
const BOQ_ID = "lf-boq-current";
const BOQ_TITLE = "Cedar Heights - Structure";
const OTHER_BOQ_ID = "lf-boq-mep";

type Net = { mode: "up" | "down" | "offline" };

function line(n: number, boqId: string, boqTitle: string, boqVersion: number, boqStatus: string): FixtureLine {
  return {
    id: `lf-line-${n}`, boqId, boqTitle, boqVersion, boqStatus, parentLineItemId: null, activityId: null, itemCode: `CH-${n}`, category: "",
    description: `Slab item ${n}`, unit: "m2", quantity: "10", rate: "12.50", amount: "125.00", createdAt: `2026-09-0${n}T00:00:00Z`,
  };
}

const LINES: FixtureLine[] = [
  line(1, BOQ_ID, BOQ_TITLE, 2, "approved"),
  line(2, BOQ_ID, BOQ_TITLE, 2, "approved"),
  line(3, BOQ_ID, BOQ_TITLE, 2, "approved"),
  line(4, OTHER_BOQ_ID, "Cedar Heights - MEP", 1, "draft"),
];

const FIXTURE = {
  projectId: PROJECT_ID,
  boqId: BOQ_ID,
  boqTitle: BOQ_TITLE,
  lines: LINES,
  header: { id: BOQ_ID, projectId: PROJECT_ID, version: 2, title: BOQ_TITLE, status: "approved", parentBoqId: null, createdAt: "2026-08-28T00:00:00.000Z" },
  expected: { total: LINES.length, own: 3, formworkInProject: 0 },
} as unknown as ProjectFixture;

const CORS = (origin: string | undefined) => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-headers": "authorization, content-type, x-px-client, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  vary: "Origin",
});

/** Answers the sync service the way docs/local-first/CONTRACT.md says, from the fixture. */
async function stubSyncService(page: Page, who: LocalSession, net: Net) {
  const served: string[] = [];
  const json = (route: Route, origin: string | undefined, body: unknown, status = 200) =>
    route.fulfill({ status, headers: { ...CORS(origin), "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) });

  await page.route(`${SYNC_BASE}/**`, async (route, request) => {
    const origin = request.headers()["origin"];
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS(origin) });
    if (net.mode !== "up") return route.abort(net.mode === "offline" ? "internetdisconnected" : "connectionrefused");
    const path = new URL(request.url()).pathname.slice("/functions/v1/projexa-sync".length);
    served.push(`${request.method()} ${path}`);
    if (request.method() === "GET" && path === "/manifest") {
      return json(route, origin, {
        user: { id: who.userId, name: "Asha Rao", role: "owner", org_id: "lf-org-1" },
        projects: [{ id: PROJECT_ID, name: PROJECT_NAME, status: "active" }],
        kinds: [{ kind: "boq_lines", project_scoped: true, cursor_field: "updated_at", deletes_supported: true }],
        view_class: "0123456789abcdef",
        release: { current: null, min_compatible: null, protocol: 2 },
        server_time: new Date().toISOString(),
      });
    }
    if (request.method() === "POST" && path === "/pull") {
      const body = request.postDataJSON() as { project_id?: string; kind?: string; ids?: string[] };
      if (body.project_id !== PROJECT_ID || body.kind !== "boq_lines") return json(route, origin, { error: "not found" }, 404);
      const rows = body.ids ? LINES.filter((l) => body.ids!.includes(l.id)) : LINES;
      return json(route, origin, {
        items: rows.map((l) => ({ id: l.id, updated_at: l.createdAt, version: 1, data: l, sig: null })),
        kid: null, next_cursor: null, has_more: false, hidden_fields: [], redacted: false, server_time: new Date().toISOString(),
      });
    }
    if (request.method() === "POST" && path === "/changes") return json(route, origin, { changes: [], next_seq: 0, has_more: false, head_seq: 0, server_time: new Date().toISOString() });
    if (request.method() === "POST" && path === "/ids") return json(route, origin, { ids: LINES.map((l) => l.id), has_more: false, next_id: null });
    if (request.method() === "GET" && path === "/release/current") return json(route, origin, { current: null, min_compatible: null, registered: true });
    if (request.method() === "POST" && (path === "/release/register" || path === "/install")) return json(route, origin, { ok: true });
    return json(route, origin, { error: "not part of the local stub" }, 404);
  });
  return { served };
}

type Patch = { path: string; body: unknown };

/** Records every PATCH of a BOQ line and answers it, unless the network is "down" or "offline". */
async function stubLineEdits(page: Page, net: Net) {
  const patches: Patch[] = [];
  await page.route("**/api/scope/line-items/**", async (route, request) => {
    if (request.method() !== "PATCH") return route.fallback();
    if (net.mode !== "up") return route.abort(net.mode === "offline" ? "internetdisconnected" : "connectionrefused");
    patches.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "x", category: (request.postDataJSON() as { category?: string }).category ?? null }) });
  });
  return patches;
}

// ─── reading what is really stored on the laptop ───────────────────────────────────────────────

function readMeta(page: Page, dbName: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, key }) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => resolve(undefined);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("meta")) { db.close(); resolve(undefined); return; }
          const get = db.transaction("meta", "readonly").objectStore("meta").get(key);
          get.onerror = () => { db.close(); resolve(undefined); };
          get.onsuccess = () => { db.close(); resolve((get.result as { value?: unknown } | undefined)?.value); };
        };
      }),
    { dbName, key }
  );
}

const deviceMeta = (page: Page, key: string) => readMeta(page, "projexa-local", key);
const personMeta = (page: Page, userId: string, key: string) => readMeta(page, `projexa-local:${userId}`, key);

// ─── getting a laptop into the "prepared" state, the way a person does ─────────────────────────

async function prepareLaptop(page: Page, context: BrowserContext, net: Net) {
  const session = await signInLocally(context, "local-first-spec@example.invalid");
  const sync = await stubSyncService(page, session, net);
  const app = await stubAppApis(page, FIXTURE, session);
  const patches = await stubLineEdits(page, net);

  await test.step("online: open the app; the first-run screen prepares the workspace and finishes", async () => {
    await page.goto(`/scope/${BOQ_ID}`);
    await expect(page.getByTestId("prepare-percent"), "the 'Preparing your workspace' screen never reached 100%").toHaveText("100%", { timeout: 240_000 });
    await page.getByTestId("prepare-continue").click();
  });

  await test.step("the quiet boot leaves the release, the identity and the project names on the laptop", async () => {
    await expect
      .poll(() => deviceMeta(page, "app:release"), { timeout: 240_000, message: "the release was never installed (meta app:release)" })
      .toMatchObject({ version: expect.stringMatching(/^\d{4}\.\d{2}\.\d{2}-\d{3}$/) });
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith("px-release-"))), { message: "no px-release-<version> cache exists" })
      .toHaveLength(1);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("px-identity-v1")), { message: "the identity was never mirrored to localStorage" })
      .toContain(session.userId);
    await expect
      .poll(() => deviceMeta(page, `shell:manifest:${session.userId}`), { timeout: 60_000, message: "the project names were never cached" })
      .toMatchObject({ projects: [{ id: PROJECT_ID, name: PROJECT_NAME }] });
    await expect
      .poll(() => personMeta(page, session.userId, `sync:done:${PROJECT_ID}:boq_lines`), { timeout: 120_000, message: "the BOQ lines were never copied to the laptop" })
      .toBeTruthy();
  });

  await test.step("the page is controlled by the service worker (reload once, online)", async () => {
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { message: "the service worker does not control the page" })
      .toBe(true);
  });

  return { session, sync, patches, app };
}

/** Sets what the stubs do and, for a real outage of the browser, the browser's own switch. */
function setNetwork(net: Net, app: AppStub, mode: Net["mode"]) {
  net.mode = mode;
  app.setOffline(mode !== "up");
}

async function goOffline(context: BrowserContext, net: Net, app: AppStub) {
  setNetwork(net, app, "offline");
  await context.setOffline(true);
}

async function goOnline(context: BrowserContext, net: Net, app: AppStub) {
  setNetwork(net, app, "up");
  await context.setOffline(false);
}

// Next.js itself mounts ONE empty role="alert" element on every App Router page, its route announcer (id __next-route-announcer__, in
// node_modules/next/dist/client/components/app-router-announcer.js), that reads the new page title to a screen reader after a client
// navigation. It is not an error and not ours, so it is the only alert excluded; any other dialog or alert still fails the test.
const noDialog = async (page: Page) => {
  await expect(
    page.locator('[role="dialog"], [role="alertdialog"], [role="alert"]:not(#__next-route-announcer__)'),
    "an error or dialog appeared for being offline"
  ).toHaveCount(0);
};

// ─── the tests ─────────────────────────────────────────────────────────────────────────────────

test("R1: with NO internet the app opens from the laptop, shows the BOQ from the local database, and an edit made offline is sent when it is back", async ({ page, context }) => {
  const net: Net = { mode: "up" };
  const { session, patches, app } = await prepareLaptop(page, context, net);

  await goOffline(context, net, app);
  expect(await page.evaluate(() => navigator.onLine), "the browser still thinks it is online").toBe(false);

  await test.step("offline: the shell opens, signed in, from the laptop", async () => {
    await page.goto(`/local/scope?projectId=${PROJECT_ID}`);
    await expect(page.getByTestId("scope-list")).toBeVisible();
    await expect(page.getByTestId("scope-list")).toHaveAttribute("data-state", "local");
    await expect(page.getByTestId("scope-list-row").filter({ hasText: BOQ_TITLE })).toHaveCount(1);
    await expect(page.getByTestId("local-shell-project")).toContainText(PROJECT_NAME);
    await expect(page.getByTestId("local-shell-person")).toHaveText("local-first-spec@example.invalid");
    await expect(page.getByTestId("connectivity-marker")).toHaveText("Working on this laptop; will sync when connected");
    await noDialog(page);
  });

  await test.step("offline: a reload still opens it (the service worker serves the cached shell)", async () => {
    await page.reload();
    await expect(page.getByTestId("scope-list-row").filter({ hasText: BOQ_TITLE })).toHaveCount(1);
  });

  await test.step("offline: the BOQ screen renders its lines from the local database", async () => {
    await page.getByTestId("scope-list-row").filter({ hasText: BOQ_TITLE }).getByRole("link").click();
    await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local");
    await expect(page.getByTestId("boq-local-title")).toHaveText(BOQ_TITLE);
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
    // the app's own URL works too, not only /local/...: the worker answers any app navigation with the shell while offline
    await page.goto(`/scope/${BOQ_ID}?projectId=${PROJECT_ID}`);
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
    await noDialog(page);
  });

  await test.step("offline: an edit is kept on the laptop, shown at once, and NOT sent", async () => {
    await page.getByTestId("boq-line-category-input").first().fill("Steel");
    await page.getByTestId("boq-line-save").click();
    await expect(page.getByTestId("boq-line-waiting")).toHaveText("Waiting to sync");
    expect(patches, "an edit was sent while the laptop was offline").toHaveLength(0);
    // the outcome PERSISTED: read back from IndexedDB, not from the screen
    expect(await personMeta(page, session.userId, "shell:edits")).toEqual([expect.objectContaining({ lineId: "lf-line-1", patch: { category: "Steel" } })]);
    // and it survives a reload
    await page.reload();
    await expect(page.getByTestId("boq-line-waiting")).toHaveText("Waiting to sync");
    await expect(page.getByTestId("boq-line-category-input").first()).toHaveValue("Steel");
  });

  await test.step("back online: it syncs by itself, once, as the person's intent only", async () => {
    await goOnline(context, net, app);
    await expect.poll(() => patches.length, { timeout: 90_000, message: "the offline edit was never sent after the laptop came back online" }).toBe(1);
    expect(patches[0]).toEqual({ path: "/api/scope/line-items/lf-line-1", body: { category: "Steel" } });
    await expect(page.getByTestId("boq-line-waiting")).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(() => personMeta(page, session.userId, "shell:edits"), { message: "the sent edit is still stored as waiting" }).toEqual([]);
  });
});

test("R2: with internet but OUR server down (sync service and /api refused) the app keeps working, an edit waits, and it syncs when the server is back", async ({ page, context }) => {
  const net: Net = { mode: "up" };
  const { session, patches, app } = await prepareLaptop(page, context, net);

  setNetwork(net, app, "down"); // the browser is online; the sync Edge Function and every /api call are refused

  await test.step("server down: the shell and the BOQ open from the laptop with no error dialog", async () => {
    await page.goto(`/local/scope/${BOQ_ID}?projectId=${PROJECT_ID}`);
    await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local");
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
    await noDialog(page);
  });

  await test.step("server down: an edit is kept and waits, nothing is lost", async () => {
    await page.getByTestId("boq-line-category-input").nth(1).fill("Civil");
    await page.getByTestId("boq-line-save").click();
    await expect(page.getByTestId("boq-line-waiting")).toHaveText("Waiting to sync");
    expect(await personMeta(page, session.userId, "shell:edits")).toEqual([expect.objectContaining({ lineId: "lf-line-2", patch: { category: "Civil" } })]);
    await noDialog(page);
  });

  await test.step("the server is back: coming back to the tab sends it", async () => {
    setNetwork(net, app, "up");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => patches.length, { timeout: 90_000, message: "the edit was never sent after the server came back" }).toBe(1);
    expect(patches[0]).toEqual({ path: "/api/scope/line-items/lf-line-2", body: { category: "Civil" } });
    await expect.poll(() => personMeta(page, session.userId, "shell:edits")).toEqual([]);
  });
});

test("R9: once signed in the person stays signed in: a lost cookie and a dead sign-in service do not send them to /login", async ({ page, context }) => {
  const net: Net = { mode: "up" };
  const { session, app } = await prepareLaptop(page, context, net);

  await test.step("the session cookie is gone (a browser that drops script-written cookies) and the sign-in service refuses everything", async () => {
    await context.clearCookies();
    await page.route(/localhost:\d+\/auth\/v1\//, (route) => route.abort("connectionrefused"));
    await goOffline(context, net, app);
  });

  await test.step("offline, with no cookie: the app still opens as the same person, from the identity kept on the laptop", async () => {
    await page.goto(`/local/scope?projectId=${PROJECT_ID}`);
    await expect(page.getByTestId("local-shell-person")).toHaveText("local-first-spec@example.invalid");
    await expect(page).toHaveURL(/\/local\/scope/); // not /login
    await expect(page.getByTestId("local-shell-signed-out")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("px-identity-v1"))).toContain(session.userId);
  });
});

test("R10: the app asks the browser to keep its storage, and puts the release back if the cache is missing", async ({ page, context }) => {
  const net: Net = { mode: "up" };
  await prepareLaptop(page, context, net);

  await test.step("persistent storage was requested once and the outcome recorded", async () => {
    await expect
      .poll(() => deviceMeta(page, "persist:state"), { timeout: 60_000, message: "persist() was never requested/recorded" })
      .toMatchObject({ requestedAt: expect.any(Number) });
  });

  await test.step("the release cache is deleted (as a browser under storage pressure would) and a reload, online, installs it again", async () => {
    await page.evaluate(async () => { for (const name of await caches.keys()) if (name.startsWith("px-release-")) await caches.delete(name); });
    expect(await page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith("px-release-")).length)).toBe(0);
    await page.reload();
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith("px-release-")).length), { timeout: 240_000, message: "the missing release was not silently installed again" })
      .toBe(1);
  });
});
