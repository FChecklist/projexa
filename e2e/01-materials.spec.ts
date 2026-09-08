import { test, expect } from "@playwright/test";
import { apiGet, DEFAULT_PROJECT } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// STALE AS OF THE "Point 33" real-screen conversion (MaterialsClient.tsx:1-41,
// materials/page.tsx:136-137): /materials was rebuilt from a read-only,
// org-wide erp_stock_ledger_entries listing into a real, project-scoped
// Material Master + Inbound Receipts + Issues + Cost Report screen with
// working create routes (/materials/new, /materials/receipts/new,
// /materials/issues/new). The erp_stock_ledger_entries/erp_items divergence
// this file used to document no longer applies -- that table isn't read here
// at all any more, so the old PHASE1/PHASE2 seed-report citations are moot.
//
// Two concrete backend changes this rewrite reflects:
//   - The page now REQUIRES a project (materials/page.tsx:71-80, `resolveProjectForModule`
//     with `allProjectsWhenUnset: true`): a bare /materials with no ?projectId=
//     no longer resolves to any org default, it renders a "choose a project"
//     card. A ?projectId= in the URL is a fast, deterministic resolution path
//     (module-list-source.ts's `resolveProjectIdFastWithSource`, source "url").
//   - "/api/materials" itself changed meaning: it now requires ?projectId=
//     (400 without one, src/app/api/materials/route.ts:16-17) and returns
//     Inbound Receipts (`{ receipts }`, proxying VERIDIAN's
//     /construction/materials/receipts). The Material Master grid this test
//     actually renders on load reads /api/materials/master?projectId=
//     instead (src/app/api/materials/master/route.ts:12-23, `{ materials }`),
//     which is also the exact request MaterialsClient.tsx's `loadMaterials()`
//     (line ~389) fires on mount.
test.describe("materials", () => {
  test("renders the real material master and matches the live API", async ({ page }) => {
    const api = await apiGet<{ materials: unknown[] }>(
      page,
      `/api/materials/master?projectId=${DEFAULT_PROJECT.id}`
    );

    await page.goto(`/materials?projectId=${DEFAULT_PROJECT.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Materials" })).toBeVisible();

    if (api.materials.length === 0) {
      // Real empty-state copy (MaterialsClient.tsx:738), not the old
      // "No material movements recorded yet." string.
      await expect(page.getByText(/No materials in the master yet/)).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(api.materials.length);
    }

    // This module is read+write, not read-only: MaterialsClient.tsx:655-676
    // wires a real Filter toggle and a "+ New Material" header action
    // (testid "materials-new") that routes to /materials/new
    // (materials/new/page.tsx) -- the old dialog-based Add Material flow is
    // gone (MaterialsClient.tsx:20-22), replaced by a real create route, not
    // removed outright. Assert the controls exist instead of asserting their
    // absence.
    await expect(page.getByTestId("materials-new")).toBeVisible();
    await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();
  });
});
