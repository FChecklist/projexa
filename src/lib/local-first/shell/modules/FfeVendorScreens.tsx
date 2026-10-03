"use client";

// LOCAL-FIRST shell, FF&E (furniture, fixtures, equipment) and Vendors, read from the laptop's own copy.
//
// FF&E: Item, Room, Category, Qty, Cost, Price, Status as online. Cost and Price are the item's own per-unit figures as the server holds
// them; below the role that sees cost they were never sent and say "Hidden for your role" (never 0). The TOTALS and the MARGIN the online
// page shows are the server's aggregation: money is never computed on the laptop, so they are not shown here and the screen says so.
// "Advance" is a request for the next status (update_ffe_status, money sensitive, rank 3): only offered to a role that sees cost; the
// server decides. A new FF&E item carries cost and price, so it needs a connection.
//
// Vendors: the organisation's supplier master (an organisation kind, vendors-adapter.ts). A role that does not receive vendors is told so.
// GST, contacts, risks and performance are not on the laptop; the object screen says so.

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { orgStateWords } from "../../org-local";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Money, Num, ReadOnlyNote, SaveNote, Screen, ServerOnly, StateMessage, Waiting, mayWrite, projectName, withProject } from "./DeliveryParts";
import type { FfeItemWithVendor } from "./ffe-adapter";
import { BACK_LINK, Chip, NeedsConnection, SectionText, useSiteSave, words } from "./SiteParts";
import { advanceFfeOffline, canOffer, nextFfeStatus } from "./site-writes";
import type { ListData, LocalFfeItem, ObjectData } from "./site-records";
import type { VendorObjectData, VendorsListData } from "./vendors-adapter";

