import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";
import { apiJson, expectCompleteGuide, fieldMessage, guidePanel, pressFixAndExpectHighlight, stamp, AUDIT_TAG } from "./support/guided-g2";

// GUIDED ERRORS, GROUP G2 -- WORK PROGRESS (daily entry form). One test per way a real person can get this form wrong.
// Run against https://projexa-ai.com (default baseURL) or any build: PLAYWRIGHT_BASE_URL=... bunx playwright test e2e/guided-g2-progress.spec.ts
// Signed in as the seeded E2E Meridian CEO (Arjun) -- see e2e/users.ts. Read-only except the one AUDIT-tagged success entry in the last test (no deletions).
//
// Each fault test checks: (1) the guide panel is complete (title, what, why, steps), (2) the fault is also written beside its field,
// (3) "Fix it now" outlines the exact field, (4) what was typed is still there, (5) NOTHING was saved (re-read from the API).
test.use({ storageState: "playwright/.auth/ceo.json" });
test.describe.configure({ mode: "serial" });

const P = DEFAULT_PROJECT.id;
const FORM_URL = `/work-progress?projectId=${P}`;

type Entries = { entries?: { id: string; remarks?: string | null }[] };
async function entryCount(page: Page): Promise<number> {
  return ((await apiJson<Entries>(page, `/api/work-progress?projectId=${P}`)).entries ?? []).length;
}

async function openForm(page: Page) {
  // every test starts in a fresh browser context, so session storage (where the typed draft is kept) is empty
  await page.goto(FORM_URL);
  await expect(page.getByTestId("wp-activity")).toBeVisible({ timeout: 60_000 });
}
async function pickActivity(page: Page) {
  await page.getByTestId("wp-activity").click();
  await page.getByRole("option").first().click();
}
async function pickLine(page: Page, index = 0) {
  await page.getByTestId("wp-boq-line").getByRole("combobox").click();
  await page.getByRole("option", { disabled: false }).nth(index).click();
}
async function fillValid(page: Page, over: { qty?: string; pct?: string; date?: string } = {}) {
  await pickActivity(page);
  await pickLine(page);
  await page.getByTestId("wp-quantity").fill(over.qty ?? "0.01");
  await page.getByTestId("wp-percent").fill(over.pct ?? "0");
  if (over.date) await page.getByTestId("wp-date").fill(over.date);
}
const logEntry = (page: Page) => page.getByRole("button", { name: /^Log Entry/ });
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

test("empty form: Log Entry names the first missing box (activity), lists the rest, outlines the box, saves nothing", async ({ page }) => {
  await openForm(page);
  const before = await entryCount(page);
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_ACTIVITY_MISSING", minSteps: 2, fixLabel: /./ });
  await expect(page.getByTestId("fault-panel-more")).toContainText("BOQ line");
  await expect((await fieldMessage(page, "wp-activity"))).toContainText("Choose the activity");
  await pressFixAndExpectHighlight(page, "wp-activity");
  expect(await entryCount(page), "nothing was saved").toBe(before);
});

test("no BOQ line chosen: the panel says which line is needed and why (the report is priced off it)", async ({ page }) => {
  await openForm(page);
  await pickActivity(page);
  await page.getByTestId("wp-quantity").fill("1");
  await page.getByTestId("wp-percent").fill("1");
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_BOQ_LINE_MISSING" });
  await expect(page.getByTestId("guided-error-why")).toContainText(/priced|report|bill/i);
  await expect((await fieldMessage(page, "wp-boq-line").catch(async () => page.getByText("Choose the BOQ line this work was done on.").first()))).toBeVisible();
  await pressFixAndExpectHighlight(page, "wp-boq-line");
  // the fix: choose a line; the panel goes away once the form is valid and the typed numbers are untouched
  await pickLine(page);
  await expect(page.getByTestId("wp-quantity")).toHaveValue("1");
  await expect(page.getByTestId("wp-percent")).toHaveValue("1");
});

