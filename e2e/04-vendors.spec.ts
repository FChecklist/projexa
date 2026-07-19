import { test, expect } from "@playwright/test";
import { apiGet, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /vendors (VendorsClient.tsx) is read + create only (no edit/delete UI),
// no filters/search/sort. The GST column/field is conditional on the org's
// country being India (useOrgRole()'s isIndiaOrg) -- confirmed live via
// /api/organization that this seeded org's country is "IN", so the GST
// column and field are expected to render.
test.describe("vendors", () => {
  test("renders the real seeded vendor list (PHASE1_SEED_REPORT.md: 10 vendors)", async ({ page }) => {
    const api = await apiGet<{ vendors: unknown[] }>(page, "/api/vendors");
    expect(api.vendors.length).toBeGreaterThanOrEqual(10);

    await page.goto("/vendors");
    await expect(page.getByRole("heading", { level: 1, name: "Vendors" })).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(api.vendors.length);

    // India-org GST column: a second, independent async fetch
    // (useOrgRole -> /api/organization) gates this -- wait for it rather
    // than asserting immediately on mount.
    await expect(page.getByRole("columnheader", { name: "GST" })).toBeVisible();
  });

  test("creating a vendor persists and is reflected after reload (real write)", async ({ page }) => {
    const before = await apiGet<{ vendors: { vendorName: string }[] }>(page, "/api/vendors");
    const vendorName = `E2E Test Vendor ${uniqueSuffix()}`;

    await page.goto("/vendors");
    await expect(page.getByRole("heading", { level: 1, name: "Vendors" })).toBeVisible();

    await page.getByRole("button", { name: "New Vendor" }).click();
    await expect(page.getByRole("dialog", { name: "New Vendor" })).toBeVisible();
    await fieldInput(page, "Vendor Name").fill(vendorName);
    await fieldInput(page, "Type (optional)").fill("Subcontractor");
    await fieldInput(page, "Trade (optional)").fill("Electrical");
    await fieldInput(page, "GST (optional)").fill("29ABCDE1234F1Z5");
    await fieldInput(page, "Credit Limit (optional)").fill("500000");

    const [createResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/vendors") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Add Vendor" }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Vendor added")).toBeVisible();

    // Persistence check: reload fresh (new navigation, not just in-memory
    // state) and confirm the vendor is really there via both the API and
    // the rendered table.
    await page.reload();
    const after = await apiGet<{ vendors: { vendorName: string; vendorType: string | null; trade: string | null }[] }>(
      page,
      "/api/vendors"
    );
    expect(after.vendors.length).toBe(before.vendors.length + 1);
    const created = after.vendors.find((v) => v.vendorName === vendorName);
    expect(created).toBeTruthy();
    expect(created?.vendorType).toBe("Subcontractor");
    expect(created?.trade).toBe("Electrical");

    await expect(page.getByRole("row", { name: new RegExp(vendorName) })).toBeVisible();
  });
});
