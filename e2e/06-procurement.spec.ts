import { test, expect } from "@playwright/test";
import { apiGet, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /procurement (ProcurementClient.tsx) is a 5-stage workflow (Requisitions
// -> RFQs -> Quotations -> Purchase Orders -> Goods Receipts), each its own
// tab/table, no search/sort/pagination on any of them. The "Purchase
// Orders" tab reads the SAME /api/procurement/purchase-orders data as the
// standalone /purchase-orders page's /api/purchase-orders (both proxy to
// VERIDIAN's erp_purchase_orders per PHASE1_SEED_REPORT.md row 24/26) --
// this file cross-checks that real consistency. Runs after
// 05-inventory.spec.ts (needs a real warehouse for the goods-receipt step)
// and before 07-purchase-orders.spec.ts (this file's own "convert to PO"
// write also lands in that module's table -- see that file's comments for
// why its assertions use before/after deltas instead of a fixed count).
//
// The 5 stages are deliberately written as 4 SEPARATE tests (Requisition;
// RFQ; Quotation+convert-to-PO; Goods Receipt) rather than one chained mega
// -test: RFQ/Quotation/Goods-Receipt creation don't actually require a
// prior requisition (every "linked X (optional)" dropdown defaults to
// "none — raise directly"), so a real bug in one stage (see Requisition
// test below) shouldn't prevent this suite from exercising and reporting
// on the other 3 independently.
test.describe("procurement", () => {
  test("baseline: 4 of 5 stages are genuinely empty; the Purchase Orders stage matches /api/purchase-orders exactly", async ({
    page,
  }) => {
    const [requisitions, rfqs, quotations, goodsReceipts, procurementPOs, standalonePOs] = await Promise.all([
      apiGet<{ requisitions: unknown[] }>(page, "/api/procurement/requisitions"),
      apiGet<{ rfqs: unknown[] }>(page, "/api/procurement/rfqs"),
      apiGet<{ quotations: unknown[] }>(page, "/api/procurement/quotations"),
      apiGet<{ goodsReceipts: unknown[] }>(page, "/api/procurement/goods-receipts"),
      apiGet<{ purchaseOrders: unknown[] }>(page, "/api/procurement/purchase-orders"),
      apiGet<{ purchaseOrders: unknown[] }>(page, "/api/purchase-orders"),
    ]);

    // Real, reportable finding: PHASE1_SEED_REPORT.md's Batch 3 seeded
    // vendors/materials/customers/purchase-orders/quotations/sales-orders/
    // invoices, but NOT this module's own precursor entities
    // (erp_purchase_requisitions/erp_rfqs/erp_supplier_quotations/
    // erp_purchase_receipts) -- confirmed live, all 4 return 0. See
    // PHASE2_BATCH_B_FINDINGS.md.
    test.info().annotations.push({
      type: "seed-data-note",
      description: `requisitions=${requisitions.requisitions.length}, rfqs=${rfqs.rfqs.length}, quotations=${quotations.quotations.length}, goodsReceipts=${goodsReceipts.goodsReceipts.length} -- none of procurement's own precursor-stage entities were seeded, only the terminal erp_purchase_orders table (via the standalone Purchase Orders / vendors/materials seed batch).`,
    });

    // Cross-module consistency check: the two "Purchase Orders" surfaces
    // must show the exact same real rows, since they hit the same table.
    expect(procurementPOs.purchaseOrders.length).toBe(standalonePOs.purchaseOrders.length);
    expect(standalonePOs.purchaseOrders.length).toBeGreaterThanOrEqual(12); // PHASE1_SEED_REPORT.md: 12 purchase orders

    await page.goto("/procurement");
    await expect(page.getByRole("heading", { level: 1, name: "Procurement" })).toBeVisible();

    for (const [tabName, emptyText, count] of [
      ["1. Requisitions", "No purchase requisitions yet.", requisitions.requisitions.length],
      ["2. RFQs", "No RFQs yet.", rfqs.rfqs.length],
      ["3. Quotations", "No supplier quotations recorded yet.", quotations.quotations.length],
      ["5. Goods Receipts", "No goods receipts recorded yet.", goodsReceipts.goodsReceipts.length],
    ] as const) {
      await page.getByRole("tab", { name: tabName }).click();
      if (count === 0) {
        await expect(page.getByText(emptyText)).toBeVisible();
      } else {
        await expect(page.locator("table tbody tr")).toHaveCount(count);
      }
    }

    await page.getByRole("tab", { name: "4. Purchase Orders" }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(procurementPOs.purchaseOrders.length);
  });

  test("creating a requisition and submitting it persists (real write)", async ({ page }) => {
    const suffix = uniqueSuffix();
    const itemDesc = `E2E Test Material ${suffix}`;

    await page.goto("/procurement");
    await page.getByRole("tab", { name: "1. Requisitions" }).click();
    await page.getByRole("button", { name: "New Requisition" }).click();
    await fieldInput(page, "Purpose (optional)").fill(`E2E test run ${suffix}`);
    await fieldInput(page, "Item description").fill(itemDesc);
    await fieldInput(page, "Quantity").fill("10");
    const [reqRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/requisitions") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Create Requisition" }).click(),
    ]);
    // Real, reportable bug (see PHASE2_BATCH_B_FINDINGS.md): as of authoring,
    // this POST reliably returns 500 with body {"error":"Failed to create
    // purchase requisition"} against the live site with this exact payload
    // (purpose + 1 line item, no requisitionNumber/warehouseId/other field
    // supplied -- matching every field the New Requisition dialog itself
    // collects, so this is reachable through the real UI, not a contrived
    // payload). Logged as a test annotation (not just the bare assertion
    // failure) so the full body survives in the HTML/CI report either way.
    test.info().annotations.push({
      type: "requisition-create-response",
      description: `status=${reqRes.status()} body=${await reqRes.text().catch((e) => `<failed to read body: ${e}>`)}`,
    });
    expect(reqRes.status()).toBe(201);
    await expect(page.getByText("Requisition created")).toBeVisible();
    const reqRow = page.getByRole("row", { name: new RegExp(`PR-\\d+.*${suffix}`) });
    await expect(reqRow).toBeVisible();
    await expect(reqRow.getByText("draft")).toBeVisible();

    const [submitReqRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/procurement/requisitions/") && r.url().endsWith("/submit")),
      reqRow.getByRole("button", { name: "Submit" }).click(),
    ]);
    expect(submitReqRes.status(), await submitReqRes.text().catch(() => "")).toBe(200);
    await expect(page.getByText("Requisition submitted")).toBeVisible();
    await expect(reqRow.getByText("submitted")).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: "1. Requisitions" }).click();
    await expect(page.getByRole("row", { name: new RegExp(`PR-\\d+.*${suffix}`) }).getByText("submitted")).toBeVisible();
  });

  test("creating an RFQ (raised directly, no linked requisition) and sending it to vendors persists (real write)", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const itemDesc = `E2E Test Material ${suffix}`;
    const vendorsApi = await apiGet<{ vendors: { id: string; vendorName: string }[] }>(page, "/api/vendors");
    const vendor = vendorsApi.vendors[0];

    await page.goto("/procurement");
    await page.getByRole("tab", { name: "2. RFQs" }).click();
    await page.getByRole("button", { name: "New RFQ" }).click();
    await fieldInput(page, "Item description").fill(itemDesc);
    await fieldInput(page, "Quantity").fill("10");
    await page.getByRole("checkbox", { name: vendor.vendorName }).check();
    const [rfqRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/rfqs") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Create RFQ" }).click(),
    ]);
    expect(rfqRes.status(), await rfqRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("RFQ created")).toBeVisible();
    // This suite has run many times against this same live, persistent org
    // (see PHASE2_BATCH_B_FINDINGS.md's "repeated-run data accumulation"
    // note) -- by now there are several older RFQs from prior runs,
    // already sent (no longer "draft"). Locate the row by THIS RFQ's own
    // real rfqNumber (from the create response), not "the first RFQ row",
    // so this test always acts on the one it just created.
    const rfqNumber = ((await rfqRes.json()) as { rfqNumber: number }).rfqNumber;
    // Real bug (see PHASE2_BATCH_B_FINDINGS.md and the dedicated
    // "tab resets" test below): every write action's load() sets
    // loading=true, which unmounts the whole <Tabs defaultValue=
    // "requisitions">, silently resetting the active tab back to
    // Requisitions. Re-clicking is the only way a real user (or this test)
    // can get back to what they were just looking at.
    await page.getByRole("tab", { name: "2. RFQs" }).click();
    const rfqRow = page.getByRole("row", { name: new RegExp(`^RFQ-${rfqNumber}\\b`) });
    await expect(rfqRow).toBeVisible();

    const [sendRfqRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/procurement/rfqs/") && r.url().endsWith("/send")),
      rfqRow.getByRole("button", { name: "Send to Vendors" }).click(),
    ]);
    expect(sendRfqRes.status(), await sendRfqRes.text().catch(() => "")).toBe(200);
    await expect(page.getByText("RFQ sent to suppliers")).toBeVisible();
    await page.getByRole("tab", { name: "2. RFQs" }).click();
    await expect(rfqRow.getByText("sent")).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: "2. RFQs" }).click();
    await expect(rfqRow.getByText("sent")).toBeVisible();
  });

  test("recording a supplier quotation and converting it to a purchase order persists in both Purchase Orders surfaces (real write)", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const itemDesc = `E2E Test Material ${suffix}`;
    const vendorsApi = await apiGet<{ vendors: { id: string; vendorName: string }[] }>(page, "/api/vendors");
    const vendor = vendorsApi.vendors[0];

    await page.goto("/procurement");
    await page.getByRole("tab", { name: "3. Quotations" }).click();
    await page.getByRole("button", { name: "Record Quotation" }).click();
    await fieldInput(page, "Vendor").click();
    await page.getByRole("option", { name: vendor.vendorName }).click();
    await fieldInput(page, "Item description").fill(itemDesc);
    await fieldInput(page, "Quantity").fill("10");
    await fieldInput(page, "Rate").fill("250");
    const [quoteRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/quotations") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Record Quotation" }).click(),
    ]);
    expect(quoteRes.status(), await quoteRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("Quotation recorded")).toBeVisible();
    // Locate by this quotation's own real quotationNumber (see the RFQ
    // test's comment above for why "first row matching vendor name" is
    // unreliable against this suite's own accumulated prior-run data).
    const quotationNumber = ((await quoteRes.json()) as { quotationNumber: number }).quotationNumber;
    // Real bug workaround (see the dedicated "tab resets" test below):
    // load() resets the active tab to Requisitions after every write.
    await page.getByRole("tab", { name: "3. Quotations" }).click();
    const quoteRow = page.getByRole("row", { name: new RegExp(`^SQ-${quotationNumber}\\b`) });
    await expect(quoteRow).toBeVisible();

    // Convert to PO -- real cross-table write, verified both here and
    // against the standalone /api/purchase-orders endpoint.
    const posBefore = await apiGet<{ purchaseOrders: unknown[] }>(page, "/api/purchase-orders");
    const [convertRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/purchase-orders") && r.request().method() === "POST"),
      quoteRow.getByRole("button", { name: "Convert to PO" }).click(),
    ]);
    expect(convertRes.status(), await convertRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("Purchase order created from quotation")).toBeVisible();
    const poNumber = ((await convertRes.json()) as { poNumber: number }).poNumber;

    await page.getByRole("tab", { name: "4. Purchase Orders" }).click();
    const newPoRow = page.getByRole("row", { name: new RegExp(`^PO-${poNumber}\\b`) });
    await expect(newPoRow).toBeVisible();

    const posAfter = await apiGet<{ purchaseOrders: unknown[] }>(page, "/api/purchase-orders");
    expect(posAfter.purchaseOrders.length).toBe(posBefore.purchaseOrders.length + 1);
  });

  test("recording a goods receipt and posting it to stock persists (real write)", async ({ page }) => {
    // Against whatever real warehouse exists (05-inventory.spec.ts creates
    // one; this runs after it).
    const warehousesApi = await apiGet<{ warehouses: { id: string; warehouseName: string }[] }>(
      page,
      "/api/inventory/warehouses"
    );
    test.skip(warehousesApi.warehouses.length === 0, "No warehouse exists yet to record a goods receipt against.");
    const warehouse = warehousesApi.warehouses[0];
    const vendorsApi = await apiGet<{ vendors: { id: string; vendorName: string }[] }>(page, "/api/vendors");
    const vendor = vendorsApi.vendors[0];

    await page.goto("/procurement");
    await page.getByRole("tab", { name: "5. Goods Receipts" }).click();
    await page.getByRole("button", { name: "New Goods Receipt" }).click();
    await fieldInput(page, "Vendor").click();
    await page.getByRole("option", { name: vendor.vendorName }).click();
    await fieldInput(page, "Receiving Warehouse").click();
    await page.getByRole("option", { name: warehouse.warehouseName }).click();
    await fieldInput(page, "Quantity").fill("10");
    const [grRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/goods-receipts") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Record Receipt (draft)" }).click(),
    ]);
    expect(grRes.status(), await grRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("Goods receipt recorded (draft)")).toBeVisible();
    // Locate by this receipt's own real receiptNumber (see the RFQ test's
    // comment above for why "first row matching vendor name" is unreliable
    // against this suite's own accumulated prior-run data -- confirmed live:
    // an earlier run's GRN-1 for this same vendor is already "submitted",
    // not "draft").
    const receiptNumber = ((await grRes.json()) as { receiptNumber: number }).receiptNumber;
    // Real bug workaround (see the dedicated "tab resets" test below):
    // load() resets the active tab to Requisitions after every write.
    await page.getByRole("tab", { name: "5. Goods Receipts" }).click();
    const grRow = page.getByRole("row", { name: new RegExp(`^GRN-${receiptNumber}\\b`) });
    await expect(grRow).toBeVisible();
    await expect(grRow.getByText("draft")).toBeVisible();

    const [postRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/procurement/goods-receipts/") && r.url().endsWith("/submit")),
      grRow.getByRole("button", { name: "Post to Stock" }).click(),
    ]);
    expect(postRes.status(), await postRes.text().catch(() => "")).toBe(200);
    await expect(page.getByText("Goods receipt posted to stock")).toBeVisible();
    await page.getByRole("tab", { name: "5. Goods Receipts" }).click();
    // The real backend status string after posting isn't documented in the
    // frontend (it renders `gr.status` verbatim) -- assert on the one thing
    // the component code guarantees: the "Post to Stock" button only shows
    // for status==="draft", so its disappearance proves the status changed.
    await expect(grRow.getByRole("button", { name: "Post to Stock" })).toHaveCount(0);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/procurement/goods-receipts") && r.request().method() === "GET"),
      page.reload(),
    ]);
    await page.getByRole("tab", { name: "5. Goods Receipts" }).click();
    await expect(grRow.getByRole("button", { name: "Post to Stock" })).toHaveCount(0);
  });

  test("real bug: every create/submit/send/convert action resets the active tab back to '1. Requisitions'", async ({
    page,
  }) => {
    // Root cause (read from ProcurementClient.tsx source): load() calls
    // setLoading(true) synchronously on every refetch (including the ones
    // triggered by createRequisition/createRfq/sendRfq/createQuotation/
    // convertToPo/createGoodsReceipt/etc. after a successful write), and
    // the component's render guard is `if (loading) return <spinner>` --
    // which unmounts the ENTIRE <Tabs defaultValue="requisitions"> tree.
    // Since Tabs is uncontrolled (no value=/onValueChange= wiring it to a
    // state variable that would survive the remount), it always
    // re-mounts back to its defaultValue. A real user mid-workflow on the
    // RFQs tab, who just sent an RFQ, is silently bounced back to
    // Requisitions -- the RFQ they just acted on isn't visibly gone (it's
    // still in the data, confirmed elsewhere in this file), but it LOOKS
    // gone, with no error, toast, or visual explanation.
    await page.goto("/procurement");
    await page.getByRole("tab", { name: "3. Quotations" }).click();
    await expect(page.getByRole("tab", { name: "3. Quotations" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: "Record Quotation" }).click();
    const vendorsApi = await apiGet<{ vendors: { vendorName: string }[] }>(page, "/api/vendors");
    await fieldInput(page, "Vendor").click();
    await page.getByRole("option", { name: vendorsApi.vendors[0].vendorName }).click();
    await fieldInput(page, "Item description").fill(`E2E tab-reset probe ${uniqueSuffix()}`);
    await fieldInput(page, "Rate").fill("1");
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/quotations") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Record Quotation" }).click(),
    ]);
    await expect(page.getByText("Quotation recorded")).toBeVisible();

    // The bug: still shows "selected" on Requisitions, not Quotations,
    // immediately after a write made on the Quotations tab.
    await expect(page.getByRole("tab", { name: "1. Requisitions" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "3. Quotations" })).toHaveAttribute("aria-selected", "false");
  });
});
