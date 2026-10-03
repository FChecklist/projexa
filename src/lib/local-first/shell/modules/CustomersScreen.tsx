"use client";

// LOCAL-FIRST shell, Customers (/customers): the organisation's customers from the laptop's own copy. Read-only; the credit limit is
// "Hidden for your role" when the sync hid it; tax ids are not kept on the laptop. See customers-adapter.ts.

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAmount } from "@/lib/boq-helpers";
import { orgStateWords } from "../../org-local";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Screen, ServerOnly, textHandlers } from "./DeliveryParts";
import type { CustomersData } from "./customers-adapter";
import { formatInBase } from "./org-masters";

/** More rows than this are not drawn at once (the online list pages by 20); the search narrows them. */
const MAX_ROWS = 500;

export default function CustomersScreen({ shell, data }: ShellScreenProps<CustomersData>) {
  const [search, setSearch] = useState("");
  if (data.state !== "local") {
    return (
      <Screen testId="customers" state={data.state} title="Customers">
        <p className="mt-3 text-sm text-px-muted">{orgStateWords(data.state, "customers")}</p>
      </Screen>
    );
  }
  const needle = search.trim().toLowerCase();
  const matches = needle ? data.customers.filter((c) => c.name.toLowerCase().includes(needle)) : data.customers;
  const shown = matches.slice(0, MAX_ROWS);
  return (
    <Screen testId="customers" state="local" title="Customers">
      <CopyNote testId="customers-copy-note" syncedAt={data.syncedAt} />
      <ServerOnly shell={shell} what="Adding or changing a customer, and a customer's own page and tax details, are on the server." path="/customers" />
      <input
        aria-label="Search customers"
        data-testid="customers-search"
        placeholder="Search customers…"
        value={search}
        {...textHandlers(setSearch)}
        className="mt-3 block w-56 rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm"
      />
      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted" data-testid="customers-empty">No customers found.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Credit Limit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => (
                <TableRow key={c.id} data-testid="customers-row">
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-px-muted">
                    {data.creditHidden ? <span data-hidden="1">Hidden for your role</span> : c.creditLimit === null ? DASH : formatInBase(c.creditLimit, data.base) ?? formatAmount(c.creditLimit)}
                  </TableCell>
                  <TableCell>{c.isActive ? "active" : "inactive"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {matches.length > MAX_ROWS ? <p className="mt-2 text-xs text-px-muted">Showing the first {MAX_ROWS} of {matches.length}; search to narrow them.</p> : null}
    </Screen>
  );
}
