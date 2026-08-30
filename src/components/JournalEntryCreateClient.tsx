"use client";

// Real-screen conversion (2026-08-30) -- replaces AccountingClient.tsx's
// GeneralLedgerPanel's old "New Journal Entry" Dialog popup with a real
// create screen, same fields and same debit=credit validation.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currencyLabel, useCurrencies } from "@/lib/currency";

type Account = { id: string; accountName: string; accountNumber: string | null };
type JeLine = { accountId: string; debit: string; credit: string };

function money(n: number, label: string) {
  return `${label}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function JournalEntryCreateClient() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [userRemark, setUserRemark] = useState("");
  const [lines, setLines] = useState<JeLine[]>([{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((data) => setAccounts(data.accounts ?? [])).catch(() => {});
  }, []);

  function updateLine(idx: number, patch: Partial<JeLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const balanced = lines.length >= 2 && Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  async function createEntry() {
    if (!balanced) {
      toast.error("Debit and credit totals must match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/journal-entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postingDate, userRemark: userRemark || undefined,
          lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create journal entry");
      toast.success("Journal entry drafted");
      router.push(`/accounting/journal-entries/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create journal entry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="General Ledger / New Journal Entry"
      title="New Journal Entry"
      mode="create"
      hasDraft={false}
      onSave={createEntry}
      onCancel={() => router.push("/accounting?tab=ledger")}
      onBack={() => router.push("/accounting?tab=ledger")}
      saveDisabled={submitting || !balanced}
      saveDisabledReason={submitting ? "Creating…" : !balanced ? "Debit and credit totals must match" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Posting Date</Label><Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Remark</Label><Input value={userRemark} onChange={(e) => setUserRemark(e.target.value)} placeholder="e.g. Site 4 material accrual" /></div>
        </div>
        <div className="space-y-2">
          <Label>Lines (double-entry — debit must equal credit)</Label>
          {lines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_90px_90px_28px] items-center gap-1.5">
              <Select value={line.accountId} onValueChange={(v) => updateLine(idx, { accountId: v })}>
                <SelectTrigger><SelectValue placeholder={accounts.length ? "Account" : "Loading…"} /></SelectTrigger>
                <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" placeholder="Debit" value={line.debit} onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? "" : line.credit })} />
              <Input type="number" placeholder="Credit" value={line.credit} onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? "" : line.debit })} />
              <Button variant="ghost" size="icon" disabled={lines.length <= 2} onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}>✕</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { accountId: "", debit: "", credit: "" }])}>+ Add Line</Button>
        </div>
        <div className={`rounded-md border p-2 text-sm ${balanced ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"}`}>
          Debit {money(totalDebit, currencyLabel(undefined, currencies))} &middot; Credit {money(totalCredit, currencyLabel(undefined, currencies))} {balanced ? "— balanced" : "— must balance before posting"}
        </div>
      </div>
    </ObjectScreen>
  );
}
