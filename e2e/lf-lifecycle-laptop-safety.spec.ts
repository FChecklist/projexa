import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { APP_ORIGIN, stubAppApis } from "./support/boq-local";
import {
  databases, deviceMeta, dumpDb, fixtureOf, makePerson, newWorld, personDb, personMeta, prepareLaptop, releaseCaches, signIn, stubSyncService,
  type Person, type SyncWorld,
} from "./support/lf-lifecycle-stub";
import { openLocal, prepareLaptop as prepareDocumentsLaptop } from "./support/lf-documents-prepare";

// AUDIT-100 B12, B24, B27: the laptop is SAFE when it is shared, when the browser wipes the site's storage, and when the storage is full.
// Real Chromium, production build, local Auth stand-in, sync service answered inside the browser (e2e/support/lf-lifecycle-stub.ts).
// Nothing reaches Vercel, Supabase or any real network; every identity is a placeholder (lf-b3-*@example.invalid).
//
//     bunx playwright test -c playwright.local-first.config.ts lf-lifecycle-laptop-safety
//
//   B12 two people on one browser profile: A signs out (the real account menu), B signs in. B never sees A's projects or BOQ rows, on the page
//       or in B's own local database; A's local database is still there, byte for byte what it was. The leak detector is proved able to fail
//       (it finds A's words in A's own database, and in B's database once one of A's rows is planted there on purpose).
//   B24 the browser evicts the site's storage (IndexedDB, Cache Storage, localStorage, service worker: the real Chromium wipe through the
//       DevTools protocol) while the login cookie survives. PROJEXA recovers by itself: the install runs again, the projects are copied again.
//       WHAT IS LOST, said plainly and asserted: an edit that had not reached the server yet lived only in that storage, so it is GONE -- the
//       line shows the server's value again, nothing is "waiting to sync", and the edit is never sent. Only an unsent edit can be lost.
//   B27 the storage cap: keeping a file on the laptop meets the browser's "storage full" refusal (a QuotaExceededError raised at the
//       IndexedDB call, see STORAGE_FULL_SCRIPT for why it is injected). The person is told in plain words; nothing half-kept is left; with
//       room again the same button keeps the file (so the failure was the cap, and the check can fail). The app's own caps (60 MB per file,
//       500 MB kept, 150 MB recent) are unit-tested in src/lib/local-first/shell/modules/documents-file-cache.test.ts.

const CDP_UNAVAILABLE = "this check needs Chromium's DevTools protocol";

/** Everything of a person that must never appear in another person's page or database. */
function markersOf(p: Person): string[] {
  return [p.projectName, p.boqTitle, p.projectId, p.boqId, p.orgId, p.email, ...p.lines.map((l) => l.id), ...p.lines.map((l) => l.description)];
}

/** The leak detector: which of `p`'s markers are in `text`. */
function leaksOf(text: string, p: Person): string[] {
  return markersOf(p).filter((m) => text.includes(m));
}

/** One store of a local database, as JSON, for a byte-for-byte comparison (meta, records, outbox, drafts...). */
function storeDump(page: Page, dbName: string): Promise<Record<string, string>> {
  return page.evaluate(
    (dbName) =>
      new Promise<Record<string, string>>((resolve) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => resolve({});
        open.onsuccess = () => {
          const db = open.result;
          const names = [...db.objectStoreNames].sort();
          if (names.length === 0) { db.close(); resolve({}); return; }
          const tx = db.transaction(names, "readonly");
          const out: Record<string, string> = {};
          for (const n of names) {
            const r = tx.objectStore(n).getAll();
            r.onsuccess = () => { out[n] = JSON.stringify(r.result); };
          }
          tx.oncomplete = () => { db.close(); resolve(out); };
        };
      }),
    dbName
  );
}

async function openLocalBoq(page: Page, p: Person) {
  await page.goto(`/local/scope/${p.boqId}?projectId=${p.projectId}`);
  await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local");
  await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
}

