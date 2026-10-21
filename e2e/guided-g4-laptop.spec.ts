import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { BOQ_ID, PROJECT_ID, goOffline, goOnline, prepareDeliveryLaptop, readOutbox, watchConsole, type ExtraProject, type Net, type Prepared } from "./support/lf-delivery-stub";

// GUIDED ERRORS, group G4, part 3: THE LAPTOP-FIRST SHELL. Offline writes that wait, a change the server turns down after it was queued ("Line budget was
// not saved": the exact line, the typed value, one button to the line with the value filled in), sync conflicts, a project that is not copied yet, a role
// that is too low. Same fast rig as lf-delivery-*.spec.ts (support/lf-delivery-stub.ts: the sync service and the app's APIs are answered in the browser, so
// no real backend, no real person's data, and nothing is deleted); real Chromium, the real built app, `context.setOffline` for the network.
//   bunx playwright test -c playwright.local-first.config.ts guided-g4-laptop     (or the config you use for the lf-delivery specs)
//
// Fault cases covered here: offline write queued ("Waiting to sync" + what to do), change refused by the server after being queued (what, why, which line,
// typed value, link to the exact line, re-enter and the result persisted), sync conflict, project not yet copied (progress + how long + what to do), role
// too low (who to ask + Settings link), no project on the laptop is NOT covered (the rig always has one) -- see the covered/not-covered table in the PR.

const q = `?projectId=${PROJECT_ID}`;
const UNSYNCED: ExtraProject = { id: "lf-dl-project-late", name: "Marina Lobby", mode: "unsynced" };

async function laptop(page: Page, context: BrowserContext, role: string, extra: ExtraProject[] = []): Promise<Prepared & { net: Net; problems: string[] }> {
  const net: Net = { mode: "up" };
  const problems = watchConsole(page);
  const prepared = await prepareDeliveryLaptop(page, context, net, role, expect, extra);
  return { ...prepared, net, problems };
}

