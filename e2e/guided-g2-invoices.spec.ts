import { test, expect, type Page } from "@playwright/test";
import { apiJson, expectCompleteGuide, guidePanel, pressFixAndExpectHighlight, stamp, AUDIT_TAG } from "./support/guided-g2";

// GUIDED ERRORS, GROUP G2 -- SALES INVOICES (create, post to the ledger, record a payment). Meridian CEO; AUDIT-tagged data, never deleted (a posted
// invoice is a real ledger entry on the E2E test organisation).
// Run: PLAYWRIGHT_BASE_URL=https://projexa-ai.com bunx playwright test e2e/guided-g2-invoices.spec.ts
test.use({ storageState: "playwright/.auth/ceo.json" });
test.describe.configure({ mode: "serial" });

const save = (page: Page) => page.getByRole("button", { name: /^Save/ });
/** The customer list loads after the form; "+ New customer" is always its last option, so wait for a real customer and take the first one. */
async function pickExistingCustomer(page: Page): Promise<void> {
  await page.getByTestId("inv-customer").click();
  const real = page.getByRole("option").filter({ hasNotText: /New customer/ }).first();
  await expect(real, "the test organisation needs at least one customer").toBeVisible({ timeout: 60_000 });
  await real.click();
}
type Inv = { id: string; status: string; grandTotal: string; outstandingAmount: string; items: { description: string }[] };

test("empty invoice: customer and every line box are named, the customer box is outlined, nothing is saved", async ({ page }) => {
  await page.goto("/invoices/new");
  await expect(page.getByTestId("inv-customer")).toBeVisible({ timeout: 60_000 });
  await save(page).click();
  await expectCompleteGuide(page, { code: "INV_CUSTOMER_MISSING", minSteps: 2 });
  await expect(page.getByTestId("fault-panel-more")).toContainText("Line 1");
  await pressFixAndExpectHighlight(page, "inv-customer");
});

test("a line with quantity 0 and a negative rate is refused line by line; what was typed stays", async ({ page }) => {
  await page.goto("/invoices/new");
  await pickExistingCustomer(page);
  await page.getByTestId("inv-line-description-0").fill(`${AUDIT_TAG} probe`);
  await page.getByTestId("inv-line-qty-0").fill("0");
  await page.getByTestId("inv-line-rate-0").fill("-5");
  await save(page).click();
  await expectCompleteGuide(page, { code: "INV_LINE_QTY_INVALID" });
  await expect(page.getByTestId("fault-panel-more")).toContainText("rate must be a number");
  await pressFixAndExpectHighlight(page, "inv-line-qty-0");
  await expect(page.getByTestId("inv-line-description-0")).toHaveValue(`${AUDIT_TAG} probe`);
});

test("the invoice typed survives leaving the form and coming back", async ({ page }) => {
  await page.goto("/invoices/new");
  await page.getByTestId("inv-line-description-0").fill(`${AUDIT_TAG} draft probe`);
  await page.getByTestId("inv-line-rate-0").fill("250");
  await page.goto("/invoices?tab=invoices");
  await page.goto("/invoices/new");
  await expect(page.getByTestId("inv-draft-restored")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("inv-line-description-0")).toHaveValue(`${AUDIT_TAG} draft probe`);
  await expect(page.getByTestId("inv-line-rate-0")).toHaveValue("250");
});

let invoiceId = "";
test("a valid draft invoice is saved and the lines persisted", async ({ page }) => {
  await page.goto("/invoices/new");
  const description = `${AUDIT_TAG} ${stamp()} invoice`;
  await pickExistingCustomer(page);
  await page.getByTestId("inv-line-description-0").fill(description);
  await page.getByTestId("inv-line-qty-0").fill("2");
  await page.getByTestId("inv-line-rate-0").fill("100");
  await save(page).click();
  await page.waitForURL(/\/invoices\/(?!new)[0-9a-z-]+$/, { timeout: 60_000 }); // not "/invoices/new" itself
  invoiceId = page.url().split("/invoices/")[1]!.split("?")[0]!;
  const inv = await apiJson<Inv>(page, `/api/sales-invoices/${invoiceId}`);
  expect(inv.status).toBe("draft");
  expect(inv.items.map((i) => i.description)).toContain(description);
});

test("posting to the ledger without choosing a revenue account is refused and the account box is outlined; the invoice stays a draft", async ({ page }) => {
  test.skip(!invoiceId, "needs the draft invoice from the previous test");
  await page.goto(`/invoices/${invoiceId}`);
  await page.getByRole("button", { name: /Submit \(Post to Ledger\)/ }).click();
  await expect(guidePanel(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("fault-panel")).toHaveAttribute("data-fault-code", /INV_(REVENUE_ACCOUNT_MISSING|NO_REVENUE_ACCOUNT)/);
  await expectCompleteGuide(page, { minSteps: 1, fixLabel: /./ });
  expect((await apiJson<Inv>(page, `/api/sales-invoices/${invoiceId}`)).status).toBe("draft");
});

test("recording a payment: amount 0, more than owed, and no account are each explained; nothing is recorded", async ({ page }) => {
  test.skip(!invoiceId, "needs the draft invoice from the earlier tests");
  await page.goto(`/invoices/${invoiceId}`);
  await page.getByTestId("inv-revenue-account").click();
  const option = page.getByRole("option").first();
  test.skip((await option.count()) === 0, "this organisation has no revenue account to post to");
  await option.click();
  await page.getByRole("button", { name: /Submit \(Post to Ledger\)/ }).click();
  await expect(page.getByTestId("inv-payment-amount")).toBeVisible({ timeout: 60_000 });
  const outstanding = (await apiJson<Inv>(page, `/api/sales-invoices/${invoiceId}`)).outstandingAmount;
  await page.getByTestId("inv-payment-amount").fill("0");
  await page.getByRole("button", { name: "Record Payment" }).click();
  await expectCompleteGuide(page, { code: "INV_PAYMENT_AMOUNT_INVALID" });
  await page.getByTestId("inv-payment-amount").fill(String(Number(outstanding) + 1000));
  await page.getByRole("button", { name: "Record Payment" }).click();
  await expectCompleteGuide(page, { code: "INV_PAYMENT_TOO_MUCH" });
  await pressFixAndExpectHighlight(page, "inv-payment-amount");
  await page.getByTestId("inv-payment-amount").fill("10");
  await page.getByRole("button", { name: "Record Payment" }).click();
  await expectCompleteGuide(page, { code: "INV_PAYMENT_ACCOUNT_MISSING" });
  expect((await apiJson<Inv>(page, `/api/sales-invoices/${invoiceId}`)).outstandingAmount, "no payment was recorded").toBe(outstanding);
});

test("an invoice that does not exist is explained with a way back", async ({ page }) => {
  await page.goto("/invoices/00000000-0000-0000-0000-000000000000");
  await expect(guidePanel(page)).toBeVisible({ timeout: 60_000 });
  await expectCompleteGuide(page, { fixLabel: /./ });
});
