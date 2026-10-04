"use client";

// LOCAL-FIRST shell, one budget (/finance/budgets/:id, /budgets/:id): the header row from the laptop's own copy. Lines are on the server.

import type { ShellScreenProps } from "../types";
import { CopyNote, DASH, Screen } from "./DeliveryParts";
import type { BudgetData } from "./erp-b-adapter";
import { Facts, GateScreen, LinesOnServer, dateOrDash, statusWords } from "./ErpBParts";

export default function BudgetObjectScreen({ shell, data }: ShellScreenProps<{ base: string; result: BudgetData }>) {
  const { base, result } = data;
  if (result.state === "not_allowed" || result.state === "not_synced") return <GateScreen testId="budget-object" title="Budget" state={result.state} what="budgets" />;
  if (result.state === "not_found") {
    return (
      <Screen testId="budget-object" state="not_found" title="Budget">
        <p className="mt-3 text-sm text-px-muted">This budget is not in the copy on this laptop. It may not have been copied yet.</p>
        <p className="mt-3 text-sm"><a className="underline underline-offset-2" href={base}>Back to Budgets</a></p>
      </Screen>
    );
  }
  const b = result.budget;
  return (
    <Screen testId="budget-object" state="local" title={b.name}>
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={base}>Budgets</a></p>
      <CopyNote testId="budget-copy-note" syncedAt={result.syncedAt} />
      <Facts testId="budget-facts" rows={[
        ["Fiscal year", b.fiscalYear ?? DASH], ["Company", b.company ?? DASH], ["Status", statusWords(b.status)],
        ["Action if exceeded", b.actionIfExceeded ? statusWords(b.actionIfExceeded) : DASH], ["Submitted", dateOrDash(b.submittedAt)],
      ]} />
      <LinesOnServer shell={shell} what="Budget lines and the annual amount" path={`/finance/budgets/${encodeURIComponent(b.id)}`} />
    </Screen>
  );
}
