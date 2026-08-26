"use client";

// Priority 15: PROJEXA's Accounting surface -- 6 tabs over VERIDIAN's real
// GL/financial-reporting engine, sized for a ~100-employee firm running
// ~500 projects: a Finance dashboard (cash position, AR aging, revenue
// trend), a paginated/filtered General Ledger with real double-entry
// journal-entry creation (debit=credit validated server-side), Trial
// Balance / P&L / Balance Sheet as generated reports with a date-range
// picker, a P&L-by-project rollup (the view a 500-project firm actually
// needs, not just company-wide), and a read-only Bank Reconciliation view.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Landmark, ChevronLeft, ChevronRight, Building2 } from "lucide-react";
import { Currency, currencyLabel, useCurrencies } from "@/lib/currency";
import { type Company, type CompanyScope, companyScopeQuery, CompanySelector } from "@/components/company-scope";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import LoadError from "@/components/LoadError";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
type Account = { id: string; accountName: string; accountNumber: string | null; rootType: string; accountType: string | null };
type JournalEntry = { id: string; entryNumber: number; postingDate: string; referenceType: string | null; userRemark: string | null; status: string; totalDebit: string; totalCredit: string };
type FinanceDashboard = {
  asOfDate: string; cashPosition: number;
  arAging: { totalOutstanding: number; buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number } };
  topOverdueInvoices: { invoiceId: string; invoiceNumber: number; customerName: string | null; outstandingAmount: string; daysOverdue: number }[];
  revenue: { thisMonth: number; lastMonth: number };
};
type AccountBalance = { accountId: string; accountName: string; accountNumber: string | null; rootType: string; totalDebit: number; totalCredit: number; netBalance: number };
type TrialBalanceReport = { asOfDate: string; accounts: AccountBalance[]; totalDebit: number; totalCredit: number; isBalanced: boolean };
type PnlReport = { fromDate: string; toDate: string; income: AccountBalance[]; expense: AccountBalance[]; totalIncome: number; totalExpense: number; netProfit: number };
type BalanceSheetReport = { asOfDate: string; assets: AccountBalance[]; liabilities: AccountBalance[]; equity: AccountBalance[]; totalAssets: number; totalLiabilities: number; totalEquity: number; isBalanced: boolean };
type ProjectPnl = { fromDate: string; toDate: string; costCenters: { costCenterId: string; costCenterName: string; projectId: string | null; income: number; expense: number; netProfit: number }[]; totalIncome: number; totalExpense: number };
type BankImport = { id: string; fileName: string; totalLines: number; importedAt: string };
type BankLine = { id: string; transactionDate: string; description: string | null; debitAmount: string; creditAmount: string; status: string };
// Company/CompanyScope/companyScopeQuery/CompanySelector now live in
// @/components/company-scope (Priority 17 remaining-gap pass, 2026-07-15) so
// Reports/Budgets/Sales-CRM/HR can reuse the exact same selector instead of
// each page forking its own copy -- imported above, not redefined here.

