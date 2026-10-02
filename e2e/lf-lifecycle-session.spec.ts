import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { APP_ORIGIN, type LocalSession } from "./support/boq-local";
import {
  databases, deviceMeta, dumpDb, makePerson, newWorld, personDb, prepareLaptop, releaseCaches, signIn, stubSyncService, swPointer, watchConsole,
  type Person, type SyncWorld,
} from "./support/lf-lifecycle-stub";

// LOCAL-FIRST lifecycle (package lf-e12): sign-out, and two people on one laptop, in a real Chromium (playwright.local-first.config.ts).
//   * CONTRACT "sign-out policy": the default Sign Out KEEPS this laptop's copy, so signing in again costs nothing and works offline;
//     "Sign out and delete this laptop's copy" removes it.
//   * Organisation isolation is non-negotiable: person B (another organisation) signing in after A on the same browser never sees ANY of
//     A's rows, project names, outbox or AI surface; A signing back in gets A's own copy.
// The person is identified by the sign-in token's `sub`, as the real service does (e2e/support/lf-lifecycle-stub.ts).

const A = makePerson("sesa", "lf-org-1", "Harbour Point Tower", "Harbour Point - Structure");
const B = makePerson("sesb", "lf-org-2", "Juniper Lane Clinic", "Juniper Lane - Fit-out");

/** Every word of a person that must never reach another person's screen or database. */
const wordsOf = (p: Person) => [p.projectName, p.boqTitle, p.projectId, p.boqId, ...p.lines.map((l) => l.description), p.email, p.orgId];

/**
 * Once the release is installed, every app page is the on-laptop shell (sw-core.ts navigation). lf-e12 found its header printed the person's
 * email with NO way to sign out (the Settings page is not in the shell and only opens from the server); the shell now has the AccountMenu's
 * two choices (src/lib/local-first/shell/ShellSignOut.tsx). This is the person's click.
 */
async function signOutFromMenu(page: Page, email: string, choice: "Sign Out" | "Sign out and delete this laptop's copy") {
  await expect(page.getByTestId("local-shell-person")).toHaveText(email);
  await page.getByTestId(choice === "Sign Out" ? "local-shell-sign-out" : "local-shell-sign-out-delete").click();
  await expect(page, "a sign-out must end on the login page").toHaveURL(/\/login/, { timeout: 60_000 });
}

/** Puts a person's own (still valid) session cookie back: signing in again as the SAME person (the Auth stand-in makes a new person per call). */
async function signBackIn(context: BrowserContext, session: LocalSession) {
  await context.addCookies([{ name: session.cookieName, value: session.cookieValue, url: APP_ORIGIN }]);
}

async function goOffline(context: BrowserContext, world: SyncWorld, setApiOffline: (off: boolean) => void) {
  world.net = "offline";
  setApiOffline(true);
  await context.setOffline(true);
}

async function goOnline(context: BrowserContext, world: SyncWorld, setApiOffline: (off: boolean) => void) {
  world.net = "up";
  setApiOffline(false);
  await context.setOffline(false);
}

