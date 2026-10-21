import { test, expect, type Page } from "@playwright/test";
import { AUDIT, backFromStrip, expectGuidedPanel, expectHighlighted, failOnce, makeAuditBoq, makeAuditProject, openOnline, panel, pressFix, type ProjectRef, type Session } from "./support/guided";

// GUIDED ERRORS, group G1 -- one BOQ: submit, approve (own BOQ, role), delete/edit locks, budget % and vendor amounts, revise (scope reduction, faults),
// compare, baseline (Project 360), site-instruction links. O-xx cases, through the real screens. Each BOQ is made in an AUDIT-labelled project of its own.

test.describe.configure({ mode: "serial" });

let PM: Session; // finance = Project Manager: makes and submits
let OWNER: Session; // ceo = Owner: may approve what the PM made
let MEMBER: Session; // hr = a plain member
let proj: ProjectRef;
let boq: { id: string; title: string };

test.beforeAll(async ({ browser }) => {
  PM = await openOnline(browser, "finance");
  OWNER = await openOnline(browser, "ceo");
  MEMBER = await openOnline(browser, "hr");
  proj = await makeAuditProject(PM.page, "object");
  boq = await makeAuditBoq(PM.page.request, proj.id, "object boq", [
    { description: `${AUDIT} excavation`, unit: "m3", quantity: 100, rate: 50, itemCode: "E-1" },
    { description: `${AUDIT} backfill`, unit: "m3", quantity: 40, rate: 20, itemCode: "E-2" },
  ]);
});
test.afterAll(async () => {
  await PM?.context.close();
  await OWNER?.context.close();
  await MEMBER?.context.close();
});

