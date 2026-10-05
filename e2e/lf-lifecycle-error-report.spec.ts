import { test, expect } from "@playwright/test";
import { prepareLaptop } from "./support/lf-ai-laptop";
import { APP_ORIGIN } from "./support/boq-local";

// AUDIT-100 A33 / B57 (page level): "errors and pings reach us", proved in a REAL browser against the production build.
// An error thrown in the page while the laptop is OFFLINE is kept in the browser's own storage (the person loses nothing), and when the
// laptop is back online it is delivered to this site's REAL /api/local-first/client-error handler, which answers 204, and the kept copy is removed.
// Everything except that one address is answered by the shared local stand-ins (prepareLaptop). That one address is NOT stubbed: the request goes to
// the real route of the running build, so a 204 here is the real handler's answer, not the test's.
// The earlier journey spec for the same behaviour (audit37-real-journey.spec.ts) needs a real login against the live backend and cannot run in CI.
//
// Run: bunx playwright test -c playwright.local-first.config.ts e2e/lf-lifecycle-error-report.spec.ts

const KEY = "px-client-errors-pending";
const TAG = "a33-offline-probe";

test("an error thrown in the page offline is kept, then delivered to the real error endpoint when back online, and the kept copy goes", async ({ page, context }) => {
  const laptop = await prepareLaptop(page, context, "manager", { person: { role: "owner" } });
  await page.goto("/local");
  await expect(page.getByTestId("local-shell-home")).toBeVisible({ timeout: 60_000 });

  // let the real route through (the shared stub answers every other /api call itself)
  const delivered: Array<{ status: number; body: { reports?: Array<{ kind: string; message: string; where: string | null }> } }> = [];
  await context.route(`${APP_ORIGIN}/api/local-first/client-error`, (route) => route.fallback());
  await context.unroute("**/api/**"); // drop the generic stub so the real handler is reached
  await context.route("**/api/**", async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/local-first/client-error") return route.continue();
    return route.fallback();
  });
  page.on("response", async (r) => {
    if (!r.url().endsWith("/api/local-first/client-error")) return;
    let body: { reports?: Array<{ kind: string; message: string; where: string | null }> } = {};
    try { body = JSON.parse(r.request().postData() ?? "{}"); } catch { /* not ours */ }
    delivered.push({ status: r.status(), body });
  });

  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await context.setOffline(true);
  await page.evaluate((tag) => { setTimeout(() => { throw new Error(tag); }, 0); }, TAG);

  // kept while offline: in the browser's storage, with the message, and nothing reached the server
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), KEY), { message: "the error was not kept while offline" })
    .toContain(TAG);
  expect(delivered.filter((d) => d.body.reports?.some((x) => x.message.includes(TAG)))).toEqual([]);

  // back online: delivered to the real handler. The report endpoint is open on purpose (a failed login is exactly what we need to hear about), and the
  // local Auth stand-in cannot answer the membership lookup the middleware makes for a signed-in write (it would answer 503), so the cookies are dropped first.
  await context.clearCookies();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(() => delivered.find((d) => d.body.reports?.some((x) => x.message.includes(TAG)))?.status, { message: "the kept error never reached /api/local-first/client-error", timeout: 60_000 })
    .toBe(204);
  const hit = delivered.find((d) => d.body.reports?.some((x) => x.message.includes(TAG)))!;
  expect(hit.body.reports!.find((x) => x.message.includes(TAG))!.kind).toBe("window_error");

  // and the kept copy is gone (read back from storage, not a success message)
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), KEY), { message: "the kept copy was not removed after the server took it", timeout: 30_000 })
    .toBeNull();
  void laptop;
});
