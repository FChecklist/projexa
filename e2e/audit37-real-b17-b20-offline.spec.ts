import { test, expect, chromium, devices, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseURL, loginAndPrepare, openLocal, projectId, readStore } from "./support/real-backend";

// AUDIT-100 rows B20 (offline sign-in screen in a real browser) and B17 (open the app offline after a FULL browser restart),
// against the REAL backend (playwright.audit37-real.config.ts): real login, real first copy of the person's data, real Chromium.
// Everything is read back from what the browser PERSISTED (localStorage, IndexedDB, what the page shows), never from a message.
test.describe.configure({ mode: "serial" });
test.setTimeout(1_200_000);

const noop = () => undefined;

// AUDIT-100 B20 (P1, 2026-10-08): there is no offline passcode sign-in any more -- sign-in is the e-mailed 6-digit code, which needs a connection. What stays
// true and is proved here: the default sign-out KEEPS the (public) release, so with no network /login still opens from the laptop (the worker serves the shell
// from the kept release); its signed-out screen says in plain words that a connection is needed, offers no code or password box, and keeps no passcode
// record on the laptop. The same journey runs on the fast rig on every change: e2e/lf-lifecycle-offline-passcode.spec.ts.
test("B20 (P1): sign out, cut the network: /login opens from the laptop and says a connection is needed; no passcode is kept", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "allow", baseURL });
  const page = await context.newPage();
  try {
    await loginAndPrepare(page, "hr");

    expect(await page.evaluate(() => localStorage.getItem("px-offline-pin-v1")), "a passcode record was kept on the laptop").toBeNull();

    // a real sign-out from the offline shell's own account menu
    await page.goto("/local/");
    await page.getByTestId("local-shell-account").locator("summary").click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/login/, { timeout: 60_000 });

    // no network at all: the sign-in page must still open (from the laptop's own copy of the app) and say a connection is needed
    await context.setOffline(true);
    await page.goto("/login");
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByTestId("local-shell-signed-out")).toContainText("You need a connection", { timeout: 60_000 });
    await expect(page.locator("#code")).toHaveCount(0);
    await expect(page.locator("#password")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/login");
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
