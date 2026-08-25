"use client";

// R46 P8 seq133: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list and R46 P8 seq127/seq128/seq134 established
// for drawings.list/documents.list/variations.list (see those Client
// components' header comments for the full history). Only the 3 real data
// columns (Name/Status/Action if Exceeded) are registry-driven: COLUMNS is
// now the fallback used when budgets/page.tsx's server-side resolve of the
// budget.list screen_definitions row returns null (404/error), same "keep
// the hardcoded version behind a flag until verified" contract as the
// other three conversions. The CompanySelector, New Budget dialog, and its
// VERIDIAN lookups (fiscal years/cost centers/accounts) are unrelated to
// the list's own columns and are kept exactly as-is.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
// Priority 17 remaining gap (2026-07-15): erp_budgets.companyId has existed
// since Wave 70 (createBudget already accepted it) -- this wires the UI
// selector, reusing AccountingClient.tsx's exact component.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";

type Budget = { id: string; name: string; fiscalYearId: string; companyId: string | null; costCenterId: string | null; status: string; actionIfExceeded: string | null };
type FiscalYear = { id: string; yearName: string; startDate: string; endDate: string; isClosed: boolean };
type CostCenter = { id: string; name: string; projectId: string | null };
// Priority 19 Part 2, Workstream B: erp_accounts now gets a real default
// chart of accounts seeded on ERP enablement (see compliance-tracker's
// erp-enablement-service.ts), and /api/v1/projexa/accounts already existed
// (AccountingClient.tsx's account picker) -- this was just never wired into
// the Budgets dialog, which is why the line item's account ID was a
// paste-an-opaque-ID free-text field. Reusing the same lookup here closes
// that.
type Account = { id: string; accountName: string; accountNumber: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", approved: "default",
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / DrawingsClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Status", field: "status", type: "text", importance: "High" },
  { label: "Action if Exceeded", field: "actionIfExceeded", type: "text", importance: "Medium" },
];

// Per-field cell renderer -- this screen isn't built on the kit's
// ListScreen, so unlike PermitsListClient there's no generic
// column-type-driven renderer to hand columns to. A registry row can still
// reorder/relabel these 3 columns live (the hard-stop test); the actual
// cell value for each known field is still this project's own formatting
// logic, looked up by field name so reordering doesn't change what renders.
function renderBudgetCell(field: string, b: Budget) {
  switch (field) {
    case "name":
      return <span className="font-medium">{b.name}</span>;
    case "status":
      return <Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge>;
    case "actionIfExceeded":
      return <span className="text-px-muted">{b.actionIfExceeded ?? "—"}</span>;
    default:
      return String((b as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function BudgetsClient({ registryColumns }: { registryColumns?: RegistryColumn[] | null }) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;

  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(false);

  // Priority 17 remaining gap: companies list + list-level filter scope,
  // same pattern as AccountingClient.tsx/LeadsClient.tsx.
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  const [name, setName] = useState("");
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [annualAmount, setAnnualAmount] = useState("");
  const [budgetCompanyId, setBudgetCompanyId] = useState<string>("__none__");

  async function load(companyId: string | null = null) {
    setLoading(true);
    try {
      const qs = companyId ? `?companyId=${companyId}` : "";
      const res = await fetch(`/api/project-budgets${qs}`);
      const data = await res.json();
      setBudgets(data.projectBudgets ?? []);
    } catch {
      toast.error("Couldn't load budgets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(scope.companyId); }, [scope.companyId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/companies");
        const data = await res.json();
        setCompanies(data.companies ?? []);
      } catch {
        // Non-fatal -- CompanySelector renders nothing when companies is empty.
      }
    })();
  }, []);

  async function loadLookups() {
    setLookupsLoading(true);
    try {
      const [fyRes, ccRes, acRes] = await Promise.all([fetch("/api/fiscal-years"), fetch("/api/cost-centers"), fetch("/api/accounts")]);
      const [fyData, ccData, acData] = await Promise.all([fyRes.json(), ccRes.json(), acRes.json()]);
      setFiscalYears(fyData.fiscalYears ?? []);
      setCostCenters(ccData.costCenters ?? []);
      setAccounts(acData.accounts ?? []);
    } catch {
      toast.error("Couldn't load fiscal years / cost centers / accounts from VERIDIAN");
    } finally {
      setLookupsLoading(false);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) loadLookups();
  }

  async function createBudget() {
    if (!name.trim() || !fiscalYearId || !accountId.trim() || !annualAmount) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/project-budgets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, fiscalYearId, costCenterId: costCenterId || undefined,
          companyId: budgetCompanyId === "__none__" ? undefined : budgetCompanyId,
          lineItems: [{ accountId, annualAmount: Number(annualAmount) }],
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Budget created");
      setName(""); setFiscalYearId(""); setCostCenterId(""); setAccountId(""); setAnnualAmount(""); setBudgetCompanyId("__none__"); setOpen(false);
      load(scope.companyId);
    } catch {
      toast.error("Couldn't create budget");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <CompanySelector companies={companies} scope={scope} onChange={setScope} showConsolidateToggle={false} />
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-px-muted">
          Fiscal year, cost center, and the line item&apos;s account are all looked up live from VERIDIAN&apos;s ERP
          module below — no more guessing an opaque ID.
        </p>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild><Button className="shrink-0"><Plus className="size-4" /> New Budget</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Budget</DialogTitle></DialogHeader>
            {lookupsLoading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Budget Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1.5">
                  <Label>Fiscal Year</Label>
                  <Select value={fiscalYearId} onValueChange={setFiscalYearId}>
                    <SelectTrigger><SelectValue placeholder={fiscalYears.length ? "Select a fiscal year" : "No fiscal years found in VERIDIAN"} /></SelectTrigger>
                    <SelectContent>
                      {fiscalYears.map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.yearName}{fy.isClosed ? " (closed)" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Cost Center (optional)</Label>
                  <Select value={costCenterId} onValueChange={setCostCenterId}>
                    <SelectTrigger><SelectValue placeholder={costCenters.length ? "Select a cost center" : "No cost centers found in VERIDIAN"} /></SelectTrigger>
                    <SelectContent>
                      {costCenters.map((cc) => <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Account</Label>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger><SelectValue placeholder={accounts.length ? "Select an account" : "No chart of accounts found in VERIDIAN"} /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.accountNumber ? `${a.accountNumber} — ` : ""}{a.accountName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Annual Amount</Label><Input type="number" value={annualAmount} onChange={(e) => setAnnualAmount(e.target.value)} /></div>
                {companies.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Company / Office (optional)</Label>
                    <Select value={budgetCompanyId} onValueChange={setBudgetCompanyId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Org-wide (no specific company)</SelectItem>
                        {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            <DialogFooter><Button onClick={createBudget} disabled={submitting || lookupsLoading}>{submitting ? "Creating…" : "Create Budget"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : budgets.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No budgets found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.map((b) => (
                  <TableRow key={b.id}>
                    {columns.map((col) => (
                      <TableCell key={col.field}>{renderBudgetCell(col.field, b)}</TableCell>
                    ))}
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
