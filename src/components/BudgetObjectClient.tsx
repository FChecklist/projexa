"use client";

// Real-screen conversion (2026-08-30): the Budgets list never had a detail
// view -- no way to see line items, edit them, submit a draft, cancel a
// budget, or see Budget vs Actual. Real Object Page on the kit's ObjectScreen.
// Real Delete = real Cancel (cancelBudget() -- an actual, designed lifecycle
// end-state, not an invented mapping like Schedule's archive-as-delete).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type LineItem = { id: string; accountId: string; annualAmount: string };
type Budget = {
  id: string; name: string; fiscalYearId: string; companyId: string | null; costCenterId: string | null;
  status: string; actionIfExceeded: string | null; lineItems: LineItem[];
};
type Account = { id: string; accountName: string; accountNumber: string | null };
type VarianceLine = { accountId: string; accountName: string; annualAmount: number; actualAmount: number; varianceAmount: number; variancePercent: number | null; isOverBudget: boolean };
type Variance = { asOfDate: string; lines: VarianceLine[]; totalBudget: number; totalActual: number };

function money(n: number, label: string) {
  return `${label}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function BudgetObjectClient({ budgetId }: { budgetId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [variance, setVariance] = useState<Variance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draftLines, setDraftLines] = useState<LineItem[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  async function load() {
    try {
      const [data, accountsData] = await Promise.all([
        fetchJson<Budget>(`/api/project-budgets/${budgetId}`),
        fetchJson<{ accounts: Account[] }>("/api/accounts").catch(() => ({ accounts: [] })),
      ]);
      setBudget(data);
      setAccounts(accountsData.accounts ?? []);
      setDraftLines(data.lineItems);
      setLoadError(null);
      fetchJson<Variance>(`/api/project-budgets/${budgetId}/variance`).then(setVariance).catch(() => setVariance(null));
    } catch (err) {
      setBudget(null);
      setLoadError(errorMessage(err, "Couldn't load this budget"));
    }
  }

  useEffect(() => { load(); }, [budgetId]);

  function updateLine(idx: number, patch: Partial<LineItem>) {
    setDraftLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function handleSave() {
    try {
      const res = await fetch(`/api/project-budgets/${budgetId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItems: draftLines.map((l) => ({ accountId: l.accountId, annualAmount: Number(l.annualAmount) })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save budget");
      toast.success("Budget saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save budget");
    }
  }

  async function runAction(action: "submit" | "cancel") {
    setActionBusy(action);
    try {
      const res = await fetch(`/api/project-budgets/${budgetId}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed to ${action} budget`);
      toast.success(action === "submit" ? "Budget submitted" : "Budget cancelled");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't ${action} budget`);
    } finally {
      setActionBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!budget) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const isDraft = budget.status === "draft";
  const totalAnnual = budget.lineItems.reduce((sum, l) => sum + Number(l.annualAmount), 0);

  return (
    <ObjectScreen
      breadcrumb="Budgets / Budget"
      title={budget.name}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: budget.status === "submitted" ? "done" : budget.status === "cancelled" ? "late" : "neutral", label: budget.status }}
      facets={[
        { label: "Annual Total", value: money(totalAnnual, label) },
        { label: "Action if Exceeded", value: budget.actionIfExceeded ?? "warn" },
      ]}
      onEdit={isDraft && mode === "display" ? () => { setDraftLines(budget.lineItems); setMode("edit"); } : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => { setDraftLines(budget.lineItems); setMode("display"); } : undefined}
      onDelete={budget.status !== "cancelled" ? () => runAction("cancel") : undefined}
      deleteDisabledReason={budget.status === "cancelled" ? "Already cancelled" : actionBusy ? "Working…" : undefined}
      onBack={() => router.push("/finance/budgets")}
      saveDisabled={actionBusy !== null}
      messages={[]}
    >
      {isDraft && mode === "display" && (
        <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
          <Button size="sm" disabled={actionBusy !== null} onClick={() => runAction("submit")}>{actionBusy === "submit" ? "Submitting…" : "Submit"}</Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow><TableHead>Account</TableHead><TableHead className="text-right">Annual Amount</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {(mode === "edit" ? draftLines : budget.lineItems).map((l, idx) => {
            const account = accounts.find((a) => a.id === l.accountId);
            return (
              <TableRow key={l.id ?? idx}>
                <TableCell>
                  {mode === "edit" ? (
                    <Select value={l.accountId} onValueChange={(v) => updateLine(idx, { accountId: v })}>
                      <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    account ? `${account.accountNumber ? `${account.accountNumber} — ` : ""}${account.accountName}` : l.accountId
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {mode === "edit" ? (
                    <Input type="number" className="w-32 text-right ml-auto" value={l.annualAmount} onChange={(e) => updateLine(idx, { annualAmount: e.target.value })} />
                  ) : money(Number(l.annualAmount), label)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {variance && variance.lines.length > 0 && (
        <div className="border-t border-ct-border px-4 py-3">
          <h3 className="mb-2 text-[13px] font-semibold text-ct-navy">Budget vs Actual (as of {variance.asOfDate})</h3>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Account</TableHead><TableHead className="text-right">Budget</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Variance</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {variance.lines.map((v) => (
                <TableRow key={v.accountId}>
                  <TableCell>{v.accountName}</TableCell>
                  <TableCell className="text-right">{money(v.annualAmount, label)}</TableCell>
                  <TableCell className="text-right">{money(v.actualAmount, label)}</TableCell>
                  <TableCell className={`text-right ${v.isOverBudget ? "text-px-error" : ""}`}>
                    {money(v.varianceAmount, label)}{v.variancePercent !== null ? ` (${v.variancePercent.toFixed(0)}%)` : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ObjectScreen>
  );
}
