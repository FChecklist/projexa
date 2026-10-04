"use client";

// LOCAL-FIRST shell, Expenses (/expenses): the project's expenses from the laptop's own copy, each amount as the server recorded it.
// No total is added up here (money is the server's) and logging an expense needs the server (see expenses-adapter.ts).

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format-date";
import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Money, Screen, ServerOnly, StateMessage, projectName } from "./DeliveryParts";
import type { ExpensesData } from "./expenses-adapter";

export default function ExpensesScreen({ shell, data }: ShellScreenProps<ExpensesData>) {
  if (data.state !== "local") return <StateMessage testId="expenses" title="Expenses" state={data.state} what="expense list" />;
  const name = projectName(shell, data.projectId);
  return (
    <Screen testId="expenses" state="local" title={`Expenses${name ? ` / ${name}` : ""}`}>
      <CopyNote testId="expenses-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 text-sm text-px-muted" data-testid="expenses-count">
        {data.expenses.length === 0 ? "No expenses logged yet." : `${data.expenses.length} ${data.expenses.length === 1 ? "expense" : "expenses"} logged. Totals are worked out by the server.`}
      </p>
      <ServerOnly shell={shell} what="Logging an expense is done on the server." path="/expenses/new" />
      {data.expenses.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Head</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.expenses.map((e) => (
                <TableRow key={e.id} data-testid="expenses-row">
                  <TableCell className="text-px-muted">{formatDate(e.date)}</TableCell>
                  <TableCell>{e.head}{e.isRework ? " · rework" : ""}</TableCell>
                  <TableCell className="text-px-muted">
                    {data.descriptionHidden ? <span data-hidden="1">Hidden for your role</span> : e.description ?? DASH}
                  </TableCell>
                  <TableCell className="text-right"><Money value={e.amount} hidden={data.amountHidden} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </Screen>
  );
}
