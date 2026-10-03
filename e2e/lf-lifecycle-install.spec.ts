import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP_ORIGIN, stubAppApis } from "./support/boq-local";
import {
  deviceMeta, fixtureOf, makePerson, newWorld, releaseCaches, signIn, stubSyncService, swPointer,
  type Person, type SyncWorld,
} from "./support/lf-lifecycle-stub";

// LOCAL-FIRST "Option C" (owner decision 2026-10-03): PROJEXA is INSTALLED into the browser on a person's first login (case 1: a brand-new user)
// and on the first login on a new machine (case 2: the same user in a second, empty browser profile) -- the PWA path, no .exe: the release
// in Cache Storage, a service worker controlling the page, persistent storage asked for, the person's data in IndexedDB. The "Preparing your
// PROJEXA workspace" screen must not close before ALL of that is true; the moment it closes, this spec looks (no polling grace period for the
// install: the old behaviour opened PROJEXA at 100% and the release arrived seconds later, or never).
//
//     bunx playwright test -c playwright.local-first.config.ts lf-lifecycle-install
//
// Real Chromium, production build, local Auth stand-in, sync service answered inside the browser (see e2e/support/lf-lifecycle-stub.ts).
// Nothing reaches Vercel or any real network.

async function assertInstalled(page: Page, context: BrowserContext, world: SyncWorld, person: Person, userId: string) {
  // The screen has just closed: everything it promised is already there.
  const rel = (await deviceMeta(page, "app:release")) as { version: string; manifest_sha256: string } | undefined;
  expect(rel?.version, "IndexedDB meta app:release is not set").toMatch(/^\d{4}\.\d{2}\.\d{2}-\d{3}$/);
  expect(await releaseCaches(page), "Cache Storage holds no px-release-<version>").toEqual([`px-release-${rel!.version}`]);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), "no service worker controls the page").toBe(true);
  expect((await swPointer(page))?.version, "the worker does not point at the installed release").toBe(rel!.version);
  expect(await deviceMeta(page, "persist:state"), "persistent storage was never requested").toMatchObject({ requestedAt: expect.any(Number) });
  expect(
    await page.evaluate((id) => localStorage.getItem(`px-workspace-ready-v1:${id}`), userId),
    "the ready flag is missing"
  ).not.toBeNull();
  // the data (IndexedDB replica) is in
  const done = await page.evaluate(
    ({ db, key }) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open(db);
        open.onerror = () => resolve(undefined);
        open.onsuccess = () => {
          const d = open.result;
          if (!d.objectStoreNames.contains("meta")) { d.close(); resolve(undefined); return; }
          const g = d.transaction("meta", "readonly").objectStore("meta").get(key);
          g.onsuccess = () => { d.close(); resolve(g.result); };
          g.onerror = () => { d.close(); resolve(undefined); };
        };
      }),
    { db: `projexa-local:${userId}`, key: `sync:done:${person.projectId}:boq_lines` }
  );
  expect(done, "the person's data is not in IndexedDB").toBeTruthy();

  // Going offline: the module's /local shell is served from the installed copy.
  world.net = "offline";
  await context.setOffline(true);
  await page.goto(`/local/scope/${person.boqId}?projectId=${person.projectId}`);
  await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local");
  await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
  await context.setOffline(false);
  world.net = "up";
  return rel!.version;
}

async function openAndWaitForInstall(page: Page, world?: SyncWorld) {
  const dialog = page.getByTestId("workspace-prepare");
  const logs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => logs.push(`pageerror: ${String(e).slice(0, 200)}`));
  await expect(dialog, "the prepare screen never appeared").toBeVisible({ timeout: 60_000 });
  await expect(dialog.locator("button, li, a"), "the screen is only the sentence and the percentage").toHaveCount(0);
  try {
    await expect(dialog).toHaveCount(0, { timeout: 240_000 });
  } catch (err) {
    const state = await page
      .evaluate(async () => ({
        controller: Boolean(navigator.serviceWorker.controller),
        caches: await caches.keys(),
        percent: document.querySelector('[data-testid="prepare-percent"]')?.textContent,
        dbs: (await indexedDB.databases()).map((d) => d.name),
        regs: (await navigator.serviceWorker.getRegistrations()).map((r) => ({ scope: r.scope, active: r.active?.state, waiting: r.waiting?.state, installing: r.installing?.state })),
        nav: (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type,
      }))
      .catch((e) => ({ evalFailed: String(e) }));
    throw new Error(`the prepare screen never closed. page: ${JSON.stringify(state)} | last report: ${JSON.stringify(world?.prepares.at(-1) ?? null)} | reports: ${world?.prepares.length} | console: ${JSON.stringify(logs.slice(-8))}
${String(err).slice(0, 200)}`);
  }
}

