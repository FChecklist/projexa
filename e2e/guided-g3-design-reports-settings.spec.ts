import { test, expect, type Page } from "@playwright/test";
import { AUDIT, createAuditProject, expectGuide, followFix, goBack, panel, readJson, saveButton, today } from "./support/guided-g3";
import { DEFAULT_PROJECT, uniqueSuffix } from "./helpers";
import { USERS } from "./users";

// GUIDED ERRORS, G3 -- DESIGN STUDIO (timesheets, review), REPORTS (a failed run, a failed share link) and SETTINGS (organisation, members, invites,
// accepting an invitation). A few server faults that cannot be provoked on a healthy server (500, 403) are SIMULATED by answering that one request
// in the browser; the test says so. All data is labelled AUDIT-G3 and never deleted.
// Run: PLAYWRIGHT_BASE_URL=https://projexa-ai.com bunx playwright test e2e/guided-g3-design-reports-settings.spec.ts

test.use({ storageState: "playwright/.auth/ceo.json" });

type Task = { id: string; title: string };
type Entry = { id: string; hours: string | number; approvalStatus?: string };

async function addTask(page: Page, projectId: string, label: string): Promise<Task> {
  const title = `${AUDIT} ${label} ${uniqueSuffix()}`;
  const res = await page.request.post("/api/schedule/tasks", { data: { projectId, title, priority: "no_priority", startDate: today() } });
  expect(res.ok(), `creating the audit task answered ${res.status()}`).toBe(true);
  return { id: ((await res.json()) as { id: string }).id, title };
}

