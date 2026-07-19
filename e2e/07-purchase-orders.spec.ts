import { test, expect } from "@playwright/test";
import { apiGet, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /purchase-orders (PurchaseOrdersClient.tsx) is a DIFFERENT, independent
// module from procurement's own "Purchase Orders" tab (different
// component, richer multi-line/multi-currency create form) even though
// both read/write the same erp_purchase_orders table -- confirmed in
// 06-procurement.spec.ts. Because that file's "convert to PO" write also
// lands here, this file deliberately never asserts an exact baseline count
// (it would be order-dependent); it asserts a real minimum and a real
// before/after delta for its own write instead.
test.describe("purchase-orders", () => {
  test("renders the real seeded purchase orders (PHASE1_SEED_REPORT.md: 12 purchase orders)", async ({ page }) => {
    const api = await apiGet<{ purchaseOrders: unknown[] }>(page, "/api/purchase-orders");
    expect(api.purchaseOrders.length).toBeGreaterThanOrEqual(12);

    await page.goto("/purchase-orders");
    await expect(page.getByRole("heading", { level: 1, name: "Purchase Orders" })).toBeVisible();
    await expect(page.locator("table tbody tr")).toHaveCount(api.purchaseOrders.length);
  });

  test("the Company/Office selector and Currency selector visibility exactly matches the real live /api/companies and /api/currencies state", async ({
    page,
  }) => {
    // `companies` and `currencies` are ORG-WIDE entities, not scoped to this
    // module -- at authoring time this org had 0 of each, but this org is
    // shared with 2 concurrently-running sibling E2E batches (see this
    // suite's claim entry in compliance-tracker's ACTIVE-CLAIMS.yaml) whose
    // own scope (e.g. Batch C's accounting/companies coverage) can and does
    // add real company rows here -- confirmed live mid-authoring: a company
    // literally named "E2E Batch C Test Office ..." appeared between runs.
    // So this test observes the real current value and asserts the UI
    // matches it exactly, rather than assuming a permanently-empty baseline.
    const [companies, currencies] = await Promise.all([
      apiGet<{ companies: unknown[] }>(page, "/api/companies"),
      apiGet<{ currencies: unknown[] }>(page, "/api/currencies"),
    ]);

    await page.goto("/purchase-orders");
    await expect(page.getByRole("heading", { level: 1, name: "Purchase Orders" })).toBeVisible();
    // CompanySelector renders null with 0 companies.
    await expect(page.getByText("Company / Office")).toHaveCount(companies.companies.length > 0 ? 1 : 0);

    await page.getByRole("button", { name: "New Purchase Order" }).click();
    await expect(page.getByRole("dialog", { name: "New Purchase Order" })).toBeVisible();
    await expect(page.getByText("Company / Office (optional)")).toHaveCount(companies.companies.length > 0 ? 1 : 0);
    await expect(page.getByText("Currency (optional)")).toHaveCount(currencies.currencies.length > 0 ? 1 : 0);
  });

  test("creating a purchase order with multiple line items persists and is reflected after reload (real write)", async ({
    page,
  }) => {
    const before = await apiGet<{ purchaseOrders: unknown[] }>(page, "/api/purchase-orders");
    const vendorsApi = await apiGet<{ vendors: { vendorName: string }[] }>(page, "/api/vendors");
    const vendor = vendorsApi.vendors[0];
    const suffix = uniqueSuffix();
    const line1 = `E2E Line Item A ${suffix}`;
    const line2 = `E2E Line Item B ${suffix}`;

    await page.goto("/purchase-orders");
    await expect(page.getByRole("heading", { level: 1, name: "Purchase Orders" })).toBeVisible();

    await page.getByRole("button", { name: "New Purchase Order" }).click();
    await fieldInput(page, "Vendor").click();
    await page.getByRole("option", { name: vendor.vendorName }).click();

    await page.getByPlaceholder("Description").fill(line1);
    await page.getByPlaceholder("Qty").fill("5");
    await page.getByPlaceholder("Rate").fill("100");
    await page.getByRole("button", { name: "Add Line" }).click();
    await page.getByPlaceholder("Description").nth(1).fill(line2);
    await page.getByPlaceholder("Qty").nth(1).fill("2");
    await page.getByPlaceholder("Rate").nth(1).fill("300");

    const [createRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/purchase-orders") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Create Purchase Order" }).click(),
    ]);
    expect(createRes.status(), await createRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("Purchase order created")).toBeVisible();

    await page.reload();
    const after = await apiGet<{
      purchaseOrders: { vendorId: string; items: { description: string; quantity: string; rate: string }[] }[];
    }>(page, "/api/purchase-orders");
    expect(after.purchaseOrders.length).toBe(before.purchaseOrders.length + 1);

    const created = after.purchaseOrders.find((po) => po.items.some((i) => i.description === line1));
    expect(created, "the newly created PO should be findable by its unique line-item description").toBeTruthy();
    expect(created?.items.some((i) => i.description === line2)).toBeTruthy();

    await expect(page.locator("table tbody tr")).toHaveCount(after.purchaseOrders.length);
  });
});