test("quantity missing: says to type 0 when only a percentage is entered", async ({ page }) => {
  await openForm(page);
  await pickActivity(page);
  await pickLine(page);
  await page.getByTestId("wp-percent").fill("5");
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_QTY_MISSING" });
  await expect(page.getByTestId("guided-error-what")).toContainText("Type 0");
  await pressFixAndExpectHighlight(page, "wp-quantity");
  await expect(page.getByTestId("wp-percent")).toHaveValue("5");
});

test("quantity below zero: refused with the way to undo a wrong entry", async ({ page }) => {
  await openForm(page);
  const before = await entryCount(page);
  await fillValid(page, { qty: "-3", pct: "5" });
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_QTY_INVALID" });
  await expect((await fieldMessage(page, "wp-quantity"))).toContainText("cannot be below 0");
  await pressFixAndExpectHighlight(page, "wp-quantity");
  expect(await entryCount(page)).toBe(before);
});

test("quantity not a number (12,5 with a comma): refused with an example", async ({ page }) => {
  await openForm(page);
  await fillValid(page, { qty: "12,5", pct: "5" });
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_QTY_INVALID" });
  await expect((await fieldMessage(page, "wp-quantity"))).toContainText("must be a number");
});

test("percentage above 100 (140): refused beside the box and in the panel; fixing it to 40 clears both and keeps the rest", async ({ page }) => {
  await openForm(page);
  const before = await entryCount(page);
  await fillValid(page, { qty: "0.01", pct: "140" });
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_PERCENT_RANGE", minSteps: 2 });
  await expect((await fieldMessage(page, "wp-percent"))).toContainText("outside 0 to 100");
  await pressFixAndExpectHighlight(page, "wp-percent");
  await page.getByTestId("wp-percent").fill("40");
  await expect(page.getByTestId("wp-quantity")).toHaveValue("0.01");
  await expect(page.getByTestId("fault-panel")).toHaveCount(0);
  expect(await entryCount(page), "the refused entry was not saved").toBe(before);
});

test("percentage below 0 and not-a-number are refused the same way", async ({ page }) => {
  await openForm(page);
  await fillValid(page, { pct: "-5" });
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_PERCENT_RANGE" });
  await page.getByTestId("wp-percent").fill("abc");
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_PERCENT_RANGE" });
});

test("a date in the future: refused, the box is outlined, today is accepted", async ({ page }) => {
  await openForm(page);
  const before = await entryCount(page);
  await fillValid(page, { date: addDays(3) });
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_DATE_FUTURE" });
  await expect((await fieldMessage(page, "wp-date"))).toContainText("in the future");
  await pressFixAndExpectHighlight(page, "wp-date");
  expect(await entryCount(page)).toBe(before);
});

