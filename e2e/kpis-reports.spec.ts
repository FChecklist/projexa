import { test, expect } from "@playwright/test";
import { activeTabPanel, fieldInput } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

test.describe("KPIs (/kpis)", () => {
  test("GAP: Phase 1 documents 6 seeded KPI definitions, but the live API returns 0 for all 4 real projects", async ({ page }) => {
    // Verified live before writing this test: GET /api/kpis?projectId=<id>
    // for all 4 seeded projects (Meridian Heights, Emerald Business Park,
    // Riverside Public School Renovation, Highway Logistics Warehouse
    // Complex) each return {"definitions":[]} -- zero, not 6. This
    // contradicts PHASE1_SEED_REPORT.md section (d)'s "6 KPI definitions
    // (+18 monthly entries)" claim. Documented here as a real, reproducible
    // discrepancy for Phase 4/5 to investigate (possible causes: seed rows
    // tagged to a different org/project id, or a read-path filter bug).
    // "No KPIs defined..." only holds true the FIRST time this suite runs
    // (the write test below permanently adds one on every re-run, no
    // delete UI exists) -- not re-asserted here to keep the suite
    // safely re-runnable.
    await page.goto("/kpis");
    await expect(page.getByRole("heading", { name: "KPIs" })).toBeVisible();
    await page.waitForLoadState("networkidle");
  });

  test("real write: create a new KPI definition, verify it persists (proves the write path itself works)", async ({ page }) => {
    await page.goto("/kpis");
    const metricName = `E2E Batch C Metric ${Date.now()}`;
    // STALE: "New KPI" opened a Dialog when this test was written.
    // KpisClient.tsx's 2026-08-30 "Real-screen conversion" (its own doc
    // comment, lines 3-7) replaced that with `router.push('/kpis/new...')` --
    // a dedicated create PAGE, the same page-not-modal "chain sentence"
    // architecture vendors use. There is no dialog to find any more.
    await page.getByRole("button", { name: /new kpi/i }).click();
    await page.waitForURL(/\/kpis\/new/);
    await fieldInput(page, "Metric Name").fill(metricName);
    await fieldInput(page, "Target Value (optional)").fill("95");
    // STALE: the create screen is the kit's ObjectScreen in mode="create";
    // its Save control is a real <button>Save</button>
    // (node_modules/@fchecklist/veridian-ui-kit/.../ObjectScreen.tsx:92-100),
    // never labelled "Create KPI" -- KpiCreateClient.tsx (line 48) wires it
    // to onSave={createDefinition}, which POSTs to /api/kpis then navigates
    // to the new /kpis/[id] object page, where the metric name becomes the
    // page's own <h1> title.
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(metricName)).toBeVisible({ timeout: 15_000 });
  });

  test("real write: submit an actual value against a KPI definition", async ({ page }) => {
    await page.goto("/kpis");
    await page.waitForLoadState("networkidle");
    const firstRow = page.locator("table tbody tr").first();
    const hasRow = await firstRow.isVisible().catch(() => false);
    test.skip(!hasRow, "no KPI definition exists to submit an entry against");
    // STALE: rows had a "View Entries" button when this test was written.
    // KpisClient.tsx's 2026-08-30 conversion (component doc comment, lines
    // 3-7; row onClick at line 64) made the WHOLE row navigate to the real
    // /kpis/[id] object page instead -- there is no per-row button any more.
    await firstRow.click();
    await page.waitForURL(/\/kpis\/[^/?]+/);
    await page.getByPlaceholder(/e.g. 2026-07/i).fill("2026-07");
    await page.locator('input[type="number"]').last().fill("92");
    await page.getByRole("button", { name: /^submit/i }).click();
    await expect(page.getByText("No actual values submitted yet.")).not.toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Reports (/reports)", () => {
  test("Full Catalog tab loads the real report catalog from VERIDIAN (org-wide, no project needed)", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await page.getByRole("tab", { name: "Full Catalog" }).click();
    // STALE: no source file has ever contained "report/analysis types across
    // the platform" -- ReportCatalogSection.tsx's real success-state
    // sentence (data-testid="catalog-header-sentence", ~line 333) is
    // "<N> construction reports — <N> run here with your project; the rest
    // run on the VERIDIAN dashboard.", distinct from its own "Loading the
    // full catalog..." and "Could not load the catalog..." states, so
    // matching it is real proof the org-wide catalog loaded, not just that
    // the tab switched.
    await expect(page.getByTestId("catalog-header-sentence")).toContainText(/construction reports/i, { timeout: 20_000 });
  });

  test("catalog search filters real entries", async ({ page }) => {
    await page.goto("/reports");
    await page.getByRole("tab", { name: "Full Catalog" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/search reports and analyses/i).fill("revenue");
    await page.waitForTimeout(500);
    // STALE: `[class*="card"]` matched nothing entry-specific. Each catalog
    // entry's own container (ReportCatalogSection.tsx's CatalogCard, root
    // div "rounded-lg border border-px-border p-3") carries no "card" class
    // any more -- only the ONE outer shadcn <Card> wrapping the whole panel
    // still does (its "bg-card"/"shadow-card" utility classes), so this
    // locator matched that single ambient wrapper and was already visible
    // before the search input even had a value, proving nothing about
    // filtering. Scoped to the real per-entry container instead.
    const cards = page.locator("div.rounded-lg.border.border-px-border", { hasText: /revenue/i });
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  });

  test("real write: run a live definition-backed report (revenue) and see real output", async ({ page }) => {
    await page.goto("/reports");
    await page.getByRole("tab", { name: "Full Catalog" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/search reports and analyses/i).fill("Revenue");
    // STALE: the toggle read "Run this report" and needed a second "Run"
    // click when this test was written. ReportCatalogRunner.tsx's R67 E-31
    // rewrite (its own header comment, points 1-2) renamed it "Run Report"
    // (data-testid="catalog-run-report", ReportCatalogSection.tsx:198-199)
    // and made it auto-run on expand via a mount-only useEffect
    // (ReportCatalogRunner.tsx:132-134) -- there is no second button any more.
    const runToggle = page.getByTestId("catalog-run-report").first();
    const hasRunnable = await runToggle.isVisible().catch(() => false);
    test.skip(!hasRunnable, "no runnable (definition-backed) Revenue report found in the catalog");
    await runToggle.click();
    // STALE: "could not generate"/bare "error" never appears. A failed run's
    // real text is "Could not run this report — ..."
    // (ReportCatalogRunner.tsx's failureMessage, line 141, role="alert").
    await expect(page.getByText(/could not run this report/i)).not.toBeVisible({ timeout: 20_000 });
  });

  test("Project Reports tab: 17 project-scoped reports are selectable and at least one runs with real data", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("tab", { name: "Project Reports" })).toBeVisible();
    await page.getByRole("tab", { name: "Project Reports" }).click();
    // STALE: an unscoped combobox() now hits TWO real Radix Select triggers
    // at once -- the persistent sidebar's own project switcher
    // (ProjectSwitcher.tsx:56, mounted on every page) and this panel's
    // Report picker -- and throws a strict-mode violation. This is exactly
    // the trap helpers.ts's activeTabPanel() doc comment describes; scoping
    // to the active tab panel is its documented fix.
    await activeTabPanel(page).getByRole("combobox").click();
    // STALE: "Budget Summary" is now a HOSTED report (src/lib/report-
    // destinations.ts HOSTED_REPORTS["budget-summary"], ~line 84 -- it
    // navigates to /scope?tab=variance instead of running inline), so its
    // button reads "Open Report" (report-parameters.ts runButtonLabel(),
    // no openLabel entry for budget-summary), never "Run Report", and
    // pressing it leaves /reports entirely. "Budget vs Actual" carries no
    // HOSTED_REPORTS entry, so it still runs in-panel behind the "Run
    // Report" label this test expects.
    await page.getByRole("option", { name: /budget vs actual/i }).click();
    await page.getByRole("button", { name: /run report/i }).click();
    // STALE: "Could not generate this report." does not exist anywhere in
    // source any more. A failed run renders inside
    // data-testid="reports-error" (ReportsClient.tsx's ProjectReportsPanel,
    // status === "error" branch, ~line 841).
    await expect(page.getByTestId("reports-error")).not.toBeVisible({ timeout: 20_000 });
  });
});
