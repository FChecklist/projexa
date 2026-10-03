"use client";

// LOCAL-FIRST shell, one quotation / sales order / invoice: the header row from the laptop's own copy. Lines, tax breakdown by line,
// PDFs and status changes are on the server. A link to a related document is offered only when that header is on this laptop too.

import type { ReactNode } from "react";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Screen } from "./DeliveryParts";
import { DOC_SPECS, type DocData, type DocKind } from "./erp-b-adapter";
import { Facts, GateScreen, LinesOnServer, MoneyCell, dateOrDash, statusWords } from "./ErpBParts";

export type SalesDocObjectScreenData = { kind: DocKind; result: DocData };

export default function SalesDocObjectScreen({ shell, data }: ShellScreenProps<SalesDocObjectScreenData>) {
  const spec = DOC_SPECS[data.kind];
  const result = data.result;
  const testId = `${data.kind.replace(/_/g, "-")}-object`;
  if (result.state === "not_allowed" || result.state === "not_synced") return <GateScreen testId={testId} title={spec.label} state={result.state} what={spec.plural.toLowerCase()} />;
  if (result.state === "not_found") {
    return (
      <Screen testId={testId} state="not_found" title={spec.label}>
        <p className="mt-3 text-sm text-px-muted">This {spec.label.toLowerCase()} is not in the copy on this laptop. It may not have been copied yet.</p>
        <p className="mt-3 text-sm"><a className="underline underline-offset-2" href={spec.base}>Back to {spec.plural}</a></p>
      </Screen>
    );
  }
  const { doc, hidden, related } = result;
  const money = (col: string, value: number | null) => <MoneyCell value={value} hidden={hidden[col] === true} currency={doc.currency} />;
  const rows: Array<[string, ReactNode]> = [
    ["Customer", doc.customerName ?? <span className="text-px-muted">Customer not on this laptop</span>],
    ["Date", dateOrDash(doc.date)],
    [spec.dueLabel, dateOrDash(doc.due)],
    ["Status", statusWords(doc.status)],
  ];
  if (doc.projectName) rows.push(["Project", doc.projectName]);
  if (data.kind === "quotations") rows.push(["Version", doc.version ?? DASH]);
  if (data.kind === "invoices") {
    rows.push(["Subtotal", money("subtotal", doc.subtotal)], ["Tax", money("tax_amount", doc.tax)]);
  }
  rows.push(["Total", money("grand_total", doc.total)]);
  if (data.kind === "invoices") rows.push(["Outstanding", money("outstanding_amount", doc.outstanding)], ["E-invoice", doc.eInvoiceStatus ? statusWords(doc.eInvoiceStatus) : DASH]);
  const link = (href: string, label: string) => <a key={href} className="underline underline-offset-2" href={href}>{label}</a>;
  const links: ReactNode[] = [];
  if (related.quotationOnLaptop && doc.quotationId) links.push(link(`/quotations/${encodeURIComponent(doc.quotationId)}`, "The quotation this order came from"));
  if (related.salesOrderOnLaptop && doc.salesOrderId) links.push(link(`/sales-orders/${encodeURIComponent(doc.salesOrderId)}`, "The sales order this invoice came from"));
  if (related.revisionOnLaptop && doc.revisionOf) links.push(link(`/quotations/${encodeURIComponent(doc.revisionOf)}`, "The quotation this one revises"));
  for (const id of related.orderedFrom) links.push(link(`/sales-orders/${encodeURIComponent(id)}`, "A sales order made from this quotation"));
  for (const id of related.invoicedFrom) links.push(link(`/invoices/${encodeURIComponent(id)}`, "An invoice made from this order"));
  return (
    <Screen testId={testId} state="local" title={`${spec.label}${doc.number ? ` #${doc.number}` : ""}`}>
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={spec.base}>{spec.plural}</a></p>
      <CopyNote testId={`${testId}-copy-note`} syncedAt={result.syncedAt} />
      <Facts testId={`${testId}-facts`} rows={rows} />
      {links.length ? <ul className="mt-3 list-disc pl-5 text-sm" data-testid={`${testId}-related`}>{links.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
      <LinesOnServer shell={shell} what="Line items, PDFs and status changes" path={`${spec.base}/${encodeURIComponent(doc.id)}`} />
    </Screen>
  );
}
