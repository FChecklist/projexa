// LOCAL-FIRST shell, group "ERP A": inventory, purchase orders, procurement, floor plans, mood boards, knowledge base -- every adapter
// reads the laptop's own copy of an ORGANISATION kind (replica-org.ts) and nothing else; none of them calls the server.
//
// WHAT THE LAPTOP HAS (compliance-tracker drizzle/0691_projexa_sync_erp_hr_kinds.sql is the authority; one allow-list of columns each):
//   inventory        warehouses, item_groups, stock_items (standard rates are MONEY), stock_entries (valuation_rate, balance_value are MONEY)
//   purchase-orders  purchase_orders (grand_total is MONEY)           procurement  requisitions, rfqs, goods_receipts, purchase_orders
//   floor-plans      floor_plans        mood-boards  mood_boards        knowledge-base  knowledge_base (published, not archived; content included)
// A role below member (viewer, client viewer ...) is never sent any of them: the manifest does not list the kind, so loadOrgLocal says
// "not_allowed" and the screen says so calmly. Money columns the server hid for the role arrive as null AND are named in the done
// marker's hidden fields: that list is the only authority here (a value a row still carries for a hidden column is dropped, never shown).
//
// HEADER ROWS ONLY. Line items (PO / receipt / requisition / RFQ lines, floor-plan rooms and placements, mood-board items) are not
// synced; nothing is drawn or counted for them, and the screens say plainly that they are on the server. Stock balances per item are not
// a kind either: the laptop shows each movement's own stored running balance, never a sum it worked out itself. Nothing here adds up
// money, quantities or totals.
//
// Replica rows are untrusted input: a row is used only when it is a plain object with a non-empty string id and the fields the screen
// needs; every field goes through the tolerant readers (string / finite number / boolean / date, anything else null -- never a 0).

import type { ShellData } from "../context";
import { loadOrgLocal } from "../../org-local";
import { moneyMasters, type Currency } from "./org-masters";
import { bool, day, field, isHidden, num, rowWithId, text, type Obj } from "./finance-local";

export type NotThere = { state: "not_allowed" } | { state: "not_synced" };
type Listed<T> = NotThere | { state: "local"; rows: T[]; hidden: string[]; syncedAt: number };

/** How many stock movements one page draws (stock_entries grows without bound: it is the only kind that does). */
export const MOVEMENTS_PAGE = 50;

const access = (data: ShellData) => ({ userId: data.userId, idb: data.idb });

/** A short label field: a non-empty string, or a finite number shown as text (document numbers are integers). */
function label(o: Obj, snake: string): string | null {
  const v = field(o, snake);
  if (typeof v === "string") return v.trim() === "" ? null : v;
  return typeof v === "number" && Number.isFinite(v) ? String(v) : null;
}

async function listKind<T>(data: ShellData, kind: string, parse: (o: Obj & { id: string }, hidden: string[]) => T | null): Promise<Listed<T>> {
  const r = await loadOrgLocal(kind, access(data));
  if (r.state !== "local") return { state: r.state };
  const rows: T[] = [];
  for (const raw of r.rows) {
    const o = rowWithId(raw);
    const row = o && parse(o, r.hiddenFields);
    if (row) rows.push(row);
  }
  return { state: "local", rows, hidden: r.hiddenFields, syncedAt: r.syncedAt };
}

async function names(data: ShellData, kind: string, nameField: string, extra?: string): Promise<Map<string, string>> {
  const r = await listKind(data, kind, (o) => {
    const n = text(o, nameField);
    if (!n) return null;
    const e = extra ? text(o, extra) : null;
    return { id: o.id, name: e ? `${n} (${e})` : n };
  });
  return new Map(r.state === "local" ? r.rows.map((x) => [x.id, x.name]) : []);
}

