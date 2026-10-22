import { test, expect, type Page } from "@playwright/test";
import { AUDIT, backFromStrip, expectGuidedPanel, expectHighlighted, failOnce, mainProject, openOnline, panel, pressFix, type Session } from "./support/guided";

// GUIDED ERRORS, group G1 -- New Project and the project list, through the real screens. Every fault: the panel says what happened, why and the
// numbered steps; the Fix button takes the person to the exact box (outlined for 3 s); what was typed is still there; after the fix the project is SAVED
// and re-read from the server. Cases are named P-xx; the report lists each against its test.

test.describe.configure({ mode: "serial" });

let S: Session;
test.beforeAll(async ({ browser }) => {
  S = await openOnline(browser, "finance");
});
test.afterAll(async () => {
  await S?.context.close();
});

const save = (page: Page) => page.getByRole("button", { name: /^Save/ });
async function openNew(page: Page) {
  await page.goto("/projects/new");
  await expect(page.locator("#name")).toBeVisible({ timeout: 60_000 });
  // a draft from an earlier test must not leak in
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.locator("#name")).toBeVisible();
}
async function projectNames(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/projects");
  return ((await res.json()) as { projects: { name: string }[] }).projects.map((p) => p.name);
}

test("P-01 a name over 200 letters: told in full, the name box outlined, nothing sent, then fixed and saved", async () => {
  const page = S.page;
  await openNew(page);
  let posted = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/projects") posted += 1;
  });
  const long = `${AUDIT} ${"x".repeat(210)}`;
  await page.locator("#name").fill(long);
  await page.locator("#description").fill("kept while the name is corrected");
  await save(page).click();
  const p = await expectGuidedPanel(page, { id: "project-name-too-long-form", what: /most that can be saved is 200/, where: /Project Name/ });
  await expect(p.getByTestId("guided-error-fix")).toBeVisible();
  await expectHighlighted(page, "#name");
  expect(posted, "nothing was sent").toBe(0);
  await expect(page.locator("#name")).toHaveValue(long);
  await expect(page.locator("#description")).toHaveValue("kept while the name is corrected");

  // the Fix button takes the person back to the box (same screen)
  await page.evaluate(() => document.querySelector("#name")?.removeAttribute("data-px-highlighted"));
  await pressFix(page);
  await expectHighlighted(page, "#name");

  // the fix, then the result is persisted
  const name = `${AUDIT} long name fixed`;
  await page.locator("#name").fill(name);
  await save(page).click();
  await expect.poll(async () => (await projectNames(page)).includes(name), { timeout: 60_000, message: "the corrected project reached the server" }).toBe(true);
});

test("P-02 a target date before the start date: the box is named, nothing sent, the dates stay, the fix saves", async () => {
  const page = S.page;
  await openNew(page);
  const name = `${AUDIT} dates`;
  await page.locator("#name").fill(name);
  await page.locator("#startDate").fill("2026-12-01");
  await page.locator("#targetDate").fill("2026-11-01");
  await save(page).click();
  await expectGuidedPanel(page, { id: "project-date-order-form", what: /on or after the start date/, where: /Target Date/ });
  await expectHighlighted(page, "#targetDate");
  await expect(page.locator("#startDate")).toHaveValue("2026-12-01");
  await expect(page.locator("#targetDate")).toHaveValue("2026-11-01");
  await page.locator("#targetDate").fill("2027-03-01");
  await save(page).click();
  await expect.poll(async () => (await projectNames(page)).includes(name), { timeout: 60_000 }).toBe(true);
});

test("P-03 a year that cannot be right (0002): the date box is named and nothing is sent", async () => {
  const page = S.page;
  await openNew(page);
  await page.locator("#name").fill(`${AUDIT} bad year`);
  await page.locator("#startDate").fill("0002-01-01");
  await save(page).click();
  await expectGuidedPanel(page, { id: "project-date-invalid-form", what: /year 2/, where: /outlined date/ });
  await expectHighlighted(page, "#startDate");
  await expect(page.locator("#name")).toHaveValue(`${AUDIT} bad year`);
  expect(await projectNames(page)).not.toContain(`${AUDIT} bad year`);
});

