import { test, expect } from "@playwright/test";
import { apiGet } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /materials (src/app/(app)/materials/page.tsx -> MaterialsClient.tsx) is a
// read-only org-wide stock ledger (erp_stock_ledger_entries) with no
// filters, search, sort, or write form -- confirmed by reading the
// component source. This file intentionally runs FIRST (numeric prefix)
// among the write-capable modules, because /api/inventory/stock-entries
// (exercised by 05-inventory.spec.ts) posts into what is very likely this
// same underlying stock-ledger table -- see PHASE2_BATCH_B_FINDINGS.md for
// why this suite avoids hardcoding an exact "must stay 0 forever" assertion
// here despite that being the real, empirically-confirmed seed baseline.
test.describe("materials", () => {
  test("renders the real stock ledger and matches the live API", async ({ page }) => {
    const api = await apiGet<{ materials: unknown[] }>(page, "/api/materials");

    await page.goto("/materials");
    await expect(page.getByRole("heading", { level: 1, name: "Materials" })).toBeVisible();

    if (api.materials.length === 0) {
      await expect(page.getByText("No material movements recorded yet.")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(api.materials.length);
    }

    // Real, reportable divergence: PHASE1_SEED_REPORT.md's Batch 3 summary
    // says "20 materials" were seeded, but that landed in erp_items (this
    // org's /api/inventory/items returns 20 -- see 05-inventory.spec.ts),
    // NOT in the stock-ledger entries this page actually reads. At the time
    // this suite was authored, /api/materials returned 0 rows for this org.
    // See PHASE2_BATCH_B_FINDINGS.md, "materials" section, for the full
    // writeup -- logged here (not asserted) since this suite's own writes
    // elsewhere may legitimately change this count on future runs.
    test.info().annotations.push({
      type: "seed-data-note",
      description: `/api/materials returned ${api.materials.length} rows at test time (PHASE1_SEED_REPORT.md implies 20 via Batch 3's "20 materials" line, which actually seeded erp_items, not this stock ledger).`,
    });

    // No search/filter/sort controls exist on this page -- confirm none
    // leaked in from a shared layout (e.g. no stray search input).
    await expect(page.getByPlaceholder(/search|filter/i)).toHaveCount(0);
    // No create/add button -- this is a genuinely read-only page.
    await expect(page.getByRole("button", { name: /^(new|add|create)/i })).toHaveCount(0);
  });
});