const byNewest = <T extends { date: string | null; createdAt: string | null; id: string }>(a: T, b: T) =>
  (b.date ?? "").localeCompare(a.date ?? "") || (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id.localeCompare(a.id);

type Money = { currencies: Map<string, Currency>; base: Currency | null };
async function currencies(data: ShellData): Promise<Money> {
  const m = await moneyMasters(access(data));
  return m.state === "local" ? { currencies: m.currencies, base: m.base } : { currencies: new Map(), base: null };
}

// â”€â”€â”€ inventory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type Warehouse = { id: string; name: string; parentName: string | null; isGroup: boolean; address: string | null };
export type Item = {
  id: string; code: string; name: string; groupName: string | null; uom: string | null; isActive: boolean; hasBatch: boolean; hasSerial: boolean;
  isStockItem: boolean | null; hsn: string | null; sellingRate: number | null; buyingRate: number | null;
};
export type Movement = {
  id: string; date: string | null; createdAt: string | null; itemName: string | null; warehouseName: string | null; voucherType: string | null;
  quantityChange: number | null; balanceQty: number | null; valuationRate: number | null; balanceValue: number | null; uom: string | null;
};
export type InventoryTab = "movements" | "warehouses" | "items";
export const INVENTORY_TABS: readonly { id: InventoryTab; label: string }[] = [
  { id: "movements", label: "Stock Movements" }, { id: "warehouses", label: "Warehouses" }, { id: "items", label: "Items" },
];

export type InventoryData =
  | (NotThere & { tab: InventoryTab })
  | { state: "local"; tab: "warehouses"; warehouses: Warehouse[]; syncedAt: number }
  | { state: "local"; tab: "items"; items: Item[]; ratesHidden: boolean; base: Currency | null; syncedAt: number }
  | { state: "local"; tab: "movements"; movements: Movement[]; total: number; page: number; pages: number; moneyHidden: boolean; base: Currency | null; syncedAt: number };

export function inventoryTab(raw: string | null | undefined): InventoryTab {
  return raw === "warehouses" || raw === "items" ? raw : "movements";
}

export async function loadInventory(data: ShellData, tabParam: string | null, pageParam: string | null = null): Promise<InventoryData> {
  const tab = inventoryTab(tabParam);
  if (tab === "warehouses") {
    const parents = await names(data, "warehouses", "warehouse_name");
    const r = await listKind(data, "warehouses", (o): Warehouse | null => {
      const name = text(o, "warehouse_name");
      if (!name) return null;
      const parent = text(o, "parent_warehouse_id");
      return { id: o.id, name, parentName: parent ? parents.get(parent) ?? null : null, isGroup: bool(o, "is_group") ?? false, address: text(o, "address") };
    });
    if (r.state !== "local") return { state: r.state, tab };
    return { state: "local", tab, warehouses: r.rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), syncedAt: r.syncedAt };
  }
  if (tab === "items") {
    const groups = await names(data, "item_groups", "group_name");
    const r = await listKind(data, "stock_items", (o, hidden): Item | null => {
      const name = text(o, "item_name");
      if (!name) return null;
      const group = text(o, "item_group_id");
      return {
        id: o.id, code: text(o, "item_code") ?? "", name, groupName: group ? groups.get(group) ?? null : null, uom: text(o, "uom"),
        isActive: bool(o, "is_active") ?? true, hasBatch: bool(o, "has_batch_no") ?? false, hasSerial: bool(o, "has_serial_no") ?? false,
        isStockItem: bool(o, "is_stock_item"), hsn: text(o, "hsn_sac_code"),
        sellingRate: isHidden(hidden, "standard_selling_rate") ? null : num(o, "standard_selling_rate"),
        buyingRate: isHidden(hidden, "standard_buying_rate") ? null : num(o, "standard_buying_rate"),
      };
    });
    if (r.state !== "local") return { state: r.state, tab };
    const money = await currencies(data);
    r.rows.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { state: "local", tab, items: r.rows, ratesHidden: isHidden(r.hidden, "standard_selling_rate") || isHidden(r.hidden, "standard_buying_rate"), base: money.base, syncedAt: r.syncedAt };
  }
  const [items, warehouses] = await Promise.all([names(data, "stock_items", "item_name", "item_code"), names(data, "warehouses", "warehouse_name")]);
  const r = await listKind(data, "stock_entries", (o, hidden): Movement | null => {
    const q = num(o, "quantity_change");
    const posted = day(o, "posting_date");
    if (q === null && !posted) return null; // neither a quantity nor a date: not a movement this screen can say anything true about
    const item = text(o, "item_id");
    const wh = text(o, "warehouse_id");
    return {
      id: o.id, date: posted, createdAt: text(o, "created_at"), itemName: item ? items.get(item) ?? null : null, warehouseName: wh ? warehouses.get(wh) ?? null : null,
      voucherType: text(o, "voucher_type"), quantityChange: q, balanceQty: num(o, "balance_qty"), uom: text(o, "transaction_uom"),
      valuationRate: isHidden(hidden, "valuation_rate") ? null : num(o, "valuation_rate"),
      balanceValue: isHidden(hidden, "balance_value") ? null : num(o, "balance_value"),
    };
  });
  if (r.state !== "local") return { state: r.state, tab };
  const sorted = r.rows.sort(byNewest);
  const pages = Math.max(1, Math.ceil(sorted.length / MOVEMENTS_PAGE));
  const asked = Number(pageParam);
  const page = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, pages) : 1;
  const money = await currencies(data);
  return {
    state: "local", tab, movements: sorted.slice((page - 1) * MOVEMENTS_PAGE, page * MOVEMENTS_PAGE), total: sorted.length, page, pages,
    moneyHidden: isHidden(r.hidden, "valuation_rate") || isHidden(r.hidden, "balance_value"), base: money.base, syncedAt: r.syncedAt,
  };
}

