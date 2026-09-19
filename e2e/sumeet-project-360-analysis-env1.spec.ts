import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// Sumeet requirements #7 ("for a project the change of BOQ, change of
// scope, billing, milestones, timelines analysis -- one combined view")
// and #8 ("profit and loss analysis for the project"), R-99/R-100 in the
// register. GAP FOUND (2026-09-19, Playwright gap-closure Round 3): no
// Playwright coverage existed for this screen at all -- CLOSED via ad-hoc
// verification only. This screen fans out 5 real API calls
// (boq-analysis, change-orders, milestones, schedule/gantt,
// billing-claims) inside ONE try/catch, so any single failing call hides
// ALL five behind one generic "Couldn't load the Project 360 analysis"
// banner -- a real risk worth a real, committed test.
test.use({ storageState: "playwright/.auth/ceo.json" });

const PROJECT_ID = DEFAULT_PROJECT.id;

test("Sumeet #7/#8: Project 360 combines P&L, change of BOQ, scope changes, milestones, timeline and billing in one real view", async ({ page }) => {
  // Destructured (not indexed) so each variable keeps its own, non-nullable
  // `Response` type -- page.goto()'s own return type is `Response | null`,
  // and indexing the Promise.all tuple with a plain number widens every
  // element to the union of all six, including that null.
  const [boqAnalysisRes, changeOrdersRes, milestonesRes, ganttRes, billingClaimsRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/reports/boq-analysis") && r.request().method() === "GET"),
    page.waitForResponse((r) => r.url().includes("/api/change-orders") && r.request().method() === "GET"),
    page.waitForResponse((r) => r.url().includes("/api/milestones") && r.request().method() === "GET"),
    page.waitForResponse((r) => r.url().includes("/api/schedule/gantt") && r.request().method() === "GET"),
    page.waitForResponse((r) => r.url().includes("/api/billing-claims") && r.request().method() === "GET"),
    page.goto(`/analysis/project-360?projectId=${PROJECT_ID}`, { waitUntil: "networkidle" }),
  ]);
  const responses = [boqAnalysisRes, changeOrdersRes, milestonesRes, ganttRes, billingClaimsRes];
  for (const [i, label] of ["boq-analysis", "change-orders", "milestones", "schedule/gantt", "billing-claims"].entries()) {
    expect(responses[i].ok(), `the real ${label} API this screen depends on must succeed, not be silently swallowed behind the generic error banner`).toBe(true);
  }

  // Must NOT show the generic swallow-everything error banner -- if any one
  // of the 5 calls above is ok() but this still renders, the client-side
  // Promise.all/try-catch itself has a bug distinct from any one API's own
  // correctness.
  await expect(page.getByText("Couldn't load the Project 360 analysis"), "the combined view must not fall back to its generic error banner when every dependency call succeeded").toHaveCount(0);

  // Real, specific assertions on each of the 5 cards -- not just "a page
  // rendered". The P&L card either reads "Not yet baselined" (a real,
  // named state, not blank) or a real currency figure.
  await expect(page.getByText("Profit & Loss — the answer")).toBeVisible();
  const plCard = page.locator("text=Profit & Loss — the answer").locator("xpath=ancestor::*[contains(@class,'shadow-card')][1]");
  await expect(
    plCard.getByText(/Not yet baselined|AED|₹|\$/).first(),
    "the P&L card must render a real currency figure or the named 'Not yet baselined' state, not stay blank"
  ).toBeVisible();

  // exact: true throughout -- the screen's own intro paragraph ("...combined
  // with scope changes, billing milestones and schedule slippage") contains
  // several of these same words in lowercase prose, which a non-exact,
  // case-insensitive getByText also matches, causing a real strict-mode
  // ambiguity against the card titles this test actually means to check.
  await expect(page.getByText("Change of BOQ", { exact: true })).toBeVisible();
  await expect(page.getByText("Scope changes", { exact: true })).toBeVisible();
  await expect(page.getByText("Milestones", { exact: true })).toBeVisible();
  await expect(page.getByText("Timeline", { exact: true })).toBeVisible();
  await expect(page.getByText("Billing milestones", { exact: true })).toBeVisible();

  // Cross-check the "Scope changes" card's own count against the real API
  // response this same page load already fetched -- a real, specific
  // number, not just "some card rendered".
  const changeOrdersBody = await changeOrdersRes.json();
  const expectedCount = (changeOrdersBody.changeOrders ?? []).length;
  const scopeChangesCard = page.locator("text=Scope changes").locator("xpath=ancestor::*[contains(@class,'shadow-card')][1]");
  await expect(scopeChangesCard.getByText(String(expectedCount), { exact: true }), `the Scope changes card must show the real count (${expectedCount}) from the API it just fetched`).toBeVisible();
});

test("Sumeet #7/#8: Project 360 Analysis is reachable from the Analysis screen list", async ({ page }) => {
  await page.goto(`/analysis?projectId=${PROJECT_ID}`, { waitUntil: "networkidle" });
  const link = page.getByRole("link", { name: /project 360 analysis/i });
  await expect(link, "the Analysis screen's own list must surface the Project 360 entry").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/analysis\/project-360/);
});