test("case 1: a brand-new login installs PROJEXA into the browser before the prepare screen closes", async ({ page, context }) => {
  const A = makePerson("inst1", "lf-org-1", "Install Point Tower", "Install Point - Structure");
  const world = newWorld();
  await stubSyncService(context, world);
  const { session } = await signIn(page, context, world, A);
  await page.goto(`/scope/${A.boqId}`);
  await openAndWaitForInstall(page, world);
  const version = await assertInstalled(page, context, world, A, session.userId);
  // the registry was told once
  await expect.poll(() => world.installs.length).toBeGreaterThanOrEqual(1);
  expect(world.installs[0]).toMatchObject({ release_version: version, status: "installed" });
  expect(world.prepares.at(-1)).toMatchObject({ stage: "done", percent: 100 });
});

test("case 2: the same user's first login on a new machine (empty storage) installs it again", async ({ page, context, browser }) => {
  const A = makePerson("inst2", "lf-org-1", "Second Machine Tower", "Second Machine - Structure");
  const world = newWorld();
  await stubSyncService(context, world);
  const first = await signIn(page, context, world, A);
  await page.goto(`/scope/${A.boqId}`);
  await openAndWaitForInstall(page, world);
  await assertInstalled(page, context, world, A, first.session.userId);

  // A second, completely empty browser profile = another machine. Same account (the same session cookie), nothing stored.
  const machine2 = await newMachine(browser, test.info().project.use.baseURL!);
  try {
    await stubSyncService(machine2.context, world);
    expect(await releaseCaches(await blank(machine2.page)), "the new machine must start with nothing installed").toEqual([]);
    await machine2.context.addCookies([{ name: first.session.cookieName, value: first.session.cookieValue, url: APP_ORIGIN }]);
    await stubAppApis(machine2.page, fixtureOf(A), first.session);
    await machine2.page.goto(`/scope/${A.boqId}`);
    await openAndWaitForInstall(machine2.page, world);
    await assertInstalled(machine2.page, machine2.context, world, A, first.session.userId);
    expect(world.installs.length, "each machine tells the registry about its own install").toBeGreaterThanOrEqual(2);
  } finally {
    await machine2.context.close();
  }
});

test("an install that cannot finish (release unreachable) keeps the screen up, reports why, retries, and opens only once it is installed", async ({ page, context }) => {
  const A = makePerson("inst3", "lf-org-1", "Retry Tower", "Retry - Structure");
  const world = newWorld();
  await stubSyncService(context, world);
  let blocked = true;
  let manifestHits = 0;
  await context.route("**/_release/release.json", (route) => {
    manifestHits += 1;
    if (blocked) return route.abort("connectionrefused");
    return route.continue();
  });
  const { session } = await signIn(page, context, world, A);
  await page.goto(`/scope/${A.boqId}`);
  const dialog = page.getByTestId("workspace-prepare");
  await expect(dialog).toBeVisible({ timeout: 60_000 });

  await test.step("it is told, with the app stage and a reason, and the person is not let in", async () => {
    await expect
      .poll(() => world.prepares.some((p) => p.stage === "app" && (p.status === "failed" || p.status === "retrying")), { timeout: 150_000, message: "we were never told the app install failed" })
      .toBe(true);
    const failure = world.prepares.find((p) => p.stage === "app" && (p.status === "failed" || p.status === "retrying"))!;
    expect(failure.error_class).toBe("download_failed");
    expect(String(failure.error_detail)).toContain("manifest_unreachable");
    await expect(dialog).toBeVisible();
    expect(await releaseCaches(page)).toEqual([]);
    expect(await deviceMeta(page, "app:release")).toBeUndefined();
  });

  await test.step("it retries by itself", async () => {
    const hits = manifestHits;
    await expect.poll(() => manifestHits, { timeout: 120_000, message: "no retry of the install" }).toBeGreaterThan(hits);
  });

  await test.step("the release becomes reachable: it installs, then opens", async () => {
    blocked = false;
    await expect(dialog).toHaveCount(0, { timeout: 240_000 });
    await assertInstalled(page, context, world, A, session.userId);
  });
});

async function newMachine(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL, serviceWorkers: "allow" });
  const page = await context.newPage();
  return { context, page };
}

/** Lands on the app's origin without a session so Cache Storage / IndexedDB can be inspected; resolves the same page. */
async function blank(page: Page) {
  await page.goto("/login");
  return page;
}
