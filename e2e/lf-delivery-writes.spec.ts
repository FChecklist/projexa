import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  PROJECT_ID, backOnline, goOffline, noCrash as checkNoCrash, openScreen, prepareDeliveryLaptop, readOutbox, today, typeDate as typeDateInto,
  typeInto, watchConsole, type Net, type Prepared,
} from "./support/lf-delivery-stub";

// LOCAL-FIRST, package lf-e10a: every WRITE the delivery screens keep on the laptop (attendance from the form and from the day's sheet,
// a material receipt, a material issue), made with the network OFF in a real Chromium, typed with real keystrokes, kept across a reload,
// and sent EXACTLY ONCE when the connection is back -- with the function id and the parameter names of the REAL registry
// (compliance-tracker src/lib/pipeline/function-registry.ts, mirrored in src/lib/local-first/ai/function-registry.json). And a change the
// server turns down must reach the person, with what they typed kept (OutboxAttention), never vanish silently.
//
// The progress entry's write is in lf-delivery-offline.spec.ts. Same set-up and rules as that file (see its header).

const q = `?projectId=${PROJECT_ID}`;
const TODAY = today();

const noCrash = (page: Page, problems: string[]) => checkNoCrash(page, problems, expect);
const open = (page: Page, path: string, testId: string) => openScreen(page, path, testId, expect);
const type = (page: Page, label: string, text: string) => typeInto(page, label, text, expect);
const typeDate = (page: Page, label: string, iso: string) => typeDateInto(page, label, iso, expect);

/** Prepared online, then offline; console errors from the online prepare are not this file's subject. */
async function offlineLaptop(page: Page, context: BrowserContext, role = "member"): Promise<Prepared & { net: Net; problems: string[] }> {
  const net: Net = { mode: "up" };
  const problems = watchConsole(page);
  const prepared = await prepareDeliveryLaptop(page, context, net, role, expect);
  await goOffline(context, net, prepared.app);
  problems.length = 0;
  return { ...prepared, net, problems };
}

/** After coming back online: exactly ONE push of this function, and the outbox empty; a later flush pass does not send it again. */
async function sentExactlyOnce(page: Page, l: Prepared, functionId: string) {
  await expect.poll(() => l.sync.pushes.length, { timeout: 60_000, message: `the offline ${functionId} was never sent` }).toBe(1);
  await expect.poll(() => readOutbox(page, l.session.userId), { message: "the sent op is still in the outbox" }).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(2_000);
  expect(l.sync.pushes, "the same edit was sent twice").toHaveLength(1);
  expect(l.sync.pushes[0].function_id).toBe(functionId);
  return l.sync.pushes[0];
}

test("attendance from the form: kept offline, survives a reload, sent once as record_attendance {projectId, rosterId, date, status, hours}", async ({ page, context }) => {
  const l = await offlineLaptop(page, context);

  await test.step("offline: mark Meena half day, 4.5 hours, with real keystrokes", async () => {
    await open(page, `/labour/attendance/new${q}`, "labour-attendance-new");
    await page.getByLabel("Worker").selectOption({ label: "Meena Pillai · painter" });
    await typeDate(page, "Date", TODAY);
    await page.getByLabel("Status").selectOption("half_day");
    await type(page, "Hours", "4.5");
    await page.getByRole("button", { name: "Save attendance" }).click();
    await expect(page.getByTestId("save-note")).toHaveText("Saved on this laptop. It will be sent to the server when you are connected.");
    await expect(page.getByLabel("Hours", { exact: true })).toHaveValue("");
    expect(l.sync.pushes).toHaveLength(0);
    await noCrash(page, l.problems);
  });

  await test.step("offline: the attendance list shows it waiting, also after a reload", async () => {
    await open(page, `/labour${q}&tab=attendance`, "labour");
    await expect(page.getByTestId("labour-today")).toHaveText("Today: 1 present · 1 half day · 0 absent");
    const row = page.getByTestId("labour-attendance-row").filter({ hasText: "Meena Pillai" }).filter({ hasText: TODAY });
    await expect(row).toContainText("Half day");
    await expect(row).toContainText("4.5");
    await expect(row).toContainText("Worked out when sent");
    await expect(row.getByTestId("waiting")).toHaveText("Waiting to sync");
    await page.reload();
    await expect(page.getByTestId("labour-attendance-row").filter({ hasText: "Meena Pillai" }).filter({ hasText: TODAY }).getByTestId("waiting")).toHaveText("Waiting to sync");
    expect(await readOutbox(page, l.session.userId)).toEqual([expect.objectContaining({ functionId: "record_attendance", status: "pending" })]);
  });

  await test.step("online: sent once with the registry's names; the server's row (cost from the worker's rate) replaces the guess", async () => {
    await backOnline(page, context, l.net, l.app);
    const op = await sentExactlyOnce(page, l, "record_attendance");
    expect(op).toMatchObject({ project_id: PROJECT_ID, record_kind: "attendance" });
    expect(op.params).toEqual({ projectId: PROJECT_ID, rosterId: "w-2", date: TODAY, status: "half_day", hours: 4.5 });
    const row = page.getByTestId("labour-attendance-row").filter({ hasText: "Meena Pillai" }).filter({ hasText: TODAY });
    await expect(row).toContainText("410.00", { timeout: 30_000 }); // 820.00 a day, half a day
    await expect(row.getByTestId("waiting")).toHaveCount(0);
    await noCrash(page, l.problems);
  });
});

