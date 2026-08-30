"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Loader2, Plus, PlayCircle } from "lucide-react";
import { useOrgRole } from "@/hooks/use-org-role";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

// R43 F_031: which of the six data sources a given tab renders, so a tab
// whose own source failed can say so instead of falling into its
// `array.length === 0` empty-state copy. Keyed the same as the `key` values
// passed to readList() below.
type PayrollLoadKey = "runs" | "employees" | "components" | "structures" | "rules" | "slabs";

type PayrollRun = { id: string; month: number; year: number; status: string; processedAt: string | null };
type SalaryComponent = { id: string; name: string; componentType: "earning" | "deduction"; calculationType: string; defaultPercentage: string | null; defaultAmount: string | null; isStatutory: boolean; includeInPfWage: boolean };
type SalaryStructure = { id: string; employeeId: string; employeeName: string; employeeCode: string | null; effectiveFrom: string; ctcAnnual: string; state: string | null; components: { componentId: string; amount: string | null; percentage: string | null; component: { name: string } }[] };
type StatutoryRule = { id: string; ruleType: string; state: string | null; effectiveFrom: string; effectiveTo: string | null; employeeRate: string | null; employerRate: string | null; wageCeiling: string | null; slabs: { uptoAmount: number; taxAmount: number }[] | null };
type IncomeTaxSlab = { id: string; name: string; effectiveFrom: string; standardDeduction: string; rates: { fromAmount: string; toAmount: string | null; percentDeduction: string }[] };
type Employee = { id: string; name: string; profile: { employeeCode: string | null } | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VALID_TABS = new Set(["runs", "structures", "components", "statutory", "tax"]);

// Real-screen conversion (2026-08-30): every "New X" Dialog popup is gone --
// each routes to a real create screen; the Payroll Run row / Register /
// Payslip nested-Dialog-on-Dialog is gone -- rows route to real Object
// Pages (PayrollRunObjectClient.tsx / PayslipObjectClient.tsx). "Assign Slab
// to Employee" was already a real inline action (no Dialog) and is
// unchanged. Also fixes the same uncontrolled-Tabs-no-URL-sync bug found
// and fixed repeatedly this session.
export default function PayrollClient({ initialTab }: { initialTab?: string }) {
  const router = useRouter();
  // Priority 19 Part 2, Workstream C: "Income Tax" tab is India-specific
  // (progressive income-tax slabs -- not applicable to UAE, which has no
  // personal income tax) -- gated on isIndiaOrg, hidden (not errored) for
  // non-IN orgs.
  const { isHrAdmin, isIndiaOrg } = useOrgRole();
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "runs");
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [rules, setRules] = useState<StatutoryRule[]>([]);
  const [slabs, setSlabs] = useState<IncomeTaxSlab[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  // R52 F_031: a 504 must never render as an empty state -- see load().
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  // R43 F_031 follow-up: per-source, so each tab can gate on its OWN failure
  // instead of only the combined banner above the tabs -- see load().
  const [sourceErrors, setSourceErrors] = useState<Partial<Record<PayrollLoadKey, string>>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);

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
    setSourceErrors({});
    const failures: string[] = [];
    const bySource: Partial<Record<PayrollLoadKey, string>> = {};

    // Pass 1 -- only what the default "Payroll Runs" tab renders. allSettled
    // (not Promise.all) so: (a) if BOTH calls fail, both errors are named
    // instead of only the first rejection's reason, which is all Promise.all
    // ever surfaces, and (b) a successful sibling still lands via its own
    // setter instead of being discarded because the other one failed.
    const [runsRes, empRes] = await Promise.allSettled([fetch("/api/payroll/runs"), fetch("/api/employees")]);
    const primary: [PromiseSettledResult<Response>, PayrollLoadKey, string, (v: never[]) => void][] = [
      [runsRes, "runs", "Payroll runs", setRuns as (v: never[]) => void],
      [empRes, "employees", "Employees", setEmployees as (v: never[]) => void],
    ];

    for (const [settled, key, label, setter] of primary) {
      if (settled.status !== "fulfilled") {
        const msg = `${label}: request failed`;
        failures.push(msg);
        bySource[key] = msg;
        continue;
      }
      try {
        setter((await readList(settled.value, key, label)) as never[]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : `${label}: request failed`;
        failures.push(msg);
        bySource[key] = msg;
      }
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

    const secondary: [PromiseSettledResult<Response>, PayrollLoadKey, string, (v: never[]) => void][] = [
      [compRes, "components", "Salary components", setComponents as (v: never[]) => void],
      [structRes, "structures", "Salary structures", setStructures as (v: never[]) => void],
      [rulesRes, "rules", "Statutory rules", setRules as (v: never[]) => void],
      [slabsRes, "slabs", "Income tax slabs", setSlabs as (v: never[]) => void],
    ];

    for (const [settled, key, label, setter] of secondary) {
      if (settled.status !== "fulfilled") {
        const msg = `${label}: request failed`;
        failures.push(msg);
        bySource[key] = msg;
        continue;
      }
      try {
        setter((await readList(settled.value, key, label)) as never[]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : `${label}: request failed`;
        failures.push(msg);
        bySource[key] = msg;
      }
    }

    if (failures.length) {
      setLoadErrors(failures);
      setSourceErrors(bySource);
      toast.error("Some payroll data couldn't be loaded");
    }
  }

  useEffect(() => { load(); }, []);

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

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  const runColumns: ColumnDef<PayrollRun>[] = useMemo(() => [
    { id: "period", header: "Period", cell: ({ row }) => <span className="font-medium">{MONTHS[row.original.month - 1]} {row.original.year}</span> },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <Badge variant={row.original.status === "processed" ? "default" : "secondary"}>{row.original.status}</Badge> },
    { id: "processedAt", header: "Processed", cell: ({ row }) => row.original.processedAt ? formatDateTime(row.original.processedAt) : "—" },
    {
      id: "actions", header: "", cell: ({ row }) => (
        <div className="flex gap-2">
          {row.original.status === "draft" && isHrAdmin && (
            <Button size="sm" variant="outline" disabled={processingId === row.original.id} onClick={(e) => { e.stopPropagation(); processRun(row.original.id); }}>
              <PlayCircle className="size-4" /> {processingId === row.original.id ? "Processing…" : "Process"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); router.push(`/payroll/runs/${row.original.id}`); }}>View Register</Button>
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
    <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="runs">Payroll Runs</TabsTrigger>
        <TabsTrigger value="structures">Salary Structures</TabsTrigger>
        <TabsTrigger value="components">Salary Components</TabsTrigger>
        <TabsTrigger value="statutory">Statutory Rules</TabsTrigger>
        {isIndiaOrg && <TabsTrigger value="tax">Income Tax</TabsTrigger>}
      </TabsList>

      <TabsContent value="runs" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "New
              Payroll Run" Dialog popup with a real create route. */}
          {isHrAdmin && <Button onClick={() => router.push("/payroll/runs/new")}><Plus className="size-4" /> New Payroll Run</Button>}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {sourceErrors.runs ? (
              // R43 F_031: this tab is open by default, so it is the surface
              // most likely to be seen right after a failed load -- it must
              // not say "No payroll runs yet." about data that was never read.
              <DataLoadError messages={[sourceErrors.runs]} onRetry={load} />
            ) : runs.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No payroll runs yet.</p>
            ) : (
              // Real screen navigation (2026-08-30) -- "View Register" (in
              // the actions column below) opens the real Payroll Run Object
              // Page, where Register + Process now live.
              <DataTable columns={runColumns} data={runs} />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="structures" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "New
              Salary Structure" Dialog popup with a real create route. */}
          {isHrAdmin && <Button onClick={() => router.push("/payroll/structures/new")}><Plus className="size-4" /> New Salary Structure</Button>}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {sourceErrors.structures ? (
              <DataLoadError messages={[sourceErrors.structures]} onRetry={load} />
            ) : structures.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No salary structures yet.</p>
            ) : (
              <DataTable columns={structureColumns} data={structures} />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="components" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "New
              Component" Dialog popup with a real create route. */}
          {isHrAdmin && <Button onClick={() => router.push("/payroll/components/new")}><Plus className="size-4" /> New Component</Button>}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {sourceErrors.components ? (
              <DataLoadError messages={[sourceErrors.components]} onRetry={load} />
            ) : components.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No salary components yet.</p>
            ) : (
              <DataTable columns={componentColumns} data={components} />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="statutory" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "New
              Statutory Rule" Dialog popup with a real create route. */}
          {isHrAdmin && <Button onClick={() => router.push("/payroll/statutory-rules/new")}><Plus className="size-4" /> New Statutory Rule</Button>}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {sourceErrors.rules ? (
              <DataLoadError messages={[sourceErrors.rules]} onRetry={load} />
            ) : rules.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No statutory rules yet.</p> : (
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
            {/* Real screen navigation (2026-08-30) -- replaces the old "New
                Slab" Dialog popup with a real create route. */}
            {isHrAdmin && <Button size="sm" onClick={() => router.push("/payroll/tax-slabs/new")}><Plus className="size-4" /> New Slab</Button>}
          </div>
          <Card className="shadow-card">
            <CardContent className="p-0">
              {sourceErrors.slabs ? (
                <DataLoadError messages={[sourceErrors.slabs]} onRetry={load} />
              ) : slabs.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No income tax slabs yet.</p> : (
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
    </Tabs>
    </>
  );
}
