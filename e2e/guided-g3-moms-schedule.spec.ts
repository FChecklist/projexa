import { test, expect, type Page } from "@playwright/test";
import { AUDIT, createAuditProject, expectGuide, followFix, panel, readJson, saveButton, today } from "./support/guided-g3";
import { uniqueSuffix } from "./helpers";

// GUIDED ERRORS, G3 -- MINUTES OF MEETING and SCHEDULE (tasks, milestones, sprints). One test per fault. Shared links that no longer open are tested
// without a sign-in (they are public pages). All data is labelled AUDIT-G3 and never deleted.
// Run: PLAYWRIGHT_BASE_URL=https://projexa-ai.com bunx playwright test e2e/guided-g3-moms-schedule.spec.ts

test.use({ storageState: "playwright/.auth/ceo.json" });

type Row = { id: string; title?: string; name?: string; status?: string; minutes?: string | null };

async function addMeeting(page: Page, projectId: string, label: string): Promise<{ id: string; title: string }> {
  const title = `${AUDIT} ${label} ${uniqueSuffix()}`;
  const res = await page.request.post("/api/moms", { data: { projectId, title, scheduledAt: new Date().toISOString(), meetingType: "team", attendees: [], agenda: [] } });
  expect(res.ok(), `creating the audit meeting answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { id: string };
  return { id: body.id, title };
}

async function addTask(page: Page, projectId: string, label: string): Promise<{ id: string; title: string }> {
  const title = `${AUDIT} ${label} ${uniqueSuffix()}`;
  const res = await page.request.post("/api/schedule/tasks", { data: { projectId, title, priority: "no_priority", startDate: today() } });
  expect(res.ok(), `creating the audit task answered ${res.status()}`).toBe(true);
  const body = (await res.json()) as { id: string };
  return { id: body.id, title };
}

test.describe("guided errors G3 - minutes of meeting", () => {
  test("MOM1 the new-meeting form keeps title, agenda and minutes through a reload", async ({ page }) => {
    const project = await createAuditProject(page.request, "mom-draft");
    const title = `${AUDIT} Weekly ${uniqueSuffix()}`;
    await page.goto(`/moms/new?projectId=${project.id}`);
    await page.locator("#title").fill(title);
    await page.locator("#agenda").fill("Safety\nProgress\nBudget");
    await page.locator("#minutes").fill("Concrete pour agreed for Thursday.");
    await page.reload();
    await expect(page.getByTestId("draft-restored")).toBeVisible();
    await expect(page.locator("#title")).toHaveValue(title);
    await expect(page.locator("#agenda")).toHaveValue("Safety\nProgress\nBudget");
    await expect(page.locator("#minutes")).toHaveValue("Concrete pour agreed for Thursday.");
    await saveButton(page).click();
    await page.waitForURL(/\/moms\/[0-9a-f-]{8,}/);
    const list = await readJson<{ meetings: Row[] }>(page.request, `/api/moms?projectId=${project.id}`);
    expect(list.meetings.some((m) => m.title === title)).toBe(true);
  });

  test("MOM2 publishing twice: the second press is explained as already done", async ({ page }) => {
    const project = await createAuditProject(page.request, "mom-publish");
    const meeting = await addMeeting(page, project.id, "Publish");
    await page.goto(`/moms/${meeting.id}`);
    await expect(page.getByRole("button", { name: /Publish & Lock/ })).toBeVisible();
    // somebody else (or an earlier click) publishes it first
    const first = await page.request.patch(`/api/moms/${meeting.id}`, { data: { action: "publish" } });
    expect(first.ok()).toBe(true);
    await page.getByRole("button", { name: /Publish & Lock/ }).click();
    await page.getByRole("button", { name: /^(Publish|Confirm|Yes)/ }).last().click();
    await expectGuide(page, { id: "mom-already-published" });
    const after = await readJson<Row>(page.request, `/api/moms/${meeting.id}`);
    expect(after.status).toBe("published");
  });

  test("MOM3 sharing minutes that are not published yet: explained, Fix highlights Publish & Lock", async ({ page }) => {
    const project = await createAuditProject(page.request, "mom-share");
    const meeting = await addMeeting(page, project.id, "Share");
    await page.goto(`/moms/${meeting.id}`);
    await page.getByTestId("share-menu-button").click();
    await page.getByTestId("share-copy-link").click();
    await expectGuide(page, { id: "mom-share-unpublished" });
    await followFix(page, { path: `/moms/${meeting.id}`, focus: "mom-publish" });
  });

  test("MOM4 the unsaved minutes survive a reload", async ({ page }) => {
    const project = await createAuditProject(page.request, "mom-minutes");
    const meeting = await addMeeting(page, project.id, "Minutes");
    await page.goto(`/moms/${meeting.id}`);
    await page.locator("#mom-minutes").fill("Decision: start piling on Monday.");
    await page.reload();
    await expect(page.locator("#mom-minutes")).toHaveValue("Decision: start piling on Monday.");
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText(/^Saved \d/)).toBeVisible();
    const after = await readJson<Row>(page.request, `/api/moms/${meeting.id}`);
    expect(after.minutes).toBe("Decision: start piling on Monday.");
  });

  test("MOM5 generating a summary with no minutes typed: explained, Fix highlights the minutes box", async ({ page }) => {
    const project = await createAuditProject(page.request, "mom-summary");
    const meeting = await addMeeting(page, project.id, "Summary");
    await page.goto(`/moms/${meeting.id}`);
    await page.getByRole("button", { name: /Generate AI Summary/ }).click();
    await expectGuide(page);
    await followFix(page, { path: `/moms/${meeting.id}`, focus: "mom-minutes" });
  });

  test("MOM6 a shared minutes link that has expired: the public page explains it in full", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(`/shared/mom/${"x".repeat(40)}`);
    await expectGuide(page, { id: "mom-link-expired" });
    await context.close();
  });

  test("RPT1 a shared report link that has expired: the public page explains it in full", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(`/share/report/${"y".repeat(40)}`);
    await expectGuide(page, { id: "report-share-expired" });
    await page.goto(`/share/attendance/${"z".repeat(40)}`);
    await expectGuide(page, { id: "report-share-expired" });
    await context.close();
  });
});

test.describe("guided errors G3 - schedule", () => {
  test("SCH1 new task: a due date before the start date is explained, the title stays, the corrected task is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "task-dates");
    const title = `${AUDIT} Pour slab ${uniqueSuffix()}`;
    await page.goto(`/schedule/tasks/new?projectId=${project.id}`);
    await page.locator("#title").fill(title);
    await page.locator("#startDate").fill(today(10));
    await page.locator("#dueDate").fill(today(2));
    await saveButton(page).click();

    await expectGuide(page, { id: "schedule-task-dates-order" });
    await followFix(page, { path: "/schedule/tasks/new", focus: "dueDate" });
    await expect(page.locator("#title")).toHaveValue(title);
    await page.locator("#dueDate").fill(today(14));
    await saveButton(page).click();
    await page.waitForURL(/\/schedule\/tasks\/[0-9a-f-]{8,}/);
    const list = await readJson<{ tasks: Row[] }>(page.request, `/api/schedule/tasks?projectId=${project.id}`);
    expect(list.tasks.some((t) => t.title === title)).toBe(true);
  });

  test("SCH2 new task: a negative duration is explained and highlights the duration box", async ({ page }) => {
    const project = await createAuditProject(page.request, "task-duration");
    await page.goto(`/schedule/tasks/new?projectId=${project.id}`);
    await page.locator("#title").fill(`${AUDIT} Short ${uniqueSuffix()}`);
    await page.locator("#startDate").fill(today());
    await page.locator("#durationDays").fill("-3");
    await saveButton(page).click();
    await expectGuide(page, { id: "schedule-task-duration", what: "-3" });
    await followFix(page, { path: "/schedule/tasks/new", focus: "durationDays" });
  });

  test("SCH3 the new-task form keeps every value through a reload", async ({ page }) => {
    const project = await createAuditProject(page.request, "task-draft");
    const title = `${AUDIT} Draft task ${uniqueSuffix()}`;
    await page.goto(`/schedule/tasks/new?projectId=${project.id}`);
    await page.locator("#title").fill(title);
    await page.locator("#startDate").fill(today(3));
    await page.reload();
    await expect(page.getByTestId("draft-restored")).toBeVisible();
    await expect(page.locator("#title")).toHaveValue(title);
    await expect(page.locator("#startDate")).toHaveValue(today(3));
  });

  test("SCH4 editing a task: a due date before the start date is explained on the task page", async ({ page }) => {
    const project = await createAuditProject(page.request, "task-edit");
    const task = await addTask(page, project.id, "Edit");
    await page.goto(`/schedule/tasks/${task.id}?projectId=${project.id}`);
    await page.getByRole("button", { name: /^Edit/ }).first().click();
    await page.locator('input[type="date"]').nth(1).fill(today(-20));
    await page.getByRole("button", { name: /^Save/ }).first().click();
    await expectGuide(page, { id: "schedule-task-dates-order" });
    await followFix(page, { path: `/schedule/tasks/${task.id}`, focus: "task-due-date" });
  });

  test("SCH5 logging 30 hours on a task is explained and highlights the hours box", async ({ page }) => {
    const project = await createAuditProject(page.request, "task-hours");
    const task = await addTask(page, project.id, "Hours");
    await page.goto(`/schedule/tasks/${task.id}?projectId=${project.id}`);
    await page.getByRole("button", { name: "Log Time", exact: true }).click();
    await page.locator("#task-log-hours").fill("30");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expectGuide(page, { id: "design-timesheet-hours", what: '"30"' });
    await followFix(page, { path: `/schedule/tasks/${task.id}`, focus: "task-log-hours" });
  });

  test("SCH6 milestone without a date: explained, Fix highlights the date box, the typed name stays, the corrected milestone is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "milestone");
    const name = `${AUDIT} Foundation ${uniqueSuffix()}`;
    await page.goto(`/schedule?projectId=${project.id}&tab=milestones`);
    await page.getByRole("button", { name: /New Milestone/ }).click();
    await page.locator("#milestone-name").fill(name);
    await page.getByRole("button", { name: /^Save/ }).click();

    await expectGuide(page, { id: "schedule-milestone-no-date" });
    await followFix(page, { path: "/schedule", focus: "milestone-target-date" });
    await expect(page.locator("#milestone-name")).toHaveValue(name);
    await page.locator("#milestone-target-date").fill(today(60));
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByText(name)).toBeVisible();
    const list = await readJson<{ milestones: Row[] }>(page.request, `/api/milestones?projectId=${project.id}`);
    expect(list.milestones.some((m) => m.name === name)).toBe(true);
  });

  test("SCH7 milestone form keeps its values through a reload and re-opens by itself", async ({ page }) => {
    const project = await createAuditProject(page.request, "milestone-draft");
    const name = `${AUDIT} Roof ${uniqueSuffix()}`;
    await page.goto(`/schedule?projectId=${project.id}&tab=milestones`);
    await page.getByRole("button", { name: /New Milestone/ }).click();
    await page.locator("#milestone-name").fill(name);
    await page.reload();
    await expect(page.locator("#milestone-name")).toHaveValue(name);
    await expect(page.getByTestId("draft-restored")).toBeVisible();
  });

  test("SCH8 new sprint: an end date before the start date is explained, the corrected sprint is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "sprint");
    const name = `${AUDIT} Sprint ${uniqueSuffix()}`;
    await page.goto(`/schedule/sprints/new?projectId=${project.id}`);
    await page.locator("#sprint-name").fill(name);
    await page.locator("#sprint-start").fill(today(10));
    await page.locator("#sprint-end").fill(today(2));
    await page.getByRole("button", { name: /^(Save|Create)/ }).first().click();
    await expectGuide(page, { id: "schedule-sprint-dates-order" });
    await followFix(page, { path: "/schedule/sprints/new", focus: "sprint-end" });
    await expect(page.locator("#sprint-name")).toHaveValue(name);
    await page.locator("#sprint-end").fill(today(24));
    await page.getByRole("button", { name: /^(Save|Create)/ }).first().click();
    await page.waitForURL((u) => u.pathname === "/schedule");
    const list = await readJson<{ sprints: { name: string }[] }>(page.request, `/api/schedule/sprints?projectId=${project.id}`);
    expect(list.sprints.some((s) => s.name === name)).toBe(true);
  });

  test("SCH9 a server fault while saving a new task (simulated 500): explained, Try again offered, nothing typed is lost", async ({ page }) => {
    const project = await createAuditProject(page.request, "task-server");
    await page.route("**/api/schedule/tasks", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Failed to create task" }) }) : route.continue()));
    await page.goto(`/schedule/tasks/new?projectId=${project.id}`);
    await page.locator("#title").fill(`${AUDIT} Server ${uniqueSuffix()}`);
    await page.locator("#startDate").fill(today());
    await saveButton(page).click();
    await expectGuide(page);
    await expect(panel(page).getByTestId("guided-error-retry")).toBeVisible();
    await expect(page.locator("#title")).not.toHaveValue("");
  });
});