test("P-04 the server is down when Save is pressed: the panel says it may not be saved, offers Try again; the retry saves once", async () => {
  const page = S.page;
  await openNew(page);
  const name = `${AUDIT} retry`;
  await page.locator("#name").fill(name);
  const fail = await failOnce(page, "/api/projects", "POST", 503, { error: "The construction data service did not respond in time." });
  await save(page).click();
  await expectGuidedPanel(page, { what: /may or may not have been saved/, retry: true });
  expect(fail.hits()).toBe(1);
  await expect(page.locator("#name")).toHaveValue(name);
  await panel(page).getByTestId("guided-error-retry").click();
  await expect.poll(async () => (await projectNames(page)).filter((n) => n === name).length, { timeout: 60_000 }).toBe(1);
});

test("P-05 Fix-it trip and the way back: 'Check the project list' leaves the form, the strip brings the person back with everything typed", async () => {
  const page = S.page;
  await openNew(page);
  const name = `${AUDIT} trip`;
  await page.locator("#name").fill(name);
  await page.locator("#description").fill("typed before the trip");
  await page.locator("#startDate").fill("2026-10-01");
  await failOnce(page, "/api/projects", "POST", 503, { error: "The construction data service did not respond in time." });
  await save(page).click();
  const p = await expectGuidedPanel(page, { id: "project-create-failed", where: /Projects/ });
  await p.getByTestId("guided-error-fix").click();
  await expect(page).toHaveURL(/\/projects(\?|$)/);
  await expect(page).toHaveURL(/returnTo=/);
  await backFromStrip(page, /form/i);
  await expect(page).toHaveURL(/\/projects\/new/);
  await expect(page.locator("#name")).toHaveValue(name);
  await expect(page.locator("#description")).toHaveValue("typed before the trip");
  await expect(page.locator("#startDate")).toHaveValue("2026-10-01");
  await expect(page.getByTestId("draft-restored")).toContainText("kept what you typed");
  // and the saved result persists
  await save(page).click();
  await expect.poll(async () => (await projectNames(page)).includes(name), { timeout: 60_000 }).toBe(true);
});

test("P-06 signed out while typing: 'Sign in again' goes to the sign-in page carrying the New Project address, and the form comes back with the values kept", async () => {
  const page = S.page;
  await openNew(page);
  const name = `${AUDIT} signed out`;
  await page.locator("#name").fill(name);
  await failOnce(page, "/api/projects", "POST", 401, { error: "Unauthorized" });
  await save(page).click();
  const p = await expectGuidedPanel(page);
  await expect(p.getByTestId("guided-error-fix")).toContainText(/sign in/i);
  // the link itself is read, not followed: this test user is still signed in on the server, so a real visit to /login would be sent on to /dashboard before the address could be seen
  const href = await p.getByTestId("guided-error-fix").getAttribute("href");
  expect(href, "Sign in again is a link to the sign-in page carrying the return address").toMatch(/\/login\?.*redirectTo=/);
  const back = new URL(href!, page.url()).searchParams.get("redirectTo");
  expect(back, "the sign-in page is told to bring the person back here").toContain("/projects/new");
  // this test user is still signed in on the server, so the address the sign-in page returns to is opened directly
  await page.goto(back!);
  await expect(page.locator("#name")).toHaveValue(name);
  await expect(page.getByTestId("draft-restored")).toBeVisible();
});

test("P-07 the project list cannot be read: the panel, Try again, then the list", async () => {
  const page = S.page;
  const fail = await failOnce(page, "/api/projects/overview", "GET", 503, { error: "The construction data service did not respond in time." });
  await page.goto("/projects");
  await expectGuidedPanel(page, { what: /did not respond in time/, retry: true }); // a list that cannot be read says so; "may or may not have been saved" belongs to Save only
  expect(fail.hits()).toBe(1);
  await panel(page).getByTestId("guided-error-retry").click();
  await expect(page.getByTestId("guided-error")).toHaveCount(0, { timeout: 30_000 });
  const main = await mainProject(page);
  await expect(page.getByText(main.name).first()).toBeVisible();
});