export function FfeListScreen({ shell, data }: ShellScreenProps<ListData<LocalFfeItem>>) {
  const { saving, note, save } = useSiteSave(shell);
  if (data.state !== "local") return <StateMessage testId="ffe-list" title="FF&E" state={data.state} what="item" />;
  const projectId = data.projectId;
  const name = projectName(shell, projectId);
  const mayAdvance = canOffer(shell.data.role, 3) && mayWrite(shell);
  return (
    <Screen testId="ffe-list" state="local" title={`FF&E Schedule${name ? ` / ${name}` : ""}`}>
      <CopyNote testId="ffe-list-copy-note" syncedAt={data.syncedAt} />
      <NeedsConnection>The total cost, client price and margin are worked out by the server and appear when you are online. A new item needs a connection.</NeedsConnection>
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No FF&amp;E items yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead><TableHead>Room</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Qty</TableHead>
                <TableHead>Cost</TableHead><TableHead>Price</TableHead><TableHead>Status</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((i) => {
                const next = nextFfeStatus(i.status);
                return (
                  <TableRow key={i.id} data-testid="ffe-row" data-item-id={i.id}>
                    <TableCell><a className="font-medium underline-offset-2 hover:underline" href={withProject(`/ffe/${encodeURIComponent(i.id)}`, projectId)}>{i.itemName}</a><Waiting on={i.waiting} /></TableCell>
                    <TableCell className="text-px-muted">{i.roomOrArea ?? DASH}</TableCell>
                    <TableCell className="capitalize text-px-muted">{i.category ?? DASH}</TableCell>
                    <TableCell className="text-right"><Num value={i.quantity} /></TableCell>
                    <TableCell><Money value={i.unitCost} hidden={i.costHidden} /></TableCell>
                    <TableCell><Money value={i.unitPrice} hidden={i.costHidden} /></TableCell>
                    <TableCell><Chip value={i.status} /></TableCell>
                    <TableCell className="text-right">
                      {mayAdvance && !i.costHidden && next && !i.waiting ? (
                        <Button size="sm" variant="outline" disabled={saving} data-testid="ffe-advance" onClick={() => void save(() => advanceFfeOffline(shell.data, { projectId, itemId: i.id, status: next }))}>Advance</Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <SaveNote note={note} />
      {!mayWrite(shell) ? <ReadOnlyNote /> : null}
      <ServerOnly shell={shell} what="Adding an item" path="/ffe/new" />
    </Screen>
  );
}

export function FfeObjectScreen({ shell, data }: ShellScreenProps<ObjectData<FfeItemWithVendor>>) {
  const { saving, note, save } = useSiteSave(shell);
  if (data.state !== "local") return <StateMessage testId="ffe-object" title="FF&E item" state={data.state} what="item" back={{ href: withProject("/ffe", shell.projectId), label: "Back to FF&E" }} />;
  const i = data.item;
  const projectId = data.projectId;
  const next = nextFfeStatus(i.status);
  const mayAdvance = canOffer(shell.data.role, 3) && mayWrite(shell) && !i.costHidden && next !== null && !i.waiting;
  return (
    <Screen testId="ffe-object" state="local" title={i.itemName}>
      <CopyNote testId="ffe-object-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 text-sm"><Chip value={i.status} /><Waiting on={i.waiting} /></p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-px-muted">Room</dt><dd>{i.roomOrArea ?? DASH}</dd>
        <dt className="text-px-muted">Category</dt><dd className="capitalize">{words(i.category)}</dd>
        <dt className="text-px-muted">Qty</dt><dd><Num value={i.quantity} /></dd>
        <dt className="text-px-muted">Cost</dt><dd><Money value={i.unitCost} hidden={i.costHidden} /></dd>
        <dt className="text-px-muted">Client Price</dt><dd><Money value={i.unitPrice} hidden={i.costHidden} /></dd>
        <dt className="text-px-muted">Vendor</dt>
        <dd data-testid="ffe-vendor">{i.vendorHidden || i.costHidden ? <span className="text-px-muted" data-hidden="1">Hidden for your role</span> : i.vendorName ?? DASH}</dd>
        <dt className="text-px-muted">SKU</dt><dd>{i.sku ?? DASH}</dd>
        <dt className="text-px-muted">Lead time</dt><dd>{i.leadTimeDays === null ? DASH : `${i.leadTimeDays} days`}</dd>
      </dl>
      <SectionText title="Description" value={i.description} />
      <NeedsConnection>Dimensions are not kept on this laptop yet.</NeedsConnection>
      {mayAdvance ? (
        <div className="mt-4">
          <Button disabled={saving} data-testid="ffe-advance" onClick={() => void save(() => advanceFfeOffline(shell.data, { projectId, itemId: i.id, status: next! }))}>{saving ? "Saving…" : `Advance to ${next}`}</Button>
          <SaveNote note={note} />
          <p className="mt-2 text-xs text-px-muted">The server makes the change; this only sends your request.</p>
        </div>
      ) : null}
      <p className="mt-4 text-sm"><a className={BACK_LINK} href={withProject("/ffe", projectId)}>Back to FF&E</a></p>
    </Screen>
  );
}

// ─── vendors ────────────────────────────────────────────────────────────────────────────────────────────────────

function OrgState({ testId, title, state }: { testId: string; title: string; state: "not_allowed" | "not_synced" | "not_found" }) {
  return (
    <Screen testId={testId} state={state} title={title}>
      <p className="mt-3 text-sm text-px-muted">
        {state === "not_found" ? "This vendor is not in the copy on this laptop. It may not have been copied yet." : orgStateWords(state, "vendors")}
      </p>
    </Screen>
  );
}

export function VendorsListScreen({ shell, data }: ShellScreenProps<VendorsListData>) {
  if (data.state !== "local") return <OrgState testId="vendors-list" title="Vendors" state={data.state} />;
  return (
    <Screen testId="vendors-list" state="local" title="Vendors">
      <CopyNote testId="vendors-list-copy-note" syncedAt={data.syncedAt} />
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted">No vendors yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Trade</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.rows.map((v) => (
                <TableRow key={v.id} data-testid="vendor-row" data-vendor-id={v.id}>
                  <TableCell><a className="font-medium underline-offset-2 hover:underline" href={`/vendors/${encodeURIComponent(v.id)}`}>{v.name}</a></TableCell>
                  <TableCell className="capitalize text-px-muted">{words(v.type)}</TableCell>
                  <TableCell className="text-px-muted">{v.trade ?? DASH}</TableCell>
                  <TableCell><Chip value={v.isActive ? "active" : "inactive"} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ServerOnly shell={shell} what="Adding a vendor, GST numbers, contacts and risks" path="/vendors" />
    </Screen>
  );
}

export function VendorObjectScreen({ shell, data }: ShellScreenProps<VendorObjectData>) {
  if (data.state !== "local") return <OrgState testId="vendor-object" title="Vendor" state={data.state} />;
  const v = data.vendor;
  return (
    <Screen testId="vendor-object" state="local" title={v.name}>
      <CopyNote testId="vendor-object-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 text-sm"><Chip value={v.isActive ? "active" : "inactive"} /></p>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-px-muted">Type</dt><dd className="capitalize">{words(v.type)}</dd>
        <dt className="text-px-muted">Trade</dt><dd>{v.trade ?? DASH}</dd>
        <dt className="text-px-muted">Qualification</dt><dd className="capitalize">{words(v.qualification)}</dd>
        <dt className="text-px-muted">Payment terms</dt><dd>{v.paymentTermsDays === null ? DASH : `${v.paymentTermsDays} days`}</dd>
        <dt className="text-px-muted">Credit limit</dt><dd data-testid="vendor-credit"><Money value={v.creditLimit} hidden={v.creditHidden} /></dd>
      </dl>
      <NeedsConnection>GST number, contacts, addresses, risks and performance are not kept on this laptop yet.</NeedsConnection>
      <p className="mt-4 text-sm"><a className={BACK_LINK} href="/vendors">Back to vendors</a></p>
    </Screen>
  );
}
