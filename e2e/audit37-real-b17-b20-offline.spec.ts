import { test, expect, chromium, devices, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USERS } from "./users";
import { baseURL, loginAndPrepare, openLocal, projectId, readStore } from "./support/real-backend";

// AUDIT-100 rows B20 (offline passcode sign-in in a real browser) and B17 (open the app offline after a FULL browser restart),
// against the REAL backend (playwright.audit37-real.config.ts): real login, real first copy of the person's data, real Chromium.
// Everything is read back from what the browser PERSISTED (localStorage, IndexedDB, what the page shows), never from a message.
test.describe.configure({ mode: "serial" });
test.setTimeout(1_200_000);

const noop = () => undefined;

// KNOWN PRODUCT GAP, measured 2026-10-05 in real Chromium (AUDIT-100 B20): the offline passcode sign-in exists (login/page.tsx + offline-pin.ts, unit-tested, and the
// salted hash IS kept after the online sign-in, asserted below) but it cannot be REACHED offline. A deliberate sign-out deletes the release caches (sign-out-keeps-app.test.ts:
// "so the next person on the laptop starts from nothing"), so offline /login answers the service worker's "PROJEXA is not saved on this laptop yet" page, with no form.
// (And while a release IS installed, offline /login is answered with the /local shell, whose signed-out screen only says "sign in once while online".)
// Making it reachable needs an owner/product decision: keep the (public) release caches across a sign-out, or render the passcode form from the shell's signed-out screen.
// `test.fail` keeps this spec green while the gap exists and turns RED the moment someone fixes it, so the annotation is then removed.
test("B20: sign out, cut the network, the wrong passcode is refused and the right one opens this laptop's own copy (offline passcode sign-in)", async ({ browser }) => {
  test.fail(true, "B20: offline passcode sign-in page is unreachable after a sign-out (release caches are deleted) -- see the comment above this test");
  const who = USERS.hr;
  const context = await browser.newContext({ serviceWorkers: "allow", baseURL });
  const page = await context.newPage();
  try {
    await loginAndPrepare(page, "hr");

    // after the online sign-in the laptop keeps a salted hash, never the passcode itself (offline-pin.ts)
    const stored = await page.evaluate(() => localStorage.getItem("px-offline-pin-v1"));
    expect(stored, "no offline passcode record was kept after the online sign-in").toBeTruthy();
    expect(stored).not.toContain(who.password);
    expect(Object.keys(JSON.parse(stored!))).toContain(who.email.toLowerCase());
    const dbBefore = (await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:")))).sort();

    // a real sign-out from the offline shell's own account menu
    await page.goto("/local/");
    await page.getByTestId("local-shell-account").locator("summary").click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/login/, { timeout: 60_000 });

    // no network at all: the sign-in page must still open (from the laptop's own copy of the app), and refuse a wrong passcode with a plain message
    await context.setOffline(true);
    await page.goto("/login");
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await page.locator("#email").fill(who.email);
    await page.locator("#password").fill("000000-not-it");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("form")).toContainText("does not match", { timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe("/login");

    // the right passcode signs in offline and the person's own copy opens
    await page.locator("#password").fill(who.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
    await page.goto("/local/");
    await expect(page.getByTestId("local-shell-person")).toContainText(who.name.split(" ")[0], { timeout: 60_000 });
    // it is the SAME local copy as before the sign-out (nothing was lost, nothing was made new)
    const dbAfter = (await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:")))).sort();
    expect(dbAfter).toEqual(dbBefore);
    expect((await readStore(page, "meta")).filter((m) => String(m.key).startsWith("sync:done:")).length).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("B17: after a FULL browser restart (browser closed, new browser, same profile folder) the app opens with no network from the laptop's own copy", async () => {
  const profile = mkdtempSync(join(tmpdir(), "px-b17-"));
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      ...devices["Desktop Chrome"],
      baseURL,
      serviceWorkers: "allow",
      args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
    });
  let context: BrowserContext | undefined;
  try {
    // ---- first run: sign in, let the laptop prepare itself, wait until the first project's RFIs are on the laptop
    context = await launch();
    let page: Page = context.pages()[0] ?? (await context.newPage());
    await loginAndPrepare(page, "siteSupervisor");
    const P = await projectIdFor(context);
    await openLocal(page, `/local/rfis?projectId=${P}`, "rfis-list");
    const rowsOnLine = await page.getByTestId("rfi-row").count();
    const releaseCaches = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("px-release-")));
    expect(releaseCaches.length, "the app bundle is not stored on the laptop").toBe(1);
    const dbBefore = (await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:")))).sort();
    await page.evaluate(noop);

    // ---- the whole browser is closed (every process of it) ...
    await context.close();
    context = undefined;

    // ---- ... and a brand-new browser starts on the same profile folder, with NO network
    // BREAK-TEST SWITCH (R74-RULING-03 (c)): AUDIT100_BREAK=b17 starts the second browser on an EMPTY profile (a different laptop); this test must then FAIL.
    if (process.env.AUDIT100_BREAK === "b17") rmSync(profile, { recursive: true, force: true });
    context = await launch();
    await context.setOffline(true);
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`/local/rfis?projectId=${P}`);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByTestId("rfis-list")).toHaveAttribute("data-state", "local", { timeout: 60_000 });
    expect(await page.title()).toMatch(/PROJEXA/i);
    // the same rows as before the restart, read from the laptop's own database
    await expect(page.getByTestId("rfi-row")).toHaveCount(rowsOnLine);
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect((await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:")))).sort()).toEqual(dbBefore);
    expect(await page.evaluate(() => fetch("https://example.com/", { mode: "no-cors" }).then(() => "reached", () => "refused"))).toBe("refused");
    // and the shell's other screens open too
    await page.goto("/local/");
    await expect(page.getByTestId("local-shell-person")).toBeVisible({ timeout: 60_000 });
  } finally {
    await context?.close().catch(noop);
    rmSync(profile, { recursive: true, force: true });
  }
});

async function projectIdFor(context: BrowserContext): Promise<string> {
  return projectId(context);
}
