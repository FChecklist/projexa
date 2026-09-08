import { test, expect } from "@playwright/test";
import { apiGet, fieldInput, uniqueSuffix } from "./helpers";

// R81 D0-07 / D6-07: prove the purchase-order -> goods-receipt -> stock chain
// THROUGH THE REAL UI, driving BOTH processes at once.
//
// Why this exists: that chain was structurally DEAD for every PROJEXA-raised
// PO and it survived 4107 passing tests plus one earlier fix. It survived
// because it crosses two repositories -- PROJEXA's UI posts to PROJEXA's API,
// which calls compliance-tracker over VERIDIAN_API_BASE_URL, and
// submitPurchaseReceipt() runs there. Neither repo's suite exercises both
// processes together, so the whole path is invisible to both. This is the
// first test that drives them together.
//
// WHAT 754cef17 ACTUALLY FIXED, and why a one-sided assertion is worthless:
// crediting the ORDER and posting STOCK are two different facts and no longer
// share one guard. erp_purchase_order_items.itemId is nullable, and a PO line
// without one is ordinary rather than exceptional -- this product legitimately
// buys things that are not stock items, and PROJEXA's PO screens leave the
// stock item OPTIONAL. The old code ran `if (!item.itemId) continue` BEFORE
// the receivedQuantity credit, so such a line credited nothing and its order
// could never reach partially_received however much arrived. The fix moved the
// credit above that guard. So the assertion that matters is that a FREE-TEXT
// line is credited -- which is precisely what the old code failed to do.
test.use({ storageState: "playwright/.auth/ceo.json" });

test("R81 D6-07: a free-text PO line raised in the UI is credited when received", async ({ page }) => {
  const suffix = uniqueSuffix();
  const line1 = `R81 GRN Line ${suffix}`;
  const QTY = "5";
  const RATE = "137";

  // KD-15: warm the cross-repo path before measuring it. PROJEXA aborts an
  // upstream call at 8s (VERIDIAN_FETCH_TIMEOUT_MS) and the first
  // authenticated call into a cold compliance-tracker -- route compile plus a
  // first tenant-scoped round trip -- exceeds that. Warming is not masking: no
  // timeout, threshold or assertion below is relaxed, and the real read still
  // has to succeed on its own.
  for (let i = 0; i < 8; i++) {
    if ((await page.request.get("/api/vendors")).ok()) break;
    await page.waitForTimeout(2000);
  }
  const vendorsApi = await apiGet<{ vendors: { vendorName: string }[] }>(page, "/api/vendors");
  const vendor = vendorsApi.vendors[0];
  expect(vendor, "the seeded org must have at least one vendor").toBeTruthy();

  // ---- 1. raise the PO through the real screen ----
  await page.goto("/purchase-orders");
  await page.getByRole("button", { name: "New Purchase Order" }).click();
  await fieldInput(page, "Vendor").click();
  await page.getByRole("option", { name: vendor.vendorName }).click();
  await page.getByPlaceholder("Description").fill(line1);
  await page.getByPlaceholder("Qty").fill(QTY);
  await page.getByPlaceholder("Rate").fill(RATE);

  const [createRes] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/purchase-orders") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  expect(createRes.status(), await createRes.text().catch(() => "")).toBe(201);
  await page.waitForURL(/procurement\/purchase-orders\/[^/]+$/i, { timeout: 30_000 });
  const poId = page.url().split("/").pop()!;
  console.log(`R81_D607 po_id=${poId} line="${line1}" qty=${QTY} rate=${RATE} vendor="${vendor.vendorName}"`);

  // ---- 2. receive it through the real screen ----
  // Use the screen's OWN pre-population route (?poId=, resolved server-side),
  // which is R80 Part 5's GAP-8. That exercises the delivered behaviour
  // instead of reaching around it: the form must seed one editable row per PO
  // line, carrying the ordered quantity.
  await page.goto(`/procurement/goods-receipts/new?poId=${poId}`);
  await expect(page.getByRole("heading", { name: "Record Goods Receipt" })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);

  const seededQty = await page.getByPlaceholder("Qty").first().inputValue();
  console.log(`R81_D607 gap8_prepopulated_qty=${seededQty}`);
  expect(Number(seededQty), "GAP-8: the receipt form must seed the ordered quantity from the PO").toBe(Number(QTY));

  // warehouse is required and is not seeded from the order
  await page.getByRole("combobox").last().click();
  await page.getByRole("option").first().click();

  const [grnRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/procurement/goods-receipts") && r.request().method() === "POST", { timeout: 60_000 }),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  console.log(`R81_D607 grn_create_status=${grnRes.status()}`);
  expect([200, 201]).toContain(grnRes.status());

  // ---- 3. post it to stock ----
  await page.waitForURL(/procurement\/goods-receipts\/[^/]+$/i, { timeout: 30_000 });
  const grnId = page.url().split("/").pop()!;
  const [submitRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/submit") && r.request().method() === "POST", { timeout: 90_000 }),
    page.getByRole("button", { name: "Post to Stock" }).click(),
  ]);
  console.log(`R81_D607 grn_id=${grnId} submit_status=${submitRes.status()}`);
  expect(submitRes.status(), await submitRes.text().catch(() => "")).toBe(200);

  // ---- 4. prove it by RE-READING, never by a toast (KD-06 / XD-09) ----
  // The single-PO route passes compliance-tracker's response straight through
  // (NextResponse.json(data)), so accept either envelope rather than pinning a
  // key that belongs to the other repo and could change without this test
  // being touched.
  type PoLine = { description: string; quantity: string; receivedQuantity: string | null };
  const raw = await apiGet<Record<string, unknown>>(page, `/api/procurement/purchase-orders/${poId}`);
  const po = (raw.purchaseOrder ?? raw.data ?? raw) as { status: string; items: PoLine[] };
  const item = po.items?.find((i) => i.description === line1);
  console.log(`R81_D607 RESULT po_status=${po.status} received=${item?.receivedQuantity} ordered=${item?.quantity}`);

  expect(item, "the ordered line must still be findable after receipt").toBeTruthy();
  // THE REGRESSION THIS GUARDS. The old code ran `if (!item.itemId) continue`
  // BEFORE the receivedQuantity credit, so a free-text line credited nothing
  // and its order could never leave draft however much arrived. This line
  // failing means that bug is back.
  expect(Number(item!.receivedQuantity ?? 0),
    "a free-text PO line must credit receivedQuantity on receipt").toBeGreaterThan(0);
  expect(["partially_received", "completed", "received"],
    `the order must advance past draft, got "${po.status}"`).toContain(po.status);
});
