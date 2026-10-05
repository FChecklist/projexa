import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deviceMeta, makePerson, newWorld, numbered, prepareLaptop, releaseCaches, signIn, stubSyncService, swPointer, watchConsole, type BuiltRelease,
} from "./support/lf-lifecycle-stub";
import { APP_HOST, leftTheLaptop, trackTraffic, type Seen } from "./support/lf-vercel-budget";

// AUDIT-100 B60 (static bundle and shell on free Cloudflare Pages) and A3 (Vercel used as little as possible), in a real Chromium on a
// PRODUCTION build made with the ONE switch on: NEXT_PUBLIC_PX_STATIC_BASE = a separate static host (e2e/support/static-host-server.mjs,
// a different origin, standing in for the Pages project; its folder is staged by scripts/stage-static-pages.mjs, the same script that
// stages the real upload).
//
//     bunx playwright test -c playwright.static-host.config.ts
//
// Proved here: (1) from sign-in through install, daily use and a reload, the browser fetches ZERO static files (/_next/static/**,
// /_release/**, the release's public files) from the app origin -- every one comes from the static host or the laptop's own copy;
// (2) the installed app then works with the network OFF (the worker answers the static host's addresses from the verified release);
// (3) the hashes are still checked: a static host that drops the bundle or serves ONE wrong byte is refused, nothing is installed, and
// the real bytes install on the next start.

const ROOT = process.cwd();
const A = makePerson("b60", "lf-org-b60", "Static Host Tower", "Static Host - Structure");
// the same address playwright.static-host.config.ts builds the app with (NEXT_PUBLIC_PX_STATIC_BASE)
const STATIC_ORIGIN = `http://127.0.0.1:${Number(process.env.STATIC_HOST_PORT ?? 3198)}`;
const STATIC_HOST = new URL(STATIC_ORIGIN).host;

function releaseN(): BuiltRelease["manifest"] {
  return JSON.parse(readFileSync(join(ROOT, "public", "_release", "release.json"), "utf8")) as BuiltRelease["manifest"];
}

async function ctl(body: Record<string, unknown>) {
  const res = await fetch(`${STATIC_ORIGIN}/__ctl`, { method: "POST", body: JSON.stringify(body) });
  expect(res.ok, "the static host stand-in did not take the control request").toBe(true);
}

async function hostLog(): Promise<{ path: string; status: number }[]> {
  return (await (await fetch(`${STATIC_ORIGIN}/__log`)).json()) as { path: string; status: number }[];
}

/** The static files the app origin must never be asked for: everything under /_next/static and /_release, and every public file of the release. */
function isAppStatic(s: Seen, releasePaths: Set<string>): boolean {
  if (new URL(s.url).host !== APP_HOST) return false;
  return s.path.startsWith("/_next/static/") || s.path.startsWith("/_release/") || releasePaths.has(s.path);
}

async function openLocalBoq(page: Page) {
  await page.goto(`/local/scope/${A.boqId}?projectId=${A.projectId}`);
  await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local");
  await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
}

test.beforeEach(async () => {
  await ctl({ resetLog: true });
});