// ─── B12 ────────────────────────────────────────────────────────────────────────────────────────

test("B12: A signs out, B signs in on the same browser profile: B never sees A's projects or BOQ rows; A's copy stays untouched (and the leak check can fail)", async ({ page, context }) => {
  const A = makePerson("lf-b3-a", "lf-org-b3-a", "Alder Court Tower", "Alder Court - Structure");
  const B = makePerson("lf-b3-b", "lf-org-b3-b", "Birch Lane Mall", "Birch Lane - Fitout");
  const world = newWorld();
  await stubSyncService(context, world);

  const a = await prepareLaptop(page, context, world, A);
  const aDb = personDb(a.session.userId);
  await openLocalBoq(page, A);
  for (const l of A.lines) await expect(page.getByText(l.description)).toBeVisible();
  const aBefore = await storeDump(page, aDb);
  expect(aBefore.records ?? "", "A's rows are not in A's local database").toContain(A.lines[0].description);

  await test.step("A signs out from the account menu (the default: A's copy is kept on the laptop)", async () => {
    await page.getByTestId("local-shell-account").locator("summary").click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  });

  const b = await test.step("B signs in on the same browser profile; B's own workspace is prepared", async () => {
    const prepared = await prepareLaptop(page, context, world, B);
    expect(prepared.session.userId).not.toBe(a.session.userId);
    return prepared;
  });
  const bDb = personDb(b.session.userId);

  await test.step("on the page: B's BOQ is B's; A's BOQ is not reachable from B's session", async () => {
    await openLocalBoq(page, B);
    for (const l of B.lines) await expect(page.getByText(l.description)).toBeVisible();
    expect(leaksOf(await page.locator("body").innerText(), A), "A's words are on B's screen").toEqual([]);
    // the shell's account control names B, never A
    await expect(page.getByTestId("local-shell-person")).toHaveText(B.email);
    // B asks for A's BOQ directly: nothing of A is shown
    await page.goto(`/local/scope/${A.boqId}?projectId=${A.projectId}`);
    await expect(page.getByTestId("boq-local-line")).toHaveCount(0);
    expect(leaksOf(await page.locator("body").innerText(), A), "A's BOQ opened in B's session").toEqual([]);
    // and the sync service was only ever asked for B's data under B's token
    const bHits = world.hits.filter((h) => h.person === B.email);
    expect(bHits.length).toBeGreaterThan(0);
  });

  await test.step("in B's local database: nothing of A's", async () => {
    const bDump = await dumpDb(page, bDb);
    expect(bDump).toContain(B.lines[0].description);
    expect(leaksOf(bDump, A), "A's data is in B's local database").toEqual([]);
  });

  await test.step("A's copy is still on the laptop, untouched (every store, byte for byte)", async () => {
    expect(await databases(page)).toEqual(expect.arrayContaining([aDb, bDb]));
    expect(await storeDump(page, aDb)).toEqual(aBefore);
  });

  await test.step("the leak check can fail: it finds A's words in A's own database, and in B's once A's row is planted there", async () => {
    expect(leaksOf(await dumpDb(page, aDb), A).length, "the detector is blind: it does not even see A's words in A's database").toBeGreaterThan(3);
    const planted = `boq_lines:${A.lines[0].id}`;
    await page.evaluate(
      ({ db, row }) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(db);
          open.onsuccess = () => {
            const tx = open.result.transaction("records", "readwrite");
            tx.objectStore("records").put(row);
            tx.oncomplete = () => { open.result.close(); resolve(); };
            tx.onerror = () => { open.result.close(); reject(tx.error); };
          };
        }),
      { db: bDb, row: { id: planted, type: "boq_lines", orgId: A.orgId, projectId: A.projectId, data: A.lines[0], serverVersion: 1 } }
    );
    expect(leaksOf(await dumpDb(page, bDb), A), "a planted leak was not caught").toContain(A.lines[0].description);
    await page.evaluate(
      ({ db, id }) =>
        new Promise<void>((resolve) => {
          const open = indexedDB.open(db);
          open.onsuccess = () => {
            const tx = open.result.transaction("records", "readwrite");
            tx.objectStore("records").delete(id);
            tx.oncomplete = () => { open.result.close(); resolve(); };
          };
        }),
      { db: bDb, id: planted }
    );
    expect(leaksOf(await dumpDb(page, bDb), A)).toEqual([]);
  });
});

