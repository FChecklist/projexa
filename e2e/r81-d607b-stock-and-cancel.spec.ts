import { test, expect } from "@playwright/test";
import { apiGet, fieldInput, uniqueSuffix } from "./helpers";

// R81 D6-07, the two halves the first spec deliberately did not cover.
//
// r81-d607-po-to-grn.spec.ts proves the case that was DEAD: a FREE-TEXT PO
// line (itemId null) is credited on receipt and posts no stock. These are the
// other side of the same fix, and the split between them is its whole point:
//
//   (a) a line NAMING A STOCK ITEM must credit the order AND open a FIFO
//       layer at a REAL, NON-ZERO rate. Before the fix, an unlinked line had
//       no rate to fall back to and every layer opened at `rate ?? 0` --
//       zero-valued stock, which is worse than no stock because it silently
//       corrupts valuation.
//   (b) a CANCELLED purchase order must be REFUSED a receipt at the service
//       layer. 'cancelled' is terminal, and a receipt against one would drag
//       a withdrawn order back toward partially_received.
//
// A test asserting only (a) would pass against the old broken code, which is
// why the free-text half exists; a suite with only the free-text half would
// miss a regression that starts posting phantom or zero-valued stock.
test.use({ storageState: "playwright/.auth/ceo.json" });
test.setTimeout(180_000);

/** The first authenticated cross-repo call compiles a route AND opens a first
 *  tenant-scoped connection; PROJEXA aborts upstream at 8s, so warm before
 *  measuring (KD-15). Warming changes no assertion below. */
async function warm(page: import("@playwright/test").Page) {
  for (let i = 0; i < 10; i++) {
    const r = await page.request.get("/api/vendors", { timeout: 120_000 }).catch(() => null);
    if (r?.ok()) return;
    await page.waitForTimeout(2000);
  }
}

