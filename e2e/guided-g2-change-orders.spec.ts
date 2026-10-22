import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";
import { USERS } from "./users";
import { apiJson, expectCompleteGuide, guidePanel, pressFixAndExpectHighlight, stamp, AUDIT_TAG } from "./support/guided-g2";

// GUIDED ERRORS, GROUP G2 -- CHANGE ORDERS (create, send for e-signature). One test per way a real person can get the screens wrong.
// Run: PLAYWRIGHT_BASE_URL=https://projexa-ai.com bunx playwright test e2e/guided-g2-change-orders.spec.ts   (signs in as the seeded Meridian CEO)
// Records are AUDIT-tagged and never deleted. A change order is approved ONLY by its signer completing the e-signature link (there is no approve button
// and no BOQ-comparison / evidence-document field in this app), so "approve" and "approve your own work" cannot be done from these screens: see the report.
test.use({ storageState: "playwright/.auth/ceo.json" });
test.describe.configure({ mode: "serial" });

const P = DEFAULT_PROJECT.id;
const NEW_URL = `/change-orders/new?projectId=${P}`;
const save = (page: Page) => page.getByRole("button", { name: /^Save/ });
// the second person: Deepak Joshi (project manager). Their address is on the E2E test domain, so no real mailbox receives the signing e-mail.
const SIGNER = { name: USERS.finance.name, email: USERS.finance.email };

type CoList = { changeOrders?: { id: string; title: string; status: string; costImpact: string; scheduleImpactDays: number }[] };
async function listCos(page: Page) {
  return (await apiJson<CoList>(page, `/api/change-orders?projectId=${P}`)).changeOrders ?? [];
}

test("no title: Save names the title, outlines it, and sends nothing", async ({ page }) => {
  await page.goto(NEW_URL);
  const before = (await listCos(page)).length;
  await expect(page.getByTestId("co-title")).toBeVisible({ timeout: 60_000 });
  await save(page).click();
  await expectCompleteGuide(page, { code: "CO_TITLE_MISSING", minSteps: 2 });
  await expect(page.getByRole("alert").filter({ hasText: "Give the change order a title" }).first()).toBeVisible();
  await pressFixAndExpectHighlight(page, "co-title");
  expect((await listCos(page)).length, "nothing was saved").toBe(before);
});

test("cost typed with letters or commas is refused with an example; the title typed is kept", async ({ page }) => {
  await page.goto(NEW_URL);
  await page.getByTestId("co-title").fill(`${AUDIT_TAG} cost probe`);
  await page.getByTestId("co-cost").fill("Rs 5,000");
  await save(page).click();
  await expectCompleteGuide(page, { code: "CO_COST_NOT_NUMBER" });
  await pressFixAndExpectHighlight(page, "co-cost");
  await expect(page.getByTestId("co-title")).toHaveValue(`${AUDIT_TAG} cost probe`);
  await page.getByTestId("co-cost").fill("-5000");
  await expect(page.getByTestId("fault-panel")).toHaveCount(0);
});

test("schedule days that are not whole (2.5) are refused", async ({ page }) => {
  await page.goto(NEW_URL);
  await page.getByTestId("co-title").fill(`${AUDIT_TAG} days probe`);
  await page.getByTestId("co-days").fill("2.5");
  await save(page).click();
  await expectCompleteGuide(page, { code: "CO_DAYS_INVALID" });
  await pressFixAndExpectHighlight(page, "co-days");
});

test("a title over 200 letters is refused", async ({ page }) => {
  await page.goto(NEW_URL);
  await page.getByTestId("co-title").fill("x".repeat(205));
  await save(page).click();
  await expectCompleteGuide(page, { code: "CO_TITLE_LONG" });
});

test("what was typed survives leaving the form and coming back", async ({ page }) => {
  await page.goto(NEW_URL);
  await page.getByTestId("co-title").fill(`${AUDIT_TAG} draft probe`);
  await page.getByTestId("co-reason").fill("typed before leaving");
  await page.getByTestId("co-cost").fill("1200");
  await page.goto(`/change-orders?projectId=${P}`);
  await page.goto(NEW_URL);
  await expect(page.getByTestId("co-draft-restored")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("co-title")).toHaveValue(`${AUDIT_TAG} draft probe`);
  await expect(page.getByTestId("co-reason")).toHaveValue("typed before leaving");
  await expect(page.getByTestId("co-cost")).toHaveValue("1200");
});

let createdId = "";
test("a valid change order is created, opens its own page, and the values persisted", async ({ page }) => {
  await page.goto(NEW_URL);
  const title = `${AUDIT_TAG} ${stamp()} CO`;
  await page.getByTestId("co-title").fill(title);
  await page.getByTestId("co-reason").fill("created by the G2 guided-errors spec");
  await page.getByTestId("co-cost").fill("-1500");
  await page.getByTestId("co-days").fill("3");
  await save(page).click();
  await page.waitForURL(/\/change-orders\/[0-9a-z-]+$/, { timeout: 60_000 });
  createdId = page.url().split("/change-orders/")[1]!.split("?")[0]!;
  const row = await apiJson<{ title: string; status: string; costImpact: string; scheduleImpactDays: number }>(page, `/api/change-orders/${createdId}`);
  expect(row.title).toBe(title);
  expect(row.status).toBe("draft");
  expect(Number(row.costImpact)).toBe(-1500);
  expect(row.scheduleImpactDays).toBe(3);
});

