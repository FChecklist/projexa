import { test, expect } from "@playwright/test";
import { apiGet, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /vendors (VendorsClient.tsx) is read + create only (no edit/delete UI),
// no filters/search/sort. The GST column/field is conditional on the org's
// country being India (useOrgRole()'s isIndiaOrg) -- confirmed live via
// /api/organization that this seeded org's country is "IN", so the GST
// column and field are expected to render.
//
// STALE-TEST FIX (2026-09-08): the "New Vendor" flow used to be a modal
// Dialog; VendorsClient.tsx:1-7's own header comment says that popup "is
// gone" as of a 2026-08-30 real-screen conversion -- "New Vendor" now does
// router.push("/vendors/new") (VendorsClient.tsx:59) to a dedicated create
// route (VendorCreateClient.tsx), matching this app's chain-sentence
// Project > Module > New <thing> navigation used throughout. The create
// screen is a shared-kit ObjectScreen, whose only footer control in create
// mode is a plain "Save" button (node_modules/@fchecklist/veridian-ui-kit/
// src/screens/ObjectScreen.tsx:92-100) -- there is no "Add Vendor" button
// and no `role=dialog` anywhere in this flow. On success
// VendorCreateClient.tsx:40 redirects to the new vendor's own Object Page
// (`/vendors/${vendor.id}`, VendorObjectClient.tsx) rather than closing a
// dialog back onto the list.
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

    // Stale: this used to open a Dialog. It now navigates to a dedicated
    // route -- see the describe-level comment above (VendorsClient.tsx:59).
    await page.getByRole("button", { name: "New Vendor" }).click();
    await expect(page).toHaveURL(/\/vendors\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "New Vendor" })).toBeVisible();
    await fieldInput(page, "Vendor Name").fill(vendorName);
    await fieldInput(page, "Type (optional)").fill("Subcontractor");
    await fieldInput(page, "Trade (optional)").fill("Electrical");
    await fieldInput(page, "GST (optional)").fill("29ABCDE1234F1Z5");
    await fieldInput(page, "Credit Limit (optional)").fill("500000");

    // Stale: no "Add Vendor" button exists -- ObjectScreen's create-mode
    // footer control is always plain "Save" (ObjectScreen.tsx:92-100).
    const [createResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/vendors") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    await expect(page.getByText("Vendor added")).toBeVisible();

    // Stale: nothing to close (no dialog). Instead, confirm the redirect
    // VendorCreateClient.tsx:40 makes on success -- to the new vendor's own
    // Object Page, whose title is the vendor's real name fetched back from
    // the server (VendorObjectClient.tsx:225), not just the value we typed.
    await expect(page).toHaveURL(/\/vendors\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1, name: vendorName })).toBeVisible();

    // Persistence check: a fresh full navigation (not just in-memory state,
    // and not the SPA transition we already followed above) back to the
    // list, then confirm the vendor is really there via both the API and
    // the rendered table.
    await page.goto("/vendors");
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
