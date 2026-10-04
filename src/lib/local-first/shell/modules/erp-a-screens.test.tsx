import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { shellManifestKey } from "../manifest-cache";
import { seedDelivery } from "./delivery-test-seed";
import { seedOrgKinds, type OrgSeed } from "./finance-test-seed";

// Inventory, Purchase Orders, Procurement, Floor Plans, Mood Boards and the Knowledge Base, rendered inside the REAL shell (route table,
// adapters, IndexedDB via fake-indexeddb, identity mirror) with the NETWORK OFF: they open from the laptop's own copy, never print a hidden
// money value, never add anything up, say plainly that line items are on the server, answer a role that is not sent a kind with one calm
// sentence, and not one request leaves the laptop.

let idb: IDBFactory;
const realReplicaShared = await import("../../replica-shared");
mock.module("../../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("../LocalShell");

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const ORIGIN = "https://px.test";
const realFetch = globalThis.fetch;
let fetchCalls: string[];

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}
function go(path: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}${path}`);
}
const identity = (role: string): DurableIdentity => ({
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role, lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
});

// a hidden value the row still carries (never trusted over the marker): 7777 / 88888 / 4242 must never appear on screen
const orgKinds = (hide: boolean): OrgSeed[] => [
  { kind: "vendors", rows: [{ id: "v1", supplier_name: "Shree Cement" }] },
  { kind: "currencies", rows: [{ id: "c1", code: "INR", symbol: "R", is_base_currency: true }] },
  { kind: "departments", rows: [{ id: "d1", name: "Civil" }] },
  { kind: "warehouses", rows: [{ id: "w1", warehouse_name: "Main store", address: "Plot 4" }] },
  { kind: "item_groups", rows: [{ id: "g1", group_name: "Masonry" }] },
  { kind: "stock_items", hidden: hide ? ["standard_selling_rate", "standard_buying_rate"] : [], rows: [{ id: "i1", item_code: "CEM-1", item_name: "Cement", item_group_id: "g1", uom: "bag", standard_buying_rate: hide ? 7777 : 410, standard_selling_rate: hide ? 7777 : 450 }] },
  {
    kind: "stock_entries", hidden: hide ? ["valuation_rate", "balance_value"] : [],
    rows: Array.from({ length: 60 }, (_, i) => ({ id: `m${String(i + 1).padStart(3, "0")}`, item_id: "i1", warehouse_id: "w1", posting_date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, voucher_type: "purchase_receipt", quantity_change: 5, balance_qty: 5 * (i + 1), valuation_rate: hide ? 7777 : 410, balance_value: hide ? 88888 : 2050 * (i + 1), transaction_uom: "bag", created_at: "2026-09-01T00:00:00Z" })),
  },
  { kind: "purchase_orders", hidden: hide ? ["grand_total"] : [], rows: [{ id: "o1", po_number: 7, supplier_id: "v1", order_date: "2026-09-10", status: "partially_received", grand_total: hide ? 4242 : "125000.50", currency_id: "c1" }] },
  { kind: "requisitions", rows: [{ id: "q1", requisition_number: 11, department_id: "d1", purpose: "Site cement", posting_date: "2026-09-01", status: "submitted" }] },
  { kind: "rfqs", rows: [{ id: "f1", rfq_number: 4, requisition_id: "q1", posting_date: "2026-09-02", status: "sent" }] },
  { kind: "goods_receipts", rows: [{ id: "g1", receipt_number: 9, supplier_id: "v1", purchase_order_id: "o1", posting_date: "2026-09-12", status: "posted", putaway_status: "pending" }] },
  { kind: "floor_plans", rows: [{ id: "f1", project_id: "p1", name: "Ground floor", floor_level: "G", status: "draft", created_at: "2026-09-01T00:00:00Z" }, { id: "f2", project_id: "p2", name: "Annexe plan" }] },
  { kind: "mood_boards", rows: [{ id: "b1", project_id: "p1", title: "Living room", room_or_area: "Hall", description: "Warm tones", status: "approved" }] },
  { kind: "knowledge_base", rows: [{ id: "k1", title: "Handbook", version: 2, content: "Line one\nLine two" }, { id: "k2", title: "Safety", parent_page_id: "k1", content: "<img src=x onerror=alert(1)>Wear a helmet." }] },
];

async function seedLaptop(role: string, opts: { hide?: boolean; listed?: string[] } = {}) {
  await seedDelivery(idb, [], { projectIds: ["p1", "p2"], at: NOW });
  await seedOrgKinds(idb, orgKinds(Boolean(opts.hide)), { at: NOW, listed: opts.listed });
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role, org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }, { id: "p2", name: "Annexe", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity(role));
}

beforeEach(() => {
  idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  localStorage.clear();
  sessionStorage.clear();
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  setOnline(false);
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setOnline(true);
});

const noDialog = () => document.querySelector('[role="dialog"], [role="alertdialog"], [role="alert"]') === null;

describe("ERP A modules open OFFLINE from the laptop's own copy", () => {
  test("Inventory: newest movements first, a page at a time, stored balances as sent (not added up), the server owns every write", async () => {
    await seedLaptop("manager");
    go("/local/inventory");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("inventory")).getAttribute("data-state")).toBe("local");
    expect(getAllByTestId("inventory-row")).toHaveLength(50);
    expect(getByTestId("inventory-page-note").textContent).toContain("Newest first, 50 to a page: showing 1 to 50 of 60 stock movements");
    expect(getByTestId("inventory-pager").textContent).toContain("Older");
    const first = getAllByTestId("inventory-row")[0]!.textContent!;
    expect(first).toContain("Cement (CEM-1)");
    expect(first).toContain("Main store");
    expect(first).toContain("R410");
    expect(getByTestId("server-only").textContent).toContain("It will be available here when you are connected.");
    expect(getByTestId("inventory").textContent).not.toMatch(/stock balance of/i);
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("Inventory for a role without cost: movements and item rates say 'Hidden for your role', never the value a row carries", async () => {
    await seedLaptop("member", { hide: true });
    go("/local/inventory");
    const a = render(<LocalShell />);
    expect((await a.findAllByTestId("inventory-row"))[0]!.textContent).toContain("Hidden for your role");
    expect(a.getByTestId("inventory").textContent).not.toMatch(/7,?777|88,?888/);
    cleanup();
    go("/local/inventory?tab=items");
    const b = render(<LocalShell />);
    expect((await b.findAllByTestId("inventory-row"))[0]!.textContent).toContain("Hidden for your role");
    expect(b.getByTestId("inventory").textContent).not.toMatch(/7,?777/);
    cleanup();
    go("/local/inventory/items/i1");
    const c = render(<LocalShell />);
    expect((await c.findByTestId("item")).textContent).toContain("Hidden for your role");
    expect(c.getByTestId("item").textContent).not.toMatch(/7,?777/);
    expect(fetchCalls).toEqual([]);
  });

  test("Inventory tabs: warehouses and items, an item opens its own header page", async () => {
    await seedLaptop("manager");
    go("/local/inventory?tab=warehouses");
    const a = render(<LocalShell />);
    expect((await a.findAllByTestId("inventory-row"))[0]!.textContent).toContain("Main store");
    cleanup();
    go("/local/inventory?tab=items");
    const b = render(<LocalShell />);
    const row = (await b.findAllByTestId("inventory-row"))[0]!;
    expect(row.textContent).toContain("Masonry");
    expect(row.textContent).toContain("R410");
    expect(row.querySelector("a")!.getAttribute("href")).toBe("/inventory/items/i1");
    expect(fetchCalls).toEqual([]);
  });

  test("Purchase Orders: vendor, date, total as the server sent it; the order's lines are said to be on the server", async () => {
    await seedLaptop("manager");
    go("/local/purchase-orders");
    const a = render(<LocalShell />);
    const row = (await a.findAllByTestId("purchase-orders-row"))[0]!.textContent!;
    expect(row).toContain("PO-7");
    expect(row).toContain("Shree Cement");
    expect(row).toContain("R125,000.5");
    cleanup();
    go("/local/procurement/purchase-orders/o1");
    const b = render(<LocalShell />);
    expect((await b.findByTestId("purchase-order")).getAttribute("data-state")).toBe("local");
    expect(b.getByTestId("lines-on-server").textContent).toContain("line items are on the server");
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("Purchase Orders for a role without cost: the total is 'Hidden for your role', on the list and on the order", async () => {
    await seedLaptop("member", { hide: true });
    go("/local/purchase-orders");
    const a = render(<LocalShell />);
    expect((await a.findAllByTestId("purchase-orders-row"))[0]!.textContent).toContain("Hidden for your role");
    expect(a.getByTestId("purchase-orders").textContent).not.toMatch(/4,?242/);
    cleanup();
    go("/local/procurement/purchase-orders/o1");
    const b = render(<LocalShell />);
    expect((await b.findByTestId("purchase-order")).textContent).toContain("Hidden for your role");
    expect(b.getByTestId("purchase-order").textContent).not.toMatch(/4,?242/);
    expect(fetchCalls).toEqual([]);
  });

  test("Procurement: every stage from the copy, quotations honestly absent, each header page says its lines are on the server", async () => {
    await seedLaptop("manager");
    const seen: Record<string, string> = { requisitions: "PR-11", rfqs: "RFQ-4", "goods-receipts": "GRN-9", "purchase-orders": "PO-7" };
    for (const [tab, text] of Object.entries(seen)) {
      go(`/local/procurement?tab=${tab}`);
      const r = render(<LocalShell />);
      expect((await r.findAllByTestId(tab === "purchase-orders" ? "purchase-orders-row" : "procurement-row"))[0]!.textContent).toContain(text);
      cleanup();
    }
    go("/local/procurement?tab=quotations");
    const q = render(<LocalShell />);
    expect((await q.findByTestId("procurement-quotations")).textContent).toContain("kept on the server");
    cleanup();
    for (const path of ["/local/procurement/requisitions/q1", "/local/procurement/rfqs/f1", "/local/procurement/goods-receipts/g1"]) {
      go(path);
      const r = render(<LocalShell />);
      expect((await r.findByTestId("procurement-doc")).getAttribute("data-state")).toBe("local");
      expect(r.getByTestId("lines-on-server").textContent).toContain("line items");
      cleanup();
    }
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("Floor Plans and Mood Boards: the selected project's own, headers only, rooms and items said to be on the server", async () => {
    await seedLaptop("manager");
    go("/local/floor-plans?projectId=p1");
    const a = render(<LocalShell />);
    const rows = await a.findAllByTestId("floor-plans-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Ground floor");
    expect(a.getByTestId("lines-on-server").textContent).toContain("rooms");
    expect(a.getByTestId("floor-plans").textContent).not.toContain("Annexe plan");
    cleanup();
    go("/local/mood-boards?projectId=p1");
    const b = render(<LocalShell />);
    expect((await b.findAllByTestId("mood-boards-row"))[0]!.textContent).toContain("Living room");
    expect(b.getByTestId("lines-on-server").textContent).toContain("items");
    cleanup();
    go("/local/mood-boards/b1");
    const c = render(<LocalShell />);
    expect((await c.findByTestId("mood-board")).textContent).toContain("Warm tones");
    expect(fetchCalls).toEqual([]);
  });

  test("Knowledge Base: pages from the copy, the text is shown as text and never run as markup", async () => {
    await seedLaptop("member");
    go("/local/knowledge-base");
    const a = render(<LocalShell />);
    expect((await a.findAllByTestId("knowledge-base-row")).map((r) => r.textContent)).toEqual([expect.stringContaining("Handbook"), expect.stringContaining("Safety")]);
    cleanup();
    go("/local/knowledge-base/k2");
    const b = render(<LocalShell />);
    const content = await b.findByTestId("kb-page-content");
    expect(content.textContent).toContain("<img src=x onerror=alert(1)>Wear a helmet.");
    expect(content.querySelector("img")).toBeNull();
    expect(b.getByTestId("kb-page").textContent).toContain("Under Handbook");
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("a role that is not sent these kinds (a viewer): one calm sentence per module, no rows, no request, no dialog", async () => {
    await seedLaptop("viewer", { listed: ["cost_visibility"] });
    for (const [path, id, what] of [
      ["/local/inventory", "inventory", "stock records"], ["/local/purchase-orders", "purchase-orders", "purchase orders"], ["/local/procurement", "procurement", "procurement records"],
      ["/local/floor-plans?projectId=p1", "floor-plans", "floor plans"], ["/local/mood-boards?projectId=p1", "mood-boards", "mood boards"], ["/local/knowledge-base", "knowledge-base", "knowledge base pages"],
    ] as const) {
      go(path);
      const r = render(<LocalShell />);
      const screen = await r.findByTestId(id);
      expect(screen.getAttribute("data-state")).toBe("not_allowed");
      expect(screen.textContent).toContain(`Your role does not include the organisation's ${what}`);
      expect(screen.querySelectorAll("tr, li")).toHaveLength(0);
      cleanup();
    }
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("a kind never copied to the end says so calmly; a create page offline is the server's, not an item called 'new'", async () => {
    await seedLaptop("manager", { listed: ["warehouses"] });
    go("/local/knowledge-base");
    const a = render(<LocalShell />);
    expect((await a.findByTestId("knowledge-base")).getAttribute("data-state")).toBe("not_allowed");
    cleanup();
    go("/local/inventory/items/new");
    const b = render(<LocalShell />);
    const s = await b.findByTestId("delivery-server-only");
    expect(s.textContent).toContain("done on the server for now");
    expect(b.queryByTestId("item")).toBeNull();
    expect(fetchCalls).toEqual([]);
  });
});
