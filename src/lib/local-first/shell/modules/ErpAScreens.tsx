"use client";

// LOCAL-FIRST shell, group "ERP A": the screens of inventory, purchase orders, procurement, floor plans, mood boards and the knowledge
// base, drawn from the laptop's own copy (erp-a-adapters.ts has the rules). Everything is read-only: creating or changing anything, line
// items, stock balances per item and supplier quotations are on the server, and each screen says so in one calm sentence (with a link
// while online). Money is shown exactly as the server sent it; a value the server hid for the role reads "Hidden for your role"; nothing
// is added up here.

import { Fragment, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAmount } from "@/lib/boq-helpers";
import { orgStateWords } from "../../org-local";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Screen, ServerOnly } from "./DeliveryParts";
import { formatInBase, type Currency } from "./org-masters";
import {
  INVENTORY_TABS, MOVEMENTS_PAGE, PROCUREMENT_TABS,
  type FloorPlanObjectData, type FloorPlansData, type InventoryData, type ItemObjectData, type KbObjectData, type KnowledgeBaseData,
  type MoodBoardObjectData, type MoodBoardsData, type NotThere, type ProcurementData, type ProcurementObjectData, type PurchaseOrder,
  type PurchaseOrderObjectData, type PurchaseOrdersData,
} from "./erp-a-adapters";

const HIDDEN = <span className="text-px-muted" data-hidden="1">Hidden for your role</span>;

/** Money as the server sent it, in the document's own currency when the laptop has it, else the base currency, else a bare number. */
function Cash({ value, hidden, currency, base }: { value: number | null; hidden: boolean; currency?: Currency | null; base: Currency | null }) {
  if (hidden) return HIDDEN;
  if (value === null) return <>{DASH}</>;
  return <>{formatInBase(value, currency ?? base) ?? formatAmount(value)}</>;
}

const qty = (v: number | null, uom?: string | null) => (v === null ? DASH : `${v.toLocaleString("en-IN", { maximumFractionDigits: 3 })}${uom ? ` ${uom}` : ""}`);
const plain = (v: string | null) => v ?? DASH;

function NotThereScreen({ testId, title, state, what }: { testId: string; title: string; state: NotThere["state"]; what: string }) {
  return (
    <Screen testId={testId} state={state} title={title}>
      <p className="mt-3 text-sm text-px-muted">{orgStateWords(state, what)}</p>
    </Screen>
  );
}

function NoProject({ testId, title }: { testId: string; title: string }) {
  return (
    <Screen testId={testId} state="no_project" title={title}>
      <p className="mt-3 text-sm text-px-muted">There is no project on this laptop yet. Open PROJEXA once while you are online and your projects will be copied here.</p>
    </Screen>
  );
}

function Missing({ testId, title, what, back }: { testId: string; title: string; what: string; back: { href: string; label: string } }) {
  return (
    <Screen testId={testId} state="not_found" title={title}>
      <p className="mt-3 text-sm text-px-muted">This {what} is not in the copy on this laptop. It may not have been copied yet, or it may no longer exist.</p>
      <p className="mt-3 text-sm"><a className="text-px-ink underline underline-offset-2" href={back.href}>{back.label}</a></p>
    </Screen>
  );
}