test("attendance from the day's sheet: one tap is one record_attendance, sent once", async ({ page, context }) => {
  const l = await offlineLaptop(page, context);

  await test.step("offline: the sheet lists the ACTIVE workers with today's marks; tap Absent for Meena", async () => {
    await open(page, `/labour/attendance/${TODAY}${q}`, "labour-attendance-sheet");
    const rows = page.getByTestId("labour-sheet-row");
    await expect(rows).toHaveCount(2); // Joseph is inactive
    await expect(page.getByTestId("labour-sheet-counts")).toHaveText("1 present · 0 half day · 0 absent · 1 not marked");
    await expect(rows.filter({ hasText: "Ravi Kumar" })).toContainText("Present");
    await expect(rows.filter({ hasText: "Ravi Kumar" })).toContainText("950.00");
    await rows.filter({ hasText: "Meena Pillai" }).getByRole("button", { name: "Absent" }).click();
    await expect(page.getByTestId("labour-sheet-counts")).toHaveText("1 present · 0 half day · 1 absent · 0 not marked");
    await expect(rows.filter({ hasText: "Meena Pillai" }).getByTestId("waiting")).toHaveText("Waiting to sync");
    await page.reload();
    await expect(page.getByTestId("labour-sheet-row").filter({ hasText: "Meena Pillai" }).getByTestId("waiting")).toHaveText("Waiting to sync");
    await noCrash(page, l.problems);
  });

  await test.step("online: sent once, no hours (none was given), and the mark is the server's", async () => {
    await backOnline(page, context, l.net, l.app);
    const op = await sentExactlyOnce(page, l, "record_attendance");
    expect(op.params).toEqual({ projectId: PROJECT_ID, rosterId: "w-2", date: TODAY, status: "absent" });
    const meena = page.getByTestId("labour-sheet-row").filter({ hasText: "Meena Pillai" });
    await expect(meena.getByTestId("waiting")).toHaveCount(0, { timeout: 30_000 });
    await expect(meena).toContainText("Absent");
    await expect(meena).toContainText("0.00");
    await noCrash(page, l.problems);
  });
});

test("material receipt: kept offline (no cost decided on the laptop), counted as stock at once, sent once as record_material_receipt", async ({ page, context }) => {
  const l = await offlineLaptop(page, context);

  await test.step("offline: record 6 drums of emulsion with a delivery note, with real keystrokes", async () => {
    await open(page, `/materials/receipts/new${q}`, "material-receipt-new");
    await page.getByLabel("Material").selectOption({ label: "Acrylic emulsion (drum)" });
    await type(page, "Quantity", "6");
    await typeDate(page, "Received on", TODAY);
    await type(page, "Reference", "DN-4610");
    await type(page, "Notes", "Pallet 2 of 3, two drums re-sealed on site");
    await page.getByRole("button", { name: "Save receipt" }).click();
    await expect(page.getByTestId("save-note")).toHaveAttribute("data-ok", "1");
    await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("");
    await noCrash(page, l.problems);
  });

  await test.step("offline: the receipts list shows it waiting, the stock already counts it, and a reload keeps both", async () => {
    await open(page, `/materials${q}&tab=receipts`, "materials");
    const row = page.getByTestId("materials-receipt-row").filter({ hasText: "DN-4610" });
    await expect(row).toContainText("Acrylic emulsion");
    await expect(row).toContainText("6 drum");
    await expect(row).toContainText("Set by the server");
    await expect(row.getByTestId("waiting")).toHaveText("Waiting to sync");
    // the voided receipt stays on the list, struck through
    await expect(page.getByTestId("materials-receipt-row").filter({ hasText: "DN-4519" })).toHaveClass(/line-through/);
    await page.reload();
    await open(page, `/materials${q}`, "materials");
    await expect(page.getByTestId("materials-row").filter({ hasText: "Acrylic emulsion" })).toContainText("16"); // 10 + 6 waiting
    expect(await readOutbox(page, l.session.userId)).toEqual([expect.objectContaining({ functionId: "record_material_receipt", status: "pending" })]);
  });

  await test.step("online: sent once without any cost; the server's row carries the material's own cost", async () => {
    await backOnline(page, context, l.net, l.app);
    const op = await sentExactlyOnce(page, l, "record_material_receipt");
    expect(op.params).toEqual({ projectId: PROJECT_ID, materialId: "mat-2", quantity: 6, receivedDate: TODAY, reference: "DN-4610", notes: "Pallet 2 of 3, two drums re-sealed on site" });
    await open(page, `/materials${q}&tab=receipts`, "materials");
    const row = page.getByTestId("materials-receipt-row").filter({ hasText: "DN-4610" });
    await expect(row).toContainText("142.00");
    await expect(row.getByTestId("waiting")).toHaveCount(0);
    await noCrash(page, l.problems);
  });
});

