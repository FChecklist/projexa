import { test, expect, type Page } from "@playwright/test";
import { AUDIT, createAuditProject, expectGuide, followFix, goBack, readJson, saveButton, today } from "./support/guided-g3";
import { uniqueSuffix } from "./helpers";

// GUIDED ERRORS, G3 -- LABOUR / MANPOWER. One test per fault on the roster, the single attendance form and the daily attendance sheet.
// All data is labelled AUDIT-G3 and never deleted. Run: PLAYWRIGHT_BASE_URL=https://projexa-ai.com bunx playwright test e2e/guided-g3-labour.spec.ts

test.use({ storageState: "playwright/.auth/ceo.json" });

type Worker = { id: string; name: string; dailyRate?: string | number };

async function addWorker(page: Page, projectId: string, label: string): Promise<Worker> {
  const name = `${AUDIT} ${label} ${uniqueSuffix()}`;
  const res = await page.request.post("/api/labour-roster", { data: { projectId, name, trade: "Mason", dailyRate: 180 } });
  expect(res.ok(), `creating the audit worker answered ${res.status()}`).toBe(true);
  return (await res.json()) as Worker;
}

test.describe("guided errors G3 - labour", () => {
  test("L1 new worker: a negative daily rate is explained, the name stays, the corrected worker is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "labour-rate");
    const name = `${AUDIT} Worker ${uniqueSuffix()}`;
    await page.goto(`/labour/new?projectId=${project.id}`);
    await page.locator("#name").fill(name);
    await page.locator("#trade").fill("Mason");
    await page.locator("#dailyRate").fill("-50");
    await saveButton(page).click();

    await expectGuide(page, { id: "labour-rate-invalid", what: "-50" });
    await followFix(page, { path: "/labour/new", focus: "dailyRate" });
    await expect(page.locator("#name")).toHaveValue(name);
    await expect(page.locator("#trade")).toHaveValue("Mason");

    await page.locator("#dailyRate").fill("180");
    await saveButton(page).click();
    await page.waitForURL(/\/labour\/[0-9a-f-]{8,}/);
    const roster = await readJson<{ roster: Worker[] }>(page.request, `/api/labour-roster?projectId=${project.id}`);
    const saved = roster.roster.find((w) => w.name === name);
    expect(saved, "the corrected worker is stored").toBeTruthy();
    expect(Number(saved!.dailyRate)).toBe(180);
  });

  test("L2 attendance for a day that has not happened: explained, the worker stays, the corrected day is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "attendance-future");
    const worker = await addWorker(page, project.id, "Future");
    await page.goto(`/labour/attendance/new?projectId=${project.id}`);
    await page.locator("#attendanceDate").fill(today(10));
    await saveButton(page).click();

    await expectGuide(page, { id: "input-date-in-future" });
    await followFix(page, { path: "/labour/attendance/new", focus: "attendanceDate" });
    await page.locator("#attendanceDate").fill(today());
    await saveButton(page).click();
    await page.waitForURL((u) => u.pathname === "/labour");
    const att = await readJson<{ attendance: { rosterId: string; attendanceDate: string }[] }>(page.request, `/api/attendance?projectId=${project.id}&attendanceDate=${today()}`);
    expect(att.attendance.some((a) => a.rosterId === worker.id)).toBe(true);
  });

  test("L3 attendance with 30 hours: explained, Fix highlights the hours box, the corrected hours are stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "attendance-hours");
    const worker = await addWorker(page, project.id, "Hours");
    await page.goto(`/labour/attendance/new?projectId=${project.id}`);
    await page.locator("#hoursWorked").fill("30");
    await saveButton(page).click();

    await expectGuide(page, { id: "design-timesheet-hours", what: '"30"' });
    await followFix(page, { path: "/labour/attendance/new", focus: "hoursWorked" });
    await page.locator("#hoursWorked").fill("8");
    await saveButton(page).click();
    await page.waitForURL((u) => u.pathname === "/labour");
    const att = await readJson<{ attendance: { rosterId: string; hoursWorked: string | number | null }[] }>(page.request, `/api/attendance?projectId=${project.id}&attendanceDate=${today()}`);
    expect(att.attendance.some((a) => a.rosterId === worker.id && Number(a.hoursWorked) === 8)).toBe(true);
  });

  test("L4 attendance on a project with nobody on the roster: explained, Fix goes to New Worker, Back returns to the form", async ({ page }) => {
    const project = await createAuditProject(page.request, "attendance-noroster");
    await page.goto(`/labour/attendance/new?projectId=${project.id}`);
    await expectGuide(page, { id: "labour-none-yet", fix: /Add a worker/ });
    await followFix(page, { path: "/labour/new", focus: "name" });
    await page.locator("#name").fill(`${AUDIT} First ${uniqueSuffix()}`);
    await page.locator("#trade").fill("Carpenter");
    await page.locator("#dailyRate").fill("150");
    await saveButton(page).click();
    await page.waitForURL(/\/labour\/[0-9a-f-]{8,}/);
    await goBack(page, "/labour/attendance/new");
    // the roster now has one person, who is chosen already; the form is usable
    await saveButton(page).click();
    await page.waitForURL((u) => u.pathname === "/labour");
    const att = await readJson<{ attendance: unknown[] }>(page.request, `/api/attendance?projectId=${project.id}&attendanceDate=${today()}`);
    expect(att.attendance.length).toBe(1);
  });

  test("L5 the same worker twice on one day: the server's refusal is explained and points at that day's sheet", async ({ page }) => {
    const project = await createAuditProject(page.request, "attendance-twice");
    const worker = await addWorker(page, project.id, "Twice");
    const first = await page.request.post("/api/attendance", { data: { projectId: project.id, rosterId: worker.id, attendanceDate: today(), status: "present" } });
    expect(first.ok()).toBe(true);
    await page.goto(`/labour/attendance/new?projectId=${project.id}`);
    await saveButton(page).click();
    await expectGuide(page, { id: "labour-attendance-duplicate", what: /already recorded/ });
    await followFix(page, { path: "/labour" });
  });

  test("L6 daily sheet: every marked row survives a reload, a bad hours value is explained, the corrected sheet is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "attendance-sheet");
    const a = await addWorker(page, project.id, "Sheet A");
    const b = await addWorker(page, project.id, "Sheet B");
    const c = await addWorker(page, project.id, "Sheet C");
    await page.goto(`/labour/attendance/${today()}?projectId=${project.id}`);
    for (const w of [a, b, c]) {
      await page.getByRole("radiogroup", { name: `Attendance for ${w.name}` }).getByText("Present", { exact: true }).click();
    }
    await page.getByTestId(`hours-${b.id}`).fill("30");

    // a reload is what a sign-in that ran out looks like: nothing marked may be lost
    await page.reload();
    for (const w of [a, b, c]) {
      await expect(page.locator(`input[name="attendance-${w.id}"][value="present"]`)).toBeChecked();
    }
    await expect(page.getByTestId(`hours-${b.id}`)).toHaveValue("30");

    await page.getByTestId("attendance-sheet-save").click();
    await expectGuide(page, { id: "design-timesheet-hours", what: "30" });
    await followFix(page, { path: `/labour/attendance/${today()}`, focus: `hours-${b.id}` });
    await page.getByTestId(`hours-${b.id}`).fill("9");
    await page.getByTestId("attendance-sheet-save").click();
    await expect(page.getByText(/saved — 3 rows/)).toBeVisible();

    const att = await readJson<{ attendance: { rosterId: string; hoursWorked: string | number | null }[] }>(page.request, `/api/attendance?projectId=${project.id}&attendanceDate=${today()}`);
    expect(att.attendance.length).toBe(3);
    expect(att.attendance.find((r) => r.rosterId === b.id)?.hoursWorked).toBeTruthy();
    expect(Number(att.attendance.find((r) => r.rosterId === b.id)?.hoursWorked)).toBe(9);
  });

  test("L7 daily sheet for a future day: explained, Fix opens today's sheet", async ({ page }) => {
    const project = await createAuditProject(page.request, "attendance-sheet-future");
    const w = await addWorker(page, project.id, "FutureSheet");
    await page.goto(`/labour/attendance/${today(7)}?projectId=${project.id}`);
    await page.getByRole("radiogroup", { name: `Attendance for ${w.name}` }).getByText("Present", { exact: true }).click();
    await page.getByTestId("attendance-sheet-save").click();
    await expectGuide(page, { id: "labour-attendance-future-sheet" });
    await followFix(page, { path: `/labour/attendance/${today()}` });
  });
});
