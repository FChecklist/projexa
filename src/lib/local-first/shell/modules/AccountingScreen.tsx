"use client";

// LOCAL-FIRST shell, Accounting (/accounting): the chart of accounts and the fiscal years from the laptop's own copy. Read-only.
// Journal entries and ledgers are not on the laptop (the screen says so); no balance or total is worked out here.

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Screen } from "./DeliveryParts";
import type { AccountingData } from "./erp-b-adapter";
import { GateScreen, LinesOnServer, MAX_ROWS, dateOrDash } from "./ErpBParts";

export default function AccountingScreen({ shell, data }: ShellScreenProps<AccountingData>) {
  const { accounts, fiscalYears } = data;
  if (accounts.state !== "local" && fiscalYears.state !== "local") {
    return <GateScreen testId="accounting" title="Accounting" state={accounts.state} what="chart of accounts and fiscal years" />;
  }
  const syncedAt = Math.max(accounts.state === "local" ? accounts.syncedAt : 0, fiscalYears.state === "local" ? fiscalYears.syncedAt : 0);
  return (
    <Screen testId="accounting" state="local" title="Accounting">
      <CopyNote testId="accounting-copy-note" syncedAt={syncedAt} />
      <LinesOnServer shell={shell} what="Journal entries and their lines, ledgers and balances" path="/accounting" />

      <h2 className="mt-5 font-heading text-lg text-px-ink">Chart of accounts</h2>
      {accounts.state !== "local" ? (
        <p className="mt-2 text-sm text-px-muted" data-testid="accounts-gate">{accounts.state === "not_allowed" ? "The chart of accounts is not available to your role." : "The chart of accounts is not on this laptop yet. It arrives with the next sync."}</p>
      ) : accounts.rows.length === 0 ? (
        <p className="mt-2 text-sm text-px-muted" data-testid="accounts-empty">No accounts found.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Number</TableHead><TableHead>Account</TableHead><TableHead>Root type</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {accounts.rows.slice(0, MAX_ROWS).map((a) => (
                <TableRow key={a.id} data-testid="accounts-row">
                  <TableCell className="text-px-muted">{a.number ?? DASH}</TableCell>
                  <TableCell className={a.isGroup ? "font-medium" : ""} style={{ paddingLeft: `${0.75 + a.depth * 1.25}rem` }}>{a.name}{a.isGroup ? " (group)" : ""}</TableCell>
                  <TableCell className="capitalize">{a.rootType ?? DASH}</TableCell>
                  <TableCell>{a.accountType ? a.accountType.replace(/_/g, " ") : DASH}</TableCell>
                  <TableCell>{a.isFrozen ? "frozen" : "active"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {accounts.state === "local" && accounts.rows.length > MAX_ROWS ? <p className="mt-2 text-xs text-px-muted">Showing the first {MAX_ROWS} of {accounts.rows.length} accounts.</p> : null}

      <h2 className="mt-6 font-heading text-lg text-px-ink">Fiscal years</h2>
      {fiscalYears.state !== "local" ? (
        <p className="mt-2 text-sm text-px-muted" data-testid="fiscal-years-gate">{fiscalYears.state === "not_allowed" ? "Fiscal years are not available to your role." : "Fiscal years are not on this laptop yet. They arrive with the next sync."}</p>
      ) : fiscalYears.rows.length === 0 ? (
        <p className="mt-2 text-sm text-px-muted" data-testid="fiscal-years-empty">No fiscal years found.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Fiscal year</TableHead><TableHead>Starts</TableHead><TableHead>Ends</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {fiscalYears.rows.map((y) => (
                <TableRow key={y.id} data-testid="fiscal-years-row">
                  <TableCell className="font-medium">{y.name}</TableCell>
                  <TableCell>{dateOrDash(y.startDate)}</TableCell>
                  <TableCell>{dateOrDash(y.endDate)}</TableCell>
                  <TableCell>{y.isClosed ? "closed" : "open"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Screen>
  );
}