test("material issue: more than is on hand is refused on the laptop; a real issue is kept, sent once as record_material_issue", async ({ page, context }) => {
  const l = await offlineLaptop(page, context);

  await test.step("offline: 500 sheets is more than the 90 on hand -> said in words, nothing kept", async () => {
    await open(page, `/materials/issues/new${q}`, "material-issue-new");
    await page.getByLabel("Material").selectOption({ label: "Gypsum board 12.5 mm · 90 sheet on hand" });
    await type(page, "Quantity", "500");
    await page.getByRole("button", { name: "Save issue" }).click();
    await expect(page.getByTestId("material-issue-too-much")).toHaveText("Only 90 sheet is on hand on this laptop.");
    expect(await readOutbox(page, l.session.userId)).toEqual([]);
  });

  await test.step("offline: 12 sheets to Meena against HV-101, with a note", async () => {
    await type(page, "Quantity", "12");
    await typeDate(page, "Issued on", TODAY);
    await page.getByLabel("BOQ item").selectOption("dl-line-1");
    await type(page, "Issued to", "Meena Pillai");
    await type(page, "Note", "Level 3 corridor, east side");
    await page.getByRole("button", { name: "Save issue" }).click();
    await expect(page.getByTestId("save-note")).toHaveAttribute("data-ok", "1");
    await open(page, `/materials${q}&tab=issues`, "materials");
    await expect(page.getByTestId("materials-issue-row")).toHaveCount(2);
    const row = page.getByTestId("materials-issue-row").filter({ hasText: "Meena Pillai" });
    await expect(row).toContainText(TODAY);
    await expect(row).toContainText("HV-101");
    await expect(row).toContainText("12 sheet");
    await expect(row.getByTestId("waiting")).toHaveText("Waiting to sync");
    await page.reload();
    await open(page, `/materials${q}`, "materials");
    await expect(page.getByTestId("materials-row").filter({ hasText: "Gypsum board 12.5 mm" })).toContainText("78"); // 90 - 12 waiting
    await noCrash(page, l.problems);
  });

  await test.step("online: sent once with the registry's names", async () => {
    await backOnline(page, context, l.net, l.app);
    const op = await sentExactlyOnce(page, l, "record_material_issue");
    expect(op.params).toEqual({ projectId: PROJECT_ID, materialId: "mat-1", quantity: 12, issuedDate: TODAY, boqLineItemId: "dl-line-1", issuedTo: "Meena Pillai", note: "Level 3 corridor, east side" });
    await open(page, `/materials${q}&tab=issues`, "materials");
    const row = page.getByTestId("materials-issue-row").filter({ hasText: "Meena Pillai" });
    await expect(row).toContainText("12 sheet");
    await expect(row.getByTestId("waiting")).toHaveCount(0);
    await noCrash(page, l.problems);
  });
});

test("a change the server turns down reaches the person on the screen they are on, with what they typed kept", async ({ page, context }) => {
  const l = await offlineLaptop(page, context);
  l.sync.answers.set("record_attendance", { status: "rejected", code: "ROLE_TOO_LOW" });

  await test.step("offline: mark attendance", async () => {
    await open(page, `/labour/attendance/new${q}`, "labour-attendance-new");
    await page.getByLabel("Worker").selectOption({ label: "Ravi Kumar · carpenter" });
    await typeDate(page, "Date", "2026-10-01");
    await type(page, "Hours", "9");
    await page.getByRole("button", { name: "Save attendance" }).click();
    await expect(page.getByTestId("save-note")).toHaveAttribute("data-ok", "1");
  });

  await test.step("online: the server says no -> a card in words on THIS screen, the waiting row undone, the text kept", async () => {
    await open(page, `/labour${q}&tab=attendance`, "labour");
    await expect(page.getByTestId("labour-attendance-row").filter({ hasText: "2026-10-01" })).toHaveCount(1);
    await backOnline(page, context, l.net, l.app);
    await expect.poll(() => l.sync.pushes.length, { timeout: 60_000 }).toBe(1);
    const card = page.getByTestId("outbox-attention");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId("outbox-draft")).toContainText("Attendance was not saved.");
    await expect(card.getByTestId("outbox-draft")).toContainText("Your role in this organisation does not allow this change");
    await expect(card.getByTestId("outbox-draft-text")).toHaveText("2026-10-01\n\npresent\n\nHours: 9");
    await expect(page.getByTestId("labour-attendance-row").filter({ hasText: "2026-10-01" })).toHaveCount(0);
    expect(await readOutbox(page, l.session.userId)).toEqual([]);
    await page.waitForTimeout(2_000);
    expect(l.sync.pushes, "a turned-down change was sent again").toHaveLength(1);
    await noCrash(page, l.problems);
  });
});