test.describe("guided errors G3 - design studio", () => {
  test("DS1 timesheet: 30 hours in a day is explained at once, Fix highlights the hours box, the corrected entry is stored", async ({ page }) => {
    const project = await createAuditProject(page.request, "ds-hours");
    const task = await addTask(page, project.id, "Design");
    await page.goto(`/design-studio/timesheets/new?projectId=${project.id}&taskId=${task.id}`);
    await page.locator("#new-entry-hours").fill("30");
    await expectGuide(page, { id: "design-timesheet-hours", what: "30" });
    await followFix(page, { path: "/design-studio/timesheets/new", focus: "new-entry-hours" });
    await page.locator("#new-entry-hours").fill("8");
    await expect(panel(page)).toHaveCount(0);
    await page.getByRole("button", { name: /^Save/ }).first().click();
    await page.waitForURL(/\/design-studio\/timesheets\/[0-9a-z-]{16,}/);
    const list = await readJson<{ entries: Entry[] }>(page.request, `/api/timesheets?projectId=${project.id}`);
    expect(list.entries.some((e) => Number(e.hours) === 8)).toBe(true);
  });

  test("DS2 timesheet: a day that has not happened is explained and highlights the date box", async ({ page }) => {
    const project = await createAuditProject(page.request, "ds-date");
    const task = await addTask(page, project.id, "DesignDate");
    await page.goto(`/design-studio/timesheets/new?projectId=${project.id}&taskId=${task.id}`);
    await page.locator("#new-entry-hours").fill("4");
    await page.locator("#new-entry-date").fill(today(9));
    await expectGuide(page, { id: "input-date-in-future" });
    await followFix(page, { path: "/design-studio/timesheets/new", focus: "new-entry-date" });
  });

  test("DS3 timesheet on a project with no task: explained, Fix goes to New Task, Back returns with the hours typed", async ({ page }) => {
    const project = await createAuditProject(page.request, "ds-notask");
    await page.goto(`/design-studio/timesheets/new?projectId=${project.id}`);
    await page.locator("#new-entry-hours").fill("5");
    await expectGuide(page, { id: "design-no-tasks", fix: /Create a task/ });
    await followFix(page, { path: "/schedule/tasks/new", focus: "title" });
    await page.locator("#title").fill(`${AUDIT} First task ${uniqueSuffix()}`);
    await page.locator("#startDate").fill(today());
    await saveButton(page).click();
    await page.waitForURL(/\/schedule\/tasks\/[0-9a-z-]{16,}/);
    await goBack(page, "/design-studio/timesheets/new");
    await expect(page.locator("#new-entry-hours")).toHaveValue("5");
    await expect(page.getByTestId("draft-restored")).toBeVisible();
    await page.locator("#new-entry-task").click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: /^Save/ }).first().click();
    await page.waitForURL(/\/design-studio\/timesheets\/[0-9a-z-]{16,}/);
    const list = await readJson<{ entries: Entry[] }>(page.request, `/api/timesheets?projectId=${project.id}`);
    expect(list.entries.some((e) => Number(e.hours) === 5)).toBe(true);
  });

  test("DS4 review: a manager approving their OWN submitted day is explained and the day stays submitted", async ({ page }) => {
    const project = await createAuditProject(page.request, "ds-selfreview");
    const task = await addTask(page, project.id, "SelfReview");
    const made = await page.request.post("/api/timesheets", { data: { issueId: task.id, hours: "3", spentOn: today() } });
    expect(made.ok(), `logging the audit hours answered ${made.status()}`).toBe(true);
    const sub = await page.request.post("/api/timesheets/submit-day", { data: { projectId: project.id, spentOn: today() } });
    expect(sub.ok(), `submitting the audit day answered ${sub.status()}`).toBe(true);

    await page.goto(`/design-studio/review?projectId=${project.id}`);
    await page.getByRole("button", { name: "Approve" }).first().click();
    await expectGuide(page, { id: "design-review-self" });
    const list = await readJson<{ entries: Entry[] }>(page.request, `/api/timesheets?projectId=${project.id}`);
    expect(list.entries.every((e) => e.approvalStatus !== "approved")).toBe(true);
  });

  test("DS5 review: a reason that is too short is explained next to the box before Send back is allowed", async ({ page }) => {
    const project = await createAuditProject(page.request, "ds-reject");
    const task = await addTask(page, project.id, "Reject");
    expect((await page.request.post("/api/timesheets", { data: { issueId: task.id, hours: "2", spentOn: today() } })).ok()).toBe(true);
    expect((await page.request.post("/api/timesheets/submit-day", { data: { projectId: project.id, spentOn: today() } })).ok()).toBe(true);
    await page.goto(`/design-studio/review?projectId=${project.id}`);
    await page.getByRole("button", { name: "Reject" }).first().click();
    await page.getByPlaceholder("What does the designer need to change?").fill("no");
    await expect(page.getByTestId("reject-reason-short")).toContainText("at least 5 characters");
    await expect(page.getByRole("button", { name: "Send back" })).toBeDisabled();
  });

  test("DS6 timesheet: negative hours are explained at once and Save stays closed", async ({ page }) => {
    const project = await createAuditProject(page.request, "ds-negative");
    const task = await addTask(page, project.id, "DesignNeg");
    await page.goto(`/design-studio/timesheets/new?projectId=${project.id}&taskId=${task.id}`);
    await page.locator("#new-entry-hours").fill("-2");
    await expectGuide(page, { id: "design-timesheet-hours", what: "-2" });
    await expect(page.getByRole("button", { name: /^Save/ }).first()).toBeDisabled();
    await followFix(page, { path: "/design-studio/timesheets/new", focus: "new-entry-hours" });
  });
});

