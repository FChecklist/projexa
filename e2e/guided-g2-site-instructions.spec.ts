import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";
import { apiJson, expectCompleteGuide, guidePanel, pressFixAndExpectHighlight, stamp, AUDIT_TAG } from "./support/guided-g2";

// GUIDED ERRORS, GROUP G2 -- SITE INSTRUCTIONS (list, new, detail, "Add file").
// Run: PLAYWRIGHT_BASE_URL=https://projexa-ai.com bunx playwright test e2e/guided-g2-site-instructions.spec.ts   (Meridian CEO; AUDIT-tagged data, never deleted)
test.use({ storageState: "playwright/.auth/ceo.json" });
test.describe.configure({ mode: "serial" });

const P = DEFAULT_PROJECT.id;
const NEW_URL = `/site-instructions/new?projectId=${P}`;
const save = (page: Page) => page.getByRole("button", { name: /^Save/ });
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

type Row = { id: string; toContractor?: string | null; description?: string | null };
async function rows(page: Page): Promise<Row[]> {
  return (await apiJson<{ siteInstructions?: Row[] }>(page, `/api/site-instructions?projectId=${P}`)).siteInstructions ?? [];
}

test("nothing typed except the date: the addressee and the instruction are named, the first box is outlined, nothing is saved", async ({ page }) => {
  await page.goto(NEW_URL);
  const before = (await rows(page)).length;
  await expect(page.locator("#toContractor")).toBeVisible({ timeout: 60_000 });
  await save(page).click();
  await expectCompleteGuide(page, { code: "SI_CONTRACTOR_MISSING", minSteps: 2 });
  await expect(page.getByTestId("fault-panel-more")).toContainText("instructed to do");
  await pressFixAndExpectHighlight(page, "toContractor");
  expect((await rows(page)).length).toBe(before);
});

test("issue date cleared: refused with the date box outlined", async ({ page }) => {
  await page.goto(NEW_URL);
  await page.locator("#toContractor").fill(`${AUDIT_TAG} contractor`);
  await page.locator("#description").fill("date probe");
  await page.locator("#issueDate").fill("");
  await save(page).click();
  await expectCompleteGuide(page, { code: "SI_DATE_MISSING" });
  await pressFixAndExpectHighlight(page, "issueDate");
  await expect(page.locator("#description")).toHaveValue("date probe");
});

test("issue date in the future: refused (an instruction is dated the day it is issued)", async ({ page }) => {
  await page.goto(NEW_URL);
  await page.locator("#toContractor").fill(`${AUDIT_TAG} contractor`);
  await page.locator("#description").fill("future date probe");
  await page.locator("#issueDate").fill(addDays(4));
  await save(page).click();
  await expectCompleteGuide(page, { code: "SI_DATE_FUTURE" });
});

test("a Word file is refused (PDF or photo only) and a file over 10 MB is refused with its size", async ({ page }) => {
  await page.goto(NEW_URL);
  await page.locator("#toContractor").fill(`${AUDIT_TAG} contractor`);
  await page.locator("#description").fill("file probe");
  await page.locator("#file").setInputFiles({ name: "instruction.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("x") });
  await save(page).click();
  await expectCompleteGuide(page, { code: "SI_FILE_TYPE" });
  await pressFixAndExpectHighlight(page, "file");
  await page.locator("#file").setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10.5 * 1024 * 1024, 1) });
  await save(page).click();
  await expectCompleteGuide(page, { code: "SI_FILE_TOO_BIG" });
  await expect(page.getByTestId("guided-error-what")).toContainText("MB");
});

test("what was typed survives leaving the form and coming back", async ({ page }) => {
  await page.goto(NEW_URL);
  await page.locator("#toContractor").fill(`${AUDIT_TAG} draft contractor`);
  await page.locator("#description").fill("typed before leaving");
  await page.locator("#drawingRef").fill("A-203 rev C");
  await page.goto(`/site-instructions?projectId=${P}`);
  await page.goto(NEW_URL);
  await expect(page.getByTestId("si-draft-restored")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#toContractor")).toHaveValue(`${AUDIT_TAG} draft contractor`);
  await expect(page.locator("#description")).toHaveValue("typed before leaving");
  await expect(page.locator("#drawingRef")).toHaveValue("A-203 rev C");
});

let createdId = "";
test("a valid instruction is saved and lands on its page; the values persisted", async ({ page }) => {
  await page.goto(NEW_URL);
  const to = `${AUDIT_TAG} ${stamp()} contractor`;
  await page.locator("#toContractor").fill(to);
  await page.locator("#description").fill("created by the G2 guided-errors spec");
  await save(page).click();
  await page.waitForURL(/\/site-instructions\/(?!new)[0-9a-z-]+/, { timeout: 60_000 }); // not "/site-instructions/new" itself
  createdId = page.url().split("/site-instructions/")[1]!.split("?")[0]!;
  const found = (await rows(page)).find((r) => r.id === createdId);
  expect(found?.toContractor).toBe(to);
});

test("Add file with no file chosen, a wrong kind, then a good PDF: each refusal is explained, the PDF is stored and re-read", async ({ page }) => {
  test.skip(!createdId, "needs the instruction created above");
  await page.goto(`/site-instructions/${createdId}?projectId=${P}`);
  await expect(page.getByTestId("si-add-file")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("si-add-file-button").click();
  await expectCompleteGuide(page, { code: "SI_FILE_NONE" });
  await pressFixAndExpectHighlight(page, "si-add-file-input");
  await page.locator("#si-add-file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await page.getByTestId("si-add-file-button").click();
  await expectCompleteGuide(page, { code: "SI_FILE_TYPE" });
  await page.locator("#si-add-file-input").setInputFiles({ name: "audit-g2.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%audit g2\n") });
  await page.getByTestId("si-add-file-button").click();
  await expect(page.getByTestId("si-add-file-note")).toHaveAttribute("data-ok", "1", { timeout: 60_000 });
  const docs = await apiJson<{ documents?: { name?: string; fileName?: string }[] }>(page, `/api/documents?linkedEntityType=construction_site_instruction&linkedEntityId=${createdId}`);
  expect(JSON.stringify(docs)).toContain("audit-g2.pdf");
});

test("a site instruction that does not exist is explained with a way back to the list", async ({ page }) => {
  await page.goto(`/site-instructions/00000000-0000-0000-0000-000000000000?projectId=${P}`);
  await expect(guidePanel(page)).toBeVisible({ timeout: 60_000 });
  await expectCompleteGuide(page, { id: "si-not-found", fixLabel: /./ });
});

test("role too low: a project member (Sneha) saving an instruction is told it needs a manager and nothing is saved", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "playwright/.auth/hr.json" });
  const page = await ctx.newPage();
  await page.goto(NEW_URL);
  const before = (await rows(page)).length;
  await page.locator("#toContractor").fill(`${AUDIT_TAG} member probe`);
  await page.locator("#description").fill("a member cannot issue site instructions");
  await save(page).click();
  await expect(guidePanel(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("guided-error-steps")).toContainText(/Owner|Admin|Project Manager/);
  expect((await rows(page)).length).toBe(before);
  await ctx.close();
});