export type ItemObjectData = NotThere | { state: "not_found" } | { state: "local"; item: Item; ratesHidden: boolean; base: Currency | null; syncedAt: number };

/** One item's header (its own page online adds batches and stock; those stay on the server). */
export async function loadItemObject(data: ShellData, id: string): Promise<ItemObjectData> {
  const r = await loadInventory(data, "items");
  if (r.state !== "local" || r.tab !== "items") return r.state === "local" ? { state: "not_synced" } : { state: r.state };
  const item = r.items.find((i) => i.id === id);
  return item ? { state: "local", item, ratesHidden: r.ratesHidden, base: r.base, syncedAt: r.syncedAt } : { state: "not_found" };
}

// â”€â”€â”€ purchase orders and procurement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type PurchaseOrder = {
  id: string; number: string | null; vendor: string | null; date: string | null; createdAt: string | null; expected: string | null; status: string | null;
  total: number | null; currency: Currency | null; projectId: string | null;
};
export type PurchaseOrdersData = NotThere | { state: "local"; orders: PurchaseOrder[]; totalHidden: boolean; base: Currency | null; syncedAt: number };

async function loadOrders(data: ShellData): Promise<PurchaseOrdersData> {
  const [vendors, money] = await Promise.all([names(data, "vendors", "supplier_name"), currencies(data)]);
  const r = await listKind(data, "purchase_orders", (o, hidden): PurchaseOrder | null => {
    const number = label(o, "po_number");
    const date = day(o, "order_date");
    if (!number && !date) return null;
    const v = text(o, "supplier_id");
    const cur = text(o, "currency_id");
    return {
      id: o.id, number, vendor: v ? vendors.get(v) ?? null : null, date, createdAt: text(o, "created_at"), expected: day(o, "expected_delivery_date"), status: text(o, "status"),
      total: isHidden(hidden, "grand_total") ? null : num(o, "grand_total"), currency: cur ? money.currencies.get(cur) ?? null : null, projectId: text(o, "project_id"),
    };
  });
  if (r.state !== "local") return { state: r.state };
  return { state: "local", orders: r.rows.sort(byNewest), totalHidden: isHidden(r.hidden, "grand_total"), base: money.base, syncedAt: r.syncedAt };
}

/** The purchase-order list, optionally narrowed to the selected project (online the same list is the organisation's; the shell's project is only a filter here). */
export const loadPurchaseOrders = (data: ShellData) => loadOrders(data);

