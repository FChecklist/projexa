import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildNextRelease, databases, deviceMeta, dumpDb, makePerson, newWorld, numbered, personDb, personMeta, prepareLaptop, releaseCaches, sha256,
  stubSyncService, swPointer, watchConsole, writeMeta, type BuiltRelease, type RegistryRelease, type SyncWorld,
} from "./support/lf-lifecycle-stub";

// LOCAL-FIRST lifecycle (package lf-e12), V1 + R10: the installed app is UPDATED to the next release without losing anything the person
// has on the laptop, and a release that fails verification or download changes NOTHING. In a real Chromium, through
// playwright.local-first.config.ts (read e2e/offline-local-first.spec.ts and e2e/support/lf-lifecycle-stub.ts first).
//
// Release N is the real one this build made (public/_release). Release N+1 is built by the spec with scripts/make-release.mjs's own
// functions from the same build output plus ONE new public file (lf-lifecycle-probe.txt), as the next build number -- what the next real
// deploy looks like from the laptop: one changed file among hundreds, so the laptop fetches only that file and copies the rest.
// The spec serves N+1's release.json, its bundle and its new file through context.route; the app server keeps serving everything else.
//
//     bunx playwright test -c playwright.local-first.config.ts lf-lifecycle-release

const ROOT = process.cwd();
const PROBE = "lf-lifecycle-probe.txt";
const SEVEN_HOURS = 7 * 60 * 60 * 1000;

const A = makePerson("rela", "lf-org-1", "Harbour Point Tower", "Harbour Point - Structure");

function releaseN(): BuiltRelease["manifest"] {
  return JSON.parse(readFileSync(join(ROOT, "public", "_release", "release.json"), "utf8")) as BuiltRelease["manifest"];
}

/** A gate the spec opens by hand: the request waits until then (so the spec can look at the laptop in the middle of a download). */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => { open = r; });
  return { opened, open };
}

type Serve = { probe: "ok" | "tampered" | "cut" | { hold: Promise<void> }; probeHits: number };

