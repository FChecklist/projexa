import { test, expect, type Browser, type Page } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";
import { apiJson, expectCompleteGuide, goBackViaStrip, guidePanel, pressFixAndExpectHighlight, stamp, AUDIT_TAG } from "./support/guided-g2";

// GUIDED ERRORS, GROUP G2 -- BILLING MILESTONES, the "Invoice" action and tax templates.
// Run: PLAYWRIGHT_BASE_URL=https://projexa-ai.com bunx playwright test e2e/guided-g2-billing.spec.ts
// Two-user flow for the real approvals: Arjun (owner) creates, drafts and submits; Deepak (project manager) approves. Everything created is AUDIT-tagged and
// never deleted. NOTE: a successful "Invoice" raises a real interim bill + sales invoice on the Meridian project (AUDIT-tagged, kept).
test.use({ storageState: "playwright/.auth/ceo.json" });
test.describe.configure({ mode: "serial" });

const P = DEFAULT_PROJECT.id;
const URL_ = `/billing-milestones?projectId=${P}`;

type Claim = { id: string; milestoneDescription: string; status: string; interimBillId: string | null };
async function claims(page: Page): Promise<Claim[]> {
  return (await apiJson<{ claims?: Claim[] }>(page, `/api/billing-claims?projectId=${P}&all=true`)).claims ?? [];
}

/** Creates an AUDIT-tagged claim through the real form and returns its description. */
async function createClaim(page: Page, label: string): Promise<string> {
  const description = `${AUDIT_TAG} ${stamp()} ${label}`;
  await page.goto(URL_);
  await page.getByTestId("billing-new-milestone").click();
  await page.getByTestId("claim-customer").selectOption({ index: 1 });
  await page.locator("#claim-scheduled-date").fill("2026-12-01");
  await page.locator("#claim-description").fill(description);
  await page.getByTestId("claim-save").click();
  await expect(page.getByText(description)).toBeVisible({ timeout: 60_000 });
  return description;
}
const row = (page: Page, description: string) => page.locator("li", { hasText: description }).first();

test("new milestone with nothing typed: customer, date and description are all named, the first box is outlined, nothing is saved", async ({ page }) => {
  await page.goto(URL_);
  const before = (await claims(page)).length;
  await page.getByTestId("billing-new-milestone").click();
  await page.getByTestId("claim-save").click();
  await expectCompleteGuide(page, { code: "BILL_CUSTOMER_MISSING", minSteps: 2 });
  await expect(page.getByTestId("fault-panel-more")).toContainText("planned billing date");
  await expect(page.getByTestId("fault-panel-more")).toContainText("Describe the milestone");
  await pressFixAndExpectHighlight(page, "claim-customer");
  expect((await claims(page)).length, "nothing was saved").toBe(before);
});

test("retention above 100 or not a number is refused beside the box", async ({ page }) => {
  await page.goto(URL_);
  await page.getByTestId("billing-new-milestone").click();
  await page.getByTestId("claim-customer").selectOption({ index: 1 });
  await page.locator("#claim-scheduled-date").fill("2026-12-01");
  await page.locator("#claim-description").fill(`${AUDIT_TAG} retention probe`);
  for (const bad of ["150", "-2", "five"]) {
    await page.locator("#claim-retention").fill(bad);
    await page.getByTestId("claim-save").click();
    await expectCompleteGuide(page, { code: "BILL_RETENTION_RANGE" });
  }
  await pressFixAndExpectHighlight(page, "claim-retention");
  await expect(page.locator("#claim-description")).toHaveValue(`${AUDIT_TAG} retention probe`);
});

test("the milestone typed survives leaving the screen and coming back", async ({ page }) => {
  await page.goto(URL_);
  await page.getByTestId("billing-new-milestone").click();
  await page.locator("#claim-scheduled-date").fill("2026-12-05");
  await page.locator("#claim-description").fill(`${AUDIT_TAG} draft probe`);
  await page.goto(`/scope?projectId=${P}`);
  await page.goto(URL_);
  await expect(page.getByTestId("billing-draft-restored")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#claim-description")).toHaveValue(`${AUDIT_TAG} draft probe`);
  await expect(page.locator("#claim-scheduled-date")).toHaveValue("2026-12-05");
});

test("no approved BOQ on the project: the page says so, why, and the button goes to Scope of Work and back", async ({ page }) => {
  // the project's BOQ lookup is answered "none" for this one page, as for a brand-new project
  await page.route(/\/api\/reports\/boq-analysis/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ row: { boqId: null } }) }));
  await page.goto(URL_);
  const panel = page.getByTestId("billing-no-approved-boq");
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expectCompleteGuide(page, { fixLabel: /./ });
  await expect(panel).toContainText("Approve the BOQ on Scope of Work first");
  await guidePanel(page).getByTestId("guided-error-fix").click();
  await page.waitForURL(/\/scope/);
  await expect(page.getByTestId("return-strip")).toBeVisible();
  await page.unroute(/\/api\/reports\/boq-analysis/);
  await goBackViaStrip(page, /\/billing-milestones/);
});

