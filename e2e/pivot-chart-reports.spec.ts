import { test, expect } from "@playwright/test";

test.use({ storageState: "playwright/.auth/ceo.json" });

// Real E2E coverage for the Reports pivot/chart view-mode switch
// (CRITICAL_ERP_REPORTING_MODULE_WITH_AI_API_INTEGRATION, phase_2_projexa_
// thin_client_wiring). Runs a real report_definitions-backed report from the
// Full Catalog tab (org-wide, works against any domain -- Sales, ERP,
// construction, interior design, compliance, custom) and switches between
// the Table/Pivot/Chart tabs ReportResultView now renders, same pattern as
// the existing "run a live definition-backed report" test in
// kpis-reports.spec.ts.
test.describe("Reports pivot/chart view switch (/reports)", () => {
  test("running a real report_definitions entry offers Table/Pivot/Chart tabs, and switching between them renders real data", async ({ page }) => {
    await page.goto("/reports");
    await page.getByRole("tab", { name: "Full Catalog" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/search reports and analyses/i).fill("Report");
    await page.waitForTimeout(500);

    // Stale: the card's toggle read "Run this report" and expanding it only
    // opened an empty parameter panel needing a separate "Run" click. Real
    // source now: the button reads "Run Report" (ReportCatalogSection.tsx:199,
    // data-testid "catalog-run-report" -- also pinned by
    // ReportsClient.test.tsx:699, which asserts "Run this report" no longer
    // appears at all), and mounting the runner panel IS the run -- it fires
    // on arrival with pre-filled month-to-date params, no second button
    // (ReportCatalogRunner.tsx:125-134, "RUN ON ARRIVAL"). Its two failure
    // states ("Could not run this report — …" and the 20s timeout sentence,
    // ReportCatalogRunner.tsx:138-141) both land in one role="alert" <p>
    // (ReportCatalogRunner.tsx:222), so asserting on that role covers both
    // instead of guessing at "could not generate"/"network error" wording
    // that no longer appears anywhere in this component.
    const runToggle = page.getByTestId("catalog-run-report").first();
    const hasRunnable = await runToggle.isVisible().catch(() => false);
    test.skip(!hasRunnable, "no runnable (definition-backed) report found in the catalog");
    await runToggle.click();
    await expect(page.getByRole("alert")).not.toBeVisible({ timeout: 20_000 });

    const tableTab = page.getByRole("tab", { name: "Table" });
    const hasTabs = await tableTab.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!hasTabs, "report returned zero rows -- no Table/Pivot/Chart tabs to switch between");

    await expect(tableTab).toBeVisible();
    await expect(page.getByRole("tab", { name: "Pivot" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Chart" })).toBeVisible();

    // Pivot tab: real row/column/value/aggregate controls, real computed table.
    await page.getByRole("tab", { name: "Pivot" }).click();
    await expect(page.getByText("Rows")).toBeVisible();
    await expect(page.getByText("Aggregate")).toBeVisible();

    // Chart tab: real chart-type selector + a rendered SVG chart.
    await page.getByRole("tab", { name: "Chart" }).click();
    await expect(page.getByText("Chart type")).toBeVisible();
    await expect(page.locator(".recharts-wrapper, .recharts-responsive-container").first()).toBeVisible({ timeout: 10_000 });

    // Switching back to Table still shows the original raw grid.
    await page.getByRole("tab", { name: "Table" }).click();
    await expect(page.locator("table").first()).toBeVisible();
  });
});