test("Send for Approval with the signer name and e-mail empty: both are named, the first box is outlined, nothing is sent", async ({ page }) => {
  test.skip(!createdId, "needs the change order created by the previous test");
  await page.goto(`/change-orders/${createdId}`);
  await page.getByRole("button", { name: "Send for Approval" }).click();
  await page.getByRole("button", { name: /^Send$/ }).click();
  await expectCompleteGuide(page, { code: "CO_SIGNER_NAME_MISSING" });
  await expect(page.getByTestId("fault-panel-more")).toContainText("e-mail address");
  await pressFixAndExpectHighlight(page, "co-signer-name");
  expect((await apiJson<{ status: string }>(page, `/api/change-orders/${createdId}`)).status, "still a draft").toBe("draft");
});

test("signer e-mail without an @ or a domain is refused with an example; the name typed is kept", async ({ page }) => {
  test.skip(!createdId, "needs the change order created above");
  await page.goto(`/change-orders/${createdId}`);
  await page.getByRole("button", { name: "Send for Approval" }).click();
  await page.locator("#co-signer-name").fill(SIGNER.name);
  for (const bad of ["deepak.joshi", "deepak@company", "deepak@"]) {
    await page.locator("#co-signer-email").fill(bad);
    await page.getByRole("button", { name: /^Send$/ }).click();
    await expectCompleteGuide(page, { code: "CO_SIGNER_EMAIL_INVALID" });
  }
  await pressFixAndExpectHighlight(page, "co-signer-email");
  await expect(page.locator("#co-signer-name")).toHaveValue(SIGNER.name);
  expect((await apiJson<{ status: string }>(page, `/api/change-orders/${createdId}`)).status).toBe("draft");
});

test("the signer typed in the send box survives leaving the screen", async ({ page }) => {
  test.skip(!createdId, "needs the change order created above");
  await page.goto(`/change-orders/${createdId}`);
  await page.getByRole("button", { name: "Send for Approval" }).click();
  await page.locator("#co-signer-name").fill(SIGNER.name);
  await page.locator("#co-signer-email").fill("not-finished");
  await page.goto(`/change-orders?projectId=${P}`);
  await page.goto(`/change-orders/${createdId}`);
  await expect(page.getByTestId("co-send-draft-restored")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#co-signer-name")).toHaveValue(SIGNER.name);
  await expect(page.locator("#co-signer-email")).toHaveValue("not-finished");
});

test("sending twice (second window still shows a draft): the server's refusal is explained, the status is pending approval exactly once", async ({ page, context }) => {
  test.skip(!createdId, "needs the change order created above");
  const other = await context.newPage();
  await page.goto(`/change-orders/${createdId}`);
  await other.goto(`/change-orders/${createdId}`);
  for (const p of [page, other]) await p.getByRole("button", { name: "Send for Approval" }).click();
  for (const p of [page, other]) {
    await p.locator("#co-signer-name").fill(SIGNER.name);
    await p.locator("#co-signer-email").fill(SIGNER.email);
  }
  await page.getByRole("button", { name: /^Send$/ }).click();
  await expect(page.getByText("Signature Status")).toBeVisible({ timeout: 60_000 });
  // the other window still believes the order is a draft
  await other.getByRole("button", { name: /^Send$/ }).click();
  await expect(guidePanel(other)).toBeVisible({ timeout: 60_000 });
  await expect(other.getByTestId("guided-error-what")).toContainText(/draft/i);
  await expect(other.getByTestId("guided-error-steps").locator("li").first()).toBeVisible();
  const after = await apiJson<{ status: string }>(page, `/api/change-orders/${createdId}`);
  expect(after.status).toBe("pending_approval");
  const sig = await apiJson<{ signatureRequest: { signers: { email: string }[] } | null }>(page, `/api/change-orders/${createdId}/signature-status`);
  expect(sig.signatureRequest?.signers.map((s) => s.email)).toEqual([SIGNER.email]);
});

test("the list says so when change orders cannot be read (server down), with Try again", async ({ page }) => {
  const listUrl = /\/api\/change-orders\?/;
  await page.route(listUrl, (route) => route.request().method() === "GET" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The construction data service did not respond in time." }) }) : route.continue());
  await page.goto(`/change-orders?projectId=${P}`);
  await expectCompleteGuide(page, { id: "net-data-service-slow" });
  await expect(page.getByTestId("guided-error-retry")).toBeVisible();
  await page.unroute(listUrl);
  await page.getByTestId("guided-error-retry").click();
  await expect(page.getByTestId("guided-error")).toHaveCount(0, { timeout: 30_000 });
});
