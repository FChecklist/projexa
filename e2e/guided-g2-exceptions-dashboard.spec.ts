import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";
import { expectCompleteGuide } from "./support/guided-g2";

// GUIDED ERRORS, GROUP G2 -- EXCEPTIONS page and the project DASHBOARD (earned value). Read-only: failures are produced by answering the screen's own
// read with the failure a real outage gives, then the screen is shown to explain it and to recover (Try again) without a reload. Meridian CEO.
// Run: PLAYWRIGHT_BASE_URL=https://projexa-ai.com bunx playwright test e2e/guided-g2-exceptions-dashboard.spec.ts
test.use({ storageState: "playwright/.auth/ceo.json" });

const P = DEFAULT_PROJECT.id;
const down = (error = "The construction data service did not respond in time.") => ({ status: 503, contentType: "application/json", body: JSON.stringify({ error }) });

test("Exceptions: the report cannot be read -> the guide explains it, Try again recovers the report with no reload", async ({ page }) => {
  const url = /\/api\/exceptions\?/;
  let fail = true;
  await page.route(url, (route) => (fail ? route.fulfill(down()) : route.continue()));
  await page.goto(`/analysis/exceptions?projectId=${P}`);
  await expectCompleteGuide(page, { id: "net-data-service-slow" });
  await expect(page.getByTestId("guided-error-what")).toContainText("did not respond in time");
  fail = false;
  await page.getByTestId("guided-error-retry").click();
  await expect(page.getByTestId("guided-error")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/checks are (clear|flagged)|No exceptions found/).first()).toBeVisible();
});

test("Exceptions: signed out (401) -> the guide says so and Sign in again returns to this report", async ({ page }) => {
  const url = /\/api\/exceptions\?/;
  await page.route(url, (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Unauthorized" }) }));
  await page.goto(`/analysis/exceptions?projectId=${P}`);
  await expectCompleteGuide(page, { id: "auth-expired", fixLabel: /Sign in again/ });
  await expect(page.getByTestId("guided-error-fix")).toHaveAttribute("href", /\/login\?redirectTo=%2Fanalysis%2Fexceptions/);
});

test("Dashboard: the project dashboard cannot be read -> the guide explains it, Try again recovers", async ({ page }) => {
  const url = /\/api\/dashboard\/project/;
  let fail = true;
  await page.route(url, (route) => (fail ? route.fulfill(down()) : route.continue()));
  await page.goto(`/dashboard/project?projectId=${P}`);
  await expectCompleteGuide(page, { id: "net-data-service-slow" });
  await expect(page.getByTestId("guided-error-what")).toContainText("Couldn't load this project's dashboard");
  fail = false;
  await page.getByTestId("guided-error-retry").click();
  await expect(page.getByTestId("guided-error")).toHaveCount(0, { timeout: 60_000 });
});

test("Dashboard: no connection at all (offline) -> says nothing was reached and Try again works once back online", async ({ page, context }) => {
  await page.goto(`/dashboard/project?projectId=${P}`);
  await expect(page.getByText(/% complete by BOQ value|Contract value/i).first()).toBeVisible({ timeout: 60_000 });
  const url = /\/api\/dashboard\/project/;
  await page.route(url, (route) => route.abort("internetdisconnected"));
  await page.reload();
  await expectCompleteGuide(page, {});
  await context.setOffline(false);
  await page.unroute(url);
  await page.getByTestId("guided-error-retry").click();
  await expect(page.getByTestId("guided-error")).toHaveCount(0, { timeout: 60_000 });
});
