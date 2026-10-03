import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { deliveryShellData as shellData } from "./delivery-test-seed";
import { seedOrgKinds, type OrgSeed } from "./finance-test-seed";
import {
  MOVEMENTS_PAGE, loadFloorPlanObject, loadFloorPlans, loadInventory, loadItemObject, loadKbPage, loadKnowledgeBase, loadMoodBoardObject, loadMoodBoards,
  loadProcurement, loadProcurementObject, loadPurchaseOrderObject, loadPurchaseOrders,
} from "./erp-a-adapters";

// Inventory, purchase orders, procurement, floor plans, mood boards and the knowledge base read from the laptop's own copy of the
// organisation kinds: tolerant of junk rows, a column the server hid is never shown (even when a row still carries a value), a kind the
// role is not sent is "not_allowed", one never copied is "not_synced", nothing here ever touches the network.

let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(() => { fetchSpy = spyOn(globalThis, "fetch"); });
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore(); });

async function laptop(kinds: OrgSeed[], opts: { listed?: string[] } = {}) {
  const idb = new IDBFactory();
  await seedOrgKinds(idb, kinds, opts);
  return shellData(idb);
}

const MONEY_HIDDEN_ENTRIES = ["valuation_rate", "balance_value"];
const movement = (i: number, over: Record<string, unknown> = {}) => ({
  id: `m${String(i).padStart(3, "0")}`, item_id: "i1", warehouse_id: "w1", posting_date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, voucher_type: "purchase_receipt",
  quantity_change: "5.000", balance_qty: 5 * i, valuation_rate: "12.50", balance_value: 62.5 * i, transaction_uom: "bag", created_at: `2026-09-01T00:00:${String(i % 60).padStart(2, "0")}Z`, ...over,
});

