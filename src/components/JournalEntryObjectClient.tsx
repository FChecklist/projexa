"use client";

// Real-screen conversion (2026-08-30): the General Ledger list never had a
// detail view for a single entry -- no way to see its lines, and no way to
// submit a draft. Real Object Page on the kit's ObjectScreen.
//
// No Edit/Delete here: financial records are never physically edited or
// removed in this codebase once their lines are written (double-entry
// integrity) -- the real, designed lifecycle is draft -> submit (posted) or
// draft -> voided (an internal compensating rollback, not a user action; see
// voidDraftJournalEntry's own doc comment in erp-accounting-service.ts). The
// one real user action on a draft is Submit.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Currency, currencyLabel, useCurrencies } from "@/lib/currency";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Line = {
  id: string; accountId: string; debit: string; credit: string;
  remark: string | null; costCenter: string | null;
};
type Entry = {
  id: string; entryNumber: number; postingDate: string; referenceType: string | null;
  userRemark: string | null; status: string; totalDebit: string; totalCredit: string; lines: Line[];
};
type Account = { id: string; accountName: string; accountNumber: string | null };

function money(n: string | number, currencies: Currency[]) {
  return `${currencyLabel(undefined, currencies)}${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function JournalEntryObjectClient({ entryId }: { entryId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [data, accountsData] = await Promise.all([
        fetchJson<Entry>(`/api/journal-entries/${entryId}`),
        fetchJson<{ accounts: Account[] }>("/api/accounts").catch(() => ({ accounts: [] })),
      ]);
      setEntry(data);
      setAccounts(accountsData.accounts ?? []);
      setLoadError(null);
    } catch (err) {
      setEntry(null);
      setLoadError(errorMessage(err, "Couldn't load this journal entry"));
    }
  }

  useEffect(() => { load(); }, [entryId]);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/journal-entries/${entryId}/submit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit journal entry");
      toast.success("Journal entry submitted");
      await load();
    } catch (err) {
      // Honest, expected failure until PROJEXA has a per-user identity
      // bridge to VERIDIAN (same gap documented on Log Time/leave-approval/
      // quotation-approval) -- surfaced verbatim, not swallowed.
      toast.error(err instanceof Error ? err.message : "Couldn't submit journal entry");
    } finally {
      setSubmitting(false);
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
  if (!entry) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const isDraft = entry.status === "draft";

  return (
    <ObjectScreen
      breadcrumb="General Ledger / Journal Entry"
      title={`Journal Entry #${entry.entryNumber}`}
      subtitle={entry.userRemark ?? entry.referenceType ?? undefined}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: entry.status === "submitted" ? "done" : entry.status === "cancelled" ? "late" : "neutral", label: entry.status }}
      facets={[
        { label: "Posting Date", value: formatDate(entry.postingDate) },
        { label: "Total Debit", value: money(entry.totalDebit, currencies) },
        { label: "Total Credit", value: money(entry.totalCredit, currencies) },
      ]}
      onBack={() => router.push("/accounting?tab=ledger")}
      messages={[]}
    >
      {isDraft && (
        <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
          <Button size="sm" disabled={submitting} onClick={handleSubmit}>{submitting ? "Submitting…" : "Submit"}</Button>
          <p className="text-[12px] text-ct-muted">Posting this entry into the General Ledger requires a real user session — see the note below if it fails.</p>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow><TableHead>Account</TableHead><TableHead>Remark</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {entry.lines.map((l) => {
            const account = accounts.find((a) => a.id === l.accountId);
            return (
              <TableRow key={l.id}>
                <TableCell>{account ? `${account.accountNumber ? `${account.accountNumber} — ` : ""}${account.accountName}` : l.accountId}</TableCell>
                <TableCell className="text-ct-muted">{l.remark ?? "—"}</TableCell>
                <TableCell className="text-right">{Number(l.debit) > 0 ? money(l.debit, currencies) : "—"}</TableCell>
                <TableCell className="text-right">{Number(l.credit) > 0 ? money(l.credit, currencies) : "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {!isDraft && (
        <p className="px-4 py-3 text-[12px] text-ct-muted">
          {entry.status === "submitted" ? "Posted — financial records are never edited or removed once submitted." : "Cancelled/voided."}
        </p>
      )}
    </ObjectScreen>
  );
}
