import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { openLaptop, openLocal, outboxOps, projectId, serverRows } from "./support/real-backend";
import { AUDIT, expectGuidedPanel, expectHighlighted } from "./support/guided";

// GUIDED ERRORS, group G1 -- the laptop screens (the default for a signed-in person): New BOQ, New Revision, Line budgets and New Site Instruction in the
// offline shell. L-xx cases. The laptop's number boxes are plain text boxes, so letters and commas CAN be typed here. Every fault: the panel, the box
// named and outlined, nothing kept in the outbox, the draft kept; after the fix the write is queued and the SERVER'S row is re-read.

test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

let A: { context: BrowserContext; page: Page };
let P = "";
test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_800_000);
  A = await openLaptop(browser, "finance");
  P = await projectId(A.context);
});
test.afterAll(async () => {
  await A?.context.close();
});

const id = (i: number, col: string) => `[id="boq-line-${i}-${col}"]`;
async function fill(page: Page, testId: string, text: string) {
  const box = page.getByTestId(testId);
  await box.click();
  await box.fill(text);
}
async function openNew(page: Page) {
  await openLocal(page, `/local/scope/new?projectId=${P}`, "scope-new-screen", "ready"); // the New BOQ screen is data-state=ready (the list screens are "local")
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId("scope-new-screen")).toBeVisible({ timeout: 120_000 });
}
const outboxCount = async (page: Page) => (await outboxOps(page)).length;

test("L-01 a negative quantity on the laptop's New BOQ: the panel, the box outlined, nothing queued; the fix is queued and the SERVER'S row is re-read", async () => {
  const page = A.page;
  await openNew(page);
  const title = `${AUDIT} laptop negative`;
  const before = await outboxCount(page);
  await fill(page, "scope-new-title", title);
  await fill(page, "scope-new-0-description", `${AUDIT} laptop slab`);
  await fill(page, "scope-new-0-unit", "m3");
  await fill(page, "scope-new-0-quantity", "-4");
  await fill(page, "scope-new-0-rate", "50");
  await page.getByTestId("scope-new-save").click();
  await expectGuidedPanel(page, { id: "boq-line-number-bad", what: /Qty cannot be negative/, where: /outlined box/ });
  await expectHighlighted(page, id(0, "quantity"));
  await expect(page.locator(id(0, "quantity"))).toHaveAttribute("aria-invalid", "true");
  expect(await outboxCount(page), "nothing was kept").toBe(before);
  await expect(page.getByTestId("scope-new-0-quantity")).toHaveValue("-4");
  await fill(page, "scope-new-0-quantity", "4");
  await expect(page.getByTestId("guided-error")).toHaveCount(0);
  await page.getByTestId("scope-new-save").click();
  await expect(page.getByTestId("scope-object")).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await serverRows(A.context, P, "boqs", title)).length, { timeout: 240_000, message: "the BOQ reached the server" }).toBeGreaterThan(0);
});

test("L-02 letters and a comma in a number box (forty, 12,500): each is told with the exact box", async () => {
  const page = A.page;
  await openNew(page);
  await fill(page, "scope-new-title", `${AUDIT} laptop letters`);
  await fill(page, "scope-new-0-description", `${AUDIT} laptop`);
  await fill(page, "scope-new-0-unit", "m3");
  await fill(page, "scope-new-0-quantity", "12,500");
  await fill(page, "scope-new-0-rate", "forty");
  await page.getByTestId("scope-new-save").click();
  const p = await expectGuidedPanel(page, { id: "boq-line-number-bad" });
  await expect(p.getByTestId("guided-error-what")).toContainText(/other problem is marked/);
  await expectHighlighted(page, id(0, "quantity"));
  await expect(page.locator(id(0, "rate"))).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("scope-new-0-quantity-fault")).toContainText(/type 12500, not 12,500/);
  await expect(page.getByTestId("scope-new-0-rate-fault")).toContainText(/"forty" is not a number/);
});

