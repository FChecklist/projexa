import { test, expect } from "@playwright/test";
import { apiGet } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /permits (PermitsClient.tsx) is read-only, org-wide (no ?projectId),
// backed by VERIDIAN's generic `documents` table filtered to
// category='permit' -- there is no dedicated permits table (see
// PHASE1_SEED_REPORT.md's "notable non-gap nuances"). Its only real control
// is the "expiring within" window Select (30/60/90/365 days), which
// re-fetches on change.
//
// The org sidebar's own ProjectSwitcher (a second, unrelated combobox) also
// renders on this page once its own async /api/projects fetch resolves (this
// org has 4 projects, so it's not suppressed) -- getByRole("combobox") alone
// is ambiguous once that lands. Scoped here via the descriptive <p> that is
// this Select's actual DOM sibling in PermitsClient.tsx's JSX, the same
// pattern as helpers.ts's fieldInput().
function windowSelect(page: import("@playwright/test").Page) {
  return page.locator("p", { hasText: "Permits expiring within the selected window" }).locator("xpath=following-sibling::*[1]");
}

test.describe("permits", () => {
  test("renders the real permit-expiry list for the default 90-day window", async ({ page }) => {
    const api = await apiGet<{ permits: unknown[] }>(page, "/api/permits?withinDays=90");

    await page.goto("/permits");
    await expect(page.getByRole("heading", { level: 1, name: "Permits" })).toBeVisible();
    // Default window is "90" -- SelectValue renders the matching label.
    await expect(windowSelect(page)).toContainText("Next 90 days");

    if (api.permits.length === 0) {
      await expect(page.getByText("No permits expiring in this window.")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(api.permits.length);
    }

    test.info().annotations.push({
      type: "seed-data-note",
      description: `/api/permits?withinDays=90 returned ${api.permits.length} rows. Verified during authoring across all 4 windows (30/60/90/365 days) that this org has zero documents tagged category='permit' among its 25 seeded documents (categories actually present: other, drawing, contract, site_photo) -- a real seed-completeness gap for this module, not a rendering bug. See PHASE2_BATCH_B_FINDINGS.md.`,
    });
  });

  test("the 'expiring within' window select re-fetches real data for every option", async ({ page }) => {
    await page.goto("/permits");
    await expect(page.getByRole("heading", { level: 1, name: "Permits" })).toBeVisible();

    for (const [value, label] of [
      ["30", "Next 30 days"],
      ["60", "Next 60 days"],
      ["365", "Next 12 months"],
      ["90", "Next 90 days"],
    ] as const) {
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes(`/api/permits?withinDays=${value}`)),
        windowSelect(page).click().then(() => page.getByRole("option", { name: label }).click()),
      ]);
      expect(response.ok()).toBeTruthy();
      const body = (await response.json()) as { permits: unknown[] };
      await expect(windowSelect(page)).toContainText(label);
      if (body.permits.length === 0) {
        await expect(page.getByText("No permits expiring in this window.")).toBeVisible();
      } else {
        await expect(page.locator("table tbody tr")).toHaveCount(body.permits.length);
      }
    }
  });

  test("has no write controls (read-only by design)", async ({ page }) => {
    await page.goto("/permits");
    await expect(page.getByRole("heading", { level: 1, name: "Permits" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(new|add|create)/i })).toHaveCount(0);
  });
});