export type PurchaseOrderObjectData = NotThere | { state: "not_found" } | { state: "local"; order: PurchaseOrder; totalHidden: boolean; base: Currency | null; syncedAt: number };
export async function loadPurchaseOrderObject(data: ShellData, id: string): Promise<PurchaseOrderObjectData> {
  const r = await loadOrders(data);
  if (r.state !== "local") return r;
  const order = r.orders.find((o) => o.id === id);
  return order ? { state: "local", order, totalHidden: r.totalHidden, base: r.base, syncedAt: r.syncedAt } : { state: "not_found" };
}

export type Requisition = { id: string; number: string | null; purpose: string | null; department: string | null; date: string | null; createdAt: string | null; status: string | null };
export type Rfq = { id: string; number: string | null; requisition: string | null; date: string | null; createdAt: string | null; status: string | null };
export type Receipt = { id: string; number: string | null; vendor: string | null; purchaseOrder: string | null; date: string | null; createdAt: string | null; status: string | null; putaway: string | null };
export type ProcurementTab = "requisitions" | "rfqs" | "purchase-orders" | "goods-receipts" | "quotations";
export const PROCUREMENT_TABS: readonly { id: ProcurementTab; label: string }[] = [
  { id: "requisitions", label: "1. Requisitions" }, { id: "rfqs", label: "2. RFQs" }, { id: "quotations", label: "3. Quotations" },
  { id: "purchase-orders", label: "4. Purchase Orders" }, { id: "goods-receipts", label: "5. Goods Receipts" },
];
export function procurementTab(raw: string | null | undefined): ProcurementTab {
  return PROCUREMENT_TABS.some((t) => t.id === raw) ? (raw as ProcurementTab) : "requisitions";
}

export type ProcurementData =
  | (NotThere & { tab: ProcurementTab })
  | { state: "local"; tab: "quotations" }
  | { state: "local"; tab: "requisitions"; rows: Requisition[]; syncedAt: number }
  | { state: "local"; tab: "rfqs"; rows: Rfq[]; syncedAt: number }
  | { state: "local"; tab: "goods-receipts"; rows: Receipt[]; syncedAt: number }
  | { state: "local"; tab: "purchase-orders"; orders: PurchaseOrder[]; totalHidden: boolean; base: Currency | null; syncedAt: number };

async function requisitions(data: ShellData): Promise<Listed<Requisition>> {
  const depts = await names(data, "departments", "name");
  return listKind(data, "requisitions", (o): Requisition | null => {
    const number = label(o, "requisition_number");
    const date = day(o, "posting_date");
    if (!number && !date) return null;
    const d = text(o, "department_id");
    return { id: o.id, number, purpose: text(o, "purpose"), department: d ? depts.get(d) ?? null : null, date, createdAt: text(o, "created_at"), status: text(o, "status") };
  });
}
async function rfqs(data: ShellData): Promise<Listed<Rfq>> {
  const reqs = await requisitions(data);
  const numbers = new Map(reqs.state === "local" ? reqs.rows.map((r) => [r.id, r.number ?? ""]) : []);
  return listKind(data, "rfqs", (o): Rfq | null => {
    const number = label(o, "rfq_number");
    const date = day(o, "posting_date");
    if (!number && !date) return null;
    const q = text(o, "requisition_id");
    return { id: o.id, number, requisition: q ? numbers.get(q) || null : null, date, createdAt: text(o, "created_at"), status: text(o, "status") };
  });
}
async function receipts(data: ShellData): Promise<Listed<Receipt>> {
  const [vendors, orders] = await Promise.all([names(data, "vendors", "supplier_name"), loadOrders(data)]);
  const poNumbers = new Map(orders.state === "local" ? orders.orders.map((o) => [o.id, o.number ?? ""]) : []);
  return listKind(data, "goods_receipts", (o): Receipt | null => {
    const number = label(o, "receipt_number");
    const date = day(o, "posting_date");
    if (!number && !date) return null;
    const v = text(o, "supplier_id");
    const po = text(o, "purchase_order_id");
    return { id: o.id, number, vendor: v ? vendors.get(v) ?? null : null, purchaseOrder: po ? poNumbers.get(po) || null : null, date, createdAt: text(o, "created_at"), status: text(o, "status"), putaway: text(o, "putaway_status") };
  });
}

