import { test, expect } from "@playwright/test";
import { prepareLaptop } from "./support/lf-ai-laptop";

// AUDIT-100 A33 / B57 (page level), rewritten for the DEVICE LOG (2026-10): "errors reach us, complete, and nothing is lost on the way".
// An error thrown in the page while the laptop is OFFLINE is kept in the browser's own IndexedDB (the person loses nothing), and when the
// laptop is back online the complete report (message, stack, steps, device) is delivered to POST /api/client-logs, after which the kept copy is removed.
// /api/client-logs is answered by this test (it proxies VERIDIAN, which the CI rig does not have); every other address is answered by the shared local stand-ins
// (prepareLaptop). What is real is everything on the device: the capture hooks, the IndexedDB outbox, the retry on "online", and the removal after delivery.
// The old one-line channel (/api/local-first/client-error) still exists for old bundles and has its own route test.
//
// Run: bunx playwright test -c playwright.local-first.config.ts e2e/lf-lifecycle-error-report.spec.ts

const TAG = "a33-offline-probe";

type Delivered = { status: number; events: Array<{ kind: string; message: string; stack: string | null; breadcrumbs: unknown[]; context: { userAgent: string } }> };

test("an error thrown in the page offline is kept on the device, then delivered complete to /api/client-logs when back online, and the kept copy goes", async ({ page, context }) => {
  const laptop = await prepareLaptop(page, context, "manager", { person: { role: "owner" } });
  await page.goto("/local");
  await expect(page.getByTestId("local-shell-home")).toBeVisible({ timeout: 60_000 });

  const delivered: Delivered[] = [];
  await context.unroute("**/api/**"); // drop the generic stub so this one address can be answered here
  await context.route("**/api/client-logs", async (route, request) => {
    let body: { events?: Delivered["events"] } = {};
    try { body = JSON.parse(request.postData() ?? "{}"); } catch { /* not ours */ }
    delivered.push({ status: 200, events: body.events ?? [] });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accepted: (body.events ?? []).length, rejected: [] }) });
  });
  await context.route("**/api/**", (route) => route.fallback());

  // what the device is holding right now (read straight from the browser's own database, not from a success message)
  const kept = () =>
    page.evaluate(
      () =>
        new Promise<string[] | null>((resolve) => {
          // never open a database that is not there yet: that would create it empty and the app could not set it up
          indexedDB.databases().then((dbs) => {
          if (!dbs.some((d) => d.name === "px-client-log")) return resolve(null);
          const open = indexedDB.open("px-client-log");
          open.onerror = () => resolve(null);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("outbox")) { db.close(); return resolve(null); }
            const q = db.transaction("outbox").objectStore("outbox").getAll();
            q.onsuccess = () => { db.close(); resolve((q.result as Array<{ message: string }>).map((e) => e.message)); };
            q.onerror = () => { db.close(); resolve(null); };
          };
          }, () => resolve(null));
        })
  );

  await context.setOffline(true);
  await page.evaluate((tag) => { setTimeout(() => { throw new Error(tag); }, 0); }, TAG);

  // kept while offline: on the device, and nothing reached the server
  await expect.poll(async () => ((await kept()) ?? []).some((m) => m.includes(TAG)), { message: "the error was not kept on the device while offline" }).toBe(true);
  expect(delivered.filter((d) => d.events.some((e) => e.message.includes(TAG)))).toEqual([]);

  // back online: delivered, complete
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(() => delivered.some((d) => d.events.some((e) => e.message.includes(TAG))), { message: "the kept error never reached /api/client-logs", timeout: 60_000 })
    .toBe(true);
  const hit = delivered.flatMap((d) => d.events).find((e) => e.message.includes(TAG))!;
  expect(hit.kind).toBe("error");
  expect(hit.stack).toBeTruthy();
  expect(Array.isArray(hit.breadcrumbs)).toBe(true);
  expect(hit.context.userAgent.length).toBeGreaterThan(0);

  // and the kept copy is gone (read back from the browser's database)
  await expect
    .poll(async () => ((await kept()) ?? []).some((m) => m.includes(TAG)), { message: "the kept copy was not removed after the server took it", timeout: 30_000 })
    .toBe(false);
  void laptop;
});
