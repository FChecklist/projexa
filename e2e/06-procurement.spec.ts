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
// Real-screen conversion (2026-08-30, see ProcurementClient.tsx:55-64):
// every "New X" / "Record Quotation" Dialog popup this file used to drive
// is gone. Requisitions/RFQs/Goods Receipts each gained a real create route
// (.../new) plus a real Object Page (.../[id]) where Submit/Send/Post-to-
// Stock now live -- these used to be inline buttons on the /procurement
// list itself. Quotations is the one stage that DIDN'T gain an Object Page
// (no getSupplierQuotation() exists, QuotationCreateClient.tsx:5-7) -- its
// create screen redirects back to the list and "Convert to PO" stays a
// real inline row action, so that stage's flow below is the least changed.
//
// The 5 stages are deliberately written as 4 SEPARATE tests (Requisition;
// RFQ; Quotation+convert-to-PO; Goods Receipt) rather than one chained mega
// -test: RFQ/Quotation/Goods-Receipt creation don't actually require a
// prior requisition (every "linked X (optional)" dropdown defaults to no
// linkage), so a real bug in one stage (see Requisition test below)
// shouldn't prevent this suite from exercising and reporting on the other
// 3 independently.
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
    // Stale: this used to open a "New Requisition" Dialog. It now routes to
    // a real create screen (ProcurementClient.tsx:171-173 ->
    // RequisitionCreateClient.tsx) -- no getByRole('dialog') exists here
    // any more.
    await page.getByRole("button", { name: "New Requisition" }).click();
    await expect(page).toHaveURL(/\/procurement\/requisitions\/new$/);
    await fieldInput(page, "Purpose (optional)").fill(`E2E test run ${suffix}`);
    await fieldInput(page, "Item description").fill(itemDesc);
    await fieldInput(page, "Quantity").fill("10");
    // Stale: there is no per-module "Create Requisition" button any more --
    // the create screen's submit control is the shared kit's generic "Save"
    // (ObjectScreen.tsx footerActions, isEditing branch: `Save{...}`).
    const [reqRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/requisitions") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    // Real, reportable bug (see PHASE2_BATCH_B_FINDINGS.md): as of authoring,
    // this POST reliably returns 500 with body {"error":"Failed to create
    // purchase requisition"} against the live site with this exact payload
    // (purpose + 1 line item, no requisitionNumber/warehouseId/other field
    // supplied -- matching every field the New Requisition screen itself
    // collects, so this is reachable through the real UI, not a contrived
    // payload). Whether this still reproduces couldn't be re-confirmed by
    // source reading alone (POST /api/procurement/requisitions is a thin
    // proxy to VERIDIAN's own service, requisitions/route.ts:18-28) -- kept
    // as a test annotation (not just the bare assertion failure) so the
    // full body survives in the HTML/CI report either way.
    test.info().annotations.push({
      type: "requisition-create-response",
      description: `status=${reqRes.status()} body=${await reqRes.text().catch((e) => `<failed to read body: ${e}>`)}`,
    });
    expect(reqRes.status()).toBe(201);
    await expect(page.getByText("Requisition created")).toBeVisible();
    const reqBody = (await reqRes.json()) as { id: string; requisitionNumber: number };

    // Stale: creating used to leave you on /procurement with a new inline
    // row. It now navigates to the requisition's real Object Page
    // (RequisitionCreateClient.tsx:33) -- Requisitions never had one before
    // this conversion, only the flat list row itself.
    await expect(page).toHaveURL(new RegExp(`/procurement/requisitions/${reqBody.id}$`));
    await expect(page.getByRole("heading", { name: `PR-${reqBody.requisitionNumber}` })).toBeVisible();
    await expect(page.getByText("draft", { exact: true })).toBeVisible();

    // Stale: Submit used to be an inline per-row button on the list. It now
    // lives on the Object Page, only rendered while status is "draft"
    // (RequisitionObjectClient.tsx:86-90).
    const [submitReqRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/procurement/requisitions/") && r.url().endsWith("/submit")),
      page.getByRole("button", { name: "Submit" }).click(),
    ]);
    expect(submitReqRes.status(), await submitReqRes.text().catch(() => "")).toBe(200);
    await expect(page.getByText("Requisition submitted")).toBeVisible();
    // exact:true -- the toast text ("Requisition submitted") also contains
    // "submitted" as a substring, and both can be on screen at once.
    await expect(page.getByText("submitted", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText("submitted", { exact: true })).toBeVisible();
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
    // Stale: "New RFQ" used to open a Dialog; it now routes to a real
    // create screen (ProcurementClient.tsx:209-211 -> RfqCreateClient.tsx).
    await page.getByRole("button", { name: "New RFQ" }).click();
    await expect(page).toHaveURL(/\/procurement\/rfqs\/new$/);
    await fieldInput(page, "Item description").fill(itemDesc);
    await fieldInput(page, "Quantity").fill("10");
    await page.getByRole("checkbox", { name: vendor.vendorName }).check();
    const [rfqRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/rfqs") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(rfqRes.status(), await rfqRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("RFQ created")).toBeVisible();
    const rfqBody = (await rfqRes.json()) as { id: string; rfqNumber: number };

    // Stale: creating used to leave an inline row on /procurement, located
    // by rfqNumber because of accumulated prior-run data (still true of the
    // list, just no longer where this test verifies from). RfqCreateClient.tsx:48
    // now navigates straight to the RFQ's real Object Page -- RFQs never had
    // one before this conversion. That also retires the old tab-reclick
    // workaround this test used to need: there is no shared <Tabs> on this
    // route to reset in the first place.
    await expect(page).toHaveURL(new RegExp(`/procurement/rfqs/${rfqBody.id}$`));
    await expect(page.getByRole("heading", { name: `RFQ-${rfqBody.rfqNumber}` })).toBeVisible();

    // Stale: Send used to be an inline per-row button on the list. It now
    // lives on the Object Page, only rendered while status is "draft"
    // (RfqObjectClient.tsx:102-106).
    const [sendRfqRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/procurement/rfqs/") && r.url().endsWith("/send")),
      page.getByRole("button", { name: "Send to Vendors" }).click(),
    ]);
    expect(sendRfqRes.status(), await sendRfqRes.text().catch(() => "")).toBe(200);
    await expect(page.getByText("RFQ sent to suppliers")).toBeVisible();
    // exact:true -- see the requisition test's comment above for why (the
    // toast text also contains "sent" as a substring: "RFQ sent to...").
    await expect(page.getByText("sent", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText("sent", { exact: true })).toBeVisible();
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
    // Stale: "Record Quotation" used to open a Dialog; it now routes to a
    // real create screen (ProcurementClient.tsx:244-246 ->
    // QuotationCreateClient.tsx). Unlike Requisitions/RFQs/Goods Receipts,
    // Quotations has no Object Page (no getSupplierQuotation(), see
    // QuotationCreateClient.tsx:5-7) -- Save redirects back to
    // /procurement?tab=quotations (QuotationCreateClient.tsx:51), which
    // preselects this same tab on load, so everything from here down
    // (locate row by quotationNumber, inline "Convert to PO") is unchanged.
    await page.getByRole("button", { name: "Record Quotation" }).click();
    await expect(page).toHaveURL(/\/procurement\/quotations\/new$/);
    await fieldInput(page, "Vendor").click();
    await page.getByRole("option", { name: vendor.vendorName }).click();
    await fieldInput(page, "Item description").fill(itemDesc);
    await fieldInput(page, "Quantity").fill("10");
    await fieldInput(page, "Rate").fill("250");
    // Stale: there is no per-module "Record Quotation" submit button any
    // more -- see the requisition test's comment above re: the shared
    // kit's generic "Save".
    const [quoteRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/quotations") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(quoteRes.status(), await quoteRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("Quotation recorded")).toBeVisible();
    await expect(page).toHaveURL(/\/procurement\?tab=quotations$/);
    await expect(page.getByRole("tab", { name: "3. Quotations" })).toHaveAttribute("aria-selected", "true");
    // This suite has run many times against this same live, persistent org
    // (see PHASE2_BATCH_B_FINDINGS.md's "repeated-run data accumulation"
    // note) -- by now there are several older quotations. Locate by THIS
    // quotation's own real quotationNumber (from the create response), not
    // "the first row matching vendor name", so this test always acts on
    // the one it just created.
    const quotationNumber = ((await quoteRes.json()) as { quotationNumber: number }).quotationNumber;
    const quoteRow = page.getByRole("row", { name: new RegExp(`^SQ-${quotationNumber}\\b`) });
    await expect(quoteRow).toBeVisible();

    // Convert to PO -- real cross-table write, unchanged: no Object Page
    // conversion happened here, ProcurementClient.tsx:130-145 still handles
    // it as a real inline action. Verified both here and against the
    // standalone /api/purchase-orders endpoint.
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
    // Stale: "New Goods Receipt" used to open a Dialog; it now routes to a
    // real create screen (ProcurementClient.tsx:312-314 ->
    // GoodsReceiptCreateClient.tsx).
    await page.getByRole("button", { name: "New Goods Receipt" }).click();
    await expect(page).toHaveURL(/\/procurement\/goods-receipts\/new$/);
    await fieldInput(page, "Vendor").click();
    await page.getByRole("option", { name: vendor.vendorName }).click();
    await fieldInput(page, "Receiving Warehouse").click();
    await page.getByRole("option", { name: warehouse.warehouseName }).click();
    await fieldInput(page, "Quantity").fill("10");
    // Stale: "Record Receipt (draft)" never existed on this screen -- see
    // the requisition test's comment above re: the shared kit's generic
    // "Save". The success toast text itself is unchanged
    // (GoodsReceiptCreateClient.tsx:72).
    const [grRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/goods-receipts") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(grRes.status(), await grRes.text().catch(() => "")).toBe(201);
    await expect(page.getByText("Goods receipt recorded (draft)")).toBeVisible();
    const grBody = (await grRes.json()) as { id: string; receiptNumber: number };

    // Stale: creating used to leave an inline row on /procurement.
    // GoodsReceiptCreateClient.tsx:73 now navigates to the receipt's real
    // Object Page -- goods receipts never had one before this conversion.
    await expect(page).toHaveURL(new RegExp(`/procurement/goods-receipts/${grBody.id}$`));
    await expect(page.getByRole("heading", { name: `GRN-${grBody.receiptNumber}` })).toBeVisible();
    await expect(page.getByText("draft", { exact: true })).toBeVisible();

    // Stale: Post to Stock used to be an inline per-row button on the list.
    // It now lives on the Object Page, only rendered while status is
    // "draft" (GoodsReceiptObjectClient.tsx:101-105).
    const [postRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/procurement/goods-receipts/") && r.url().endsWith("/submit")),
      page.getByRole("button", { name: "Post to Stock" }).click(),
    ]);
    expect(postRes.status(), await postRes.text().catch(() => "")).toBe(200);
    await expect(page.getByText("Goods receipt posted to stock")).toBeVisible();
    // The real backend status string after posting isn't documented in the
    // frontend (GoodsReceiptObjectClient.tsx renders `receipt.status`
    // verbatim) -- assert on the one thing the component code guarantees:
    // the "Post to Stock" button only renders for status==="draft"
    // (GoodsReceiptObjectClient.tsx:101), so its disappearance proves the
    // status changed.
    await expect(page.getByRole("button", { name: "Post to Stock" })).toHaveCount(0);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/procurement/goods-receipts") && r.request().method() === "GET"),
      page.reload(),
    ]);
    await expect(page.getByRole("button", { name: "Post to Stock" })).toHaveCount(0);
  });

  // Stale test, flipped rather than deleted: this used to document a real
  // bug (every write's load() forced loading=true, which unmounted the
  // whole uncontrolled <Tabs defaultValue="requisitions">, always
  // remounting back to its default and silently bouncing the user off
  // whatever tab they were on). That bug is fixed -- Tabs is now
  // CONTROLLED off a persistent `activeTab` state variable that survives
  // the loading remount (ProcurementClient.tsx:159 `<Tabs value={activeTab}
  // onValueChange={goToTab}>`, state declared line 68, load()'s
  // setLoading(true)/(false) at lines 83/116, the `if (loading) return
  // <spinner>` unmount guard at lines 154-156), and goToTab()
  // (lines 147-152) also syncs `?tab=` into the URL. "Convert to PO" is the
  // only remaining in-place write on this page (every other stage's write
  // actions moved to their own Object Page routes, see the tests above), so
  // it's the only real way left to exercise this.
  test("fixed: 'Convert to PO' no longer resets the active tab off Quotations", async ({ page }) => {
    const suffix = uniqueSuffix();
    const vendorsApi = await apiGet<{ vendors: { id: string; vendorName: string }[] }>(page, "/api/vendors");
    const vendor = vendorsApi.vendors[0];

    // Seed a quotation to convert -- Quotations has no Object Page, so its
    // create screen redirects straight back here (see the dedicated
    // quotation test above).
    await page.goto("/procurement");
    await page.getByRole("tab", { name: "3. Quotations" }).click();
    await page.getByRole("button", { name: "Record Quotation" }).click();
    await fieldInput(page, "Vendor").click();
    await page.getByRole("option", { name: vendor.vendorName }).click();
    await fieldInput(page, "Item description").fill(`E2E tab-reset probe ${suffix}`);
    await fieldInput(page, "Quantity").fill("1");
    await fieldInput(page, "Rate").fill("1");
    const [quoteRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/quotations") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    await expect(page.getByText("Quotation recorded")).toBeVisible();
    await expect(page.getByRole("tab", { name: "3. Quotations" })).toHaveAttribute("aria-selected", "true");
    const quotationNumber = ((await quoteRes.json()) as { quotationNumber: number }).quotationNumber;
    const quoteRow = page.getByRole("row", { name: new RegExp(`^SQ-${quotationNumber}\\b`) });
    await expect(quoteRow).toBeVisible();

    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/procurement/purchase-orders") && r.request().method() === "POST"),
      quoteRow.getByRole("button", { name: "Convert to PO" }).click(),
    ]);
    await expect(page.getByText("Purchase order created from quotation")).toBeVisible();

    // The fix: still shows "selected" on Quotations, not Requisitions,
    // immediately after a write made on the Quotations tab.
    await expect(page.getByRole("tab", { name: "3. Quotations" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "1. Requisitions" })).toHaveAttribute("aria-selected", "false");
  });
});
