import { test, expect, type Page } from "@playwright/test";
import {
  LONG_LINE_TEXT, PROJECT_ID, PROJECT_NAME, goOffline, goOnline, prepareDeliveryLaptop, readOutbox, setNetwork, today, watchConsole,
  type Net,
} from "./support/lf-delivery-stub";

// LOCAL-FIRST, package lf-e10a: the delivery modules (work progress, labour, materials, schedule) on the laptop with NO internet, in a real
// Chromium. Owner's requirement: "the whole software works on the laptop with no internet and with our server down" -- each screen opens
// from the laptop's own database, the person can do their daily work offline, and each edit is sent EXACTLY ONCE when the connection is
// back. Before this file only the BOQ screen had been proven in a browser (e2e/offline-local-first.spec.ts, lf-e8).
//
// Runs ONLY through a production build (the service worker is never registered by `next dev`): playwright.local-first.config.ts with
// this file in its testMatch. The sync service and every /api call of the page are answered in the browser by
// e2e/support/lf-delivery-stub.ts, in the real service's shapes. Nothing reaches Vercel or any real network.
//
// "Offline" = the browser's own switch (context.setOffline) AND the stub refusing every request (a fulfilled route answers even while the
// browser believes it is offline).

const q = `?projectId=${PROJECT_ID}`;
const TODAY = today();

// Next.js mounts ONE empty role="alert" (its route announcer, id __next-route-announcer__); any other alert or dialog is a crash/error.
async function noCrash(page: Page, problems: string[]) {
  await expect(page.locator('[role="dialog"], [role="alertdialog"], [role="alert"]:not(#__next-route-announcer__)'), "an error or dialog appeared").toHaveCount(0);
  await expect(page.getByText(/Application error|Something went wrong|Unhandled Runtime Error/i)).toHaveCount(0);
  expect(problems, "page errors / console errors").toEqual([]);
}

/** Opens a shell path offline and waits for its screen. */
async function open(page: Page, path: string, testId: string) {
  await page.goto(`/local${path}`);
  await expect(page.getByTestId(testId)).toHaveAttribute("data-state", "local");
}

test("member, offline: work progress, labour, materials and the schedule open from the laptop with their real values", async ({ page, context }) => {
  const net: Net = { mode: "up" };
  const problems = watchConsole(page);
  const { app } = await prepareDeliveryLaptop(page, context, net, "member", expect);
  await goOffline(context, net, app);
  problems.length = 0; // what happened while preparing ONLINE is not this test's subject; from here on every error counts

  await test.step("work progress: the entries, newest first, with names, quantities and percents", async () => {
    await open(page, `/work-progress${q}`, "work-progress");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Work Progress / ${PROJECT_NAME}`);
    const rows = page.getByTestId("work-progress-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("2026-09-30");
    await expect(rows.nth(0)).toContainText("HV-102 · Ceiling paint, two coats");
    await expect(rows.nth(0)).toContainText("45");
    await expect(rows.nth(0)).toContainText("15%");
    await expect(rows.nth(1)).toContainText(`HV-101 · ${LONG_LINE_TEXT}`);
    await expect(rows.nth(1)).toContainText("East wing first fix");
    await expect(rows.nth(1)).toContainText("Interior fit-out");
    await expect(page.getByTestId("work-progress-form")).toBeVisible();
    await noCrash(page, problems);
  });

  await test.step("labour: roster with rates, today's head-count, attendance", async () => {
    await open(page, `/labour${q}`, "labour");
    await expect(page.getByTestId("labour-today")).toHaveText("Today: 1 present · 0 half day · 0 absent");
    const roster = page.getByTestId("labour-roster-row");
    await expect(roster).toHaveCount(3);
    await expect(roster.filter({ hasText: "Ravi Kumar" })).toContainText("950.00");
    await expect(roster.filter({ hasText: "Joseph Dsouza" })).toContainText("Inactive");
    await noCrash(page, problems);
  });

  await test.step("materials: stock counted on the laptop (a voided receipt does not count)", async () => {
    await open(page, `/materials${q}`, "materials");
    const gypsum = page.getByTestId("materials-row").filter({ hasText: "Gypsum board 12.5 mm" });
    await expect(gypsum).toContainText("18.75");
    await expect(gypsum).toContainText("90"); // 120 received - 30 issued; the voided 40 is not stock
    await noCrash(page, problems);
  });

  await test.step("schedule: the stored dates, the archived task left out", async () => {
    await open(page, `/schedule${q}`, "schedule");
    const rows = page.getByTestId("schedule-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Partition framing" })).toContainText("2026-09-20");
    await expect(page.getByText("Old mock-up wall")).toHaveCount(0);
    await noCrash(page, problems);
  });
});
