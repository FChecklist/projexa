"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Loader2, Plus, PlayCircle, Trash2, FileDown, FileText } from "lucide-react";
import { useOrgRole } from "@/hooks/use-org-role";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type PayrollRun = { id: string; month: number; year: number; status: string; processedAt: string | null };
type PayslipLine = { id: string; label: string; lineType: "earning" | "deduction"; amount: string };
type Payslip = { id: string; employeeId: string; employeeName: string; grossEarnings: string; totalDeductions: string; netPay: string; status: string; lines: PayslipLine[] };
type SalaryComponent = { id: string; name: string; componentType: "earning" | "deduction"; calculationType: string; defaultPercentage: string | null; defaultAmount: string | null; isStatutory: boolean; includeInPfWage: boolean };
type SalaryStructure = { id: string; employeeId: string; employeeName: string; employeeCode: string | null; effectiveFrom: string; ctcAnnual: string; state: string | null; components: { componentId: string; amount: string | null; percentage: string | null; component: { name: string } }[] };
type StatutoryRule = { id: string; ruleType: string; state: string | null; effectiveFrom: string; effectiveTo: string | null; employeeRate: string | null; employerRate: string | null; wageCeiling: string | null; slabs: { uptoAmount: number; taxAmount: number }[] | null };
type IncomeTaxSlab = { id: string; name: string; effectiveFrom: string; standardDeduction: string; rates: { fromAmount: string; toAmount: string | null; percentDeduction: string }[] };
type Employee = { id: string; name: string; profile: { employeeCode: string | null } | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PayrollClient() {
  // Priority 19 Part 2, Workstream C: "Income Tax" tab is India-specific
  // (progressive income-tax slabs -- not applicable to UAE, which has no
  // personal income tax) -- gated on isIndiaOrg, hidden (not errored) for
  // non-IN orgs.
  const { isHrAdmin, isIndiaOrg } = useOrgRole();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [rules, setRules] = useState<StatutoryRule[]>([]);
  const [slabs, setSlabs] = useState<IncomeTaxSlab[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  // R52 F_031: a 504 must never render as an empty state -- see load().
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [registerRun, setRegisterRun] = useState<PayrollRun | null>(null);
  const [registerPayslips, setRegisterPayslips] = useState<Payslip[]>([]);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [payslipDetail, setPayslipDetail] = useState<Payslip | null>(null);
  const [tdsAmount, setTdsAmount] = useState("");
  const [payslipBusy, setPayslipBusy] = useState(false);

  const [runOpen, setRunOpen] = useState(false);
  const [runMonth, setRunMonth] = useState(String(new Date().getMonth() + 1));
  const [runYear, setRunYear] = useState(String(new Date().getFullYear()));
  const [runSubmitting, setRunSubmitting] = useState(false);

  const [compOpen, setCompOpen] = useState(false);
  const [compName, setCompName] = useState("");
  const [compType, setCompType] = useState<"earning" | "deduction">("earning");
  const [compCalc, setCompCalc] = useState("flat");
  const [compAmount, setCompAmount] = useState("");
  const [compPercentage, setCompPercentage] = useState("");
  const [compPfWage, setCompPfWage] = useState(false);
  const [compSubmitting, setCompSubmitting] = useState(false);

  const [structOpen, setStructOpen] = useState(false);
  const [structEmployeeId, setStructEmployeeId] = useState("");
  const [structEffectiveFrom, setStructEffectiveFrom] = useState("");
  const [structCtc, setStructCtc] = useState("");
  const [structState, setStructState] = useState("");
  const [structRows, setStructRows] = useState<{ componentId: string; amount: string; percentage: string }[]>([]);
  const [structSubmitting, setStructSubmitting] = useState(false);

  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleType, setRuleType] = useState<"pf" | "esi" | "professional_tax">("pf");
  const [ruleState, setRuleState] = useState("");
  const [ruleEffectiveFrom, setRuleEffectiveFrom] = useState("");
  const [ruleEmployeeRate, setRuleEmployeeRate] = useState("");
  const [ruleEmployerRate, setRuleEmployerRate] = useState("");
  const [ruleWageCeiling, setRuleWageCeiling] = useState("");
  const [ruleSlabRows, setRuleSlabRows] = useState<{ uptoAmount: string; taxAmount: string }[]>([]);
  const [ruleSubmitting, setRuleSubmitting] = useState(false);

  const [slabOpen, setSlabOpen] = useState(false);
  const [slabName, setSlabName] = useState("");
  const [slabEffectiveFrom, setSlabEffectiveFrom] = useState("");
  const [slabStdDeduction, setSlabStdDeduction] = useState("");
  const [slabRateRows, setSlabRateRows] = useState<{ fromAmount: string; toAmount: string; percentDeduction: string }[]>([]);
  const [slabSubmitting, setSlabSubmitting] = useState(false);

  const [assignEmployeeId, setAssignEmployeeId] = useState("");
  const [assignSlabId, setAssignSlabId] = useState("");
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  // R52 fix for F_031. RECORDED SYMPTOM: on the first two page loads every
  // payroll call returned 504, reproduced 2/2 on a full reload, while the same
  // endpoints answered 200 to direct curl in ~21s each -- i.e. right at
  // whatever edge timeout was killing the in-app fetch. The owner is very
  // likely to see a blank/broken Payroll page on a normal visit.
  //
  // WHAT IS AND IS NOT FIXED HERE. The ~21s backend latency is a VERIDIAN-side
  // condition (veridian-client.ts's own header comment documents the chronic
  // upstream hang and the 20s bound PROJEXA puts on it) and is NOT fixable from
  // this repo. Two things that ARE this component's fault are fixed:
  //
  //  1. SIX SIMULTANEOUS CALLS FOR ONE TAB. Every one of the six fired on
  //     mount even though the default tab ("runs") needs only two of them.
  //     Against a backend at ~20s/call that is the burst that pushes the whole
  //     page past the edge timeout. Now the two the first paint actually needs
  //     are fetched first and rendered as soon as they land; the four lookups
  //     that back the other tabs follow afterwards and never block first paint.
  //
  //  2. A FAILED CALL RENDERED AS AN EMPTY STATE. `(await res.json()).runs ?? []`
  //     does not check res.ok -- a 504 body is {"error": "..."}, which has no
  //     `runs` key, so `?? []` turned a timeout into "No payroll runs yet."
  //     A fake zero on a payroll screen is worse than an error. Every response
  //     is now checked, and a section that failed says so instead of claiming
  //     the org has no data. Promise.allSettled means one failed lookup no
  //     longer discards the five that succeeded, which is what Promise.all did.
  async function readList<T>(res: Response, key: string, label: string): Promise<T[]> {
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ? `${label}: ${body.error}` : `${label}: request failed (${res.status})`);
    }
    const body = await res.json();
    return (body?.[key] ?? []) as T[];
  }

  async function load() {
    setLoading(true);
    setLoadErrors([]);
    const failures: string[] = [];

    // Pass 1 -- only what the default "Payroll Runs" tab renders.
    try {
      const [runsRes, empRes] = await Promise.all([fetch("/api/payroll/runs"), fetch("/api/employees")]);
      const [runsList, empList] = await Promise.all([
        readList<PayrollRun>(runsRes, "runs", "Payroll runs"),
        readList<Employee>(empRes, "employees", "Employees"),
      ]);
      setRuns(runsList);
      setEmployees(empList);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "Payroll runs: request failed");
    }
    setLoading(false);

    // Pass 2 -- the lookups behind the other tabs. allSettled so one 504 does
    // not discard the others, which is exactly what the old Promise.all did.
    const [compRes, structRes, rulesRes, slabsRes] = await Promise.allSettled([
      fetch("/api/payroll/salary-components"),
      fetch("/api/payroll/salary-structures"),
      fetch("/api/payroll/statutory-rules"),
      fetch("/api/payroll/income-tax-slabs"),
    ]);

    const secondary: [PromiseSettledResult<Response>, string, string, (v: never[]) => void][] = [
      [compRes, "components", "Salary components", setComponents as (v: never[]) => void],
      [structRes, "structures", "Salary structures", setStructures as (v: never[]) => void],
      [rulesRes, "rules", "Statutory rules", setRules as (v: never[]) => void],
      [slabsRes, "slabs", "Income tax slabs", setSlabs as (v: never[]) => void],
    ];

    for (const [settled, key, label, setter] of secondary) {
      if (settled.status !== "fulfilled") {
        failures.push(`${label}: request failed`);
        continue;
      }
      try {
        setter((await readList(settled.value, key, label)) as never[]);
      } catch (err) {
        failures.push(err instanceof Error ? err.message : `${label}: request failed`);
      }
    }

    if (failures.length) {
      setLoadErrors(failures);
      toast.error("Some payroll data couldn't be loaded");
    }
  }

  useEffect(() => { load(); }, []);

  async function createRun() {
    setRunSubmitting(true);
    try {
      const res = await fetch("/api/payroll/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: Number(runMonth), year: Number(runYear) }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Payroll run created");
      setRunOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create payroll run");
    } finally {
      setRunSubmitting(false);
    }
  }

  async function processRun(id: string) {
    setProcessingId(id);
    try {
      const res = await fetch(`/api/payroll/runs/${id}/process`, { method: "POST" });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      const data = await res.json();
      toast.success(`Processed -- ${data.payslipCount ?? 0} payslip(s) generated`);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't process payroll run");
    } finally {
      setProcessingId(null);
    }
  }

  async function openRegister(run: PayrollRun) {
    setRegisterRun(run);
    setRegisterLoading(true);
    try {
      // The last site in this file still reading a body without the status.
      // A failed payslip read used to render the salary register as if the
      // run had no payslips at all.
      const data = await fetchJson<{ payslips?: Payslip[] }>(`/api/payroll/runs/${run.id}/payslips`);
      setRegisterPayslips(data.payslips ?? []);
    } catch (err) {
      setRegisterPayslips([]);
      toast.error(errorMessage(err, "Couldn't load payslips"));
    } finally {
      setRegisterLoading(false);
    }
  }

  function exportRegisterCsv() {
    if (!registerRun || registerPayslips.length === 0) return;
    const header = "Employee,Gross Earnings,Total Deductions,Net Pay,Status";
    const rows = registerPayslips.map((p) => `${p.employeeName},${p.grossEarnings},${p.totalDeductions},${p.netPay},${p.status}`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-register-${registerRun.year}-${String(registerRun.month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPayslipPdf(payslipId: string) {
    // Real per-payslip PDF (Priority 15 Wave 2) -- a plain navigation to the
    // proxy route rather than a fetch+blob dance, since the route already
    // sets Content-Disposition: attachment and the browser handles the
    // download natively.
    window.open(`/api/payroll/payslips/${payslipId}/pdf`, "_blank");
  }

  async function saveTds() {
    if (!payslipDetail) return;
    setPayslipBusy(true);
    try {
      const res = await fetch(`/api/payroll/payslips/${payslipDetail.id}/tds`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tdsAmount: Number(tdsAmount) }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("TDS updated");
      if (registerRun) openRegister(registerRun);
      setPayslipDetail(null);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't update TDS");
    } finally {
      setPayslipBusy(false);
    }
  }

  async function finalizePayslip() {
    if (!payslipDetail) return;
    setPayslipBusy(true);
    try {
      const res = await fetch(`/api/payroll/payslips/${payslipDetail.id}/finalize`, { method: "POST" });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Payslip finalized");
      if (registerRun) openRegister(registerRun);
      setPayslipDetail(null);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't finalize payslip");
    } finally {
      setPayslipBusy(false);
    }
  }

  async function createComponent() {
    if (!compName.trim()) return;
    setCompSubmitting(true);
    try {
      const res = await fetch("/api/payroll/salary-components", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: compName, componentType: compType, calculationType: compCalc,
          defaultAmount: compAmount ? Number(compAmount) : undefined,
          defaultPercentage: compPercentage ? Number(compPercentage) : undefined,
          includeInPfWage: compPfWage,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Salary component created");
      setCompName(""); setCompAmount(""); setCompPercentage(""); setCompPfWage(false); setCompOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create salary component");
    } finally {
      setCompSubmitting(false);
    }
  }

  function addStructRow() { setStructRows((rows) => [...rows, { componentId: "", amount: "", percentage: "" }]); }
  function removeStructRow(i: number) { setStructRows((rows) => rows.filter((_, idx) => idx !== i)); }

  async function createStructure() {
    if (!structEmployeeId || !structEffectiveFrom || !structCtc || structRows.length === 0) {
      toast.error("Employee, effective date, CTC, and at least one component are required");
      return;
    }
    setStructSubmitting(true);
    try {
      const res = await fetch("/api/payroll/salary-structures", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: structEmployeeId, effectiveFrom: structEffectiveFrom, ctcAnnual: Number(structCtc),
          state: structState || undefined,
          components: structRows.filter((r) => r.componentId).map((r) => ({
            componentId: r.componentId, amount: r.amount ? Number(r.amount) : undefined, percentage: r.percentage ? Number(r.percentage) : undefined,
          })),
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Salary structure created");
      setStructEmployeeId(""); setStructEffectiveFrom(""); setStructCtc(""); setStructState(""); setStructRows([]); setStructOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create salary structure");
    } finally {
      setStructSubmitting(false);
    }
  }

  function addRuleSlabRow() { setRuleSlabRows((rows) => [...rows, { uptoAmount: "", taxAmount: "" }]); }
  function removeRuleSlabRow(i: number) { setRuleSlabRows((rows) => rows.filter((_, idx) => idx !== i)); }

  async function createRule() {
    if (!ruleEffectiveFrom) return;
    setRuleSubmitting(true);
    try {
      const res = await fetch("/api/payroll/statutory-rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType, state: ruleState || undefined, effectiveFrom: ruleEffectiveFrom,
          employeeRate: ruleEmployeeRate ? Number(ruleEmployeeRate) : undefined,
          employerRate: ruleEmployerRate ? Number(ruleEmployerRate) : undefined,
          wageCeiling: ruleWageCeiling ? Number(ruleWageCeiling) : undefined,
          slabs: ruleType === "professional_tax" && ruleSlabRows.length
            ? ruleSlabRows.filter((r) => r.uptoAmount && r.taxAmount).map((r) => ({ uptoAmount: Number(r.uptoAmount), taxAmount: Number(r.taxAmount) }))
            : undefined,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Statutory rule created");
      setRuleState(""); setRuleEffectiveFrom(""); setRuleEmployeeRate(""); setRuleEmployerRate(""); setRuleWageCeiling(""); setRuleSlabRows([]); setRuleOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create statutory rule");
    } finally {
      setRuleSubmitting(false);
    }
  }

  function addSlabRateRow() { setSlabRateRows((rows) => [...rows, { fromAmount: "", toAmount: "", percentDeduction: "" }]); }
  function removeSlabRateRow(i: number) { setSlabRateRows((rows) => rows.filter((_, idx) => idx !== i)); }

  async function createSlab() {
    if (!slabName.trim() || !slabEffectiveFrom || slabRateRows.length === 0) {
      toast.error("Name, effective date, and at least one rate band are required");
      return;
    }
    setSlabSubmitting(true);
    try {
      const res = await fetch("/api/payroll/income-tax-slabs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: slabName, effectiveFrom: slabEffectiveFrom, standardDeduction: slabStdDeduction ? Number(slabStdDeduction) : undefined,
          rates: slabRateRows.filter((r) => r.fromAmount && r.percentDeduction).map((r) => ({
            fromAmount: Number(r.fromAmount), toAmount: r.toAmount ? Number(r.toAmount) : undefined, percentDeduction: Number(r.percentDeduction),
          })),
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Income tax slab created");
      setSlabName(""); setSlabEffectiveFrom(""); setSlabStdDeduction(""); setSlabRateRows([]); setSlabOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create income tax slab");
    } finally {
      setSlabSubmitting(false);
    }
  }

  async function assignSlab() {
    if (!assignEmployeeId) return;
    setAssignSubmitting(true);
    try {
      const res = await fetch(`/api/payroll/employees/${assignEmployeeId}/income-tax-slab`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slabId: assignSlabId || undefined }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success(assignSlabId ? "Income tax slab assigned" : "Income tax slab cleared");
      setAssignEmployeeId(""); setAssignSlabId("");
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't assign income tax slab");
    } finally {
      setAssignSubmitting(false);
    }
  }

  const runColumns: ColumnDef<PayrollRun>[] = useMemo(() => [
    { id: "period", header: "Period", cell: ({ row }) => <span className="font-medium">{MONTHS[row.original.month - 1]} {row.original.year}</span> },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <Badge variant={row.original.status === "processed" ? "default" : "secondary"}>{row.original.status}</Badge> },
    { id: "processedAt", header: "Processed", cell: ({ row }) => row.original.processedAt ? formatDateTime(row.original.processedAt) : "—" },
    {
      id: "actions", header: "", cell: ({ row }) => (
        <div className="flex gap-2">
          {row.original.status === "draft" && isHrAdmin && (
            <Button size="sm" variant="outline" disabled={processingId === row.original.id} onClick={() => processRun(row.original.id)}>
              <PlayCircle className="size-4" /> {processingId === row.original.id ? "Processing…" : "Process"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => openRegister(row.original)}>View Register</Button>
        </div>
      ),
    },
  ], [processingId, isHrAdmin]);

  const componentColumns: ColumnDef<SalaryComponent>[] = [
    { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "type", header: "Type", cell: ({ row }) => <Badge variant="outline">{row.original.componentType}</Badge> },
    { id: "calc", header: "Calculation", cell: ({ row }) => row.original.calculationType.replace(/_/g, " ") },
    { id: "default", header: "Default", cell: ({ row }) => row.original.defaultAmount ?? (row.original.defaultPercentage ? `${row.original.defaultPercentage}%` : "—") },
    { id: "pfWage", header: "PF Wage", cell: ({ row }) => row.original.includeInPfWage ? "Yes" : "No" },
  ];

  const structureColumns: ColumnDef<SalaryStructure>[] = [
    { id: "employee", header: "Employee", cell: ({ row }) => <span className="font-medium">{row.original.employeeName}</span> },
    { id: "effectiveFrom", header: "Effective From", cell: ({ row }) => formatDate(row.original.effectiveFrom) },
    { id: "ctc", header: "Annual CTC", cell: ({ row }) => Number(row.original.ctcAnnual).toLocaleString() },
    { id: "state", header: "State", cell: ({ row }) => row.original.state ?? "—" },
    { id: "components", header: "Components", cell: ({ row }) => row.original.components.length },
  ];

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  }

  return (
    <>
    {loadErrors.length > 0 && (
      <div role="alert" className="mb-4 space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        <p className="font-medium">Some payroll data could not be loaded. The sections below may be incomplete — this is a load failure, not an empty organisation.</p>
        <ul className="list-inside list-disc">
          {loadErrors.map((e) => <li key={e}>{e}</li>)}
        </ul>
        <button type="button" onClick={() => load()} className="underline underline-offset-2">Retry</button>
      </div>
    )}
    <Tabs defaultValue="runs" className="space-y-4">
      <TabsList>
        <TabsTrigger value="runs">Payroll Runs</TabsTrigger>
        <TabsTrigger value="structures">Salary Structures</TabsTrigger>
        <TabsTrigger value="components">Salary Components</TabsTrigger>
        <TabsTrigger value="statutory">Statutory Rules</TabsTrigger>
        {isIndiaOrg && <TabsTrigger value="tax">Income Tax</TabsTrigger>}
      </TabsList>

      <TabsContent value="runs" className="space-y-4">
        <div className="flex justify-end">
          {isHrAdmin && (
          <Dialog open={runOpen} onOpenChange={setRunOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> New Payroll Run</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Payroll Run</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Month</Label>
                  <Select value={runMonth} onValueChange={setRunMonth}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Year</Label><Input type="number" value={runYear} onChange={(e) => setRunYear(e.target.value)} /></div>
              </div>
              <DialogFooter><Button onClick={createRun} disabled={runSubmitting}>{runSubmitting ? "Creating…" : "Create"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {runs.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No payroll runs yet.</p> : <DataTable columns={runColumns} data={runs} />}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="structures" className="space-y-4">
        <div className="flex justify-end">
          {isHrAdmin && (
          <Dialog open={structOpen} onOpenChange={setStructOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> New Salary Structure</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>New Salary Structure</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Employee</Label>
                  <Select value={structEmployeeId} onValueChange={setStructEmployeeId}>
                    <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                    <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5"><Label>Effective From</Label><Input type="date" value={structEffectiveFrom} onChange={(e) => setStructEffectiveFrom(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Annual CTC</Label><Input type="number" value={structCtc} onChange={(e) => setStructCtc(e.target.value)} /></div>
                </div>
                <div className="space-y-1.5"><Label>State (optional, for Professional Tax)</Label><Input value={structState} onChange={(e) => setStructState(e.target.value)} /></div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Components</Label>
                    <Button size="sm" variant="outline" onClick={addStructRow}><Plus className="size-3" /> Add</Button>
                  </div>
                  {structRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Select value={row.componentId} onValueChange={(v) => setStructRows((rows) => rows.map((r, idx) => idx === i ? { ...r, componentId: v } : r))}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Component" /></SelectTrigger>
                        <SelectContent>{components.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input className="w-24" placeholder="Amount" type="number" value={row.amount} onChange={(e) => setStructRows((rows) => rows.map((r, idx) => idx === i ? { ...r, amount: e.target.value } : r))} />
                      <Input className="w-20" placeholder="%" type="number" value={row.percentage} onChange={(e) => setStructRows((rows) => rows.map((r, idx) => idx === i ? { ...r, percentage: e.target.value } : r))} />
                      <Button size="icon" variant="ghost" onClick={() => removeStructRow(i)}><Trash2 className="size-4" /></Button>
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter><Button onClick={createStructure} disabled={structSubmitting}>{structSubmitting ? "Creating…" : "Create"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {structures.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No salary structures yet.</p> : <DataTable columns={structureColumns} data={structures} />}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="components" className="space-y-4">
        <div className="flex justify-end">
          {isHrAdmin && (
          <Dialog open={compOpen} onOpenChange={setCompOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> New Component</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Salary Component</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Name</Label><Input value={compName} onChange={(e) => setCompName(e.target.value)} placeholder="e.g. HRA" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select value={compType} onValueChange={(v) => setCompType(v as "earning" | "deduction")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="earning">Earning</SelectItem><SelectItem value="deduction">Deduction</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Calculation</Label>
                    <Select value={compCalc} onValueChange={setCompCalc}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flat">Flat</SelectItem>
                        <SelectItem value="percentage_of_basic">% of Basic</SelectItem>
                        <SelectItem value="percentage_of_gross">% of Gross</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5"><Label>Default Amount</Label><Input type="number" value={compAmount} onChange={(e) => setCompAmount(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Default %</Label><Input type="number" value={compPercentage} onChange={(e) => setCompPercentage(e.target.value)} /></div>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={compPfWage} onChange={(e) => setCompPfWage(e.target.checked)} /> Include in PF wage</label>
              </div>
              <DialogFooter><Button onClick={createComponent} disabled={compSubmitting}>{compSubmitting ? "Creating…" : "Create"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {components.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No salary components yet.</p> : <DataTable columns={componentColumns} data={components} />}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="statutory" className="space-y-4">
        <div className="flex justify-end">
          {isHrAdmin && (
          <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> New Statutory Rule</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>New Statutory Rule</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Rule Type</Label>
                    <Select value={ruleType} onValueChange={(v) => setRuleType(v as typeof ruleType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pf">Provident Fund</SelectItem>
                        <SelectItem value="esi">ESI</SelectItem>
                        <SelectItem value="professional_tax">Professional Tax</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Effective From</Label><Input type="date" value={ruleEffectiveFrom} onChange={(e) => setRuleEffectiveFrom(e.target.value)} /></div>
                </div>
                {ruleType === "professional_tax" ? (
                  <>
                    <div className="space-y-1.5"><Label>State</Label><Input value={ruleState} onChange={(e) => setRuleState(e.target.value)} placeholder="e.g. Maharashtra" /></div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Slabs (up to amount → tax amount)</Label>
                        <Button size="sm" variant="outline" onClick={addRuleSlabRow}><Plus className="size-3" /> Add</Button>
                      </div>
                      {ruleSlabRows.map((row, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input placeholder="Upto amount" type="number" value={row.uptoAmount} onChange={(e) => setRuleSlabRows((rows) => rows.map((r, idx) => idx === i ? { ...r, uptoAmount: e.target.value } : r))} />
                          <Input placeholder="Tax amount" type="number" value={row.taxAmount} onChange={(e) => setRuleSlabRows((rows) => rows.map((r, idx) => idx === i ? { ...r, taxAmount: e.target.value } : r))} />
                          <Button size="icon" variant="ghost" onClick={() => removeRuleSlabRow(i)}><Trash2 className="size-4" /></Button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5"><Label>Employee Rate %</Label><Input type="number" value={ruleEmployeeRate} onChange={(e) => setRuleEmployeeRate(e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Employer Rate %</Label><Input type="number" value={ruleEmployerRate} onChange={(e) => setRuleEmployerRate(e.target.value)} /></div>
                    <div className="space-y-1.5 col-span-2"><Label>Wage Ceiling</Label><Input type="number" value={ruleWageCeiling} onChange={(e) => setRuleWageCeiling(e.target.value)} /></div>
                  </div>
                )}
              </div>
              <DialogFooter><Button onClick={createRule} disabled={ruleSubmitting}>{ruleSubmitting ? "Creating…" : "Create"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {rules.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No statutory rules yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>State</TableHead><TableHead>Effective From</TableHead><TableHead>Employee Rate</TableHead><TableHead>Employer Rate</TableHead><TableHead>Wage Ceiling</TableHead></TableRow></TableHeader>
                <TableBody>
                  {rules.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.ruleType.replace(/_/g, " ")}</TableCell>
                      <TableCell>{r.state ?? "—"}</TableCell>
                      <TableCell>{formatDate(r.effectiveFrom)}</TableCell>
                      <TableCell>{r.employeeRate ? `${r.employeeRate}%` : (r.slabs ? `${r.slabs.length} slab(s)` : "—")}</TableCell>
                      <TableCell>{r.employerRate ? `${r.employerRate}%` : "—"}</TableCell>
                      <TableCell>{r.wageCeiling ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {isIndiaOrg && (
      <TabsContent value="tax" className="space-y-6">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Income Tax Slabs</h3>
            {isHrAdmin && (
            <Dialog open={slabOpen} onOpenChange={setSlabOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> New Slab</Button></DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>New Income Tax Slab</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5"><Label>Name</Label><Input value={slabName} onChange={(e) => setSlabName(e.target.value)} placeholder="e.g. New Regime FY26-27" /></div>
                    <div className="space-y-1.5"><Label>Effective From</Label><Input type="date" value={slabEffectiveFrom} onChange={(e) => setSlabEffectiveFrom(e.target.value)} /></div>
                  </div>
                  <div className="space-y-1.5"><Label>Standard Deduction</Label><Input type="number" value={slabStdDeduction} onChange={(e) => setSlabStdDeduction(e.target.value)} /></div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Rate Bands</Label>
                      <Button size="sm" variant="outline" onClick={addSlabRateRow}><Plus className="size-3" /> Add</Button>
                    </div>
                    {slabRateRows.map((row, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input placeholder="From" type="number" value={row.fromAmount} onChange={(e) => setSlabRateRows((rows) => rows.map((r, idx) => idx === i ? { ...r, fromAmount: e.target.value } : r))} />
                        <Input placeholder="To (blank = no cap)" type="number" value={row.toAmount} onChange={(e) => setSlabRateRows((rows) => rows.map((r, idx) => idx === i ? { ...r, toAmount: e.target.value } : r))} />
                        <Input placeholder="Rate %" type="number" value={row.percentDeduction} onChange={(e) => setSlabRateRows((rows) => rows.map((r, idx) => idx === i ? { ...r, percentDeduction: e.target.value } : r))} />
                        <Button size="icon" variant="ghost" onClick={() => removeSlabRateRow(i)}><Trash2 className="size-4" /></Button>
                      </div>
                    ))}
                  </div>
                </div>
                <DialogFooter><Button onClick={createSlab} disabled={slabSubmitting}>{slabSubmitting ? "Creating…" : "Create"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            )}
          </div>
          <Card className="shadow-card">
            <CardContent className="p-0">
              {slabs.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No income tax slabs yet.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Effective From</TableHead><TableHead>Standard Deduction</TableHead><TableHead>Rate Bands</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {slabs.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>{formatDate(s.effectiveFrom)}</TableCell>
                        <TableCell>{s.standardDeduction}</TableCell>
                        <TableCell>{s.rates.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {isHrAdmin && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Assign Slab to Employee</h3>
          <Card className="shadow-card">
            <CardContent className="flex flex-wrap items-end gap-2 p-4">
              <div className="w-56 space-y-1.5">
                <Label>Employee</Label>
                <Select value={assignEmployeeId} onValueChange={setAssignEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="w-56 space-y-1.5">
                <Label>Slab (blank clears)</Label>
                <Select value={assignSlabId} onValueChange={setAssignSlabId}>
                  <SelectTrigger><SelectValue placeholder="Select slab" /></SelectTrigger>
                  <SelectContent>{slabs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button onClick={assignSlab} disabled={assignSubmitting || !assignEmployeeId}>{assignSubmitting ? "Saving…" : "Assign"}</Button>
            </CardContent>
          </Card>
        </div>
        )}
      </TabsContent>
      )}

      {/* Payroll register dialog */}
      <Dialog open={!!registerRun} onOpenChange={(open) => { if (!open) { setRegisterRun(null); setRegisterPayslips([]); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Payroll Register — {registerRun ? `${MONTHS[registerRun.month - 1]} ${registerRun.year}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={registerPayslips.length === 0} onClick={exportRegisterCsv}><FileDown className="size-4" /> Export CSV</Button>
          </div>
          {registerLoading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : registerPayslips.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No payslips yet — process this run first.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Gross</TableHead><TableHead>Deductions</TableHead><TableHead>Net Pay</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {registerPayslips.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.employeeName}</TableCell>
                    <TableCell>{Number(p.grossEarnings).toLocaleString()}</TableCell>
                    <TableCell>{Number(p.totalDeductions).toLocaleString()}</TableCell>
                    <TableCell className="font-medium">{Number(p.netPay).toLocaleString()}</TableCell>
                    <TableCell><Badge variant={p.status === "finalized" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => { setPayslipDetail(p); setTdsAmount(p.lines.find((l) => l.label.startsWith("TDS"))?.amount ?? ""); }}>Details</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      {/* Payslip detail dialog */}
      <Dialog open={!!payslipDetail} onOpenChange={(open) => { if (!open) setPayslipDetail(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Payslip — {payslipDetail?.employeeName}</DialogTitle></DialogHeader>
          {payslipDetail && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => downloadPayslipPdf(payslipDetail.id)}><FileText className="size-4" /> Download PDF</Button>
              </div>
              <Table>
                <TableBody>
                  {payslipDetail.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{l.label}</TableCell>
                      <TableCell className={l.lineType === "deduction" ? "text-px-error text-right" : "text-right"}>
                        {l.lineType === "deduction" ? "-" : ""}{Number(l.amount).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">Net Pay</TableCell>
                    <TableCell className="text-right font-semibold">{Number(payslipDetail.netPay).toLocaleString()}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {payslipDetail.status === "draft" && isHrAdmin && (
                <div className="flex items-end gap-2 border-t border-px-border pt-3">
                  <div className="flex-1 space-y-1.5"><Label>TDS Amount (manual override)</Label><Input type="number" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} /></div>
                  <Button variant="outline" disabled={payslipBusy} onClick={saveTds}>Save TDS</Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {payslipDetail?.status === "draft" && isHrAdmin && <Button disabled={payslipBusy} onClick={finalizePayslip}>{payslipBusy ? "Finalizing…" : "Finalize Payslip"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
    </>
  );
}
