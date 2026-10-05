import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import http from "node:http";
import type { Socket } from "node:net";
import { APP_PORT, stubAppApis } from "./support/boq-local";
import {
  answerSync, deviceMeta, fixtureOf, makePerson, newWorld, personMeta, releaseCaches, signIn, stubSyncService, swPointer, SYNC_BASE,
  type Person, type SyncRequest, type SyncWorld,
} from "./support/lf-lifecycle-stub";

// AUDIT-100 B25 (Safari offline) + B26 (phone install and offline): the install-then-offline path of lf-lifecycle-install.spec.ts, run in
// Playwright's WebKit (Desktop Safari profile), in WebKit with the iPhone 13 profile and in Chromium with the Pixel 5 profile
// (playwright.webkit-phone.config.ts). One test, three engines/devices:
//   1. a brand-new person signs in and opens their BOQ online; the "Preparing your PROJEXA workspace" screen closes only when the release is
//      in Cache Storage, a service worker controls the page and the BOQ lines are in IndexedDB;
//   2. the laptop loses PROJEXA (see "how offline is made" below);
//   3. the BOQ screen opens from the laptop's own copy -- the three lines the server sent, read back from IndexedDB -- and survives a reload;
//   4. on a phone profile, that offline BOQ screen fits the phone's width (no sideways scroll). The HEADER fit at 375 px is lf-lifecycle-ux's.
//
// HONEST LIMITS, also in the config: WebKit-in-Playwright is Safari's ENGINE, not Safari (no Safari app, no iOS/macOS storage policy such as
// the 7-day cap on script-writable storage, no Home Screen install); the phone profiles are emulation in a desktop browser (viewport, touch,
// user agent), not a real phone. What each engine reports for storage persistence is attached to the run as measured, not assumed.
//
//     bunx playwright install webkit
//     bunx playwright test -c playwright.webkit-phone.config.ts
//
// Same rig as the other lf-* specs: production build, local Auth stand-in, sync service answered in the test. Nothing reaches a real network
// -- asserted (no request to the sync host may leave the browser).
//
// TWO MEASURED LIMITS OF PLAYWRIGHT'S WEBKIT (of the rig, not of PROJEXA; probed 2026-10-05 with a 10-line service worker of our own):
//   (a) once a service worker controls the page, WebKit no longer routes the page's requests through context.route / page.route: a fetch
//       to the sync host then goes to the REAL network. So on WebKit the sync service is answered one layer up: the page's own fetch() to
//       the sync host is handed to the same stub logic (answerSync, which stubSyncService uses) through an exposed binding. Only the HTTP
//       hop to the stubbed service is skipped; the app's sync code, the worker, Cache Storage and IndexedDB are all real.
//   (b) context.setOffline(true) in WebKit fails EVERY load, even a Response a service worker builds itself with no network at all (a
//       worker answering `new Response("from-sw")` threw "Load failed" offline; page.goto threw "WebKit encountered an internal error").
//       Real Safari does not do that, so the network switch cannot be used to test Safari offline. HOW OFFLINE IS MADE on WebKit instead:
//       the page talks to PROJEXA through a tiny pass-through server owned by this spec, which is SHUT DOWN (connections refused, open ones
//       cut) -- PROJEXA's server is unreachable, as on a laptop with no internet -- and the sync service refuses too. The browser's own
//       online flag stays true on WebKit (stated, not hidden). On Chromium (Pixel 5) the real network switch is used, as in the other specs.

async function engineFacts(page: Page) {
  return page.evaluate(async () => ({
    userAgent: navigator.userAgent,
    width: window.innerWidth,
    touchPoints: navigator.maxTouchPoints,
    onLine: navigator.onLine,
    controller: Boolean(navigator.serviceWorker?.controller),
    persisted: (await navigator.storage?.persisted?.().catch(() => null)) ?? null,
    estimate: (await navigator.storage?.estimate?.().then((e) => ({ quota: e.quota ?? null, usage: e.usage ?? null })).catch(() => null)) ?? null,
    databases: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((d) => d.name ?? "") : "indexedDB.databases() not supported",
  }));
}

/** WebKit only, limit (a): the page's fetch() to the sync host is answered by answerSync in the test runner. */
async function answerSyncInPage(context: BrowserContext, world: SyncWorld) {
  await context.exposeBinding("pxB4Sync", (_source, req: SyncRequest) => answerSync(world, req));
  await context.addInitScript((base: string) => {
    const real = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (!req.url.startsWith(base)) return real(input, init);
      const headers: Record<string, string> = { origin: location.origin };
      req.headers.forEach((v, k) => { headers[k] = v; });
      const text = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
      let body: unknown;
      try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
      const call = (window as unknown as { pxB4Sync: (r: unknown) => Promise<{ abort?: string; status: number; headers: Record<string, string>; body: string }> }).pxB4Sync;
      const a = await call({ method: req.method, url: req.url, headers, body });
      if (a.abort) throw new TypeError("Load failed");
      return new Response(a.status === 204 ? null : a.body, { status: a.status, headers: a.headers });
    };
  }, SYNC_BASE);
}

/** WebKit only, limit (b): a pass-through to PROJEXA's server that can be shut down (server unreachable). */
async function passThrough(upstreamPort: number) {
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    const up = http.request({ host: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url, headers: { ...req.headers, host: `localhost:${upstreamPort}` } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { res.destroy(); });
    req.pipe(up);
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  let down = false;
  return {
    origin: `http://localhost:${port}`,
    async shutDown() {
      if (down) return;
      down = true;
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const s of sockets) s.destroy();
      await closed;
    },
  };
}