let claimA = "";
let claimB = "";

test("two-user flow: Arjun creates, drafts and submits a milestone; Deepak approves it; the status persisted", async ({ page, browser }) => {
  claimA = await createClaim(page, "claim A");
  await row(page, claimA).getByRole("button", { name: "Draft" }).click();
  await expect(row(page, claimA).getByRole("button", { name: "Submit" })).toBeVisible({ timeout: 60_000 });
  await row(page, claimA).getByRole("button", { name: "Submit" }).click();
  await expect(row(page, claimA).getByRole("button", { name: "Approve" })).toBeVisible({ timeout: 60_000 });
  await approveAsDeepak(browser, claimA);
  await page.reload();
  await expect(row(page, claimA).getByText("Client Approved")).toBeVisible({ timeout: 60_000 });
  const persisted = (await claims(page)).find((c) => c.milestoneDescription === claimA);
  expect(persisted?.status).toBe("client_approved");
});

async function approveAsDeepak(browser: Browser, description: string) {
  const ctx = await browser.newContext({ storageState: "playwright/.auth/finance.json" });
  const p = await ctx.newPage();
  await p.goto(URL_);
  await row(p, description).getByRole("button", { name: "Approve" }).click();
  await expect(row(p, description).getByText("Client Approved")).toBeVisible({ timeout: 60_000 });
  await ctx.close();
}

test("a window that still shows 'Draft' after another window drafted: the 409 is explained and the status is unchanged by the second click", async ({ page, context }) => {
  const description = await createClaim(page, "double-click probe");
  const other = await context.newPage();
  await other.goto(URL_);
  await row(page, description).getByRole("button", { name: "Draft" }).click();
  await expect(row(page, description).getByRole("button", { name: "Submit" })).toBeVisible({ timeout: 60_000 });
  // the other window is stale: it still offers Draft
  await row(other, description).getByRole("button", { name: "Draft" }).click();
  await expect(guidePanel(other)).toBeVisible({ timeout: 60_000 });
  await expect(other.getByTestId("guided-error-what")).toContainText(/Cannot move a 'drafted' claim/);
  await expect(other.getByTestId("guided-error-steps").locator("li").first()).toBeVisible();
  expect((await claims(page)).find((c) => c.milestoneDescription === description)?.status).toBe("drafted");
});

test("Invoice with the bill date emptied and no tax template chosen: both are named, the box is outlined, nothing is sent", async ({ page }) => {
  test.skip(!claimA, "needs the approved milestone from the two-user test");
  await page.goto(URL_);
  await row(page, claimA).getByRole("button", { name: "Invoice" }).click();
  await page.locator(`[id^="bill-date-"]`).first().fill("");
  await page.locator(`[data-testid^="claim-invoice-confirm-"]`).first().click();
  await expectCompleteGuide(page, { code: "BILL_BILLDATE_MISSING" });
  await expect(page.getByTestId("fault-panel-more")).toContainText("tax template");
  await pressFixAndExpectHighlight(page, (await page.locator(`[id^="bill-date-"]`).first().getAttribute("id"))!);
  expect((await claims(page)).find((c) => c.milestoneDescription === claimA)?.status, "still client_approved").toBe("client_approved");
});

