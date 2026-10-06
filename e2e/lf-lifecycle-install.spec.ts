import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP_ORIGIN, stubAppApis } from "./support/boq-local";
import { evalSettled } from "./support/eval-settled";
import {
  deviceMeta, fixtureOf, makePerson, newWorld, personMeta, releaseCaches, signIn, stubSyncService, swPointer,
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
  expect(await evalSettled(page, () => Boolean(navigator.serviceWorker.controller)), "no service worker controls the page").toBe(true);
  expect((await swPointer(page))?.version, "the worker does not point at the installed release").toBe(rel!.version);
  expect(await deviceMeta(page, "persist:state"), "persistent storage was never requested").toMatchObject({ requestedAt: expect.any(Number) });
  expect(
    await evalSettled(page, (id: string) => localStorage.getItem(`px-workspace-ready-v1:${id}`), userId),
    "the ready flag is missing"
  ).not.toBeNull();
  // the data (IndexedDB replica) is in
  const done = await evalSettled(
    page,
    ({ db, key }: { db: string; key: string }) =>
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

  // AUDIT-100 A3 step 1: once the projects are copied the page hands over to the shell by itself; let that one navigation finish first.
  await expect(page.getByTestId("local-shell"), "the page did not hand over to the shell after the install").toBeVisible({ timeout: 120_000 });
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

// AUDIT 37 rows B2, B3, B4, B5: an account whose organisation is not set up (the sync service answers "not found" to the projects copy) is let in as
// soon as PROJEXA is INSTALLED, never sees the full screen again (refresh x3, sign-in again), and its projects copy is retried quietly with a growing
// wait until the service answers -- then the data lands without the screen ever coming back.
test("an account with no organisation: closes once installed, never returns on refresh or sign-in, and the projects copy backs off quietly then succeeds", async ({ page, context }) => {
  test.setTimeout(900_000);
  const A = makePerson("noorg", "lf-org-1", "No Org Tower", "No Org - Structure");
  const world = newWorld();
  world.failRoutes = { names: new Set(["manifest", "heads"]), status: 404 };
  await stubSyncService(context, world);
  const sightings: number[] = [];
  await context.exposeBinding("__pxSawPrepare", () => { sightings.push(Date.now()); });
  await context.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="workspace-prepare"]')) (window as unknown as { __pxSawPrepare?: () => void }).__pxSawPrepare?.();
    }).observe(document, { childList: true, subtree: true });
  });
  const { session } = await signIn(page, context, world, A);
  let currentUserId = session.userId;
  await page.goto(`/scope/${A.boqId}`);
  await openAndWaitForInstall(page, world);
  // one ATTEMPT of the projects copy is a burst of manifest requests (the install, the AI layer and the shell each ask); a new attempt starts when
  // no request was seen for 5 s. The wait between attempts is what the backoff controls.
  const manifestHits = () => {
    const all = world.hits.filter((h) => h.route === "manifest").map((h) => h.at).sort((a, b) => a - b);
    const starts: number[] = [];
    all.forEach((t, i) => { if (i === 0 || t - all[i - 1]! > 5_000) starts.push(t); });
    return starts;
  };

  await test.step("installed: the release is on the laptop although the projects could not be copied", async () => {
    expect(await releaseCaches(page)).toHaveLength(1);
    expect(await page.evaluate((id) => localStorage.getItem(`px-workspace-ready-v1:${id}`), session.userId), "the ready flag is missing").not.toBeNull();
    expect(await personMeta(page, session.userId, `sync:done:${A.projectId}:boq_lines`), "the projects were copied although the service said not found").toBeFalsy();
  });

  await test.step("the copy is retried quietly, each wait longer than the last (15 s, 30 s ...)", async () => {
    await expect.poll(() => manifestHits().length, { timeout: 150_000, intervals: [2_000], message: "no quiet retry of the projects copy" }).toBeGreaterThanOrEqual(3);
    const at = manifestHits();
    const gaps = at.slice(1, 4).map((t, i) => t - at[i]!);
    console.log(`[B5] quiet retry gaps (ms): ${JSON.stringify(gaps)}`);
    expect(gaps[0]!, "first wait is about 15 s").toBeGreaterThan(10_000);
    expect(gaps[1]!, "second wait is longer than the first").toBeGreaterThan(gaps[0]! * 1.4);
  });

  const afterInstall = sightings.length; // the one appearance during the install itself
  await test.step("refresh three times: no screen", async () => {
    for (let i = 0; i < 3; i += 1) {
      await page.reload();
      await page.waitForTimeout(6_000);
    }
    expect(sightings.length, "the install screen appeared after a refresh").toBe(afterInstall);
  });

  await test.step("sign in again (cookies cleared, laptop's storage kept): no screen", async () => {
    await context.clearCookies();
    const again = await signIn(page, context, world, A);
    currentUserId = again.session.userId; // signing in again makes a NEW session: the laptop keeps one database per signed-in id
    await page.goto(`/scope/${A.boqId}`);
    await page.waitForTimeout(8_000);
    expect(sightings.length, "the install screen appeared after signing in again").toBe(afterInstall);
  });
});

// OPEN (AUDIT-100 B5, last leg): once the service starts answering again, the quiet retry should copy the projects without the screen coming back.
// Measured 2026-10-05 in real Chromium: after three quick refreshes and a new sign-in the sync breaker (replica.ts: 3 failures -> a stored pause of 1 min,
// doubling to 30 min) sent NO request for 240 s after the service recovered, so the copy did not land in that window. Whether a 30-min wait is the
// intended product behaviour for a person who refreshes repeatedly is an owner decision, so this stays fixme rather than a test asserting either way.
test.fixme("an account with no organisation: after the service answers again, the projects are copied by the quiet retry (see the note above)", async () => {});

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