// Priority 17 re-sweep fix: was hardcoding "₹" -- now takes the caller's own
// `currencies` list (each panel below fetches it independently via
// useCurrencies(), and BalanceRows receives it as a prop since it's a
// shared sub-component) and resolves the org's real base currency instead.
function money(n: number, currencies: Currency[]) {
  return `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------
// Finance Dashboard tab
// ---------------------------------------------------------------------------
function DashboardPanel() {
  const currencies = useCurrencies();
  const [data, setData] = useState<FinanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // R52 Gate 2. `setData(await res.json())` stored the ERROR BODY as the
  // dashboard on any non-2xx: truthy, so the `!data` guard below waved it
  // through, and the render then read data.revenue.lastMonth off undefined.
  // The two answers must be separated -- "the ERP module isn't set up" is a
  // setup fact, "the read failed" is not.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await fetchJson<FinanceDashboard>("/api/finance-dashboard"));
    } catch (err) {
      setData(null);
      const msg = errorMessage(err, "Couldn't load finance dashboard");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (!data) return <p className="py-10 text-center text-sm text-px-muted">Couldn&apos;t load the finance dashboard. (An org needs its ERP module + a chart of accounts set up first.)</p>;

  const revenueChange = data.revenue.lastMonth > 0 ? ((data.revenue.thisMonth - data.revenue.lastMonth) / data.revenue.lastMonth) * 100 : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="shadow-card"><CardContent className="p-4"><p className="text-xs font-medium text-px-muted uppercase">Cash Position</p><p className="mt-1 text-2xl font-bold text-px-ink">{money(data.cashPosition, currencies)}</p></CardContent></Card>
        <Card className="shadow-card"><CardContent className="p-4"><p className="text-xs font-medium text-px-muted uppercase">AR Outstanding</p><p className="mt-1 text-2xl font-bold text-px-ink">{money(data.arAging.totalOutstanding, currencies)}</p></CardContent></Card>
        <Card className="shadow-card"><CardContent className="p-4"><p className="text-xs font-medium text-px-muted uppercase">Revenue (This Month)</p><p className="mt-1 text-2xl font-bold text-px-ink">{money(data.revenue.thisMonth, currencies)}</p>{revenueChange !== null && <p className={`text-xs ${revenueChange >= 0 ? "text-green-600" : "text-red-600"}`}>{revenueChange >= 0 ? "+" : ""}{revenueChange.toFixed(1)}% vs last month</p>}</CardContent></Card>
        <Card className="shadow-card"><CardContent className="p-4"><p className="text-xs font-medium text-px-muted uppercase">90+ Days Overdue</p><p className="mt-1 text-2xl font-bold text-red-600">{money(data.arAging.buckets.d90Plus, currencies)}</p></CardContent></Card>
      </div>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">AR Aging</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-2 text-center text-sm">
            {[["Current", data.arAging.buckets.current], ["1-30d", data.arAging.buckets.d1_30], ["31-60d", data.arAging.buckets.d31_60], ["61-90d", data.arAging.buckets.d61_90], ["90+d", data.arAging.buckets.d90Plus]].map(([label, value]) => (
              <div key={label as string} className="rounded-md border p-3">
                <p className="text-xs text-px-muted">{label}</p>
                <p className="mt-1 font-semibold text-px-ink">{money(value as number, currencies)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base">Top Overdue Invoices</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.topOverdueInvoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-px-muted">No overdue invoices.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Days Overdue</TableHead><TableHead>Outstanding</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.topOverdueInvoices.map((inv) => (
                  <TableRow key={inv.invoiceId}>
                    <TableCell className="font-medium">#{inv.invoiceNumber}</TableCell>
                    <TableCell className="text-px-muted">{inv.customerName ?? "—"}</TableCell>
                    <TableCell className="text-red-600">{inv.daysOverdue}d</TableCell>
                    <TableCell>{money(Number(inv.outstandingAmount), currencies)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// General Ledger tab
// ---------------------------------------------------------------------------
type JeLine = { accountId: string; debit: string; credit: string };

function GeneralLedgerPanel() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [accounts, setAccounts] = useState<Account[]>([]);
  // Priority 19 Part 2, Workstream B: this used to be indistinguishable from
  // "still loading" (both rendered the same "Loading…" placeholder) --
  // root cause was zero accounts existing for any real org (erp_accounts had
  // no rows), now fixed at the source via compliance-tracker's
  // erp-enablement-service.ts seeding a default chart of accounts on ERP
  // enablement. This flag is a small defensive hardening on top of that fix
  // so a genuinely-empty chart of accounts (e.g. after backfilling data,
  // before this fix shipped) still reads as an honest empty state, not a
  // stuck spinner.
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [userRemark, setUserRemark] = useState("");
  const [lines, setLines] = useState<JeLine[]>([{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }]);
  const currencies = useCurrencies();

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/journal-entries?${params.toString()}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      toast.error("Couldn't load the General Ledger");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, statusFilter]);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next || accountsLoaded) return;
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch {
      toast.error("Couldn't load chart of accounts");
    } finally {
      setAccountsLoaded(true);
    }
  }

  function updateLine(idx: number, patch: Partial<JeLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const balanced = lines.length >= 2 && Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  async function createEntry() {
    if (!balanced) { toast.error("Debit and credit totals must match"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/journal-entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postingDate, userRemark: userRemark || undefined,
          lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error ?? "Failed"); }
      toast.success("Journal entry drafted");
      setUserRemark(""); setLines([{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }]); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create journal entry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search remarks…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="max-w-xs" />
          <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["draft", "submitted"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load}>Search</Button>
        </div>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> New Journal Entry</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Journal Entry</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Posting Date</Label><Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Remark</Label><Input value={userRemark} onChange={(e) => setUserRemark(e.target.value)} placeholder="e.g. Site 4 material accrual" /></div>
              </div>
              <div className="space-y-2">
                <Label>Lines (double-entry — debit must equal credit)</Label>
                {lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_90px_90px_28px] items-center gap-1.5">
                    <Select value={line.accountId} onValueChange={(v) => updateLine(idx, { accountId: v })}>
                      <SelectTrigger><SelectValue placeholder={!accountsLoaded ? "Loading…" : accounts.length ? "Account" : "No chart of accounts found in VERIDIAN"} /></SelectTrigger>
                      <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" placeholder="Debit" value={line.debit} onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? "" : line.credit })} />
                    <Input type="number" placeholder="Credit" value={line.credit} onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? "" : line.debit })} />
                    <Button variant="ghost" size="icon" disabled={lines.length <= 2} onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { accountId: "", debit: "", credit: "" }])}><Plus className="size-3.5" /> Add Line</Button>
              </div>
              <div className={`rounded-md border p-2 text-sm ${balanced ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"}`}>
                Debit {money(totalDebit, currencies)} &middot; Credit {money(totalCredit, currencies)} {balanced ? "— balanced" : "— must balance before posting"}
              </div>
            </div>
            <DialogFooter><Button onClick={createEntry} disabled={submitting || !balanced}>{submitting ? "Creating…" : "Create Draft Entry"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No journal entries found.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Posting Date</TableHead><TableHead>Remark</TableHead><TableHead>Debit</TableHead><TableHead>Credit</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-px-muted">{e.entryNumber}</TableCell>
                    <TableCell>{formatDate(e.postingDate)}</TableCell>
                    <TableCell className="text-px-muted">{e.userRemark ?? e.referenceType ?? "—"}</TableCell>
                    <TableCell>{money(Number(e.totalDebit), currencies)}</TableCell>
                    <TableCell>{money(Number(e.totalCredit), currencies)}</TableCell>
                    <TableCell><Badge variant={e.status === "submitted" ? "default" : "outline"} className="capitalize">{e.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm text-px-muted">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="size-4" /></Button>
          Page {page} of {totalPages}
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="size-4" /></Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trial Balance / P&L / Balance Sheet tabs (shared date-range pattern)
// ---------------------------------------------------------------------------
function BalanceRows({ rows, currencies }: { rows: AccountBalance[]; currencies: Currency[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Net</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.accountId}>
            <TableCell>{r.accountNumber ? `${r.accountNumber} — ` : ""}{r.accountName}</TableCell>
            <TableCell className="text-right">{money(r.totalDebit, currencies)}</TableCell>
            <TableCell className="text-right">{money(r.totalCredit, currencies)}</TableCell>
            <TableCell className="text-right font-medium">{money(r.netBalance, currencies)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TrialBalancePanel({ scope }: { scope: CompanyScope }) {
  const currencies = useCurrencies();
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // R52 Gate 2: res.ok unread, and the render below does `!report ? null` -- so
  // a failed statement drew a completely blank panel under a Generate button
  // that looked as though it had worked.
  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setReport(await fetchJson<TrialBalanceReport>(`/api/trial-balance?asOfDate=${asOfDate}${companyScopeQuery(scope)}`));
    } catch (err) {
      setReport(null);
      const msg = errorMessage(err, "Couldn't generate trial balance");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [scope.companyId, scope.consolidate]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="space-y-1.5"><Label>As of</Label><Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} /></div>
        <Button size="sm" onClick={load}>Generate</Button>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            : loadError ? <div className="p-4"><LoadError message={loadError} onRetry={load} /></div>
            : !report || report.accounts.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No postings yet.</p>
            : (<>
              <BalanceRows rows={report.accounts} currencies={currencies} />
              <div className="flex items-center justify-between border-t p-3 text-sm font-semibold">
                <span>Total</span>
                <span>{money(report.totalDebit, currencies)} / {money(report.totalCredit, currencies)} {report.isBalanced ? <Badge className="ml-2" variant="default">Balanced</Badge> : <Badge className="ml-2" variant="destructive">Out of balance</Badge>}</span>
              </div>
            </>)}
        </CardContent>
      </Card>
    </div>
  );
}

function ProfitAndLossPanel({ scope }: { scope: CompanyScope }) {
  const currencies = useCurrencies();
  const now = new Date();
  const [fromDate, setFromDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => now.toISOString().slice(0, 10));
  const [report, setReport] = useState<PnlReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setReport(await fetchJson<PnlReport>(`/api/profit-and-loss?fromDate=${fromDate}&toDate=${toDate}${companyScopeQuery(scope)}`));
    } catch (err) {
      setReport(null);
      const msg = errorMessage(err, "Couldn't generate P&L");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [scope.companyId, scope.consolidate]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="space-y-1.5"><Label>From</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>To</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
        <Button size="sm" onClick={load}>Generate</Button>
      </div>
      {loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div> : loadError ? <LoadError message={loadError} onRetry={load} /> : !report ? null : (
        <div className="space-y-4">
          <Card className="shadow-card"><CardHeader><CardTitle className="text-base">Income</CardTitle></CardHeader><CardContent className="p-0">{report.income.length === 0 ? <p className="py-6 text-center text-sm text-px-muted">No income postings.</p> : <BalanceRows rows={report.income} currencies={currencies} />}</CardContent></Card>
          <Card className="shadow-card"><CardHeader><CardTitle className="text-base">Expense</CardTitle></CardHeader><CardContent className="p-0">{report.expense.length === 0 ? <p className="py-6 text-center text-sm text-px-muted">No expense postings.</p> : <BalanceRows rows={report.expense} currencies={currencies} />}</CardContent></Card>
          <Card className="shadow-card"><CardContent className="flex items-center justify-between p-4 text-sm font-semibold"><span>Net Profit</span><span className={report.netProfit >= 0 ? "text-green-600" : "text-red-600"}>{money(report.netProfit, currencies)}</span></CardContent></Card>
        </div>
      )}
    </div>
  );
}

function BalanceSheetPanel({ scope }: { scope: CompanyScope }) {
  const currencies = useCurrencies();
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<BalanceSheetReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setReport(await fetchJson<BalanceSheetReport>(`/api/balance-sheet?asOfDate=${asOfDate}${companyScopeQuery(scope)}`));
    } catch (err) {
      setReport(null);
      const msg = errorMessage(err, "Couldn't generate balance sheet");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [scope.companyId, scope.consolidate]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="space-y-1.5"><Label>As of</Label><Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} /></div>
        <Button size="sm" onClick={load}>Generate</Button>
      </div>
      {loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div> : loadError ? <LoadError message={loadError} onRetry={load} /> : !report ? null : (
        <div className="space-y-4">
          <Card className="shadow-card"><CardHeader><CardTitle className="text-base">Assets — {money(report.totalAssets, currencies)}</CardTitle></CardHeader><CardContent className="p-0">{report.assets.length === 0 ? <p className="py-6 text-center text-sm text-px-muted">No asset postings.</p> : <BalanceRows rows={report.assets} currencies={currencies} />}</CardContent></Card>
          <Card className="shadow-card"><CardHeader><CardTitle className="text-base">Liabilities — {money(report.totalLiabilities, currencies)}</CardTitle></CardHeader><CardContent className="p-0">{report.liabilities.length === 0 ? <p className="py-6 text-center text-sm text-px-muted">No liability postings.</p> : <BalanceRows rows={report.liabilities} currencies={currencies} />}</CardContent></Card>
          <Card className="shadow-card"><CardHeader><CardTitle className="text-base">Equity — {money(report.totalEquity, currencies)}</CardTitle></CardHeader><CardContent className="p-0">{report.equity.length === 0 ? <p className="py-6 text-center text-sm text-px-muted">No equity postings.</p> : <BalanceRows rows={report.equity} currencies={currencies} />}</CardContent></Card>
          <Card className="shadow-card"><CardContent className="flex items-center justify-between p-4 text-sm font-semibold">
            <span>Assets = Liabilities + Equity</span>
            {report.isBalanced ? <Badge variant="default">Balanced</Badge> : <Badge variant="destructive">Out of balance</Badge>}
          </CardContent></Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// P&L by Project tab
// ---------------------------------------------------------------------------
function ProjectPnlPanel({ scope }: { scope: CompanyScope }) {
  const currencies = useCurrencies();
  const now = new Date();
  const [fromDate, setFromDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => now.toISOString().slice(0, 10));
  const [report, setReport] = useState<ProjectPnl | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/profit-and-loss-by-project?fromDate=${fromDate}&toDate=${toDate}${companyScopeQuery(scope)}`);
      setReport(await res.json());
    } catch {
      toast.error("Couldn't generate per-project P&L");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [scope.companyId, scope.consolidate]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="space-y-1.5"><Label>From</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>To</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
        <Button size="sm" onClick={load}>Generate</Button>
      </div>
      <p className="text-xs text-px-muted">Requires journal-entry lines tagged with a cost center linked to a project (VERIDIAN&apos;s Chart of Accounts / Cost Centers setup). Cost centers with no tagged postings in this range won&apos;t appear.</p>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            : !report || report.costCenters.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No cost-center-tagged postings in this range.</p>
            : (
              <Table>
                <TableHeader><TableRow><TableHead>Project / Cost Center</TableHead><TableHead className="text-right">Income</TableHead><TableHead className="text-right">Expense</TableHead><TableHead className="text-right">Net Profit</TableHead></TableRow></TableHeader>
                <TableBody>
                  {report.costCenters.map((c) => (
                    <TableRow key={c.costCenterId}>
                      <TableCell className="font-medium">{c.costCenterName}</TableCell>
                      <TableCell className="text-right">{money(c.income, currencies)}</TableCell>
                      <TableCell className="text-right">{money(c.expense, currencies)}</TableCell>
                      <TableCell className={`text-right font-medium ${c.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{money(c.netProfit, currencies)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

// CompanySelector (was defined here, Priority 17 Wave 1) now lives in
// @/components/company-scope -- imported above, reused as-is.

// ---------------------------------------------------------------------------
// Companies / Offices tab -- list + create. erp_companies (Wave 67) supports
// a real parent-child tree (an office/branch under a parent company), which
// is what makes the "Consolidated" scope above meaningful.
// ---------------------------------------------------------------------------
function CompaniesPanel({ companies, loading, onCreated }: { companies: Company[]; loading: boolean; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [abbr, setAbbr] = useState("");
  const [country, setCountry] = useState("");
  const [parentCompanyId, setParentCompanyId] = useState<string>("__none__");
  const [isGroup, setIsGroup] = useState(false);

  async function createCompany() {
    if (!companyName.trim()) { toast.error("Company name is required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName, abbr: abbr || undefined, country: country || undefined,
          parentCompanyId: parentCompanyId === "__none__" ? undefined : parentCompanyId,
          isGroup,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error ?? "Failed"); }
      toast.success("Company created");
      setCompanyName(""); setAbbr(""); setCountry(""); setParentCompanyId("__none__"); setIsGroup(false); setOpen(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create company");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-px-muted">Legal entities / offices within this org&apos;s ERP. Chart of accounts is shared across companies; reports can be scoped to one company or consolidated across its sub-companies from the selector above the financial-report tabs.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> New Company / Office</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New Company / Office</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Company Name</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Interiors — Mumbai Office" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Abbreviation</Label><Input value={abbr} onChange={(e) => setAbbr(e.target.value)} placeholder="e.g. AIM" /></div>
                <div className="space-y-1.5"><Label>Country</Label><Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. India" /></div>
              </div>
              <div className="space-y-1.5">
                <Label>Parent Company (optional)</Label>
                <Select value={parentCompanyId} onValueChange={setParentCompanyId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None (top-level company)</SelectItem>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} className="size-4" />
                This is a group/holding entity (organizational grouping, not its own set of postings)
              </label>
            </div>
            <DialogFooter><Button onClick={createCompany} disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : companies.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No companies/offices set up yet — everything defaults to org-wide.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Abbr.</TableHead><TableHead>Parent</TableHead><TableHead>Country</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.companyName}</TableCell>
                    <TableCell className="text-px-muted">{c.abbr ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{companies.find((p) => p.id === c.parentCompanyId)?.companyName ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{c.country ?? "—"}</TableCell>
                    <TableCell>{c.isGroup ? <Badge variant="outline">Group</Badge> : <Badge variant="outline">Company</Badge>}</TableCell>
                    <TableCell><Badge variant={c.isActive ? "default" : "outline"}>{c.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank Reconciliation tab (read-only for this wave)
// ---------------------------------------------------------------------------
function BankReconciliationPanel() {
  const currencies = useCurrencies();
  const [imports, setImports] = useState<BankImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [lines, setLines] = useState<BankLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/bank-reconciliation");
        const data = await res.json();
        setImports(data.imports ?? []);
      } catch {
        toast.error("Couldn't load bank statement imports");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function viewImport(id: string) {
    setSelectedImportId(id);
    setLinesLoading(true);
    try {
      const res = await fetch(`/api/bank-reconciliation?importId=${id}`);
      const data = await res.json();
      setLines(data.lines ?? []);
    } catch {
      toast.error("Couldn't load statement lines");
    } finally {
      setLinesLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-px-muted">Read-only for this wave — importing a new bank statement (file upload) and matching lines to journal entries is done from VERIDIAN&apos;s own Accounting workspace for now.</p>
      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
      ) : imports.length === 0 ? (
        <p className="py-10 text-center text-sm text-px-muted">No bank statements imported yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Card className="shadow-card">
            <CardContent className="p-2">
              {imports.map((imp) => (
                <button key={imp.id} onClick={() => viewImport(imp.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${selectedImportId === imp.id ? "bg-px-orange/10 text-px-ink" : "hover:bg-muted"}`}>
                  <div className="font-medium">{imp.fileName}</div>
                  <div className="text-xs text-px-muted">{imp.totalLines} lines &middot; {formatDate(imp.importedAt)}</div>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardContent className="p-0">
              {!selectedImportId ? <p className="py-10 text-center text-sm text-px-muted">Select an import to view its lines.</p>
                : linesLoading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
                : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {lines.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>{formatDate(l.transactionDate)}</TableCell>
                          <TableCell className="text-px-muted">{l.description ?? "—"}</TableCell>
                          <TableCell className="text-right">{Number(l.debitAmount) > 0 ? money(Number(l.debitAmount), currencies) : "—"}</TableCell>
                          <TableCell className="text-right">{Number(l.creditAmount) > 0 ? money(Number(l.creditAmount), currencies) : "—"}</TableCell>
                          <TableCell><Badge variant={l.status === "matched" ? "default" : "outline"} className="capitalize">{l.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root client
// ---------------------------------------------------------------------------
const REPORT_TABS = new Set(["trial-balance", "pnl", "balance-sheet", "project-pnl"]);

export default function AccountingClient() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  // Defaults to "All companies / consolidated" (companyId: null), matching
  // every existing report's unchanged pre-Priority-17 behavior -- an org
  // that never sets up companies/offices sees no change at all.
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  async function loadCompanies() {
    setCompaniesLoading(true);
    try {
      const res = await fetch("/api/companies");
      const data = await res.json();
      setCompanies(data.companies ?? []);
    } catch {
      toast.error("Couldn't load companies");
    } finally {
      setCompaniesLoading(false);
    }
  }
  useEffect(() => { loadCompanies(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-px-muted">
        <Landmark className="size-4" />
        <span>Real GL data from VERIDIAN AI OS — every journal entry, report, and balance below is generated from actual postings.</span>
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="ledger">General Ledger</TabsTrigger>
          <TabsTrigger value="trial-balance">Trial Balance</TabsTrigger>
          <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
          <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
          <TabsTrigger value="project-pnl">P&amp;L by Project</TabsTrigger>
          <TabsTrigger value="bank-rec">Bank Reconciliation</TabsTrigger>
          <TabsTrigger value="companies">Companies</TabsTrigger>
        </TabsList>
        {REPORT_TABS.has(activeTab) && (
          <div className="mt-3">
            <CompanySelector companies={companies} scope={scope} onChange={setScope} />
          </div>
        )}
        <TabsContent value="dashboard"><DashboardPanel /></TabsContent>
        <TabsContent value="ledger"><GeneralLedgerPanel /></TabsContent>
        <TabsContent value="trial-balance"><TrialBalancePanel scope={scope} /></TabsContent>
        <TabsContent value="pnl"><ProfitAndLossPanel scope={scope} /></TabsContent>
        <TabsContent value="balance-sheet"><BalanceSheetPanel scope={scope} /></TabsContent>
        <TabsContent value="project-pnl"><ProjectPnlPanel scope={scope} /></TabsContent>
        <TabsContent value="bank-rec"><BankReconciliationPanel /></TabsContent>
        <TabsContent value="companies"><CompaniesPanel companies={companies} loading={companiesLoading} onCreated={loadCompanies} /></TabsContent>
      </Tabs>
    </div>
  );
}