test("sign-out keeps the copy by default; signing in again is instant (no re-download) and works offline", async ({ page, context }) => {
  const console_ = watchConsole(page);
  const world = newWorld();
  await stubSyncService(context, world);
  const { session, app } = await prepareLaptop(page, context, world, A);

  await test.step("Sign Out (the default): login page, identity forgotten, the copy STAYS on the laptop", async () => {
    await page.goto(`/scope/${A.boqId}`);
    await signOutFromMenu(page, A.email, "Sign Out");
    expect(await page.evaluate(() => localStorage.getItem("px-identity-v1")), "the identity mirror outlived a deliberate sign-out").toBeNull();
    expect(await databases(page)).toContain(personDb(session.userId));
    expect(await dumpDb(page, personDb(session.userId))).toContain(A.lines[0].description);
    // the worker no longer serves A's release for A (it was told the person left)
    const pointer = await swPointer(page);
    expect(pointer === null || pointer.personId === null, `the worker still names the signed-out person: ${JSON.stringify(pointer)}`).toBe(true);
  });

  await test.step("signing in again: no first sync of the projects (the copy is reused), then it works OFFLINE", async () => {
    const pullsBefore = world.hits.filter((h) => h.route === "pull" || h.route === "pull_ids").length;
    await signBackIn(context, session);
    await page.goto(`/scope/${A.boqId}`);
    await expect(page.getByTestId("prepare-percent"), "the first-run 'Preparing your workspace' screen came back for a kept copy").toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem("px-identity-v1")), { timeout: 30_000 }).toContain(session.userId);
    expect(world.hits.filter((h) => h.route === "pull" || h.route === "pull_ids").length, "the kept copy was downloaded again").toBe(pullsBefore);
    // FINDING (lf-e12): the DATA is kept, but the sign-out made the worker drop the person's release caches (sw-core CLEAR_PERSON), so the
    // APP itself (the whole bundle, ~2.6 MB from the app's origin) is downloaded again after the re-login before the laptop works offline.
    // Asserted as it is, so a change in either direction is seen: the install is reported again, and to the registry it reads as an
    // "update" of the release to ITSELF (device meta app:release outlived its cache).
    const installsBefore = world.installs.length;
    await expect.poll(() => releaseCaches(page), { timeout: 120_000, message: "the release was not put back after the re-login" }).toHaveLength(1);
    await expect.poll(() => world.installs.length).toBe(installsBefore + 1);
    const again = world.installs.at(-1)!;
    expect(again).toMatchObject({ status: "updated" });
    expect(again.previous_release).toBe(again.release_version);
    await expect.poll(() => swPointer(page), { timeout: 60_000 }).toMatchObject({ personId: session.userId });
    await goOffline(context, world, app.setOffline);
    await page.goto(`/local/scope/${A.boqId}?projectId=${A.projectId}`);
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
    await expect(page.getByTestId("boq-local-title")).toHaveText(A.boqTitle);
    await expect(page.getByTestId("local-shell-signed-out")).toHaveCount(0);
    await goOnline(context, world, app.setOffline);
  });
  expect(console_.unexpected(), "unexpected console errors").toEqual([]);
  // FINDING pinned (see watchConsole): the release cache the sign-out dropped is read as tampering, and the AI is switched off once.
  expect(console_.aiTamper(), "the AI-integrity finding changed: re-check e2e/support/lf-lifecycle-stub.ts watchConsole").toBeGreaterThan(0);
});

test("Sign out and delete this laptop's copy: the person's database is removed, nothing else is", async ({ page, context }) => {
  const console_ = watchConsole(page);
  const world = newWorld();
  await stubSyncService(context, world);
  const { session } = await prepareLaptop(page, context, world, A);
  await page.goto(`/scope/${A.boqId}`);
  await signOutFromMenu(page, A.email, "Sign out and delete this laptop's copy");
  await expect.poll(() => databases(page), { timeout: 30_000, message: "the person's copy is still on the laptop after 'delete this laptop's copy'" }).not.toContain(personDb(session.userId));
  expect(await page.evaluate((id) => Object.keys(localStorage).filter((k) => k.includes(id)), session.userId), "a per-person hint outlived the deleted copy").toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("px-identity-v1"))).toBeNull();
  expect(console_.unexpected(), "unexpected console errors").toEqual([]);
});