async function openOnlineAndInstall(page: Page, base: string, world: SyncWorld, person: Person) {
  await page.goto(`${base}/scope/${person.boqId}`);
  await expect(page.getByTestId("workspace-prepare"), "the prepare screen never appeared").toBeVisible({ timeout: 60_000 });
  try {
    await expect(page.getByTestId("workspace-prepare")).toHaveCount(0, { timeout: 240_000 });
  } catch (err) {
    throw new Error(`the prepare screen never closed: ${JSON.stringify(await engineFacts(page).catch((e) => String(e)))} | last report: ${JSON.stringify(world.prepares.at(-1) ?? null)}\n${String(err).slice(0, 300)}`);
  }
}

async function assertInstalled(page: Page, userId: string, person: Person) {
  const rel = (await deviceMeta(page, "app:release")) as { version: string } | undefined;
  expect(rel?.version, "IndexedDB meta app:release is not set").toMatch(/^\d{4}\.\d{2}\.\d{2}-\d{3}$/);
  expect(await releaseCaches(page), "Cache Storage holds no px-release-<version>").toEqual([`px-release-${rel!.version}`]);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), "no service worker controls the page").toBe(true);
  expect((await swPointer(page))?.version, "the worker does not point at the installed release").toBe(rel!.version);
  expect(await deviceMeta(page, "persist:state"), "persistent storage was never requested").toMatchObject({ requestedAt: expect.any(Number) });
  expect(await personMeta(page, userId, `sync:done:${person.projectId}:boq_lines`), "the BOQ lines are not in IndexedDB").toBeTruthy();
}

async function assertOfflineBoq(page: Page, person: Person) {
  await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local");
  await expect(page.getByTestId("boq-local-line")).toHaveCount(person.lines.length);
  // the words the server sent, read back from the laptop's own copy (not a count of placeholders)
  for (const l of person.lines) await expect(page.getByTestId("scope-object")).toContainText(l.description);
}

test("install online, then the BOQ screen opens offline from the laptop's own copy and survives a reload", async ({ page, context, browserName }, info) => {
  const tag = `lf-b4-${info.project.name}`;
  const A = makePerson(tag, "lf-org-b4", `B4 ${info.project.name} Tower`, `B4 ${info.project.name} - Structure`);
  const world = newWorld();
  await stubSyncService(context, world);
  const { session } = await signIn(page, context, world, A);
  const webkit = browserName === "webkit";
  // A request event to the sync host on WebKit = a request that left the browser (the binding answers it in-page; nothing should go out).
  const leaked: string[] = [];
  const proxy = webkit ? await passThrough(APP_PORT) : null;
  const base = proxy ? proxy.origin : "";
  if (proxy) {
    await answerSyncInPage(context, world);
    context.on("request", (r) => { if (r.url().startsWith(SYNC_BASE)) leaked.push(`${r.method()} ${r.url()}`); });
    // the page's /api answers for the pass-through origin (before the worker takes over; the local screens below read IndexedDB, not /api)
    await page.unroute("**/api/**");
    await stubAppApis(page, fixtureOf(A), session, proxy.origin);
  }
  const localUrl = `${base}/local/scope/${A.boqId}?projectId=${A.projectId}`;

  try {
    await test.step("install: the prepare screen closes only once the release, the worker and the data are in", async () => {
      await openOnlineAndInstall(page, base, world, A);
      await assertInstalled(page, session.userId, A);
      await info.attach("engine-facts-online.json", { body: JSON.stringify(await engineFacts(page), null, 2), contentType: "application/json" });
    });

    await test.step(webkit ? "PROJEXA unreachable (server shut down, sync refused): the BOQ screen opens from the installed copy" : "network OFF: the BOQ screen opens from the installed copy", async () => {
      world.net = "offline";
      if (proxy) {
        await proxy.shutDown();
        // proven unreachable from the runner itself, not assumed
        await expect(fetch(`${proxy.origin}/login`).then(() => "reached", () => "refused")).resolves.toBe("refused");
      } else {
        await context.setOffline(true);
      }
      await page.goto(localUrl);
      await assertOfflineBoq(page, A);
    });

    await test.step("reload while still cut off: the same lines (nothing came from the network)", async () => {
      await page.reload();
      await assertOfflineBoq(page, A);
      await info.attach("engine-facts-offline.json", { body: JSON.stringify(await engineFacts(page), null, 2), contentType: "application/json" });
    });

    if (info.project.use.isMobile) {
      await test.step("phone: touch device, and the offline BOQ screen does not scroll sideways", async () => {
        // Playwright's WebKit reports maxTouchPoints 0 even with hasTouch (measured on the iPhone 13 profile); touch events are what it emulates
        const touch = await page.evaluate(() => ({ points: navigator.maxTouchPoints, events: "ontouchstart" in window }));
        expect(touch.points > 0 || touch.events, `the phone profile has no touch: ${JSON.stringify(touch)}`).toBe(true);
        // a real tap (Playwright refuses page.tap without touch): on a BOQ line, which must stay on screen afterwards
        await page.getByTestId("boq-local-line").first().tap();
        await expect(page.getByTestId("boq-local-line")).toHaveCount(A.lines.length);
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
        expect(innerWidth).toBeLessThanOrEqual(400);
        expect(scrollWidth, "the offline BOQ screen is wider than the phone").toBeLessThanOrEqual(innerWidth);
      });
    }
  } finally {
    await context.setOffline(false).catch(() => {});
    await proxy?.shutDown();
  }

  expect(leaked, "a request to the sync host left the browser for the real network").toEqual([]);
  expect(world.hits.some((h) => h.route === "pull" && h.status === 200), "the BOQ lines were never pulled from the (stubbed) sync service").toBe(true);
});
