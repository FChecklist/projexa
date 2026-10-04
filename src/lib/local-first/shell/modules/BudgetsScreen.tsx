"use client";

// LOCAL-FIRST shell, Budgets (/finance/budgets, /budgets): the budget HEADERS from the laptop's own copy (rank 3 and above are sent
// them; a lower role gets the calm "not available to your role" answer). Budget lines and the annual amount (a sum of lines) are on
// the server and are never worked out here.

import type { ShellScreenProps } from "../types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CopyNote, DASH, Screen } from "./DeliveryParts";
import type { BudgetsData } from "./erp-b-adapter";
import { GateScreen, LinesOnServer, MAX_ROWS, statusWords } from "./ErpBParts";

export default function BudgetsScreen({ shell, data }: ShellScreenProps<{ base: string; result: BudgetsData }>) {
  const { base, result } = data;
  if (result.state !== "local") return <GateScreen testId="budgets" title="Budgets" state={result.state} what="budgets" />;
  return (
    <Screen testId="budgets" state="local" title="Budgets">
      <CopyNote testId="budgets-copy-note" syncedAt={result.syncedAt} />
      <LinesOnServer shell={shell} what="Budget lines and the annual amount" path="/finance/budgets" />
      {result.budgets.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted" data-testid="budgets-empty">No budgets found.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-black/10 bg-white">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Fiscal Year</TableHead><TableHead>Company</TableHead><TableHead>Status</TableHead><TableHead>Action if Exceeded</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {result.budgets.slice(0, MAX_ROWS).map((b) => (
                <TableRow key={b.id} data-testid="budgets-row">
                  <TableCell className="font-medium"><a className="underline underline-offset-2" href={`${base}/${encodeURIComponent(b.id)}`}>{b.name}</a></TableCell>
                  <TableCell>{b.fiscalYear ?? DASH}</TableCell>
                  <TableCell>{b.company ?? DASH}</TableCell>
                  <TableCell className="capitalize">{statusWords(b.status)}</TableCell>
                  <TableCell>{b.actionIfExceeded ? statusWords(b.actionIfExceeded) : DASH}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Screen>
  );
}