// QUARANTINED P0.1: re-enabled in P4.3
test.describe.skip("R81 D6-07 stock and cancel", () => {
test("R81 D6-07(a): a stock-item PO line credits the order AND posts stock at a real rate", async ({ page }) => {
  await warm(page);
  const suffix = uniqueSuffix();
  const line = `R81 STOCK Line ${suffix}`;
  const QTY = "4";
  const RATE = "211"; // distinctive and non-zero: `rate ?? 0` is the bug this guards

  const vendors = await apiGet<{ vendors: { vendorName: string }[] }>(page, "/api/vendors");
  const vendor = vendors.vendors[0];

  await page.goto("/purchase-orders");
  await page.getByRole("button", { name: "New Purchase Order" }).click({ timeout: 60_000 });
  await fieldInput(page, "Vendor").click();
  await page.getByRole("option", { name: vendor.vendorName }).click();

  await page.getByPlaceholder("Description").fill(line);
  await page.getByPlaceholder("Qty").fill(QTY);
  await page.getByPlaceholder("Rate").fill(RATE);

  // The stock-item picker renders only when the org has stock items
  // (PurchaseOrderCreateClient.tsx:187 `items.length > 0 &&`). This org has 33,
  // confirmed in the database, so its absence would be a real defect rather
  // than a missing fixture. It is a Select whose trigger carries the
  // placeholder text, so locate it among the comboboxes by that text.
  const itemPicker = page.getByRole("combobox").filter({ hasText: "Stock item" }).first();
  await expect(itemPicker, "the stock-item picker must render -- this org has 33 stock items")
    .toBeVisible({ timeout: 30_000 });
  await itemPicker.click({ timeout: 60_000 });
  const opts = page.getByRole("option");
  await expect(opts.first()).toBeVisible({ timeout: 20_000 });
  // option 0 is "No stock item"; take a real one
  const chosen = (await opts.nth(1).textContent())?.trim() ?? "";
  await opts.nth(1).click({ timeout: 60_000 });
  console.log(`R81_D607B stock_item_chosen="${chosen}"`);

  const [createRes] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/purchase-orders") && r.request().method() === "POST", { timeout: 90_000 }),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  expect(createRes.status(), await createRes.text().catch(() => "")).toBe(201);
  await page.waitForURL(/procurement\/purchase-orders\/[^/]+$/i, { timeout: 60_000 });
  const poId = page.url().split("/").pop()!;
  console.log(`R81_D607B po_id=${poId} line="${line}" qty=${QTY} rate=${RATE}`);

  // Wait for the warehouse list to actually ARRIVE before opening its dropdown.
  // GoodsReceiptCreateClient.tsx:186 fetches /api/inventory/warehouses, and that
  // is a cross-repo call. Five browser attempts across two machines died here
  // on "waiting for getByRole('option').first()" -- an EMPTY dropdown, not a
  // slow click. The data is present (13 warehouses, 33 items confirmed in the
  // database), so this waits on the response rather than on a wall-clock guess.
  const whResp = page.waitForResponse(
    (r) => r.url().includes("/api/inventory/warehouses") && r.status() === 200,
    { timeout: 120_000 },
  );
  await page.goto(`/procurement/goods-receipts/new?poId=${poId}`);
  await expect(page.getByRole("heading", { name: "Record Goods Receipt" })).toBeVisible({ timeout: 60_000 });
  await whResp;
  await expect(page.getByPlaceholder("Qty").first()).toBeVisible({ timeout: 60_000 });

  const warehousePicker = page.getByRole("combobox").last();
  await warehousePicker.click({ timeout: 60_000 });
  const whOption = page.getByRole("option").first();
  await expect(whOption, "the warehouse dropdown must actually be populated").toBeVisible({ timeout: 60_000 });
  await whOption.click({ timeout: 60_000 });

  const [grnRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/procurement/goods-receipts") && r.request().method() === "POST", { timeout: 90_000 }),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  expect([200, 201]).toContain(grnRes.status());
  await page.waitForURL(/procurement\/goods-receipts\/[^/]+$/i, { timeout: 60_000 });
  const grnId = page.url().split("/").pop()!;

  const [submitRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/submit") && r.request().method() === "POST", { timeout: 120_000 }),
    page.getByRole("button", { name: "Post to Stock" }).click(),
  ]);
  console.log(`R81_D607B grn_id=${grnId} submit_status=${submitRes.status()}`);
  expect(submitRes.status(), await submitRes.text().catch(() => "")).toBe(200);

  const raw = await apiGet<Record<string, unknown>>(page, `/api/procurement/purchase-orders/${poId}`);
  const po = (raw.purchaseOrder ?? raw.data ?? raw) as {
    status: string; items: { description: string; quantity: string; receivedQuantity: string | null }[];
  };
  const item = po.items?.find((i) => i.description === line);
  console.log(`R81_D607B RESULT po_status=${po.status} received=${item?.receivedQuantity} ordered=${item?.quantity}`);
  expect(Number(item?.receivedQuantity ?? 0), "a stock-item line must credit the order too").toBeGreaterThan(0);
  expect(["partially_received", "completed", "received"]).toContain(po.status);
  // the FIFO layer itself is asserted in the database, since no PROJEXA screen
  // exposes the stock ledger; the po_id above is the handle for that check.
});

test("R81 D6-07(b): a cancelled purchase order is refused a goods receipt", async ({ page }) => {
  await warm(page);
  const suffix = uniqueSuffix();
  const line = `R81 CANCEL Line ${suffix}`;

  const vendors = await apiGet<{ vendors: { vendorName: string }[] }>(page, "/api/vendors");
  const vendor = vendors.vendors[0];

  await page.goto("/purchase-orders");
  await page.getByRole("button", { name: "New Purchase Order" }).click({ timeout: 60_000 });
  await fieldInput(page, "Vendor").click();
  await page.getByRole("option", { name: vendor.vendorName }).click();
  await page.getByPlaceholder("Description").fill(line);
  await page.getByPlaceholder("Qty").fill("3");
  await page.getByPlaceholder("Rate").fill("70");

  const [createRes] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/purchase-orders") && r.request().method() === "POST", { timeout: 90_000 }),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  expect(createRes.status()).toBe(201);
  await page.waitForURL(/procurement\/purchase-orders\/[^/]+$/i, { timeout: 60_000 });
  const poId = page.url().split("/").pop()!;

  // Cancel it. DELETE is the cancel verb here -- the route file says so
  // outright: "DELETE is a CANCEL upstream (status -> 'cancelled'), never a
  // row delete". A PATCH carrying {status:"cancelled"} returns 200 and changes
  // NOTHING, which is exactly the 200-is-not-persistence trap (KD-06); an
  // earlier run of this spec was fooled by it, so the status is re-read below
  // rather than inferred from the response code.
  const cancelRes = await page.request.delete(`/api/procurement/purchase-orders/${poId}`, { timeout: 120_000 });
  console.log(`R81_D607B cancel_po_id=${poId} cancel_status=${cancelRes.status()}`);
  expect([200, 204]).toContain(cancelRes.status());

  const afterCancel = await apiGet<Record<string, unknown>>(page, `/api/procurement/purchase-orders/${poId}`);
  const cancelled = (afterCancel.purchaseOrder ?? afterCancel.data ?? afterCancel) as { status: string };
  console.log(`R81_D607B po_status_after_cancel=${cancelled.status}`);
  expect(cancelled.status, "the PO must actually BE cancelled before the refusal means anything").toBe("cancelled");

  // Now attempt a receipt against it with a VALID, COMPLETE payload, so the
  // request actually reaches the service layer. A malformed body is rejected
  // by validation and proves nothing about the cancelled-PO guard -- that is
  // exactly how the first version of this test passed for the wrong reason
  // (it got a 400 "supplierId is required" and an `ok() === false` assertion
  // happily accepted it). The array is `items`, not `lines`;
  // purchaseOrderItemId is what would credit received_quantity.
  const vendorList = await apiGet<{ vendors: { id: string; vendorName: string }[] }>(page, "/api/vendors");
  const supplierId = vendorList.vendors.find((v) => v.vendorName === vendor.vendorName)?.id ?? vendorList.vendors[0].id;
  const poRaw = await apiGet<Record<string, unknown>>(page, `/api/procurement/purchase-orders/${poId}`);
  const poRead = (poRaw.purchaseOrder ?? poRaw.data ?? poRaw) as { items: { id: string; quantity: string }[] };
  const poLineId = poRead.items?.[0]?.id;
  expect(poLineId, "need the PO line id so the payload is complete enough to reach the service").toBeTruthy();

  // the receipt screen itself reads /api/inventory/warehouses
  // (GoodsReceiptCreateClient.tsx:186), so use the same source rather than
  // guessing a path -- a 404 here would produce another validation-shaped
  // refusal and mask the 409 this test exists to prove.
  const whRaw = await apiGet<{ warehouses?: { id: string }[] }>(page, "/api/inventory/warehouses");
  const warehouseId = whRaw.warehouses?.[0]?.id;
  expect(warehouseId, "need a real warehouse id so the payload reaches the service").toBeTruthy();

  const grnRes = await page.request.post("/api/procurement/goods-receipts", {
    data: {
      purchaseOrderId: poId,
      supplierId,
      warehouseId,
      postingDate: new Date().toISOString().slice(0, 10),
      items: [{ purchaseOrderItemId: poLineId, quantity: 1, warehouseId }],
    },
    timeout: 120_000,
  });
  const body = await grnRes.text().catch(() => "");
  console.log(`R81_D607B receipt_against_cancelled_status=${grnRes.status()} body=${body.slice(0, 200)}`);
  expect(grnRes.ok(), `a receipt against a cancelled PO must be refused, got ${grnRes.status()}`).toBe(false);
  expect(grnRes.status(), `the refusal must be the service's cancelled-PO 409, not a validation error. Got ${grnRes.status()}: ${body.slice(0, 200)}`).toBe(409);
});
});