/** Serves release N+1: its manifest at /_release/release.json, its bundle, and its one new file, as `serve` says. */
async function serveNext(context: BrowserContext, next: BuiltRelease, serve: Serve) {
  await context.route("**/_release/release.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(next.manifest) }));
  await context.route(`**/${next.manifest.bundle.path}`, (route) => route.fulfill({ status: 200, contentType: "application/gzip", body: next.bundle }));
  await context.route(`**/${PROBE}`, async (route: Route) => {
    serve.probeHits += 1;
    const mode = serve.probe;
    if (mode === "cut") return route.abort("connectionreset");
    if (typeof mode === "object") await mode.hold;
    const bytes = next.files.get(PROBE)!;
    const body = serve.probe === "tampered" ? Buffer.from(bytes.toString("utf8").replace("N+1", "N+X"), "utf8") : bytes;
    return route.fulfill({ status: 200, contentType: "text/plain", body });
  });
}

/** "Six hours later": the boot looks for a newer release at most every six hours (persistence.ts SIX_HOURS); the last look is moved back. */
async function sixHoursLater(page: Page) {
  await writeMeta(page, "projexa-local", "app:last-check", Date.now() - SEVEN_HOURS);
}

async function openLocalBoq(page: Page) {
  await page.goto(`/local/scope/${A.boqId}?projectId=${A.projectId}`);
  await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local");
  await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
}

/** The person's pending edit, made while our server is down (the sync service AND /api refuse): it stays on the laptop. */
async function pendingEdit(page: Page, world: SyncWorld, setApiOffline: (off: boolean) => void, userId: string) {
  world.net = "down";
  setApiOffline(true);
  await openLocalBoq(page);
  await page.getByTestId("boq-line-category-input").first().fill("Precast");
  await page.getByTestId("boq-line-save").click();
  await expect(page.getByTestId("boq-line-waiting")).toHaveText("Waiting to sync");
  expect(await personMeta(page, userId, "shell:edits")).toEqual([expect.objectContaining({ lineId: A.lines[0].id, patch: { category: "Precast" } })]);
  // the sync service is back (the release registry lives there); /api stays down so the edit keeps waiting through the update
  world.net = "up";
}

test("V1: release N+1 is installed in the background; N runs until the switch; local rows and the pending edit survive; the old cache goes; numbering and /install match", async ({ page, context }) => {
  const console_ = watchConsole(page);
  const world = newWorld();
  const n = releaseN();
  const regN = numbered(n, null);
  world.release.current = regN;
  await stubSyncService(context, world);
  const { session, app } = await prepareLaptop(page, context, world, A);

  await test.step("release N is installed, numbered by the registry, and reported ONCE", async () => {
    await expect.poll(() => deviceMeta(page, "app:release")).toMatchObject({ version: n.release_version, manifest_sha256: n.manifest_sha256 });
    const files = (await deviceMeta(page, "app:files")) as { version: string; rows: { path: string; file_no: number | null; file_version: number | null; sha256: string }[] };
    expect(files.version).toBe(n.release_version);
    expect(files.rows).toHaveLength(n.files.length);
    for (const row of files.rows) {
      const reg = regN.files.find((f) => f.path === row.path)!;
      expect(row, `file ${row.path}`).toMatchObject({ file_no: reg.file_no, file_version: reg.file_version, sha256: reg.sha256 });
    }
    await expect.poll(() => world.installs.length).toBe(1);
    expect(world.installs[0]).toMatchObject({ release_version: n.release_version, manifest_sha256: n.manifest_sha256, status: "installed", previous_release: null });
    expect(await releaseCaches(page)).toEqual([`px-release-${n.release_version}`]);
  });

  await pendingEdit(page, world, app.setOffline, session.userId);
  const rowsBefore = await dumpDb(page, personDb(session.userId));
  expect(rowsBefore).toContain(A.lines[1].description);

  const next = await buildNextRelease(ROOT, "2", { path: PROBE, text: "release N+1 probe\n" });
  expect(next.manifest.release_version > n.release_version).toBe(true);
  const regNext = numbered(next.manifest, regN);
  world.release.current = regNext;
  const hold = gate();
  const serve: Serve = { probe: { hold: hold.opened }, probeHits: 0 };
  await serveNext(context, next, serve);

  await test.step("six hours later the laptop finds N+1 and downloads ONLY the changed file; meanwhile N is still what runs", async () => {
    await sixHoursLater(page);
    await page.reload();
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
    await expect.poll(() => serve.probeHits, { timeout: 60_000, message: "the laptop never fetched N+1's new file" }).toBe(1);
    // mid-download: nothing has switched
    expect(await deviceMeta(page, "app:release")).toMatchObject({ version: n.release_version });
    expect(await swPointer(page)).toMatchObject({ version: n.release_version });
    await expect(page.getByTestId("boq-line-waiting")).toHaveText("Waiting to sync");
    hold.open();
  });

  await test.step("the switch: N+1 is active, N's cache is gone, the file table carries the registry's numbers, the install is reported once", async () => {
    await expect.poll(() => deviceMeta(page, "app:release"), { timeout: 120_000, message: "N+1 was never installed" }).toMatchObject({ version: next.manifest.release_version, manifest_sha256: next.manifest.manifest_sha256, mode: "partial" });
    await expect.poll(() => releaseCaches(page), { message: "the old release cache was not cleaned up" }).toEqual([`px-release-${next.manifest.release_version}`]);
    await expect.poll(() => swPointer(page)).toMatchObject({ version: next.manifest.release_version, personId: session.userId });
    const files = (await deviceMeta(page, "app:files")) as { version: string; rows: { path: string; file_no: number | null; file_version: number | null; sha256: string }[] };
    expect(files.version).toBe(next.manifest.release_version);
    expect(files.rows).toHaveLength(next.manifest.files.length);
    for (const row of files.rows) {
      const reg = regNext.files.find((f) => f.path === row.path)!;
      expect(row, `file ${row.path}`).toMatchObject({ file_no: reg.file_no, file_version: reg.file_version, sha256: reg.sha256 });
    }
    const probeRow = files.rows.find((r) => r.path === PROBE)!;
    expect(probeRow.file_no).toBe(n.files.length + 1); // a new path gets the next permanent number
    // every file of N+1 is in its cache, with the manifest's bytes
    const cached = await page.evaluate(async ({ name, probe }) => {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      const res = await cache.match(`/${probe}`);
      return { count: keys.length, probe: res ? await res.text() : null };
    }, { name: `px-release-${next.manifest.release_version}`, probe: PROBE });
    expect(cached).toEqual({ count: next.manifest.files.length, probe: "release N+1 probe\n" });
    await expect.poll(() => world.installs.length).toBe(2);
    expect(world.installs[1]).toMatchObject({ release_version: next.manifest.release_version, previous_release: n.release_version, status: "updated", files: next.manifest.files.length });
    // the X-Px-Client header now names the new release on the next call (a reload starts a fresh boot)
  });

  await test.step("nothing the person had is lost: the rows, the pending edit, on the screen and in IndexedDB", async () => {
    expect(await personMeta(page, session.userId, "shell:edits")).toEqual([expect.objectContaining({ lineId: A.lines[0].id, patch: { category: "Precast" } })]);
    const rowsAfter = await dumpDb(page, personDb(session.userId));
    for (const l of A.lines) expect(rowsAfter).toContain(l.description);
    await page.reload();
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
    await expect(page.getByTestId("boq-line-waiting")).toHaveText("Waiting to sync");
    await expect(page.getByTestId("boq-line-category-input").first()).toHaveValue("Precast");
    // N+1 is served by the worker from its own cache now
    expect(await page.evaluate(async (p) => (await fetch(`/${p}`)).text(), PROBE)).toBe("release N+1 probe\n");
  });

  await test.step("the edit still reaches the server once /api is back", async () => {
    app.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => personMeta(page, session.userId, "shell:edits"), { timeout: 90_000 }).toEqual([]);
  });
  expect(await databases(page)).toEqual(expect.arrayContaining(["projexa-local", personDb(session.userId)]));
  expect(console_.unexpected(), "unexpected console errors").toEqual([]);
});

