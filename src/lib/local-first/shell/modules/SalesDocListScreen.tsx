"use client";

// LOCAL-FIRST shell, quotations / sales orders / invoices (/quotations, /sales-orders, /invoices): the header rows from the laptop's
// own copy. Read-only. Money is shown as the server sent it ("Hidden for your role" when the sync hid it); nothing is added up; line
// items are on the server. See erp-b-adapter.ts.

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Screen, textHandlers } from "./DeliveryParts";
import { DOC_SPECS, type DocKind, type DocsData } from "./erp-b-adapter";
import { GateScreen, LinesOnServer, MAX_ROWS, MoneyCell, dateOrDash, selectClass, statusWords } from "./ErpBParts";

export type SalesDocListScreenData = { kind: DocKind; result: DocsData };

export default function SalesDocListScreen({ shell, data }: ShellScreenProps<SalesDocListScreenData>) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const spec = DOC_SPECS[data.kind];
  const result = data.result;
  const testId = data.kind.replace(/_/g, "-");
  if (result.state !== "local") return <GateScreen testId={testId} title={spec.plural} state={result.state} what={spec.plural.toLowerCase()} />;

  const needle = search.trim().toLowerCase();
  const matches = result.docs.filter((d) => (status === "all" || d.status === status) && (!needle || `${d.number ?? ""} ${d.customerName ?? ""}`.toLowerCase().includes(needle)));
  const invoices = data.kind === "invoices";
  return (
    <Screen testId={testId} state="local" title={spec.plural}>
      <CopyNote testId={`${testId}-copy-note`} syncedAt={result.syncedAt} />
      <LinesOnServer shell={shell} what={`Line items, creating or changing ${spec.label.toLowerCase()}s, and approvals`} path={spec.base} />
      <div className="flex flex-wrap items-end gap-3">
        <input
          aria-label={`Search ${spec.plural.toLowerCase()}`}
          data-testid={`${testId}-search`}
          placeholder="Search number or customer..."
          value={search}
          {...textHandlers(setSearch)}
          className={`${selectClass} w-56`}
        />
        <select aria-label="Status" data-testid={`${testId}-status`} value={status} {...textHandlers(setStatus)} className={selectClass}>
          <option value="all">All statuses</option>
          {result.statuses.map((s) => <option key={s} value={s}>{statusWords(s)}</option>)}
        </select>
      </div>
      {matches.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted" data-testid={`${testId}-empty`}>No {spec.plural.toLowerCase()} found.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>{spec.dueLabel}</TableHead>
                {data.kind === "quotations" ? <TableHead>Version</TableHead> : null}
                <TableHead>Total</TableHead>
                {invoices ? <TableHead>Outstanding</TableHead> : null}
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.slice(0, MAX_ROWS).map((d) => (
                <TableRow key={d.id} data-testid={`${testId}-row`} data-status={d.status ?? ""}>
                  <TableCell className="font-medium"><a className="underline underline-offset-2" href={`${spec.base}/${encodeURIComponent(d.id)}`}>{d.number ? `#${d.number}` : "Open"}</a></TableCell>
                  <TableCell>{d.customerName ?? <span className="text-px-muted">Customer not on this laptop</span>}</TableCell>
                  <TableCell>{dateOrDash(d.date)}</TableCell>
                  <TableCell>{dateOrDash(d.due)}</TableCell>
                  {data.kind === "quotations" ? <TableCell>{d.version ?? DASH}</TableCell> : null}
                  <TableCell><MoneyCell value={d.total} hidden={result.hidden.grand_total === true} currency={d.currency} /></TableCell>
                  {invoices ? <TableCell><MoneyCell value={d.outstanding} hidden={result.hidden.outstanding_amount === true} currency={d.currency} /></TableCell> : null}
                  <TableCell className="capitalize">{statusWords(d.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="mt-2 text-xs text-px-muted" data-testid={`${testId}-count`}>{matches.length} of {result.docs.length} {spec.plural.toLowerCase()}{matches.length > MAX_ROWS ? `; showing the first ${MAX_ROWS}, search to narrow them` : ""}</p>
    </Screen>
  );
}
