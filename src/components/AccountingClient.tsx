"use client";

// Priority 15: PROJEXA's Accounting surface -- 6 tabs over VERIDIAN's real
// GL/financial-reporting engine, sized for a ~100-employee firm running
// ~500 projects: a Finance dashboard (cash position, AR aging, revenue
// trend), a paginated/filtered General Ledger with real double-entry
// journal-entry creation (debit=credit validated server-side), Trial
// Balance / P&L / Balance Sheet as generated reports with a date-range
// picker, a P&L-by-project rollup (the view a 500-project firm actually
// needs, not just company-wide), and a read-only Bank Reconciliation view.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Landmark, ChevronLeft, ChevronRight } from "lucide-react";
import { Currency, currencyLabel, useCurrencies } from "@/lib/currency";
import { type Company, type CompanyScope, companyScopeQuery, CompanySelector } from "@/components/company-scope";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
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

  useEffect(() => {
    (async () => {
      try {
        setData(await fetchJson("/api/finance-dashboard"));
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't load finance dashboard"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  if (!data) return <p className="py-10 text-center text-sm text-px-muted">Couldn&apos;t load the finance dashboard. (An org needs its ERP module + a chart of accounts set up first.)</p>;

  const revenueChange = data.revenue.lastMonth > 0 ? ((data.revenue.thisMonth - data.revenue.lastMonth) / data.revenue.lastMonth) * 100 : null;
  // F_020: no GL activity posted yet for this org -- every card below would
  // read zero with zero explanation. Every sibling tab in this file already
  // renders an honest "No postings yet." / "No journal entries found."
  // empty state instead of bare zeroes (see TrialBalancePanel,
  // ProfitAndLossPanel, BalanceSheetPanel, GeneralLedgerPanel,
  // CompaniesPanel below) -- Dashboard was the one tab missing that
  // pattern. The underlying numbers aren't wrong: this panel is GL-only by
  // design (real double-entry postings, per the banner above the tabs), and
  // deliberately doesn't source from the revenue/expense figures Projects
  // shows per-project -- those aren't linked to Accounting until actually
  // submitted/posted here. AED 0 with no context reads as a broken
  // calculation instead of an unposted ledger; this banner makes that
  // distinction explicit instead of silently rendering zeroes.
  const noPostedActivity = data.cashPosition === 0 && data.arAging.totalOutstanding === 0 && data.revenue.thisMonth === 0 && data.revenue.lastMonth === 0 && data.topOverdueInvoices.length === 0;

  return (
    <div className="space-y-4">
      {noPostedActivity && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          No journal entries have been posted to the General Ledger yet, so every figure below reads {money(0, currencies)}. Submit a sales/purchase invoice or post a manual entry from the General Ledger tab to see real postings here — these figures are independent of the revenue/expenses shown per-project under Projects, which aren&apos;t linked to Accounting until posted.
        </div>
      )}
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
function GeneralLedgerPanel() {
  const router = useRouter();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const currencies = useCurrencies();

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const data = await fetchJson(`/api/journal-entries?${params.toString()}`);
      setEntries(data.entries ?? []);
      setTotalPages(data.totalPages ?? 1);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load the General Ledger"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, statusFilter]);

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
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Journal Entry" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push("/accounting/journal-entries/new")}><Plus className="size-4" /> New Journal Entry</Button>
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
                  // Real screen navigation (2026-08-30) -- rows now open the
                  // real Object Page instead of nothing (no detail view
                  // existed for a single entry before this).
                  <TableRow key={e.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/accounting/journal-entries/${e.id}`)}>
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

  async function load() {
    setLoading(true);
    try {
      setReport(await fetchJson(`/api/trial-balance?asOfDate=${asOfDate}${companyScopeQuery(scope)}`));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't generate trial balance"));
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

  async function load() {
    setLoading(true);
    try {
      setReport(await fetchJson(`/api/profit-and-loss?fromDate=${fromDate}&toDate=${toDate}${companyScopeQuery(scope)}`));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't generate P&L"));
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
      {loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div> : !report ? null : (
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

  async function load() {
    setLoading(true);
    try {
      setReport(await fetchJson(`/api/balance-sheet?asOfDate=${asOfDate}${companyScopeQuery(scope)}`));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't generate balance sheet"));
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
      {loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div> : !report ? null : (
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
      setReport(await fetchJson(`/api/profit-and-loss-by-project?fromDate=${fromDate}&toDate=${toDate}${companyScopeQuery(scope)}`));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't generate per-project P&L"));
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
function CompaniesPanel({ companies, loading }: { companies: Company[]; loading: boolean }) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-px-muted">Legal entities / offices within this org&apos;s ERP. Chart of accounts is shared across companies; reports can be scoped to one company or consolidated across its sub-companies from the selector above the financial-report tabs.</p>
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Company / Office" Dialog popup with a real create route. */}
        <Button size="sm" onClick={() => router.push("/accounting/companies/new")}><Plus className="size-4" /> New Company / Office</Button>
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
        const data = await fetchJson("/api/bank-reconciliation");
        setImports(data.imports ?? []);
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't load bank statement imports"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function viewImport(id: string) {
    setSelectedImportId(id);
    setLinesLoading(true);
    try {
      const data = await fetchJson(`/api/bank-reconciliation?importId=${id}`);
      setLines(data.lines ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load statement lines"));
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
const VALID_TABS = new Set(["dashboard", "ledger", ...REPORT_TABS, "bank-rec", "companies"]);

export default function AccountingClient({ initialTab }: { initialTab?: string }) {
  // Real-screen conversion (2026-08-30): the tab used to be internal-only
  // state, defaulting to "dashboard" on every load regardless of the URL --
  // the new Journal-Entry/Company create screens redirect back to
  // /accounting?tab=ledger / ?tab=companies after a real save, and that
  // redirect needs somewhere real to land. `initialTab` is resolved
  // server-side (accounting/page.tsx) rather than via client-side
  // useSearchParams(), matching ScheduleTabsClient.tsx's own pattern exactly
  // (avoids the Suspense-boundary requirement useSearchParams() imposes).
  // history.replaceState (not router.push) so switching tabs doesn't reload
  // the Server Component.
  const [activeTab, setActiveTabState] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "dashboard");
  function setActiveTab(next: string) {
    setActiveTabState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  // Defaults to "All companies / consolidated" (companyId: null), matching
  // every existing report's unchanged pre-Priority-17 behavior -- an org
  // that never sets up companies/offices sees no change at all.
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  async function loadCompanies() {
    setCompaniesLoading(true);
    try {
      const data = await fetchJson("/api/companies");
      setCompanies(data.companies ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load companies"));
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
        <TabsContent value="companies"><CompaniesPanel companies={companies} loading={companiesLoading} /></TabsContent>
      </Tabs>
    </div>
  );
}
