import { test, expect } from "@playwright/test";
import { apiGet, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /inventory (InventoryClient.tsx) has 3 tabs (Stock Balance / Warehouses /
// Items) each backed by its own endpoint, and 3 write dialogs (New
// Warehouse, New Item, Record Stock Movement). No search/sort/pagination on
// any tab -- confirmed by reading the component source.
test.describe("inventory", () => {
  test("Items tab renders the real seeded catalog (PHASE1_SEED_REPORT.md: 20 materials -> landed here, not on /materials)", async ({
    page,
  }) => {
    const items = await apiGet<{ items: unknown[] }>(page, "/api/inventory/items");
    expect(items.items.length).toBeGreaterThanOrEqual(20);

    await page.goto("/inventory");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();
    await page.getByRole("tab", { name: "Items" }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(items.items.length);
  });

  test("Stock Balance and Warehouses tabs match the real (empty) API baseline", async ({ page }) => {
    const balances = await apiGet<{ balances: unknown[] }>(page, "/api/inventory/stock-balance");
    const warehouses = await apiGet<{ warehouses: unknown[] }>(page, "/api/inventory/warehouses");

    await page.goto("/inventory");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();

    // Default tab is "balances".
    if (balances.balances.length === 0) {
      await expect(page.getByText("No stock on hand yet. Record a receipt to get started.")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(balances.balances.length);
    }

    await page.getByRole("tab", { name: "Warehouses" }).click();
    if (warehouses.warehouses.length === 0) {
      await expect(page.getByText("No warehouses yet.")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr")).toHaveCount(warehouses.warehouses.length);
    }

    test.info().annotations.push({
      type: "seed-data-note",
      description: `warehouses=${warehouses.warehouses.length}, stock-balances=${balances.balances.length} at test time. No warehouses or stock balances were seeded for this org -- only the item catalog (20 items) exists. See PHASE2_BATCH_B_FINDINGS.md.`,
    });
  });

  test("creating a warehouse, an item, and recording a stock receipt all persist and the balance updates (real write chain)", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const warehouseName = `E2E Test Warehouse ${suffix}`;
    const itemCode = `E2E-${suffix}`.toUpperCase();
    const itemName = `E2E Test Item ${suffix}`;

    await page.goto("/inventory");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();

    // 1. Create warehouse.
    await page.getByRole("button", { name: "New Warehouse" }).click();
    await fieldInput(page, "Warehouse Name").fill(warehouseName);
    const [whRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/inventory/warehouses") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Add Warehouse" }).click(),
    ]);
    expect(whRes.status()).toBe(201);
    await expect(page.getByText("Warehouse added")).toBeVisible();

    // 2. Create item.
    await page.getByRole("button", { name: "New Item" }).click();
    await fieldInput(page, "Item Code").fill(itemCode);
    await fieldInput(page, "Item Name").fill(itemName);
    await fieldInput(page, "Unit of Measure (optional)").fill("Nos");
    const [itemRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/inventory/items") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Add Item" }).click(),
    ]);
    expect(itemRes.status()).toBe(201);
    await expect(page.getByText("Item added")).toBeVisible();

    // 3. Record a stock receipt against the new item + warehouse.
    await page.getByRole("button", { name: "Record Stock Movement" }).click();
    await expect(page.getByRole("dialog", { name: "Record Stock Movement" })).toBeVisible();
    await fieldInput(page, "Item").click();
    await page.getByRole("option", { name: `${itemName} (${itemCode})` }).click();
    await fieldInput(page, "Warehouse").click();
    await page.getByRole("option", { name: warehouseName }).click();
    await fieldInput(page, "Quantity").fill("50");
    await fieldInput(page, "Rate (optional)").fill("120");
    const [entryRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/inventory/stock-entries") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Record Movement" }).click(),
    ]);
    expect(entryRes.status(), await entryRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("Stock receipt recorded")).toBeVisible();

    // Persistence check: reload and confirm all 3 writes really landed.
    await page.reload();
    const warehouses = await apiGet<{ warehouses: { warehouseName: string }[] }>(page, "/api/inventory/warehouses");
    expect(warehouses.warehouses.some((w) => w.warehouseName === warehouseName)).toBeTruthy();

    const items = await apiGet<{ items: { itemCode: string; itemName: string }[] }>(page, "/api/inventory/items");
    expect(items.items.some((i) => i.itemCode === itemCode && i.itemName === itemName)).toBeTruthy();

    const balances = await apiGet<{ balances: { itemCode: string | null; warehouseName: string | null; qty: number }[] }>(
      page,
      "/api/inventory/stock-balance"
    );
    const createdBalance = balances.balances.find((b) => b.itemCode === itemCode && b.warehouseName === warehouseName);
    expect(createdBalance, "the receipt should have created a stock balance row").toBeTruthy();
    expect(createdBalance?.qty).toBe(50);

    await page.getByRole("tab", { name: "Stock Balance" }).click();
    await expect(page.getByRole("row", { name: new RegExp(itemName) })).toBeVisible();
  });
});