test("B60: with the static host switched on, install + daily use fetch ZERO static files from the app origin, the app works offline, and every byte is verified", async ({ page, context }) => {
  test.setTimeout(480_000);
  const console_ = watchConsole(page);
  const n = releaseN();
  const releasePaths = new Set(n.files.filter((f) => !f.path.startsWith("_shell/")).map((f) => `/${f.path}`));
  const world = newWorld();
  world.release.current = numbered(n, null);
  await stubSyncService(context, world);
  const traffic = trackTraffic(context);

  await prepareLaptop(page, context, world, A);

  await test.step("the page's code comes from the static host (assetPrefix), not the app origin", async () => {
    const srcs = await page.evaluate(() => [...document.querySelectorAll("script[src], link[rel=stylesheet]")].map((e) => (e as HTMLScriptElement).src || (e as HTMLLinkElement).href));
    const code = srcs.filter((u) => u.includes("/_next/static/"));
    expect(code.length, "no script or stylesheet on the page").toBeGreaterThan(0);
    expect(code.filter((u) => !u.startsWith(`${STATIC_ORIGIN}/_next/static/`)), "a script or stylesheet NOT on the static host").toEqual([]);
  });

  await test.step("the release was installed from the static host and verified: every file in the laptop's cache, the install recorded", async () => {
    expect(await deviceMeta(page, "app:release")).toMatchObject({ version: n.release_version, manifest_sha256: n.manifest_sha256, files: n.files.length });
    expect(await releaseCaches(page)).toEqual([`px-release-${n.release_version}`]);
    const cached = await page.evaluate(async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname), `px-release-${n.release_version}`);
    expect(cached.length).toBe(n.files.length);
    expect(cached.every((p) => p.startsWith("/") && !p.includes(STATIC_HOST)), "the cache keys must be the app-origin paths").toBe(true);
    await expect.poll(() => world.installs.length).toBe(1);
    expect(world.installs[0]).toMatchObject({ release_version: n.release_version, manifest_sha256: n.manifest_sha256, status: "installed" });
    const log = await hostLog();
    expect(log.filter((l) => l.path === "/_release/release.json" && l.status === 200).length, "release.json was not read from the static host").toBeGreaterThan(0);
    expect(log.filter((l) => l.path === `/${n.bundle.path}` && l.status === 200).length, "the bundle was not downloaded from the static host").toBe(1);
  });

  await test.step("daily use online: the shell and its BOQ open from the laptop", async () => {
    await openLocalBoq(page);
    await page.reload();
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
  });

  await test.step("the network OFF (the static host unreachable too): the installed app still opens, answered from the verified release", async () => {
    world.net = "offline";
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
    const logo = page.locator(`img[src="${STATIC_ORIGIN}/logo-mark.svg"]`);
    if (await logo.count()) await expect.poll(() => logo.first().evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.goto(`/local?projectId=${A.projectId}`);
    await expect(page.getByTestId("local-shell-home")).toBeVisible({ timeout: 30_000 });
    await context.setOffline(false);
    world.net = "up";
  });

  traffic.stop();
  await test.step("MEASURED: zero static files from the app origin over the whole session; the static host carried them", async () => {
    const left = leftTheLaptop(traffic.all);
    const fromApp = left.filter((s) => isAppStatic(s, releasePaths)).map((s) => s.path);
    const fromStatic = left.filter((s) => new URL(s.url).host === STATIC_HOST);
    const fromCache = traffic.all.filter((s) => new URL(s.url).host === STATIC_HOST && s.answeredBySw && !s.fromSw);
    console.log(`B60 measured: app-origin static=${fromApp.length} static-host requests=${fromStatic.length} static-host answered from the laptop=${fromCache.length} release files=${n.files.length}`);
    expect(fromApp, "a static file was fetched from the app origin (Vercel in production)").toEqual([]);
    expect(fromStatic.length, "nothing was fetched from the static host").toBeGreaterThan(0);
    expect(fromCache.length, "the worker never answered a static-host address from the laptop's copy").toBeGreaterThan(0);
  });

  expect(await swPointer(page)).toMatchObject({ version: n.release_version });
  expect(console_.unexpected(), "unexpected console errors").toEqual([]);
});

test("B60: a static host that DROPS the bundle or serves ONE wrong byte is refused (nothing installed), and the real bytes install on the next start", async ({ page, context }) => {
  test.setTimeout(480_000);
  const console_ = watchConsole(page);
  const n = releaseN();
  const world = newWorld();
  world.release.current = numbered(n, null);
  await stubSyncService(context, world);
  const bundle = `/${n.bundle.path}`;

  await ctl({ drop: [bundle], resetLog: true });
  await signIn(page, context, world, A);
  await page.goto(`/scope/${A.boqId}`);
  await expect(page.getByTestId("workspace-prepare"), "the 'Preparing your PROJEXA workspace' screen never finished").toHaveCount(0, { timeout: 240_000 });

  await test.step("bundle missing on the static host: refused, no release cache, the failure recorded", async () => {
    await expect.poll(() => deviceMeta(page, "app:release-failure"), { timeout: 120_000 }).toMatchObject({ version: n.release_version, reason: "bundle_unreachable" });
    expect(await deviceMeta(page, "app:release")).toBeFalsy();
    expect(await releaseCaches(page)).toEqual([]);
    expect((await hostLog()).some((l) => l.path === bundle && l.status === 404)).toBe(true);
  });

  await test.step("ONE wrong byte in the bundle on the static host: refused by the hash, nothing installed", async () => {
    await ctl({ corrupt: [bundle] });
    await page.reload();
    await expect.poll(() => deviceMeta(page, "app:release-failure"), { timeout: 120_000 }).toMatchObject({ version: n.release_version, reason: "bundle_hash" });
    expect(await deviceMeta(page, "app:release")).toBeFalsy();
    expect(await releaseCaches(page)).toEqual([]);
    expect(world.installs.map((i) => String(i.status))).toEqual(expect.arrayContaining(["failed"]));
  });

  await test.step("the static host fixed: the next start installs the real bytes", async () => {
    await ctl({});
    await page.reload();
    await expect.poll(() => deviceMeta(page, "app:release"), { timeout: 120_000 }).toMatchObject({ version: n.release_version, manifest_sha256: n.manifest_sha256 });
    expect(await releaseCaches(page)).toEqual([`px-release-${n.release_version}`]);
    await expect.poll(() => world.installs.filter((i) => i.status === "installed").length).toBe(1);
  });
  expect(console_.unexpected(), "unexpected console errors").toEqual([]);
});