test("two people on one laptop: B (another organisation) never sees anything of A; A signing back in gets A's own copy", async ({ page, context }) => {
  const console_ = watchConsole(page);
  const world = newWorld();
  await stubSyncService(context, world);
  const a = await prepareLaptop(page, context, world, A);
  await page.goto(`/scope/${A.boqId}`);
  await signOutFromMenu(page, A.email, "Sign Out");

  const b = await signIn(page, context, world, B);
  await test.step("B signs in and is prepared: B's own workspace", async () => {
    await page.goto(`/scope/${B.boqId}`);
    await expect(page.getByTestId("prepare-percent")).toHaveText("100%", { timeout: 240_000 });
    await page.getByTestId("prepare-continue").click();
    await expect.poll(() => deviceMeta(page, `shell:manifest:${b.session.userId}`), { timeout: 60_000 }).toMatchObject({ projects: [{ id: B.projectId, name: B.projectName }] });
    await expect.poll(() => swPointer(page), { timeout: 60_000 }).toMatchObject({ personId: b.session.userId });
  });

  await test.step("nothing of A in B's database, B's identity, B's cached names, or the worker's pointer", async () => {
    const bDb = await dumpDb(page, personDb(b.session.userId));
    expect(bDb).toContain(B.lines[0].description);
    for (const w of wordsOf(A)) expect(bDb, `B's database holds A's "${w}"`).not.toContain(w);
    const identity = (await page.evaluate(() => localStorage.getItem("px-identity-v1"))) ?? "";
    expect(identity).toContain(b.session.userId);
    expect(identity).not.toContain(a.session.userId);
    const names = JSON.stringify(await deviceMeta(page, `shell:manifest:${b.session.userId}`));
    for (const w of wordsOf(A)) expect(names).not.toContain(w);
  });

  await test.step("B's screens, online and offline, never show A's project or rows (even at A's own URL)", async () => {
    await page.goto(`/local/scope?projectId=${B.projectId}`);
    await expect(page.getByTestId("scope-list-row").filter({ hasText: B.boqTitle })).toHaveCount(1);
    await expect(page.getByTestId("local-shell-project")).toContainText(B.projectName);
    for (const w of [A.projectName, A.boqTitle, A.lines[0].description]) await expect(page.getByText(w)).toHaveCount(0);
    await goOffline(context, world, b.app.setOffline);
    await page.goto(`/local/scope/${A.boqId}?projectId=${A.projectId}`);
    await expect(page.locator("body")).toBeVisible();
    for (const w of [A.projectName, A.boqTitle, ...A.lines.map((l) => l.description)]) await expect(page.getByText(w), `B sees A's "${w}" offline`).toHaveCount(0);
    await goOnline(context, world, b.app.setOffline);
  });

  await test.step("B signs out; A signs back in and gets A's own copy, offline too", async () => {
    await page.goto(`/scope/${B.boqId}`);
    await signOutFromMenu(page, B.email, "Sign Out");
    await page.unroute("**/api/**");
    const { stubAppApis } = await import("./support/boq-local");
    const { fixtureOf } = await import("./support/lf-lifecycle-stub");
    const appA = await stubAppApis(page, fixtureOf(A), a.session);
    await signBackIn(context, a.session);
    await page.goto(`/scope/${A.boqId}`);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("px-identity-v1")), { timeout: 30_000 }).toContain(a.session.userId);
    // B's sign-out dropped the release caches too (see the first test's FINDING): the app is put back for A before it works offline
    await expect.poll(() => releaseCaches(page), { timeout: 120_000 }).toHaveLength(1);
    await expect.poll(() => swPointer(page), { timeout: 60_000 }).toMatchObject({ personId: a.session.userId });
    await goOffline(context, world, appA.setOffline);
    await page.goto(`/local/scope/${A.boqId}?projectId=${A.projectId}`);
    await expect(page.getByTestId("boq-local-title")).toHaveText(A.boqTitle);
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3);
    for (const w of [B.projectName, B.boqTitle, B.lines[0].description]) await expect(page.getByText(w)).toHaveCount(0);
    await goOnline(context, world, appA.setOffline);
    expect(await releaseCaches(page)).toHaveLength(1);
  });
  expect(console_.unexpected(), "unexpected console errors").toEqual([]);
  expect(console_.aiTamper(), "the AI-integrity finding changed: re-check e2e/support/lf-lifecycle-stub.ts watchConsole").toBeGreaterThan(0);
});

test("the local-first opt-out is respected for every person of the browser, and stays off across a reload", async ({ page, context }) => {
  const world = newWorld();
  await stubSyncService(context, world);
  const a = await prepareLaptop(page, context, world, A);
  expect(await page.evaluate(() => localStorage.getItem("px-local-first"))).toBe("1"); // on by default for a signed-in person
  // what setLocalFirstEnabled(false) stores (src/lib/local-first/mode.ts): the flag removed, the person's choice remembered
  await page.evaluate(() => { localStorage.removeItem("px-local-first"); localStorage.setItem("px-local-first-off", "1"); });
  await page.reload();
  await page.goto(`/scope/${A.boqId}`);
  expect(await page.evaluate(() => localStorage.getItem("px-local-first")), "the signed-in default turned local-first back on").toBeNull();
  await signOutFromMenu(page, A.email, "Sign Out");
  const b = await signIn(page, context, world, B);
  const pullsBefore = world.hits.filter((h) => h.route === "pull").length;
  await page.goto(`/scope/${B.boqId}`);
  await page.waitForTimeout(5_000); // the boot starts 1.5 s after load; give it time to do (or not do) the first copy
  expect(await page.evaluate(() => localStorage.getItem("px-local-first")), "B's sign-in turned local-first back on in an opted-out browser").toBeNull();
  expect(world.hits.filter((h) => h.route === "pull").length, "an opted-out browser copied B's workspace").toBe(pullsBefore);
  // nothing of B was copied (an empty database the screen opened to look is not a copy)
  const bDb = await dumpDb(page, personDb(b.session.userId));
  for (const l of B.lines) expect(bDb, "an opted-out browser holds B's rows").not.toContain(l.description);
  expect(a.session.userId).not.toBe(b.session.userId);
});
