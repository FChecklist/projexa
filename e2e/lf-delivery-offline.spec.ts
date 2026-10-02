import { test, expect, type Page } from "@playwright/test";
import {
  LONG_LINE_TEXT, PROJECT_ID, PROJECT_NAME, backOnline, goOffline, noCrash as checkNoCrash, openScreen, prepareDeliveryLaptop, readOutbox, today,
  typeDate as typeDateInto, typeInto, watchConsole, type Net,
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

const noCrash = (page: Page, problems: string[]) => checkNoCrash(page, problems, expect);
const open = (page: Page, path: string, testId: string) => openScreen(page, path, testId, expect);
const type = (page: Page, label: string, text: string) => typeInto(page, label, text, expect);
const typeDate = (page: Page, label: string, iso: string) => typeDateInto(page, label, iso, expect);

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

test("member, offline: a progress entry typed on the laptop waits, survives a reload, and is sent exactly once when the connection is back", async ({ page, context }) => {
  const net: Net = { mode: "up" };
  const problems = watchConsole(page);
  const { session, sync, app } = await prepareDeliveryLaptop(page, context, net, "member", expect);
  await goOffline(context, net, app);
  problems.length = 0;

  await test.step("offline: type the entry with real keystrokes and save it", async () => {
    await open(page, `/work-progress${q}`, "work-progress");
    await page.getByLabel("BOQ line").selectOption("dl-line-2");
    await type(page, "Quantity done", "37.5");
    await typeDate(page, "Date", TODAY);
    await type(page, "Remarks", "Second coat, grid C-D");
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByTestId("save-note")).toHaveText("Saved on this laptop. It will be sent to the server when you are connected.");
    const waiting = page.getByTestId("work-progress-row").filter({ hasText: "Second coat, grid C-D" });
    await expect(waiting).toContainText("37.5");
    await expect(waiting).toContainText("Worked out when sent");
    await expect(waiting.getByTestId("waiting")).toHaveText("Waiting to sync");
    expect(sync.pushes, "something was sent while offline").toHaveLength(0);
    await noCrash(page, problems);
  });

  await test.step("offline: a reload keeps the entry and its op (outbox + optimistic row persisted)", async () => {
    await page.reload();
    await expect(page.getByTestId("work-progress-row").filter({ hasText: "Second coat, grid C-D" }).getByTestId("waiting")).toHaveText("Waiting to sync");
    const ops = await readOutbox(page, session.userId);
    expect(ops).toEqual([expect.objectContaining({ functionId: "record_work_progress", status: "pending" })]);
  });

  await test.step("online: sent once, with the registry's own parameter names, and the waiting mark clears", async () => {
    await backOnline(page, context, net, app);
    await expect.poll(() => sync.pushes.length, { timeout: 60_000, message: "the offline progress entry was never sent" }).toBe(1);
    expect(sync.pushes[0]).toMatchObject({
      function_id: "record_work_progress", project_id: PROJECT_ID, record_kind: "progress",
      params: { projectId: PROJECT_ID, boqLineItemId: "dl-line-2", entryDate: TODAY, quantityDone: 37.5, remarks: "Second coat, grid C-D" },
    });
    expect(Object.keys(sync.pushes[0].params).sort()).toEqual(["boqLineItemId", "entryDate", "projectId", "quantityDone", "remarks"]);
    // the server's row (its percent: 37.5 of 300 m2 = 12.5 %) replaces the laptop's guess
    const row = page.getByTestId("work-progress-row").filter({ hasText: "Second coat, grid C-D" });
    await expect(row).toContainText("12.5%", { timeout: 30_000 });
    await expect(row.getByTestId("waiting")).toHaveCount(0);
    await expect.poll(() => readOutbox(page, session.userId)).toEqual([]);
    await page.waitForTimeout(3_000); // a second flush pass must not send it again
    expect(sync.pushes).toHaveLength(1);
    await noCrash(page, problems);
  });
});