test("Invoice: first claim is raised or already billed; the next one has 'No new progress to bill' -> log the progress, then Back returns to the invoice form as it was", async ({ page, browser }) => {
  test.skip(!claimA, "needs the approved milestone from the two-user test");
  async function tryInvoice(description: string): Promise<"raised" | "refused"> {
    await page.goto(URL_);
    await row(page, description).getByRole("button", { name: "Invoice" }).click();
    const form = row(page, description);
    await form.locator("select").selectOption({ index: 1 });
    await form.locator(`[data-testid^="claim-invoice-confirm-"]`).click();
    const outcome = await Promise.race([
      page.getByTestId("guided-error").waitFor({ timeout: 60_000 }).then(() => "refused" as const),
      page.waitForResponse((r) => r.url().includes("/api/billing-claims/") && r.request().method() === "PATCH" && r.ok(), { timeout: 60_000 }).then(() => "raised" as const),
    ]);
    return outcome;
  }
  let outcome = await tryInvoice(claimA);
  if (outcome === "raised") {
    // everything tracked is billed now: a second approved milestone has nothing new to bill
    claimB = await createClaim(page, "claim B");
    await row(page, claimB).getByRole("button", { name: "Draft" }).click();
    await expect(row(page, claimB).getByRole("button", { name: "Submit" })).toBeVisible({ timeout: 60_000 });
    await row(page, claimB).getByRole("button", { name: "Submit" }).click();
    await expect(row(page, claimB).getByRole("button", { name: "Approve" })).toBeVisible({ timeout: 60_000 });
    await approveAsDeepak(browser, claimB);
    outcome = await tryInvoice(claimB);
  }
  expect(outcome).toBe("refused");
  await expect(guidePanel(page)).toHaveAttribute("data-guide-id", "billing-no-new-progress");
  await expectCompleteGuide(page, { id: "billing-no-new-progress", minSteps: 2, fixLabel: /progress/i });
  await expect(page.getByTestId("guided-error-what")).toContainText("No new progress to bill");
  // nothing was invoiced by the refused attempt
  const refusedClaim = (await claims(page)).find((c) => c.milestoneDescription === (claimB || claimA));
  expect(refusedClaim?.status).toBe("client_approved");
  // the fix goes to Work Progress; the way back brings the person to the same invoice form with the template still chosen
  const chosen = await row(page, claimB || claimA).locator("select").inputValue();
  await guidePanel(page).getByTestId("guided-error-fix").click();
  await page.waitForURL(/\/work-progress/);
  await goBackViaStrip(page, /\/billing-milestones/);
  await expect(row(page, claimB || claimA).locator("select")).toHaveValue(chosen);
});

test("the tax template form refuses a rate above 100 inside the form and keeps what was typed", async ({ page }) => {
  // the template form is on this page only while an approved milestone has no template: shown by answering the list of templates as empty
  test.skip(!claimA, "needs an approved milestone on the page");
  const url = /\/api\/tax-templates/;
  await page.route(url, (route) => route.request().method() === "GET" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ taxTemplates: [] }) }) : route.continue());
  await page.goto(URL_);
  const form = page.getByTestId("tax-template-form").first();
  await expect(form).toBeVisible({ timeout: 60_000 });
  await form.locator("#tt-cgst").fill("150");
  await form.getByTestId("tax-template-create").click();
  await expect(form.getByTestId("guided-error")).toBeVisible({ timeout: 60_000 });
  await expect(form.getByTestId("guided-error-what")).toContainText("between 0 and 100");
  await expect(form.locator("#tt-cgst")).toHaveValue("150");
  await page.unroute(url);
});

test("the billing list says so when it cannot be read (server down) and offers Try again", async ({ page }) => {
  const url = /\/api\/billing-claims\?/;
  await page.route(url, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The construction data service did not respond in time." }) }));
  await page.goto(URL_);
  await expect(page.getByTestId("billing-load-error")).toBeVisible({ timeout: 60_000 });
  await page.unroute(url);
  await page.getByTestId("billing-load-error").getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("billing-load-error")).toHaveCount(0, { timeout: 60_000 });
});

test("role too low: a project member (Sneha) pressing Approve is told it needs a manager and what to ask for", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "playwright/.auth/hr.json" });
  const page = await ctx.newPage();
  const submitted = (await (async () => { const p = await ctx.newPage(); await p.goto(URL_); const list = (await claims(p)).filter((c) => c.status === "submitted"); await p.close(); return list; })())[0];
  test.skip(!submitted, "no submitted milestone to press Approve on");
  await page.goto(URL_);
  await row(page, submitted!.milestoneDescription).getByRole("button", { name: "Approve" }).click();
  await expect(guidePanel(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("guided-error-steps")).toContainText(/Owner|Admin|Project Manager/);
  expect((await claims(page)).find((c) => c.id === submitted!.id)?.status, "unchanged").toBe("submitted");
  await ctx.close();
});