// ─── B24 ────────────────────────────────────────────────────────────────────────────────────────

/** The person's edit, made while our server is down: it waits on the laptop (the same path as e2e/lf-lifecycle-release.spec.ts). */
async function pendingEdit(page: Page, world: SyncWorld, setApiOffline: (off: boolean) => void, p: Person, userId: string) {
  world.net = "down";
  setApiOffline(true);
  await openLocalBoq(page, p);
  await page.getByTestId("boq-line-category-input").first().fill("Precast");
  await page.getByTestId("boq-line-save").click();
  await expect(page.getByTestId("boq-line-waiting")).toHaveText("Waiting to sync");
  expect(await personMeta(page, userId, "shell:edits")).toEqual([expect.objectContaining({ lineId: p.lines[0].id, patch: { category: "Precast" } })]);
  world.net = "up";
}

async function originUsage(context: BrowserContext, page: Page): Promise<{ usage: number; byType: Record<string, number> }> {
  const cdp = await context.newCDPSession(page).catch(() => { throw new Error(CDP_UNAVAILABLE); });
  try {
    const r = (await cdp.send("Storage.getUsageAndQuota", { origin: APP_ORIGIN })) as { usage: number; usageBreakdown: { storageType: string; usage: number }[] };
    return { usage: r.usage, byType: Object.fromEntries(r.usageBreakdown.filter((u) => u.usage > 0).map((u) => [u.storageType, u.usage])) };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

test("B24: the browser evicts the site's storage while the login cookie survives: PROJEXA reinstalls and re-copies by itself; only the unsent edit is lost", async ({ page, context }) => {
  const A = makePerson("lf-b3-evict", "lf-org-b3-e", "Cedar Wharf Depot", "Cedar Wharf - Civil");
  const world = newWorld();
  await stubSyncService(context, world);
  const { session, app } = await prepareLaptop(page, context, world, A);
  await pendingEdit(page, world, app.setOffline, A, session.userId);
  const installsBefore = world.installs.length;
  const pullsBefore = world.hits.filter((h) => h.route === "pull" && h.status === 200).length;
  expect(pullsBefore).toBeGreaterThan(0);
  const before = await originUsage(context, page);
  expect(before.byType, "nothing stored before the eviction: the wipe below would prove nothing").toMatchObject({ indexeddb: expect.any(Number), cache_storage: expect.any(Number) });

  const fresh = await test.step("the browser wipes the site's storage (the tab is closed; the cookie is kept)", async () => {
    const next = await context.newPage();
    await page.close();
    const cdp = await context.newCDPSession(next);
    await cdp.send("Storage.clearDataForOrigin", { origin: APP_ORIGIN, storageTypes: "indexeddb,cache_storage,local_storage,service_workers,file_systems" });
    await cdp.detach();
    const after = await originUsage(context, next);
    expect(after.byType, "the wipe left storage behind").toEqual({});
    expect((await context.cookies(APP_ORIGIN)).map((c) => c.name), "the login cookie must survive the eviction").toContain(session.cookieName);
    return next;
  });

  const pageErrors: string[] = [];
  fresh.on("pageerror", (e) => pageErrors.push(e.message));
  const app2 = await stubAppApis(fresh, fixtureOf(A), session);

  await test.step("PROJEXA recovers by itself: the install runs again and the projects are copied again", async () => {
    await fresh.goto(`/scope/${A.boqId}`);
    await expect(fresh.getByTestId("workspace-prepare"), "the install did not run again after the eviction").toBeVisible({ timeout: 60_000 });
    await expect(fresh.getByTestId("workspace-prepare")).toHaveCount(0, { timeout: 240_000 });
    await expect.poll(() => deviceMeta(fresh, "app:release"), { timeout: 240_000, message: "the release was not installed again" })
      .toMatchObject({ version: expect.stringMatching(/^\d{4}\.\d{2}\.\d{2}-\d{3}$/) });
    await expect.poll(() => releaseCaches(fresh)).toHaveLength(1);
    await expect.poll(() => personMeta(fresh, session.userId, `sync:done:${A.projectId}:boq_lines`), { timeout: 120_000, message: "the projects were not copied again" }).toBeTruthy();
    expect(world.installs.length, "the reinstall was not reported").toBeGreaterThan(installsBefore);
    expect(world.hits.filter((h) => h.route === "pull" && h.status === 200).length, "the rows were not pulled again").toBeGreaterThan(pullsBefore);
    await fresh.reload();
    await expect.poll(() => fresh.evaluate(() => Boolean(navigator.serviceWorker.controller)), { message: "no service worker controls the page again" }).toBe(true);
    await openLocalBoq(fresh, A);
    for (const l of A.lines) await expect(fresh.getByText(l.description)).toBeVisible();
  });

  await test.step("WHAT IS LOST: the edit that had not reached the server. It is gone from the laptop, never sent, and the line shows the server's value", async () => {
    expect(await personMeta(fresh, session.userId, "shell:edits"), "the unsent edit is unexpectedly still on the laptop").toBeUndefined();
    await expect(fresh.getByTestId("boq-line-waiting")).toHaveCount(0);
    await expect(fresh.getByTestId("boq-line-category-input").first()).toHaveValue(A.lines[0].category);
    await fresh.evaluate(() => window.dispatchEvent(new Event("focus")));
    await fresh.waitForTimeout(3_000);
    // the old tab's attempts were all refused (our server was down); the new tab never tries
    expect(app2.requests.filter((r) => r.startsWith("PATCH /api/scope/line-items/")), "a lost edit was sent after all").toEqual([]);
    expect(JSON.stringify(world.pushes)).not.toContain("Precast");
    expect(await dumpDb(fresh, personDb(session.userId))).not.toContain("Precast");
  });

  expect(pageErrors, "the recovery threw in the page").toEqual([]);
});

// ─── B27 ────────────────────────────────────────────────────────────────────────────────────────

const FILE_BYTES = 4 * 1024 * 1024;

/**
 * The browser's "this site's storage is full" refusal, at the IndexedDB API, for the per-person file database only: while the page flag is
 * on, a write there throws the same DOMException Chromium raises at its quota (name QuotaExceededError). WHY NOT THE REAL QUOTA: Chromium's
 * DevTools Storage.overrideQuotaForOrigin was tried first (it is how this spec started) and measured: it refuses a 4 MB write on a page that
 * opens its first database after the override, but NOT on the installed PROJEXA, whose databases (and service worker) are already open --
 * Chromium keeps the room it computed before -- even after leaving the app for 5 s and coming back. Lowering the quota before the install
 * makes the install itself fail instead. So the refusal is injected, in the real browser, at the one call the app makes.
 */
const STORAGE_FULL_SCRIPT = () => {
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    if ((window as unknown as { __pxStorageFull?: boolean }).__pxStorageFull && this.transaction.db.name.startsWith("projexa-files:")) {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    }
    return realPut.apply(this, args);
  } as IDBObjectStore["put"];
};

test("B27: storage cap reached: keeping a file meets the browser's 'storage full' refusal and the person is told in plain words (and the check can fail)", async ({ page, context }) => {
  await context.addInitScript(STORAGE_FULL_SCRIPT);
  const p = await prepareDocumentsLaptop(page, context, "owner", "lf-b3-quota@example.invalid");
  const fileUrl = "https://files.example.invalid/lf-b3/site-safety-plan.pdf";
  let fileHits = 0;
  await page.route("**/api/documents/lf-doc-safety", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "lf-doc-safety", signedUrl: fileUrl }) }));
  await context.route(fileUrl, (route) => {
    fileHits += 1;
    return route.fulfill({ status: 200, headers: { "content-type": "application/pdf", "access-control-allow-origin": "*" }, body: Buffer.alloc(FILE_BYTES, 7) });
  });
  const keptFiles = () =>
    page.evaluate(
      (db) =>
        new Promise<Array<{ docId: string; size: number }>>((resolve) => {
          const open = indexedDB.open(db);
          open.onsuccess = () => {
            const d = open.result;
            if (!d.objectStoreNames.contains("files")) { d.close(); resolve([]); return; }
            const r = d.transaction("files", "readonly").objectStore("files").getAll();
            r.onsuccess = () => { d.close(); resolve((r.result as Array<{ docId: string; size: number }>).map((f) => ({ docId: f.docId, size: f.size }))); };
            r.onerror = () => { d.close(); resolve([]); };
          };
          open.onerror = () => resolve([]);
        }),
      `projexa-files:${p.session.userId}`
    );
  const setFull = (on: boolean) => page.evaluate((v) => { (window as unknown as { __pxStorageFull?: boolean }).__pxStorageFull = v; }, on);

  await openLocal(page, "/documents/lf-doc-safety");
  await expect(page.getByTestId("doc-file-keep")).toBeVisible({ timeout: 60_000 });

  await test.step("the refusal is the browser's own error (the injection really raises a QuotaExceededError)", async () => {
    await setFull(true);
    const raised = await page.evaluate(
      (db) =>
        new Promise<string>((resolve) => {
          const open = indexedDB.open(db, 1);
          open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains("files")) open.result.createObjectStore("files", { keyPath: "docId" }); };
          open.onsuccess = () => {
            try { open.result.transaction("files", "readwrite").objectStore("files").put({ docId: "probe" }); resolve("stored"); } catch (e) { resolve((e as DOMException).name); }
            open.result.close();
          };
        }),
      `projexa-files:${p.session.userId}`
    );
    expect(raised).toBe("QuotaExceededError");
  });

  await test.step("'Keep on this laptop' while the storage is full: a plain-English message, nothing kept, nothing thrown", async () => {
    const uncaught: string[] = [];
    page.on("pageerror", (e) => uncaught.push(`${e.name}: ${e.message}`.slice(0, 160)));
    page.on("console", (m) => { if (m.type() === "error" && /Uncaught|Quota/i.test(m.text())) uncaught.push(m.text().slice(0, 160)); });
    await page.getByTestId("doc-file-keep").click();
    const message = page.getByTestId("doc-file-message");
    await expect
      .poll(() => message.count(), { timeout: 30_000, message: "the person was told nothing when the laptop's storage was full" })
      .toBe(1)
      .catch((err) => { throw new Error(`${String(err).slice(0, 200)} | uncaught in the page: ${JSON.stringify(uncaught)} | file downloads: ${fileHits}`); });
    expect(fileHits, "the file was never downloaded, so the storage was never asked").toBeGreaterThan(0);
    await expect(message).toContainText("no room left");
    await expect(message).not.toContainText(/quota|IndexedDB|Error|DOMException|\d{3}/i);
    expect(uncaught, "the storage-full failure escaped as an uncaught error").toEqual([]);
    await expect(page.getByTestId("doc-file-kept")).toHaveCount(0);
    expect(await keptFiles(), "a half-kept file was left behind").toEqual([]);
    await expect(page.getByTestId("doc-file-keep"), "the button is stuck after the failure").toBeEnabled();
  });

  await test.step("the check can fail: with room again, the same button keeps the file (re-read from the laptop)", async () => {
    await setFull(false);
    await page.getByTestId("doc-file-keep").click();
    await expect(page.getByTestId("doc-file-kept")).toBeVisible({ timeout: 30_000 });
    expect(await keptFiles()).toEqual([{ docId: "lf-doc-safety", size: FILE_BYTES }]);
  });
});