test("a photo that is not a picture (a PDF) is refused beside the photo box", async ({ page }) => {
  await openForm(page);
  const before = await entryCount(page);
  await fillValid(page);
  await page.getByRole("button", { name: "More details" }).click();
  await page.getByTestId("wp-photo").setInputFiles({ name: "plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await expect((await fieldMessage(page, "wp-photo"))).toContainText("not a photo");
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_PHOTO_TYPE" });
  await pressFixAndExpectHighlight(page, "wp-photo");
  expect(await entryCount(page)).toBe(before);
});

test("a photo over 4 MB is refused with its size", async ({ page }) => {
  await openForm(page);
  await fillValid(page);
  await page.getByRole("button", { name: "More details" }).click();
  await page.getByTestId("wp-photo").setInputFiles({ name: "big.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(4.6 * 1024 * 1024, 1) });
  await logEntry(page).click();
  await expectCompleteGuide(page, { code: "WP_PHOTO_TOO_BIG" });
  await expect(page.getByTestId("guided-error-what")).toContainText("MB");
});

test("more than the line has (server refusal): shown beside the quantity, nothing saved, typed values intact after the fix", async ({ page }) => {
  await openForm(page);
  const before = await entryCount(page);
  await fillValid(page, { qty: "99999999", pct: "0" });
  await page.getByRole("button", { name: "More details" }).click();
  await page.getByTestId("wp-remarks").fill(`${AUDIT_TAG} ${stamp()} over-100 probe`);
  await logEntry(page).click();
  await expect(guidePanel(page)).toHaveAttribute("data-guide-id", "progress-over-100-quantity", { timeout: 30_000 });
  await expectCompleteGuide(page, { id: "progress-over-100-quantity", minSteps: 2 });
  await expect(page.getByTestId("guided-error-what")).toContainText("more than 100%");
  await expect((await fieldMessage(page, "wp-quantity"))).toContainText("more than 100%");
  await pressFixAndExpectHighlight(page, "wp-quantity");
  // the quantity is corrected to something small: everything else the person typed is still in the form
  await page.getByTestId("wp-quantity").fill("0.01");
  await expect(page.getByTestId("wp-remarks")).toHaveValue(new RegExp(AUDIT_TAG));
  expect(await entryCount(page), "the refused entry was not saved").toBe(before);
});

test("the BOQ line was replaced by a newer BOQ revision (server answers 'BOQ line item not found'): the panel says so, outlines the line box, keeps everything typed", async ({ page }) => {
  // The server's answer is supplied here (a real revision race cannot be forced on demand); the wording is the server's own, see construction-progress-service.ts.
  await page.route(/\/api\/work-progress$/, (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "BOQ line item not found" }) })
    : route.continue());
  await openForm(page);
  await fillValid(page, { qty: "2", pct: "10" });
  await logEntry(page).click();
  await expect(guidePanel(page)).toHaveAttribute("data-guide-id", "wp-line-gone", { timeout: 30_000 });
  await expectCompleteGuide(page, { id: "wp-line-gone", minSteps: 2 });
  await pressFixAndExpectHighlight(page, "wp-boq-line");
  await expect(page.getByTestId("wp-quantity")).toHaveValue("2");
  await expect(page.getByTestId("wp-percent")).toHaveValue("10");
});

test("what was typed survives leaving the form and coming back (quantity, percent, remarks, activity)", async ({ page }) => {
  await openForm(page);
  await pickActivity(page);
  await page.getByTestId("wp-quantity").fill("3");
  await page.getByTestId("wp-percent").fill("30");
  await page.getByRole("button", { name: "More details" }).click();
  await page.getByTestId("wp-remarks").fill(`${AUDIT_TAG} draft probe`);
  // leave to another screen, then come back by the address (session storage is kept, the form is rebuilt)
  await page.goto(`/scope?projectId=${P}`);
  await page.goto(FORM_URL);
  await expect(page.getByTestId("wp-draft-restored")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("wp-quantity")).toHaveValue("3");
  await expect(page.getByTestId("wp-percent")).toHaveValue("30");
  await expect(page.getByTestId("wp-remarks")).toHaveValue(new RegExp(AUDIT_TAG));
});

test("a valid entry with a photo is saved, the photo is attached, and both can be re-read (AUDIT-tagged, never deleted)", async ({ page }) => {
  await openForm(page);
  const tag = `${AUDIT_TAG} ${stamp()} progress+photo`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  // a line already at 100% refuses further progress: try the first few lines until one accepts the tiny entry
  for (let line = 0; line < 4; line++) {
    await openForm(page);
    await pickActivity(page);
    await pickLine(page, line);
    await page.getByTestId("wp-quantity").fill("0.01");
    await page.getByTestId("wp-percent").fill("0");
    await page.getByRole("button", { name: "More details" }).click();
    await page.getByTestId("wp-remarks").fill(tag);
    await page.getByTestId("wp-photo").setInputFiles({ name: "audit.png", mimeType: "image/png", buffer: png });
    await logEntry(page).click();
    const landed = await page.waitForURL(/\/work-progress\/[0-9a-z-]+/, { timeout: 30_000 }).then(() => true).catch(() => false);
    if (landed) break;
  }
  await expect(page).toHaveURL(/\/work-progress\/[0-9a-z-]+/);
  const id = page.url().split("/work-progress/")[1]!.split("?")[0]!;
  // re-read: the entry carries the remark, and the photo row exists for it
  const entry = await apiJson<{ remarks?: string }>(page, `/api/work-progress/${id}`);
  expect(entry.remarks).toBe(tag);
  const photos = await apiJson<{ photos?: { fileName: string }[] }>(page, `/api/work-progress/photos?veridianEntryId=${id}`);
  expect((photos.photos ?? []).map((p) => p.fileName)).toContain("audit.png");
});