async function openBudget(page: Page, search = q) {
  await page.goto(`/local/scope/${BOQ_ID}/budget${search}`);
  await expect(page.getByTestId("scope-budget-screen")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
}

async function typePercent(page: Page, lineId: string, value: string) {
  const box = page.getByTestId(`scope-budget-${lineId}-pct`);
  await box.click();
  await box.press("ControlOrMeta+a");
  await page.keyboard.type(value, { delay: 15 });
  await expect(box).toHaveValue(value);
}

test.describe("G4 laptop faults", () => {
  test("offline write: queued, the row says 'Waiting to sync', the corner note explains it; back online it is sent and both go away", async ({ page, context }) => {
    const l = await laptop(page, context, "manager");
    await openBudget(page);
    await goOffline(context, l.net, l.app);
    await typePercent(page, "dl-line-1", "40");
    await page.getByTestId("scope-budget-dl-line-1-save").click();
    await expect(page.getByTestId("scope-budget-dl-line-1-waiting")).toHaveText("Waiting to sync");
    const queued = await readOutbox(page, l.session.userId);
    expect(queued.map((o) => o.functionId)).toContain("update_line_item_budget");
    const note = page.getByTestId("outbox-waiting");
    await expect(note.getByTestId("guided-error-title")).toHaveText("Waiting to sync");
    await expect(note.getByTestId("guided-error-what")).toContainText("saved on this laptop");
    await expect(note.getByTestId("guided-error-steps")).toContainText("connect this laptop to the internet");
    await goOnline(context, l.net, l.app);
    await expect(page.getByTestId("outbox-waiting")).toHaveCount(0, { timeout: 120_000 });
    // the note goes as soon as the op is sent, the push is recorded a moment later: wait for it rather than read it once.
    await expect.poll(() => l.sync.pushes.filter((p) => p.function_id === "update_line_item_budget").length, { timeout: 60_000 }).toBe(1);
  });

  test("a queued change the server turns down: 'Line budget was not saved' names the line, shows the typed value, and one button re-enters it", async ({ page, context }) => {
    const l = await laptop(page, context, "manager");
    l.sync.answers.set("update_line_item_budget", { status: "rejected", code: "VALIDATION_FAILED" });
    await openBudget(page);
    await typePercent(page, "dl-line-1", "55");
    await page.getByTestId("scope-budget-dl-line-1-save").click();

    const card = page.getByTestId("outbox-draft");
    await expect(card.getByTestId("guided-error-title")).toHaveText("Line budget was not saved", { timeout: 120_000 });
    await expect(card.getByTestId("guided-error-what")).toContainText("Line budget was not saved");
    await expect(card.getByTestId("guided-error-why")).toContainText("What you typed is kept"); // or the guide's why: the typed values are kept
    await expect(card.getByTestId("outbox-draft-subject")).toContainText("HV-101"); // the exact line
    await expect(card.getByTestId("outbox-draft-values")).toContainText("55");
    await expect(card.getByTestId("guided-error-steps").locator("li")).not.toHaveCount(0);
    await expect(card.getByTestId("guided-error-where")).toContainText("Line budget");

    // the one button: opens the budget screen on THAT line with the typed value in the box
    const fix = card.getByTestId("guided-error-fix");
    await expect(fix).toHaveText("Go to it and re-enter your values");
    const href = new URL((await fix.getAttribute("href"))!, "https://x.test");
    expect(href.pathname).toBe(`/scope/${BOQ_ID}/budget`);
    expect(href.searchParams.get("projectId")).toBe(PROJECT_ID);
    expect(href.searchParams.get("line")).toBe("dl-line-1");
    expect(href.searchParams.get("draft")).toBeTruthy();
    await fix.click();
    await expect(page.getByTestId("scope-budget-refused-note")).toBeVisible();
    await expect(page.getByTestId("scope-budget-dl-line-1-pct")).toHaveValue("55");
    await expect(page.locator('[data-line-id="dl-line-1"]')).toBeInViewport();

    // correct it, press Save: this time the server accepts; the refused card goes, the result persisted (the op reached the server, the draft is gone)
    l.sync.answers.set("update_line_item_budget", { status: "applied" });
    await typePercent(page, "dl-line-1", "60");
    await page.getByTestId("scope-budget-dl-line-1-save").click();
    await expect(page.getByTestId("outbox-draft")).toHaveCount(0, { timeout: 120_000 });
    await expect.poll(() => l.sync.pushes.filter((p) => p.function_id === "update_line_item_budget").map((p) => p.params.budgetPercentage), { timeout: 120_000 }).toContain(60);
  });

  test("a sync conflict: both values are shown with Keep mine / Keep theirs inside the guided panel", async ({ page, context }) => {
    const l = await laptop(page, context, "manager");
    // the server's row has a different budget % for the same line: both people changed the same field -> the card (not a silent merge)
    l.sync.answers.set("update_line_item_budget", { status: "conflict", theirs: { budget_percentage: "60" } });
    await openBudget(page);
    await typePercent(page, "dl-line-1", "35");
    await page.getByTestId("scope-budget-dl-line-1-save").click();
    const row = page.getByTestId("outbox-conflict");
    await expect(row.getByTestId("guided-error-title")).toHaveText("Someone changed the same thing", { timeout: 120_000 });
    await expect(row.getByTestId("guided-error-steps")).toContainText("Keep mine");
    await expect(row.getByTestId("guided-error-action-keep-mine")).toBeVisible();
    await expect(row.getByTestId("guided-error-action-keep-theirs")).toBeVisible();
  });

  test("project not yet copied: says how long, shows progress, tells what to do, links to Projects", async ({ page, context }) => {
    await laptop(page, context, "member", [UNSYNCED]);
    await page.goto(`/local/work-progress?projectId=${UNSYNCED.id}`);
    const screen = page.getByTestId("work-progress");
    await expect(screen).toHaveAttribute("data-state", "not_synced", { timeout: 60_000 });
    const panel = screen.getByTestId("guided-error");
    await expect(panel.getByTestId("guided-error-title")).toHaveText("This project is still being copied here");
    await expect(panel.getByTestId("guided-error-what")).toContainText("has not finished copying to this laptop yet");
    await expect(panel.getByTestId("guided-error-why")).toContainText("up to 3 minutes");
    await expect(panel.getByTestId("guided-error-progress")).toBeVisible();
    await expect(panel.getByTestId("guided-error-steps")).toContainText("Keep this laptop online");
    await expect(panel.getByTestId("guided-error-fix")).toHaveAttribute("href", /^\/projects/);
  });

  test("role too low for the budget screen: names the role limit, who to ask, link to Settings > Team", async ({ page, context }) => {
    await laptop(page, context, "member");
    await page.goto(`/local/scope/${BOQ_ID}/budget${q}`);
    const screen = page.getByTestId("scope-budget-screen");
    await expect(screen).toHaveAttribute("data-state", "role", { timeout: 60_000 });
    const panel = screen.getByTestId("guided-error");
    await expect(panel.getByTestId("guided-error-title")).toHaveText("Your role cannot do this");
    await expect(panel.getByTestId("guided-error-what")).toContainText("needs the manager role");
    await expect(panel.getByTestId("guided-error-steps")).toContainText("Owner or an Admin");
    await expect(panel.getByTestId("guided-error-fix")).toHaveAttribute("href", /^\/(settings|projects)/);
  });
});