test("L-03 duplicate item code, unknown parent and a share over 100 on the laptop", async () => {
  const page = A.page;
  await openNew(page);
  await fill(page, "scope-new-title", `${AUDIT} laptop rules`);
  await fill(page, "scope-new-0-description", `${AUDIT} a`);
  await fill(page, "scope-new-0-unit", "m3");
  await fill(page, "scope-new-0-quantity", "1");
  await fill(page, "scope-new-0-rate", "1");
  await fill(page, "scope-new-0-itemCode", "X");
  await page.getByTestId("scope-new-add").click();
  await fill(page, "scope-new-1-description", `${AUDIT} b`);
  await fill(page, "scope-new-1-unit", "m3");
  await fill(page, "scope-new-1-itemCode", "X");
  await fill(page, "scope-new-1-parentItemCode", "NOPE");
  await fill(page, "scope-new-1-breakdownPercentage", "180");
  await page.getByTestId("scope-new-save").click();
  // three faults at once: the panel leads with the sub-task's share (line 2) and says how many others are marked; the duplicate code is told in full beside its own box
  const p = await expectGuidedPanel(page, { id: "boq-breakdown-range" });
  await expect(p.getByTestId("guided-error-what")).toContainText(/2 other problems are marked/);
  await expect(page.getByText(/already used on line 1/).first()).toBeVisible();
  await expect(page.locator(id(1, "itemCode"))).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(id(1, "parentItemCode"))).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(id(1, "breakdownPercentage"))).toHaveAttribute("aria-invalid", "true");
});

test("L-04 leave the New BOQ form and come back: the title and every line are still there", async () => {
  const page = A.page;
  await openNew(page);
  const title = `${AUDIT} laptop trip`;
  await fill(page, "scope-new-title", title);
  for (let i = 0; i < 6; i++) {
    if (i > 0) await page.getByTestId("scope-new-add").click();
    await fill(page, `scope-new-${i}-description`, `${AUDIT} item ${i + 1}`);
    await fill(page, `scope-new-${i}-unit`, "m3");
  }
  await page.goto(`/local/scope?projectId=${P}`);
  await expect(page.getByTestId("scope-list")).toBeVisible({ timeout: 120_000 });
  await page.goto(`/local/scope/new?projectId=${P}`);
  await expect(page.getByTestId("scope-new-screen")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("scope-new-title")).toHaveValue(title);
  await expect(page.getByTestId("scope-new-5-description")).toHaveValue(`${AUDIT} item 6`);
  await expect(page.getByTestId("draft-restored")).toContainText("We kept what you typed earlier");
});

test("L-05 Budget % of 101 on the laptop's Line budgets: the panel, the box outlined, nothing queued", async () => {
  const page = A.page;
  // the BOQ the first test made, once the server has handed it back to the laptop
  await openLocal(page, `/local/scope?projectId=${P}`, "scope-list");
  const row = page.getByTestId("scope-list-row").filter({ hasText: `${AUDIT} laptop negative` }).first();
  await expect(row).toBeVisible({ timeout: 240_000 });
  await row.getByRole("link").click();
  await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local", { timeout: 240_000 });
  const before = await outboxCount(page);
  await page.getByTestId("boq-local-budget").click();
  await expect(page.getByTestId("scope-budget-screen")).toBeVisible({ timeout: 120_000 });
  const pct = page.locator('[data-testid^="scope-budget-"][data-testid$="-pct"]').first();
  await pct.fill("101");
  await page.locator('[data-testid^="scope-budget-"][data-testid$="-save"]').first().click();
  await expectGuidedPanel(page, { id: "boq-budget-percent-bad", what: /from 0 to 100/ });
  await expect(pct).toHaveAttribute("aria-invalid", "true");
  await expectHighlighted(page, `[id="${await pct.getAttribute("id")}"]`);
  expect(await outboxCount(page)).toBe(before);
});

test("L-06 a new site instruction with nothing typed: the panel names the contractor and the instruction; no browser bubble, nothing queued", async () => {
  const page = A.page;
  await openLocal(page, `/local/site-instructions/new?projectId=${P}`, "si-new");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId("si-form")).toBeVisible({ timeout: 120_000 });
  const before = await outboxCount(page);
  await page.getByRole("button", { name: /Save instruction/ }).click();
  await expectGuidedPanel(page, { id: "si-field-required" });
  await expect(page.locator("#toContractor")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#description")).toHaveAttribute("aria-invalid", "true");
  expect(await outboxCount(page)).toBe(before);
});