describe("Inventory", () => {
  test("movements: newest first, one page at a time, names resolved, stored balances shown as stored (nothing summed), junk skipped", async () => {
    const rows: unknown[] = Array.from({ length: 120 }, (_, i) => movement(i + 1, { posting_date: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}` }));
    rows.push(movement(500, { id: "newest", posting_date: "2026-10-01", quantity_change: -3, balance_qty: 7 }));
    const data = await laptop([
      { kind: "stock_entries", rows: [...rows, null, 4, { id: "bad" }, { id: "", posting_date: "2026-01-01" }] },
      { kind: "stock_items", rows: [{ id: "i1", item_name: "Cement", item_code: "CEM-1" }] },
      { kind: "warehouses", rows: [{ id: "w1", warehouse_name: "Main store" }] },
    ]);
    const first = await loadInventory(data, null);
    if (first.state !== "local" || first.tab !== "movements") throw new Error("expected movements");
    expect(first.total).toBe(121);
    expect(first.pages).toBe(3);
    expect(first.movements).toHaveLength(MOVEMENTS_PAGE);
    expect(first.movements[0]).toMatchObject({ id: "newest", date: "2026-10-01", quantityChange: -3, balanceQty: 7, itemName: "Cement (CEM-1)", warehouseName: "Main store", uom: "bag" });
    const dates = first.movements.map((m) => m.date!);
    expect(dates).toEqual([...dates].sort().reverse());
    const third = await loadInventory(data, "movements", "3");
    if (third.state !== "local" || third.tab !== "movements") throw new Error("expected movements");
    expect(third.movements).toHaveLength(121 - 2 * MOVEMENTS_PAGE);
    const clamped = await loadInventory(data, "movements", "99");
    expect(clamped.state === "local" && clamped.tab === "movements" && clamped.page).toBe(3);
    const junkPage = await loadInventory(data, "movements", "abc");
    expect(junkPage.state === "local" && junkPage.tab === "movements" && junkPage.page).toBe(1);
  });

  test("a role whose valuation columns are hidden never gets a rate or value, even when a row still carries one", async () => {
    const data = await laptop([{ kind: "stock_entries", hidden: MONEY_HIDDEN_ENTRIES, rows: [movement(1, { valuation_rate: 7777, balance_value: 88888 })] }]);
    const r = await loadInventory(data, "movements");
    if (r.state !== "local" || r.tab !== "movements") throw new Error("expected movements");
    expect(r.moneyHidden).toBe(true);
    expect(r.movements[0]).toMatchObject({ valuationRate: null, balanceValue: null, balanceQty: 5 });
  });

  test("items: rates hidden by the marker are dropped; the item object finds its row; warehouses show their parent", async () => {
    const data = await laptop([
      { kind: "stock_items", hidden: ["standard_selling_rate", "standard_buying_rate"], rows: [{ id: "i1", item_code: "B-2", item_name: "Brick", item_group_id: "g1", uom: "nos", standard_buying_rate: 9999, standard_selling_rate: "11111", has_batch_no: true, hsn_sac_code: "6904" }, { id: "i2", item_code: "A-1", item_name: "Anchor", is_active: false }] },
      { kind: "item_groups", rows: [{ id: "g1", group_name: "Masonry" }] },
      { kind: "warehouses", rows: [{ id: "w1", warehouse_name: "Main", is_group: true }, { id: "w2", warehouse_name: "Bay 2", parent_warehouse_id: "w1", address: "Plot 4" }] },
    ]);
    const items = await loadInventory(data, "items");
    if (items.state !== "local" || items.tab !== "items") throw new Error("expected items");
    expect(items.ratesHidden).toBe(true);
    expect(items.items.map((i) => i.code)).toEqual(["A-1", "B-2"]);
    expect(items.items[1]).toMatchObject({ groupName: "Masonry", hasBatch: true, sellingRate: null, buyingRate: null, hsn: "6904" });
    expect(items.items[0]!.isActive).toBe(false);
    const one = await loadItemObject(data, "i1");
    expect(one.state === "local" && one.item.name).toBe("Brick");
    expect((await loadItemObject(data, "nope")).state).toBe("not_found");
    const wh = await loadInventory(data, "warehouses");
    if (wh.state !== "local" || wh.tab !== "warehouses") throw new Error("expected warehouses");
    expect(wh.warehouses.find((w) => w.id === "w2")).toMatchObject({ parentName: "Main", address: "Plot 4" });
  });

  test("a rate the role may see is shown as the server sent it, a bad one is null (never 0)", async () => {
    const data = await laptop([{ kind: "stock_items", rows: [{ id: "i1", item_code: "X", item_name: "X", standard_buying_rate: "12.5", standard_selling_rate: "oops" }] }]);
    const items = await loadInventory(data, "items");
    if (items.state !== "local" || items.tab !== "items") throw new Error("expected items");
    expect(items.items[0]).toMatchObject({ buyingRate: 12.5, sellingRate: null });
    expect(items.ratesHidden).toBe(false);
  });

  test("not allowed (kind not in the manifest) / not synced (never copied to the end)", async () => {
    const hidden = await laptop([{ kind: "stock_entries", rows: [movement(1)] }], { listed: ["customers"] });
    expect(await loadInventory(hidden, "movements")).toEqual({ state: "not_allowed", tab: "movements" });
    const unsynced = await laptop([{ kind: "warehouses", rows: [{ id: "w1", warehouse_name: "A" }], synced: false }]);
    expect(await loadInventory(unsynced, "warehouses")).toEqual({ state: "not_synced", tab: "warehouses" });
  });
});

describe("Purchase orders and procurement", () => {
  const orders = (hidden: string[] = []): OrgSeed => ({
    kind: "purchase_orders", hidden,
    rows: [
      { id: "o1", po_number: 7, supplier_id: "v1", order_date: "2026-09-10", status: "partially_received", grand_total: hidden.length ? 4242 : "125000.50", currency_id: "c2", created_at: "2026-09-10T01:00:00Z" },
      { id: "o2", po_number: "8", supplier_id: "gone", order_date: "2026-09-20", status: "draft", grand_total: "n/a", created_at: "2026-09-20T01:00:00Z" },
      { id: "o3" }, 3,
    ],
  });
  const masters: OrgSeed[] = [
    { kind: "vendors", rows: [{ id: "v1", supplier_name: "Shree Cement" }] },
    { kind: "currencies", rows: [{ id: "c1", code: "INR", symbol: "Rs", is_base_currency: true }, { id: "c2", code: "AED", symbol: null }] },
  ];

  test("purchase orders: newest first, vendor and currency resolved, an unreadable total is null, junk skipped", async () => {
    const data = await laptop([orders(), ...masters]);
    const r = await loadPurchaseOrders(data);
    if (r.state !== "local") throw new Error("expected local");
    expect(r.orders.map((o) => o.id)).toEqual(["o2", "o1"]);
    expect(r.orders[1]).toMatchObject({ number: "7", vendor: "Shree Cement", total: 125000.5, status: "partially_received" });
    expect(r.orders[1]!.currency?.code).toBe("AED");
    expect(r.orders[0]).toMatchObject({ vendor: null, total: null, number: "8" });
    expect(r.totalHidden).toBe(false);
    const one = await loadPurchaseOrderObject(data, "o1");
    expect(one.state === "local" && one.order.number).toBe("7");
    expect((await loadPurchaseOrderObject(data, "zz")).state).toBe("not_found");
  });

  test("the total the server hid is never kept, even when the row carries one", async () => {
    const data = await laptop([orders(["grand_total"]), ...masters]);
    const r = await loadPurchaseOrders(data);
    if (r.state !== "local") throw new Error("expected local");
    expect(r.totalHidden).toBe(true);
    expect(r.orders.every((o) => o.total === null)).toBe(true);
    const one = await loadPurchaseOrderObject(data, "o1");
    expect(one.state === "local" && one.order.total).toBeNull();
  });

  test("procurement tabs: requisitions, rfqs (linked to a requisition number), receipts (vendor and PO number), purchase orders; quotations have no kind", async () => {
    const data = await laptop([
      { kind: "requisitions", rows: [{ id: "q1", requisition_number: 11, department_id: "d1", purpose: "Site cement", posting_date: "2026-09-01", status: "submitted" }] },
      { kind: "rfqs", rows: [{ id: "f1", rfq_number: 4, requisition_id: "q1", posting_date: "2026-09-02", status: "sent" }] },
      { kind: "goods_receipts", rows: [{ id: "g1", receipt_number: 9, supplier_id: "v1", purchase_order_id: "o1", posting_date: "2026-09-12", status: "posted", putaway_status: "pending" }] },
      { kind: "departments", rows: [{ id: "d1", name: "Civil" }] },
      orders(), ...masters,
    ]);
    const req = await loadProcurement(data, null);
    expect(req.state === "local" && req.tab === "requisitions" && req.rows[0]).toMatchObject({ number: "11", department: "Civil", purpose: "Site cement" });
    const rfq = await loadProcurement(data, "rfqs");
    expect(rfq.state === "local" && rfq.tab === "rfqs" && rfq.rows[0]).toMatchObject({ number: "4", requisition: "11" });
    const gr = await loadProcurement(data, "goods-receipts");
    expect(gr.state === "local" && gr.tab === "goods-receipts" && gr.rows[0]).toMatchObject({ vendor: "Shree Cement", purchaseOrder: "7", putaway: "pending" });
    const po = await loadProcurement(data, "purchase-orders");
    expect(po.state === "local" && po.tab === "purchase-orders" && po.orders).toHaveLength(2);
    expect(await loadProcurement(data, "quotations")).toEqual({ state: "local", tab: "quotations" });
    expect((await loadProcurement(data, "nonsense")).tab).toBe("requisitions");
    for (const [kind, id] of [["requisition", "q1"], ["rfq", "f1"], ["goods-receipt", "g1"]] as const) {
      const o = await loadProcurementObject(data, kind, id);
      expect(o.state === "local" && o.doc.kind).toBe(kind);
      expect((await loadProcurementObject(data, kind, "missing")).state).toBe("not_found");
    }
  });

  test("not allowed / not synced per tab", async () => {
    const data = await laptop([{ kind: "rfqs", rows: [], synced: false }, { kind: "requisitions", rows: [] }], { listed: ["rfqs", "requisitions"] });
    expect(await loadProcurement(data, "rfqs")).toEqual({ state: "not_synced", tab: "rfqs" });
    expect(await loadProcurement(data, "goods-receipts")).toEqual({ state: "not_allowed", tab: "goods-receipts" });
  });
});

describe("Floor plans, mood boards, knowledge base", () => {
  test("floor plans and mood boards are the selected project's own, newest first; no project is said so", async () => {
    const data = await laptop([
      { kind: "floor_plans", rows: [{ id: "f1", project_id: "p1", name: "Ground", floor_level: "G", status: "draft", created_at: "2026-09-01T00:00:00Z" }, { id: "f2", project_id: "p1", name: "First", status: "final", created_at: "2026-09-05T00:00:00Z" }, { id: "f3", project_id: "p2", name: "Other project" }, { id: "f4", project_id: "p1" }] },
      { kind: "mood_boards", rows: [{ id: "b1", project_id: "p1", title: "Living room", room_or_area: "Hall", description: "Warm tones", status: "approved" }, { id: "b2", project_id: "p2", title: "Elsewhere" }] },
    ]);
    const plans = await loadFloorPlans(data, "p1");
    if (plans.state !== "local") throw new Error("expected local");
    expect(plans.plans.map((p) => p.name)).toEqual(["First", "Ground"]);
    const boards = await loadMoodBoards(data, "p1");
    expect(boards.state === "local" && boards.boards.map((b) => b.title)).toEqual(["Living room"]);
    expect(await loadFloorPlans(data, null)).toEqual({ state: "no_project" });
    expect(await loadMoodBoards(data, null)).toEqual({ state: "no_project" });
    expect((await loadFloorPlanObject(data, "f2")).state).toBe("local");
    expect((await loadFloorPlanObject(data, "zz")).state).toBe("not_found");
    const b = await loadMoodBoardObject(data, "b1");
    expect(b.state === "local" && b.board.description).toBe("Warm tones");
  });

  test("knowledge base: titles sorted, content kept as text, parent title resolved, a page with no title skipped", async () => {
    const data = await laptop([{ kind: "knowledge_base", rows: [
      { id: "k2", title: "Safety", content: "<script>alert(1)</script>Wear a helmet.", version: 3, parent_page_id: "k1", slug: "safety" },
      { id: "k1", title: "Handbook", version: 1 }, { id: "k3", content: "no title" }, "junk",
    ] }]);
    const list = await loadKnowledgeBase(data);
    expect(list.state === "local" && list.pages.map((p) => p.title)).toEqual(["Handbook", "Safety"]);
    const page = await loadKbPage(data, "k2");
    expect(page.state === "local" && page.page).toMatchObject({ parentTitle: "Handbook", version: 3, content: "<script>alert(1)</script>Wear a helmet." });
    expect((await loadKbPage(data, "k3")).state).toBe("not_found");
  });

  test("a role that is not sent these kinds, and a person with another database", async () => {
    const data = await laptop([{ kind: "knowledge_base", rows: [{ id: "k1", title: "T" }] }], { listed: [] });
    expect(await loadKnowledgeBase(data)).toEqual({ state: "not_allowed" });
    expect(await loadFloorPlans(data, "p1")).toEqual({ state: "not_allowed" });
    const idb2 = new IDBFactory();
    await seedOrgKinds(idb2, [{ kind: "knowledge_base", rows: [{ id: "k1", title: "T" }] }], { userId: "u2" });
    expect(await loadKnowledgeBase(shellData(idb2))).toEqual({ state: "not_synced" });
  });
});