function TabLinks({ tabs, active, base }: { tabs: readonly { id: string; label: string }[]; active: string; base: string }) {
  return (
    <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Sections">
      {tabs.map((t) => (
        <a key={t.id} href={`${base}?tab=${t.id}`} aria-current={t.id === active ? "page" : undefined}
          className={t.id === active ? "rounded-md bg-px-ink px-3 py-1 text-white" : "rounded-md border border-black/10 px-3 py-1 text-px-ink"}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

function Grid({ heads, children, testId }: { heads: string[]; children: ReactNode; testId: string }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-black/10 bg-white" data-testid={testId}>
      <Table>
        <TableHeader><TableRow>{heads.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

const Empty = ({ testId, text }: { testId: string; text: string }) => <p className="mt-4 text-sm text-px-muted" data-testid={testId}>{text}</p>;
const Back = ({ href, label }: { href: string; label: string }) => <p className="mt-4 text-sm"><a className="text-px-ink underline underline-offset-2" href={href}>{label}</a></p>;

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="mt-4 grid max-w-xl grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-px-muted">{k}</dt><dd>{v}</dd></Fragment>))}
    </dl>
  );
}

// ─── inventory ──────────────────────────────────────────────────────────────────────────────────────────────────

export function InventoryScreen({ shell, data }: ShellScreenProps<InventoryData>) {
  if (data.state !== "local") return <NotThereScreen testId="inventory" title="Inventory" state={data.state} what="stock records" />;
  const server = <ServerOnly shell={shell} what="Recording stock movements, adding warehouses or items, and the stock balance per item are on the server." path="/inventory" />;
  return (
    <Screen testId="inventory" state="local" title="Inventory">
      <CopyNote testId="inventory-copy-note" syncedAt={data.syncedAt} />
      {server}
      <TabLinks tabs={INVENTORY_TABS} active={data.tab} base="/inventory" />
      {data.tab === "warehouses" ? (
        data.warehouses.length === 0 ? <Empty testId="inventory-empty" text="No warehouses yet." /> : (
          <Grid testId="inventory-warehouses" heads={["Warehouse Name", "Inside", "Address"]}>
            {data.warehouses.map((w) => (
              <TableRow key={w.id} data-testid="inventory-row">
                <TableCell className="font-medium">{w.name}{w.isGroup ? " (group)" : ""}</TableCell>
                <TableCell className="text-px-muted">{plain(w.parentName)}</TableCell>
                <TableCell className="text-px-muted">{plain(w.address)}</TableCell>
              </TableRow>
            ))}
          </Grid>
        )
      ) : data.tab === "items" ? (
        data.items.length === 0 ? <Empty testId="inventory-empty" text="No items yet." /> : (
          <Grid testId="inventory-items" heads={["Code", "Name", "Group", "UOM", "Batch Tracked", "Buying Rate", "Selling Rate"]}>
            {data.items.map((i) => (
              <TableRow key={i.id} data-testid="inventory-row">
                <TableCell className="font-medium"><a className="underline underline-offset-2" href={`/inventory/items/${encodeURIComponent(i.id)}`}>{i.code || DASH}</a></TableCell>
                <TableCell>{i.name}{i.isActive ? "" : " (inactive)"}</TableCell>
                <TableCell className="text-px-muted">{plain(i.groupName)}</TableCell>
                <TableCell className="text-px-muted">{plain(i.uom)}</TableCell>
                <TableCell>{i.hasBatch ? "yes" : "no"}</TableCell>
                <TableCell><Cash value={i.buyingRate} hidden={data.ratesHidden} base={data.base} /></TableCell>
                <TableCell><Cash value={i.sellingRate} hidden={data.ratesHidden} base={data.base} /></TableCell>
              </TableRow>
            ))}
          </Grid>
        )
      ) : (
        <>
          <p className="mt-3 text-xs text-px-muted" data-testid="inventory-page-note">
            Newest first, {MOVEMENTS_PAGE} to a page: showing {data.total === 0 ? 0 : (data.page - 1) * MOVEMENTS_PAGE + 1}
            {" to "}{Math.min(data.page * MOVEMENTS_PAGE, data.total)} of {data.total} stock movements on this laptop. Each balance is the one the server recorded with that movement.
          </p>
          {data.movements.length === 0 ? <Empty testId="inventory-empty" text="No stock movements yet." /> : (
            <Grid testId="inventory-movements" heads={["Date", "Item", "Warehouse", "Type", "Qty Change", "Balance Qty", "Rate", "Balance Value"]}>
              {data.movements.map((m) => (
                <TableRow key={m.id} data-testid="inventory-row">
                  <TableCell>{plain(m.date)}</TableCell>
                  <TableCell className="font-medium">{plain(m.itemName)}</TableCell>
                  <TableCell className="text-px-muted">{plain(m.warehouseName)}</TableCell>
                  <TableCell className="text-px-muted">{m.voucherType ? m.voucherType.replaceAll("_", " ") : DASH}</TableCell>
                  <TableCell>{qty(m.quantityChange, m.uom)}</TableCell>
                  <TableCell>{qty(m.balanceQty, m.uom)}</TableCell>
                  <TableCell><Cash value={m.valuationRate} hidden={data.moneyHidden} base={data.base} /></TableCell>
                  <TableCell><Cash value={m.balanceValue} hidden={data.moneyHidden} base={data.base} /></TableCell>
                </TableRow>
              ))}
            </Grid>
          )}
          {data.pages > 1 ? (
            <p className="mt-3 flex gap-4 text-sm" data-testid="inventory-pager">
              {data.page > 1 ? <a className="underline underline-offset-2" href={`/inventory?tab=movements&page=${data.page - 1}`}>Newer</a> : null}
              {data.page < data.pages ? <a className="underline underline-offset-2" href={`/inventory?tab=movements&page=${data.page + 1}`}>Older</a> : null}
            </p>
          ) : null}
        </>
      )}
    </Screen>
  );
}

export function ItemObjectScreen({ shell, data }: ShellScreenProps<ItemObjectData>) {
  if (data.state === "not_allowed" || data.state === "not_synced") return <NotThereScreen testId="item" title="Item" state={data.state} what="stock records" />;
  if (data.state === "not_found") return <Missing testId="item" title="Item" what="item" back={{ href: "/inventory?tab=items", label: "Back to items" }} />;
  const i = data.item;
  return (
    <Screen testId="item" state="local" title={i.name}>
      <CopyNote testId="item-copy-note" syncedAt={data.syncedAt} />
      <ServerOnly shell={shell} what="Editing the item, its batches and its stock are on the server." path={`/inventory/items/${i.id}`} />
      <Facts rows={[
        ["Code", plain(i.code || null)], ["Group", plain(i.groupName)], ["Unit", plain(i.uom)], ["Status", i.isActive ? "active" : "inactive"],
        ["Batch tracked", i.hasBatch ? "yes" : "no"], ["Serial tracked", i.hasSerial ? "yes" : "no"], ["HSN / SAC", plain(i.hsn)],
        ["Buying rate", <Cash key="b" value={i.buyingRate} hidden={data.ratesHidden} base={data.base} />],
        ["Selling rate", <Cash key="s" value={i.sellingRate} hidden={data.ratesHidden} base={data.base} />],
      ]} />
      <Back href="/inventory?tab=items" label="Back to items" />
    </Screen>
  );
}

// ─── purchase orders and procurement ────────────────────────────────────────────────────────────────────────────

const status = (s: string | null) => (s ? s.replaceAll("_", " ") : DASH);
const orderTotal = (o: PurchaseOrder, hidden: boolean, base: Currency | null) => <Cash value={o.total} hidden={hidden} currency={o.currency} base={base} />;

export function PurchaseOrdersScreen({ shell, data }: ShellScreenProps<PurchaseOrdersData>) {
  if (data.state !== "local") return <NotThereScreen testId="purchase-orders" title="Purchase Orders" state={data.state} what="purchase orders" />;
  return (
    <Screen testId="purchase-orders" state="local" title="Purchase Orders">
      <CopyNote testId="purchase-orders-copy-note" syncedAt={data.syncedAt} />
      <ServerOnly shell={shell} what="Creating a purchase order, and its line items, are on the server." path="/purchase-orders" />
      <OrdersTable orders={data.orders} totalHidden={data.totalHidden} base={data.base} />
    </Screen>
  );
}

function OrdersTable({ orders, totalHidden, base }: { orders: PurchaseOrder[]; totalHidden: boolean; base: Currency | null }) {
  if (orders.length === 0) return <Empty testId="purchase-orders-empty" text="No purchase orders yet." />;
  return (
    <Grid testId="purchase-orders-table" heads={["#", "Vendor", "Order Date", "Total", "Status"]}>
      {orders.map((o) => (
        <TableRow key={o.id} data-testid="purchase-orders-row">
          <TableCell className="font-medium"><a className="underline underline-offset-2" href={`/procurement/purchase-orders/${encodeURIComponent(o.id)}`}>PO-{o.number ?? DASH}</a></TableCell>
          <TableCell className="text-px-muted">{plain(o.vendor)}</TableCell>
          <TableCell className="text-px-muted">{plain(o.date)}</TableCell>
          <TableCell className="text-px-muted">{orderTotal(o, totalHidden, base)}</TableCell>
          <TableCell>{status(o.status)}</TableCell>
        </TableRow>
      ))}
    </Grid>
  );
}

export function PurchaseOrderObjectScreen({ shell, data }: ShellScreenProps<PurchaseOrderObjectData>) {
  if (data.state === "not_allowed" || data.state === "not_synced") return <NotThereScreen testId="purchase-order" title="Purchase Order" state={data.state} what="purchase orders" />;
  if (data.state === "not_found") return <Missing testId="purchase-order" title="Purchase Order" what="purchase order" back={{ href: "/procurement?tab=purchase-orders", label: "Back to purchase orders" }} />;
  const o = data.order;
  return (
    <Screen testId="purchase-order" state="local" title={`Purchase Order PO-${o.number ?? DASH}`}>
      <CopyNote testId="purchase-order-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-3 text-sm text-px-muted" data-testid="lines-on-server">Only the order&apos;s header is on this laptop. Its line items are on the server.</p>
      <ServerOnly shell={shell} what="Submitting, receiving goods against this order, and its line items are on the server." path={`/procurement/purchase-orders/${o.id}`} />
      <Facts rows={[
        ["Vendor", plain(o.vendor)], ["Order date", plain(o.date)], ["Expected delivery", plain(o.expected)], ["Status", status(o.status)],
        ["Total", orderTotal(o, data.totalHidden, data.base)],
      ]} />
      <Back href="/procurement?tab=purchase-orders" label="Back to purchase orders" />
    </Screen>
  );
}

export function ProcurementScreen({ shell, data }: ShellScreenProps<ProcurementData>) {
  if (data.state !== "local") return <NotThereScreen testId="procurement" title="Procurement" state={data.state} what="procurement records" />;
  return (
    <Screen testId="procurement" state="local" title="Procurement">
      {"syncedAt" in data ? <CopyNote testId="procurement-copy-note" syncedAt={data.syncedAt} /> : null}
      <ServerOnly shell={shell} what="Raising a requisition, RFQ, quotation or goods receipt, and the line items of each, are on the server." path="/procurement" />
      <TabLinks tabs={PROCUREMENT_TABS} active={data.tab} base="/procurement" />
      {data.tab === "quotations" ? (
        <p className="mt-4 text-sm text-px-muted" data-testid="procurement-quotations">Supplier quotations are kept on the server, not on this laptop.</p>
      ) : data.tab === "purchase-orders" ? (
        <OrdersTable orders={data.orders} totalHidden={data.totalHidden} base={data.base} />
      ) : data.tab === "requisitions" ? (
        data.rows.length === 0 ? <Empty testId="procurement-empty" text="No purchase requisitions yet." /> : (
          <Grid testId="procurement-table" heads={["#", "Purpose", "Department", "Date", "Status"]}>
            {data.rows.map((r) => (
              <TableRow key={r.id} data-testid="procurement-row">
                <TableCell className="font-medium"><a className="underline underline-offset-2" href={`/procurement/requisitions/${encodeURIComponent(r.id)}`}>PR-{r.number ?? DASH}</a></TableCell>
                <TableCell className="text-px-muted">{plain(r.purpose)}</TableCell>
                <TableCell className="text-px-muted">{plain(r.department)}</TableCell>
                <TableCell className="text-px-muted">{plain(r.date)}</TableCell>
                <TableCell>{status(r.status)}</TableCell>
              </TableRow>
            ))}
          </Grid>
        )
      ) : data.tab === "rfqs" ? (
        data.rows.length === 0 ? <Empty testId="procurement-empty" text="No RFQs yet." /> : (
          <Grid testId="procurement-table" heads={["#", "From Requisition", "Date", "Status"]}>
            {data.rows.map((r) => (
              <TableRow key={r.id} data-testid="procurement-row">
                <TableCell className="font-medium"><a className="underline underline-offset-2" href={`/procurement/rfqs/${encodeURIComponent(r.id)}`}>RFQ-{r.number ?? DASH}</a></TableCell>
                <TableCell className="text-px-muted">{r.requisition ? `PR-${r.requisition}` : DASH}</TableCell>
                <TableCell className="text-px-muted">{plain(r.date)}</TableCell>
                <TableCell>{status(r.status)}</TableCell>
              </TableRow>
            ))}
          </Grid>
        )
      ) : data.rows.length === 0 ? <Empty testId="procurement-empty" text="No goods receipts recorded yet." /> : (
        <Grid testId="procurement-table" heads={["#", "Vendor", "Purchase Order", "Date", "Status"]}>
          {data.rows.map((r) => (
            <TableRow key={r.id} data-testid="procurement-row">
              <TableCell className="font-medium"><a className="underline underline-offset-2" href={`/procurement/goods-receipts/${encodeURIComponent(r.id)}`}>GRN-{r.number ?? DASH}</a></TableCell>
              <TableCell>{plain(r.vendor)}</TableCell>
              <TableCell className="text-px-muted">{r.purchaseOrder ? `PO-${r.purchaseOrder}` : DASH}</TableCell>
              <TableCell className="text-px-muted">{plain(r.date)}</TableCell>
              <TableCell>{status(r.status)}</TableCell>
            </TableRow>
          ))}
        </Grid>
      )}
    </Screen>
  );
}

export function ProcurementObjectScreen({ shell, data }: ShellScreenProps<ProcurementObjectData>) {
  if (data.state === "not_allowed" || data.state === "not_synced") return <NotThereScreen testId="procurement-doc" title="Procurement" state={data.state} what="procurement records" />;
  const back = { href: "/procurement", label: "Back to procurement" };
  if (data.state === "not_found") return <Missing testId="procurement-doc" title="Procurement" what="document" back={back} />;
  const d = data.doc;
  const [title, path, rows]: [string, string, [string, ReactNode][]] =
    d.kind === "requisition"
      ? [`Requisition PR-${d.row.number ?? DASH}`, `/procurement/requisitions/${d.row.id}`, [["Purpose", plain(d.row.purpose)], ["Department", plain(d.row.department)], ["Date", plain(d.row.date)], ["Status", status(d.row.status)]]]
      : d.kind === "rfq"
        ? [`RFQ-${d.row.number ?? DASH}`, `/procurement/rfqs/${d.row.id}`, [["From requisition", d.row.requisition ? `PR-${d.row.requisition}` : DASH], ["Date", plain(d.row.date)], ["Status", status(d.row.status)]]]
        : [`Goods Receipt GRN-${d.row.number ?? DASH}`, `/procurement/goods-receipts/${d.row.id}`, [["Vendor", plain(d.row.vendor)], ["Purchase order", d.row.purchaseOrder ? `PO-${d.row.purchaseOrder}` : DASH], ["Date", plain(d.row.date)], ["Status", status(d.row.status)], ["Put-away", status(d.row.putaway)]]];
  return (
    <Screen testId="procurement-doc" state="local" title={title}>
      <CopyNote testId="procurement-doc-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-3 text-sm text-px-muted" data-testid="lines-on-server">Only the header is on this laptop. The line items{d.kind === "rfq" ? " and the invited vendors" : ""} are on the server.</p>
      <ServerOnly shell={shell} what="Submitting, sending, posting to stock and the line items are on the server." path={path} />
      <Facts rows={rows} />
      <Back {...back} />
    </Screen>
  );
}

// ─── floor plans, mood boards ───────────────────────────────────────────────────────────────────────────────────

export function FloorPlansScreen({ shell, data }: ShellScreenProps<FloorPlansData>) {
  if (data.state === "no_project") return <NoProject testId="floor-plans" title="Floor Plans" />;
  if (data.state !== "local") return <NotThereScreen testId="floor-plans" title="Floor Plans" state={data.state} what="floor plans" />;
  return (
    <Screen testId="floor-plans" state="local" title="Floor Plans">
      <CopyNote testId="floor-plans-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-3 text-sm text-px-muted" data-testid="lines-on-server">Only each plan&apos;s name, level and status are on this laptop. The rooms, furniture placements and the walkthrough are on the server.</p>
      <ServerOnly shell={shell} what="Creating or editing a floor plan is on the server." path="/floor-plans" />
      {data.plans.length === 0 ? <Empty testId="floor-plans-empty" text="No floor plans yet." /> : (
        <Grid testId="floor-plans-table" heads={["Plan", "Level", "Status"]}>
          {data.plans.map((p) => (
            <TableRow key={p.id} data-testid="floor-plans-row">
              <TableCell className="font-medium"><a className="underline underline-offset-2" href={`/floor-plans/${encodeURIComponent(p.id)}`}>{p.name}</a></TableCell>
              <TableCell className="text-px-muted">{plain(p.level)}</TableCell>
              <TableCell>{plain(p.status)}</TableCell>
            </TableRow>
          ))}
        </Grid>
      )}
    </Screen>
  );
}

export function FloorPlanObjectScreen({ shell, data }: ShellScreenProps<FloorPlanObjectData>) {
  if (data.state === "not_allowed" || data.state === "not_synced") return <NotThereScreen testId="floor-plan" title="Floor Plan" state={data.state} what="floor plans" />;
  if (data.state === "not_found") return <Missing testId="floor-plan" title="Floor Plan" what="floor plan" back={{ href: "/floor-plans", label: "Back to floor plans" }} />;
  const p = data.plan;
  return (
    <Screen testId="floor-plan" state="local" title={p.name}>
      <CopyNote testId="floor-plan-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-3 text-sm text-px-muted" data-testid="lines-on-server">The rooms and furniture placements of this plan, and its walkthrough, are on the server.</p>
      <ServerOnly shell={shell} what="Editing the plan and its walkthrough are on the server." path={`/floor-plans/${p.id}`} />
      <Facts rows={[["Project", plain(data.projectName)], ["Level", plain(p.level)], ["Status", plain(p.status)]]} />
      <Back href="/floor-plans" label="Back to floor plans" />
    </Screen>
  );
}

export function MoodBoardsScreen({ shell, data }: ShellScreenProps<MoodBoardsData>) {
  if (data.state === "no_project") return <NoProject testId="mood-boards" title="Mood Boards" />;
  if (data.state !== "local") return <NotThereScreen testId="mood-boards" title="Mood Boards" state={data.state} what="mood boards" />;
  return (
    <Screen testId="mood-boards" state="local" title="Mood Boards">
      <CopyNote testId="mood-boards-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-3 text-sm text-px-muted" data-testid="lines-on-server">Only each board&apos;s title, area and status are on this laptop. The items pinned to a board are on the server.</p>
      <ServerOnly shell={shell} what="Creating or editing a mood board is on the server." path="/mood-boards" />
      {data.boards.length === 0 ? <Empty testId="mood-boards-empty" text="No mood boards yet." /> : (
        <Grid testId="mood-boards-table" heads={["Board", "Room or area", "Status"]}>
          {data.boards.map((b) => (
            <TableRow key={b.id} data-testid="mood-boards-row">
              <TableCell className="font-medium"><a className="underline underline-offset-2" href={`/mood-boards/${encodeURIComponent(b.id)}`}>{b.title}</a></TableCell>
              <TableCell className="text-px-muted">{plain(b.room)}</TableCell>
              <TableCell>{plain(b.status)}</TableCell>
            </TableRow>
          ))}
        </Grid>
      )}
    </Screen>
  );
}

export function MoodBoardObjectScreen({ shell, data }: ShellScreenProps<MoodBoardObjectData>) {
  if (data.state === "not_allowed" || data.state === "not_synced") return <NotThereScreen testId="mood-board" title="Mood Board" state={data.state} what="mood boards" />;
  if (data.state === "not_found") return <Missing testId="mood-board" title="Mood Board" what="mood board" back={{ href: "/mood-boards", label: "Back to mood boards" }} />;
  const b = data.board;
  return (
    <Screen testId="mood-board" state="local" title={b.title}>
      <CopyNote testId="mood-board-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-3 text-sm text-px-muted" data-testid="lines-on-server">The items pinned to this board are on the server.</p>
      <ServerOnly shell={shell} what="Editing the board and its items are on the server." path={`/mood-boards/${b.id}`} />
      <Facts rows={[["Project", plain(data.projectName)], ["Room or area", plain(b.room)], ["Status", plain(b.status)], ["Description", plain(b.description)]]} />
      <Back href="/mood-boards" label="Back to mood boards" />
    </Screen>
  );
}

// ─── knowledge base ─────────────────────────────────────────────────────────────────────────────────────────────

export function KnowledgeBaseScreen({ shell, data }: ShellScreenProps<KnowledgeBaseData>) {
  if (data.state !== "local") return <NotThereScreen testId="knowledge-base" title="Knowledge Base" state={data.state} what="knowledge base pages" />;
  return (
    <Screen testId="knowledge-base" state="local" title="Knowledge Base">
      <CopyNote testId="knowledge-base-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-3 text-sm text-px-muted">Published pages only.</p>
      <ServerOnly shell={shell} what="Writing or editing a page, and searching across pages, are on the server." path="/knowledge-base" />
      {data.pages.length === 0 ? <Empty testId="knowledge-base-empty" text="No pages yet." /> : (
        <ul className="mt-3 divide-y divide-black/10 rounded-lg border border-black/10 bg-white" data-testid="knowledge-base-list">
          {data.pages.map((p) => (
            <li key={p.id} data-testid="knowledge-base-row" className="flex items-center gap-2 px-4 py-3 text-sm">
              <a className="flex-1 font-medium text-px-ink underline-offset-2 hover:underline" href={`/knowledge-base/${encodeURIComponent(p.id)}`}>{p.title}</a>
              {p.version !== null ? <span className="text-xs text-px-muted">v{p.version}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

export function KbPageScreen({ shell, data }: ShellScreenProps<KbObjectData>) {
  if (data.state === "not_allowed" || data.state === "not_synced") return <NotThereScreen testId="kb-page" title="Knowledge Base" state={data.state} what="knowledge base pages" />;
  if (data.state === "not_found") return <Missing testId="kb-page" title="Knowledge Base" what="page" back={{ href: "/knowledge-base", label: "Back to the knowledge base" }} />;
  const p = data.page;
  return (
    <Screen testId="kb-page" state="local" title={p.title}>
      <CopyNote testId="kb-page-copy-note" syncedAt={data.syncedAt} />
      <ServerOnly shell={shell} what="Editing this page is on the server." path={`/knowledge-base/${p.id}`} />
      {p.parentTitle ? <p className="mt-2 text-xs text-px-muted">Under {p.parentTitle}</p> : null}
      {/* the page text is shown as plain text, whatever it contains: it is never interpreted as markup */}
      <div className="mt-4 max-w-3xl whitespace-pre-wrap text-sm text-px-ink" data-testid="kb-page-content">{p.content ?? "This page has no text yet."}</div>
      <Back href="/knowledge-base" label="Back to the knowledge base" />
    </Screen>
  );
}