test("V1: a release whose file does not match its sha256 is refused, a download cut in the middle changes nothing, and the laptop tries again later", async ({ page, context }) => {
  const console_ = watchConsole(page);
  const world = newWorld();
  const n = releaseN();
  world.release.current = numbered(n, null);
  await stubSyncService(context, world);
  const { session } = await prepareLaptop(page, context, world, A);
  await expect.poll(() => world.installs.length).toBe(1);

  const next = await buildNextRelease(ROOT, "3", { path: PROBE, text: "release N+1 probe\n" });
  world.release.current = numbered(next.manifest, world.release.current as RegistryRelease);
  const serve: Serve = { probe: "tampered", probeHits: 0 };
  await serveNext(context, next, serve);

  const nIntact = async () => {
    expect(await deviceMeta(page, "app:release")).toMatchObject({ version: n.release_version, manifest_sha256: n.manifest_sha256 });
    expect(await releaseCaches(page)).toEqual([`px-release-${n.release_version}`]);
    expect(await swPointer(page)).toMatchObject({ version: n.release_version });
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
  };

  await test.step("the new file's bytes do not match the manifest: refused, nothing switches, the failure is recorded and reported", async () => {
    await sixHoursLater(page);
    await openLocalBoq(page);
    await expect.poll(() => deviceMeta(page, "app:release-failure"), { timeout: 60_000 }).toMatchObject({ version: next.manifest.release_version, reason: "file_hash" });
    await nIntact();
    await expect.poll(() => world.installs.length).toBe(2);
    expect(world.installs[1]).toMatchObject({ release_version: next.manifest.release_version, status: "failed", error: expect.stringMatching(/^file_hash/) });
  });

  await test.step("the connection is cut in the middle of the download: N keeps working, nothing half-installed", async () => {
    serve.probe = "cut";
    const before = serve.probeHits;
    await openLocalBoq(page); // a failed install never moves the "last looked" time, so the next start tries again
    await expect.poll(() => serve.probeHits, { timeout: 60_000 }).toBeGreaterThan(before);
    await expect.poll(() => deviceMeta(page, "app:release-failure"), { timeout: 60_000 }).toMatchObject({ reason: "file_unreachable" });
    await nIntact();
  });

  await test.step("later, with a good connection, the same release installs", async () => {
    serve.probe = "ok";
    await openLocalBoq(page);
    await expect.poll(() => deviceMeta(page, "app:release"), { timeout: 120_000 }).toMatchObject({ version: next.manifest.release_version });
    await expect.poll(() => releaseCaches(page)).toEqual([`px-release-${next.manifest.release_version}`]);
    expect(await deviceMeta(page, "app:release-failure")).toBeNull();
    await expect.poll(() => world.installs.filter((i) => i.status === "updated").length).toBe(1);
    expect(world.installs.map((i) => i.status)).toEqual(["installed", "failed", "failed", "updated"]);
  });
  expect(session.userId).toBeTruthy();
  expect(console_.unexpected(), "unexpected console errors").toEqual([]);
});

test("V1: a first install whose BUNDLE does not match the manifest's sha256 is refused (no release cache at all), and the next start installs it", async ({ page, context }) => {
  const console_ = watchConsole(page);
  const world = newWorld();
  const n = releaseN();
  world.release.current = numbered(n, null);
  await stubSyncService(context, world);
  const real = readFileSync(join(ROOT, "public", n.bundle.path));
  expect(sha256(real)).toBe(n.bundle.sha256);
  let tamper = true;
  await context.route(`**/${n.bundle.path}`, (route) => {
    const body = Buffer.from(real);
    if (tamper) body[body.length - 20] ^= 0xff;
    return route.fulfill({ status: 200, contentType: "application/gzip", body });
  });

  const { signIn } = await import("./support/lf-lifecycle-stub");
  const { session } = await signIn(page, context, world, A);
  await page.goto(`/scope/${A.boqId}`);
  await expect(page.getByTestId("prepare-percent")).toHaveText("100%", { timeout: 240_000 });
  await page.getByTestId("prepare-continue").click();

  await test.step("tampered bundle: refused, no px-release cache, the failure recorded", async () => {
    await expect.poll(() => deviceMeta(page, "app:release-failure"), { timeout: 120_000 }).toMatchObject({ version: n.release_version, reason: "bundle_hash" });
    expect(await deviceMeta(page, "app:release")).toBeFalsy();
    expect(await releaseCaches(page)).toEqual([]);
    await expect.poll(() => world.installs.length).toBe(1);
    expect(world.installs[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/^bundle_hash/) });
  });

  await test.step("the real bundle: the next start installs it", async () => {
    tamper = false;
    await page.reload();
    await expect.poll(() => deviceMeta(page, "app:release"), { timeout: 120_000 }).toMatchObject({ version: n.release_version });
    expect(await releaseCaches(page)).toEqual([`px-release-${n.release_version}`]);
    await expect.poll(() => world.installs.length).toBe(2);
    expect(world.installs[1]).toMatchObject({ status: "installed" });
  });
  expect(session.userId).toBeTruthy();
  expect(console_.unexpected(), "unexpected console errors").toEqual([]);
});