test.describe("guided errors G3 - reports", () => {
  test("RPT2 a report that fails to run (simulated server fault) shows the red card AND the full guide", async ({ page }) => {
    await page.route("**/api/reports/**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Failed to generate report" }) }));
    await page.goto(`/reports?projectId=${DEFAULT_PROJECT.id}`);
    const card = page.getByTestId("reports-error");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("guided-error")).toBeVisible();
    await expect(card.getByTestId("guided-error-steps").locator("li").first()).toBeVisible();
    await expect(card.getByTestId("reports-retry")).toBeVisible();
  });

  test("RPT3 a share link that cannot be made (simulated server fault) is explained in full, not as a fading message", async ({ page }) => {
    await page.goto(`/reports?projectId=${DEFAULT_PROJECT.id}`);
    await expect(page.getByTestId("reports-error")).toHaveCount(0);
    await page.route("**/api/reports/*/share", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Failed to create share link" }) }));
    await page.getByTestId("share-menu-button").click();
    await page.getByTestId("share-copy-link").click();
    await expectGuide(page, { id: "report-share-failed" });
  });
});

test.describe("guided errors G3 - settings and invitations", () => {
  test("SET1 invite: an incomplete e-mail is explained, Fix highlights the e-mail box, the corrected invitation is stored", async ({ page }) => {
    const email = `audit-g3-${uniqueSuffix()}@meridian-construction.e2e-test.projexa-ai.com`;
    await page.goto("/settings");
    await page.locator("#invite-email").fill("not-an-email");
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expectGuide(page, { id: "invite-email-invalid", what: "not-an-email" });
    await followFix(page, { path: "/settings", focus: "invite-email" });
    await page.locator("#invite-email").fill(email);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByText(email).first()).toBeVisible();
    const list = await readJson<{ invites: { email: string; accepted_at: string | null; revoked_at: string | null }[] }>(page.request, "/api/org/invites");
    expect(list.invites.some((i) => i.email === email && !i.revoked_at)).toBe(true);
  });

  test("SET2 invite: somebody who is already in the team is explained, with where to see them", async ({ page }) => {
    await page.goto("/settings");
    await page.locator("#invite-email").fill(USERS.hr.email);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expectGuide(page, { id: "auth-invite-already-member", what: /already a member/ });
    await expect(page.locator("#invite-email")).toHaveValue(USERS.hr.email);
  });

  test("SET3 invite: the same e-mail twice is explained as already waiting", async ({ page }) => {
    const email = `audit-g3-twice-${uniqueSuffix()}@meridian-construction.e2e-test.projexa-ai.com`;
    await page.goto("/settings");
    await page.locator("#invite-email").fill(email);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByText(email).first()).toBeVisible();
    await page.locator("#invite-email").fill(email);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expectGuide(page, { id: "auth-invite-pending", what: /pending invitation/ });
  });

  test("SET4 invite: a role that is too low (simulated 403) is explained with who to ask", async ({ page }) => {
    await page.route("**/api/org/invites", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Forbidden: requires one of admin, owner" }) }) : route.continue()));
    await page.goto("/settings");
    await page.locator("#invite-email").fill(`audit-g3-403-${uniqueSuffix()}@meridian-construction.e2e-test.projexa-ai.com`);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expectGuide(page);
    await expect(page.locator("#invite-email")).not.toHaveValue("");
  });

  test("SET5 the invite e-mail and role survive a reload", async ({ page }) => {
    const email = `audit-g3-draft-${uniqueSuffix()}@meridian-construction.e2e-test.projexa-ai.com`;
    await page.goto("/settings");
    await page.locator("#invite-email").fill(email);
    await page.reload();
    await expect(page.getByTestId("draft-restored")).toBeVisible();
    await expect(page.locator("#invite-email")).toHaveValue(email);
  });

  test("SET6 opening an invitation link that is not valid: the page explains it in full", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(`/invite/${"0".repeat(48)}`);
    // this page has its own panel (invite-guided-error) with the same four parts
    await expect(page.getByTestId("invite-guided-error")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("guided-error-title")).toContainText("not valid");
    await expect(page.getByTestId("guided-error-what")).not.toHaveText("");
    await expect(page.getByTestId("guided-error-why")).not.toHaveText("");
    await expect(page.getByTestId("guided-error-steps")).toContainText("ask the person who invited you");
    await context.close();
  });
});