export async function loadProcurement(data: ShellData, tabParam: string | null): Promise<ProcurementData> {
  const tab = procurementTab(tabParam);
  if (tab === "quotations") return { state: "local", tab }; // supplier quotations are sealed and have no kind: nothing to read
  if (tab === "purchase-orders") {
    const r = await loadOrders(data);
    return r.state === "local" ? { state: "local", tab, orders: r.orders, totalHidden: r.totalHidden, base: r.base, syncedAt: r.syncedAt } : { state: r.state, tab };
  }
  if (tab === "rfqs") {
    const r = await rfqs(data);
    return r.state === "local" ? { state: "local", tab, rows: r.rows.sort(byNewest), syncedAt: r.syncedAt } : { state: r.state, tab };
  }
  if (tab === "goods-receipts") {
    const r = await receipts(data);
    return r.state === "local" ? { state: "local", tab, rows: r.rows.sort(byNewest), syncedAt: r.syncedAt } : { state: r.state, tab };
  }
  const r = await requisitions(data);
  return r.state === "local" ? { state: "local", tab, rows: r.rows.sort(byNewest), syncedAt: r.syncedAt } : { state: r.state, tab };
}

export type ProcurementDoc =
  | { kind: "requisition"; row: Requisition }
  | { kind: "rfq"; row: Rfq }
  | { kind: "goods-receipt"; row: Receipt };
export type ProcurementObjectData = NotThere | { state: "not_found" } | { state: "local"; doc: ProcurementDoc; syncedAt: number };

/** One requisition / RFQ / goods receipt header (its lines are not synced). */
export async function loadProcurementObject(data: ShellData, kind: ProcurementDoc["kind"], id: string): Promise<ProcurementObjectData> {
  if (kind === "requisition") {
    const r = await requisitions(data);
    if (r.state !== "local") return { state: r.state };
    const row = r.rows.find((x) => x.id === id);
    return row ? { state: "local", doc: { kind, row }, syncedAt: r.syncedAt } : { state: "not_found" };
  }
  if (kind === "rfq") {
    const r = await rfqs(data);
    if (r.state !== "local") return { state: r.state };
    const row = r.rows.find((x) => x.id === id);
    return row ? { state: "local", doc: { kind, row }, syncedAt: r.syncedAt } : { state: "not_found" };
  }
  const r = await receipts(data);
  if (r.state !== "local") return { state: r.state };
  const row = r.rows.find((x) => x.id === id);
  return row ? { state: "local", doc: { kind, row }, syncedAt: r.syncedAt } : { state: "not_found" };
}

// â”€â”€â”€ floor plans, mood boards (header rows; online both are per project) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type FloorPlan = { id: string; projectId: string | null; name: string; level: string | null; status: string | null; createdAt: string | null };
export type MoodBoard = { id: string; projectId: string | null; title: string; room: string | null; description: string | null; status: string | null; createdAt: string | null };
export type FloorPlansData = NotThere | { state: "no_project" } | { state: "local"; plans: FloorPlan[]; projectName: string | null; syncedAt: number };
export type MoodBoardsData = NotThere | { state: "no_project" } | { state: "local"; boards: MoodBoard[]; projectName: string | null; syncedAt: number };

const forProject = <T extends { projectId: string | null }>(rows: T[], projectId: string) => rows.filter((r) => r.projectId === projectId);
const projectLabel = (data: ShellData, id: string) => data.projects.find((p) => p.id === id)?.name ?? null;
const newestFirst = (a: { createdAt: string | null; id: string }, b: { createdAt: string | null; id: string }) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id.localeCompare(a.id);

const floorPlanRows = (data: ShellData) =>
  listKind(data, "floor_plans", (o): FloorPlan | null => {
    const name = text(o, "name");
    return name ? { id: o.id, projectId: text(o, "project_id"), name, level: text(o, "floor_level"), status: text(o, "status"), createdAt: text(o, "created_at") } : null;
  });