const detail = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/scope/${id}`)).json()) as { status: string; version: number; lineItems: { id: string; description: string; budgetPercentage: string | null; vendorAmount: string | null }[] };
const open = async (page: Page, id: string, path = "") => {
  await page.goto(`/scope/${id}${path}?projectId=${proj.id}`);
  await page.evaluate(() => sessionStorage.clear());
};
const btn = (page: Page, name: RegExp | string) => page.getByRole("button", { name });

test("O-01 Submit pressed after someone already submitted it: the panel says it is no longer a draft, and the screen shows the truth", async () => {
  const page = PM.page;
  await open(page, boq.id);
  await expect(btn(page, /Submit for Approval/)).toBeVisible({ timeout: 60_000 });
  // meanwhile (another tab, a colleague) it is submitted
  const r = await page.request.post(`/api/scope/${boq.id}/submit`);
  expect(r.ok(), "submitted behind the screen's back").toBe(true);
  await btn(page, /Submit for Approval/).click();
  await expectGuidedPanel(page, { id: "boq-submit-not-draft", what: /Only a draft BOQ can be submitted/, where: /this BOQ/ });
  // the screen re-read the BOQ: it is submitted, and the Submit button is gone
  await expect(btn(page, /Submit for Approval/)).toHaveCount(0, { timeout: 30_000 });
  expect((await detail(page, boq.id)).status).toBe("submitted");
});

test("O-02 the person who made the BOQ presses Approve: 'someone else must approve', the Approve button then says why it is off", async () => {
  const page = PM.page;
  await open(page, boq.id);
  await expect(btn(page, /^Approve$/)).toBeEnabled({ timeout: 60_000 });
  await btn(page, /^Approve$/).click();
  await expectGuidedPanel(page, { id: "boq-self-approval", what: /cannot approve a BOQ you created yourself/, where: /Approve/ });
  await expect(btn(page, /^Approve$/)).toBeDisabled();
  await expect(page.getByTestId("boq-approve-blocked")).toContainText(/someone else must approve/i);
  expect((await detail(page, boq.id)).status, "still submitted").toBe("submitted");
});

test("O-03 a plain member cannot approve: Approve is off and says which roles can", async () => {
  const page = MEMBER.page;
  await open(page, boq.id);
  await expect(btn(page, /^Approve$/)).toBeDisabled({ timeout: 60_000 });
  await expect(page.getByTestId("boq-approve-blocked")).toContainText(/Only an owner, admin or project manager can approve/);
});

test("O-04 the Owner approves it: the status is re-read from the server as approved", async () => {
  const page = OWNER.page;
  await open(page, boq.id);
  await expect(btn(page, /^Approve$/)).toBeEnabled({ timeout: 60_000 });
  await btn(page, /^Approve$/).click();
  await expect.poll(async () => (await detail(page, boq.id)).status, { timeout: 60_000 }).toBe("approved");
});

test("O-05 an approved BOQ cannot be deleted or have its lines edited in place: the controls say why", async () => {
  const page = PM.page;
  await open(page, boq.id);
  await expect(page.getByRole("button", { name: /Delete/ })).toBeDisabled({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Delete/ })).toContainText(/Only a draft BOQ can be deleted/);
});

test("O-06 Budget % of 150: named at once, the cell outlined, the typed value kept; 40 is then saved and re-read", async () => {
  const page = PM.page;
  await open(page, boq.id);
  const pct = page.locator('[data-testid^="budget-pct-"]').first();
  await expect(pct).toBeVisible({ timeout: 60_000 });
  const cellId = (await pct.getAttribute("id"))!;
  await pct.fill("150");
  await pct.blur();
  await expectGuidedPanel(page, { id: "boq-budget-percent-bad", what: /Budget % must be a number from 0 to 100/, where: /Budget %/ });
  await expectHighlighted(page, `[id="${cellId}"]`);
  await expect(pct).toHaveValue("150");
  await page.evaluate((i) => document.getElementById(i)?.removeAttribute("data-px-highlighted"), cellId);
  await pressFix(page);
  await expectHighlighted(page, `[id="${cellId}"]`);
  await pct.fill("40");
  await pct.blur();
  await expect(page.getByText("✓ Saved").first()).toBeVisible({ timeout: 30_000 });
  const lineId = cellId.split(":")[0];
  await expect.poll(async () => Number((await detail(page, boq.id)).lineItems.find((l) => l.id === lineId)?.budgetPercentage), { timeout: 30_000 }).toBe(40);
});

test("O-07 a negative vendor amount: named at once, the cell outlined; a good amount is then saved and re-read", async () => {
  const page = PM.page;
  await open(page, boq.id);
  const cell = page.locator('[id$=":vendorAmount"]').first();
  await expect(cell).toBeVisible({ timeout: 60_000 });
  const cellId = (await cell.getAttribute("id"))!;
  await cell.fill("-5");
  await cell.blur();
  await expectGuidedPanel(page, { id: "boq-budget-amount-bad", what: /must be a number, zero or more/, where: /outlined box/ });
  await expectHighlighted(page, `[id="${cellId}"]`);
  await expect(cell).toHaveValue("-5");
  await cell.fill("1500");
  await cell.blur();
  await expect(page.getByText("✓ Saved").first()).toBeVisible({ timeout: 30_000 });
  const lineId = cellId.split(":")[0];
  await expect.poll(async () => Number((await detail(page, boq.id)).lineItems.find((l) => l.id === lineId)?.vendorAmount), { timeout: 30_000 }).toBe(1500);
});

test("O-08 the money grid refuses a negative quantity in a cell: panel, the cell outlined, the typed value stays", async () => {
  const page = PM.page;
  await open(page, boq.id);
  const cell = page.locator('input[aria-label^="qtyProject for"]').first();
  await expect(cell).toBeVisible({ timeout: 60_000 });
  const cellId = (await cell.getAttribute("id"))!;
  await cell.fill("-3");
  await cell.blur();
  await expectGuidedPanel(page, { id: "boq-cell-invalid", what: /Quantity cannot be negative/ });
  await expectHighlighted(page, `[id="${cellId}"]`);
  await expect(cell).toHaveValue("-3");
});

test("O-09 revise: a quantity below the work done on site is refused by the server; the panel names the line and its Qty is outlined", async () => {
  const page = PM.page;
  await open(page, boq.id, "/revise");
  await expect(page.locator("#revision-title")).toBeVisible({ timeout: 60_000 });
  await failOnce(page, `/api/scope/${boq.id}/revisions`, "POST", 409, {
    error: "Scope reduction blocked -- this revision would remove or reduce work already completed on site: E-1.",
    conflicts: [{ itemCode: "E-1", description: `${AUDIT} excavation`, recordedQty: 60, unit: "m3", lastRecordedAt: "2026-10-01" }],
  });
  await page.locator("#boq-line-0-quantity").fill("20");
  await btn(page, /^Save/).click();
  const p = await expectGuidedPanel(page, { what: /Scope reduction blocked/ });
  await expect(p.getByTestId("guided-error-fix")).toBeVisible();
  await expect(page.getByRole("button", { name: /Apply anyway - override 1 completed line/ })).toBeVisible();
  await expectHighlighted(page, "#boq-line-0-quantity");
  await expect(page.locator("#boq-line-0-quantity")).toHaveValue("20");
});

test("O-10 revise: a negative quantity, a duplicate code and an empty title are told before anything is sent; the edits survive a trip away and back", async () => {
  const page = PM.page;
  await open(page, boq.id, "/revise");
  await expect(page.locator("#revision-title")).toBeVisible({ timeout: 60_000 });
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/revisions$/.test(new URL(r.url()).pathname)) posts += 1;
  });
  await page.locator("#boq-line-0-quantity").fill("-4");
  await page.locator("#boq-line-1-itemCode").fill("E-1"); // the same code as line 1
  await btn(page, /^Save/).click();
  await expectGuidedPanel(page, { id: "boq-line-number-bad", what: /Qty cannot be negative/ });
  await expectHighlighted(page, "#boq-line-0-quantity");
  await expect(page.locator("#boq-line-1-itemCode")).toHaveAttribute("aria-invalid", "true"); // the duplicate code is marked too
  expect(posts).toBe(0);
  // away and back: the edits are still there
  await page.goto(`/projects`);
  await page.goto(`/scope/${boq.id}/revise?projectId=${proj.id}`);
  await expect(page.getByTestId("draft-restored")).toContainText(/kept what you typed/);
  await expect(page.locator("#boq-line-0-quantity")).toHaveValue("-4");
  await expect(page.locator("#boq-line-1-itemCode")).toHaveValue("E-1");
});

test("O-11 compare on a BOQ that was never revised: the panel says there is nothing to compare, and the fix leads to the list and back", async () => {
  const page = PM.page;
  await open(page, boq.id, "/compare");
  await expectGuidedPanel(page, { id: "boq-compare-unavailable", what: /no previous revision to compare against/, where: /Scope of Work/ });
  await pressFix(page);
  await expect(page).toHaveURL(/\/scope(\?|$)/);
  await backFromStrip(page, /this screen|my BOQ/i);
  await expect(page).toHaveURL(new RegExp(`/scope/${boq.id}/compare`));
});

test("O-12 a BOQ that does not exist: the panel says it cannot be found and leads to the list", async () => {
  const page = PM.page;
  await page.goto(`/scope/00000000-0000-4000-8000-000000000000?projectId=${proj.id}`);
  const p = await expectGuidedPanel(page);
  await expect(p.getByTestId("guided-error-title")).not.toHaveText("");
  await pressFix(page);
  await expect(page).toHaveURL(/\/scope(\?|$|\/)/);
});

test("O-13 baseline: no evidence typed -> the panel and the evidence box outlined; with evidence the baseline is confirmed and re-read from the server", async () => {
  const page = PM.page;
  await page.goto(`/analysis/project-360?projectId=${proj.id}`);
  await page.evaluate(() => sessionStorage.clear());
  const evidence = page.locator("#baseline-evidence");
  await expect(evidence).toBeVisible({ timeout: 90_000 });
  await btn(page, /Confirm baseline/).click();
  await expectGuidedPanel(page, { id: "boq-baseline-evidence-missing", what: /Name the evidence first/, where: /Evidence for the baseline/ });
  await expectHighlighted(page, "#baseline-evidence");
  await page.evaluate(() => document.getElementById("baseline-evidence")?.removeAttribute("data-px-highlighted"));
  await pressFix(page);
  await expectHighlighted(page, "#baseline-evidence");
  await evidence.fill(`${AUDIT} PO 4411 dated 3 Aug`);
  await btn(page, /Confirm baseline/).click();
  await expect(page.getByTestId("project360-baseline-confirmed")).toContainText("PO 4411", { timeout: 60_000 });
  const res = await page.request.get(`/api/reports/boq-analysis?projectId=${proj.id}`);
  expect(((await res.json()) as { row: { hasBaseline: boolean } }).row.hasBaseline, "the server holds the baseline").toBe(true);
});

test("O-14 Project 360 of a project with no BOQ: the panel says so and leads to New BOQ; the strip brings the person back", async ({ }) => {
  const page = PM.page;
  const empty = await makeAuditProject(page, "no boq");
  await page.goto(`/analysis/project-360?projectId=${empty.id}`);
  await page.evaluate(() => sessionStorage.clear());
  await expectGuidedPanel(page, { id: "boq-no-boq-yet", where: /Scope of Work > New/ });
  await pressFix(page);
  await expect(page).toHaveURL(/\/scope\/new/);
  await backFromStrip(page, /this screen/i);
  await expect(page).toHaveURL(/\/analysis\/project-360/);
});

test("O-15 site instruction from a BOQ: the link carries the BOQ; a .txt file is refused in the panel, the file box outlined; a PDF is then saved and linked", async () => {
  const page = PM.page;
  await open(page, boq.id);
  await page.getByRole("link", { name: "Add site instruction" }).click();
  await expect(page).toHaveURL(new RegExp(`/site-instructions/new\\?.*boqId=${boq.id}`));
  await page.evaluate(() => sessionStorage.clear());
  await page.locator("#toContractor").fill(`${AUDIT} contractor`);
  await page.locator("#description").fill(`${AUDIT} instruction`);
  await page.locator("#file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a pdf") });
  await expectGuidedPanel(page, { id: "si-file-invalid", what: /is not a PDF or a photo/, where: /Instruction file/ });
  await expectHighlighted(page, "#file");
  await expect(page.locator("#toContractor")).toHaveValue(`${AUDIT} contractor`);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  await page.locator("#file").setInputFiles({ name: "instruction.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByTestId("guided-error")).toHaveCount(0);
  await btn(page, /^Save/).click();
  await expect(page).toHaveURL(/\/site-instructions\/[0-9a-f-]{8,}/, { timeout: 90_000 });
  const list = await page.request.get(`/api/site-instructions?projectId=${proj.id}`);
  const { siteInstructions } = (await list.json()) as { siteInstructions: { boqId: string | null; description: string }[] };
  expect(siteInstructions.find((s) => s.description === `${AUDIT} instruction`)?.boqId, "the instruction is linked to the BOQ").toBe(boq.id);
});

test("O-16 site instruction: a year that cannot be right is named in the panel and the issue date outlined", async () => {
  const page = PM.page;
  await page.goto(`/site-instructions/new?projectId=${proj.id}&boqId=${boq.id}`);
  await page.evaluate(() => sessionStorage.clear());
  await expect(page.locator("#issueDate")).toBeVisible({ timeout: 60_000 });
  await page.locator("#issueDate").fill("0002-03-04");
  await page.locator("#issueDate").blur();
  await expectGuidedPanel(page, { id: "si-date-invalid", what: /year 2/, where: /Issue date/ });
  await expectHighlighted(page, "#issueDate");
  await expect(btn(page, /^Save/)).toBeDisabled();
});

test("O-17 Approve refused by the server for a stale screen (someone else approved it first): the panel, and the screen re-reads", async () => {
  // a second AUDIT BOQ: draft -> submitted by the PM, shown to the owner, approved behind the owner's back, then the owner presses Approve
  const page = OWNER.page;
  const second = await makeAuditBoq(PM.page.request, proj.id, "stale approve");
  expect((await PM.page.request.post(`/api/scope/${second.id}/submit`)).ok()).toBe(true);
  await open(page, second.id);
  await expect(btn(page, /^Approve$/)).toBeEnabled({ timeout: 60_000 });
  const r = await page.request.post(`/api/scope/${second.id}/approve`);
  expect(r.ok(), "approved behind the screen's back").toBe(true);
  await btn(page, /^Approve$/).click();
  await expectGuidedPanel(page, { id: "boq-approve-not-submitted", what: /Only a submitted BOQ can be approved/ });
  await expect(btn(page, /^Approve$/)).toHaveCount(0, { timeout: 30_000 });
  expect((await detail(page, second.id)).status).toBe("approved");
});