export async function loadFloorPlans(data: ShellData, projectId: string | null): Promise<FloorPlansData> {
  if (!projectId) return { state: "no_project" };
  const r = await floorPlanRows(data);
  if (r.state !== "local") return { state: r.state };
  return { state: "local", plans: forProject(r.rows, projectId).sort(newestFirst), projectName: projectLabel(data, projectId), syncedAt: r.syncedAt };
}

export type FloorPlanObjectData = NotThere | { state: "not_found" } | { state: "local"; plan: FloorPlan; projectName: string | null; syncedAt: number };
export async function loadFloorPlanObject(data: ShellData, id: string): Promise<FloorPlanObjectData> {
  const r = await floorPlanRows(data);
  if (r.state !== "local") return { state: r.state };
  const plan = r.rows.find((p) => p.id === id);
  return plan ? { state: "local", plan, projectName: plan.projectId ? projectLabel(data, plan.projectId) : null, syncedAt: r.syncedAt } : { state: "not_found" };
}

export async function loadMoodBoards(data: ShellData, projectId: string | null): Promise<MoodBoardsData> {
  if (!projectId) return { state: "no_project" };
  const r = await moodBoardRows(data);
  if (r.state !== "local") return { state: r.state };
  return { state: "local", boards: forProject(r.rows, projectId).sort(newestFirst), projectName: projectLabel(data, projectId), syncedAt: r.syncedAt };
}
const moodBoardRows = (data: ShellData) =>
  listKind(data, "mood_boards", (o): MoodBoard | null => {
    const title = text(o, "title");
    return title ? { id: o.id, projectId: text(o, "project_id"), title, room: text(o, "room_or_area"), description: text(o, "description"), status: text(o, "status"), createdAt: text(o, "created_at") } : null;
  });

export type MoodBoardObjectData = NotThere | { state: "not_found" } | { state: "local"; board: MoodBoard; projectName: string | null; syncedAt: number };
export async function loadMoodBoardObject(data: ShellData, id: string): Promise<MoodBoardObjectData> {
  const r = await moodBoardRows(data);
  if (r.state !== "local") return { state: r.state };
  const board = r.rows.find((b) => b.id === id);
  return board ? { state: "local", board, projectName: board.projectId ? projectLabel(data, board.projectId) : null, syncedAt: r.syncedAt } : { state: "not_found" };
}

// â”€â”€â”€ knowledge base (organisation-wide, no project) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type KbPage = { id: string; title: string; slug: string | null; version: number | null; content: string | null; parentTitle: string | null; updatedAt: string | null };
export type KnowledgeBaseData = NotThere | { state: "local"; pages: KbPage[]; syncedAt: number };
export type KbObjectData = NotThere | { state: "not_found" } | { state: "local"; page: KbPage; syncedAt: number };

async function kbPages(data: ShellData): Promise<Listed<KbPage>> {
  const raw = await listKind(data, "knowledge_base", (o): (KbPage & { parentId: string | null }) | null => {
    const title = text(o, "title");
    if (!title) return null;
    return { id: o.id, parentId: text(o, "parent_page_id"), parentTitle: null, title, slug: text(o, "slug"), version: num(o, "version"), content: text(o, "content"), updatedAt: text(o, "updated_at") ?? text(o, "created_at") };
  });
  if (raw.state !== "local") return raw;
  const titles = new Map(raw.rows.map((p) => [p.id, p.title]));
  const rows: KbPage[] = raw.rows.map(({ parentId, ...p }) => ({ ...p, parentTitle: parentId ? titles.get(parentId) ?? null : null }));
  return { ...raw, rows };
}

export async function loadKnowledgeBase(data: ShellData): Promise<KnowledgeBaseData> {
  const r = await kbPages(data);
  return r.state === "local" ? { state: "local", pages: r.rows.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)), syncedAt: r.syncedAt } : { state: r.state };
}

export async function loadKbPage(data: ShellData, id: string): Promise<KbObjectData> {
  const r = await kbPages(data);
  if (r.state !== "local") return { state: r.state };
  const page = r.rows.find((p) => p.id === id);
  return page ? { state: "local", page, syncedAt: r.syncedAt } : { state: "not_found" };
}
