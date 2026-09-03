"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { Wallet, TrendingUp, Receipt, Activity, Building2, Landmark } from "lucide-react";
import { CategoryDistributionCharts } from "@/components/CategoryDistributionCharts";
import { HierarchyProjectBars } from "@/components/HierarchyProjectBars";
import { useOrgMoney } from "@/lib/use-org-money";
import { currencyLabel, useCurrencies, type Currency } from "@/lib/currency";

type Company = { id: string; name: string; slug: string; country: string | null; role: string };
type Department = { id: string; name: string; memberCount: number };
// R67 E-23: the row now carries boqBudget and earnedValue so Sumeet's company
// chart can be drawn from the SAME payload the table already reads -- one
// call, never a second fetch per project (C06-21).
type ProjectSummary = {
  id: string; name: string;
  revenue: number | null; expenses: number | null;
  taskCount: number; delayedTaskCount: number;
  earnedValue?: number | null; boqBudget?: number | null; budget?: number | null;
  progressPercent?: number | null; percentByValue?: number | null;
};
type OrgDashboard = { totalProjects: number; totalBudget: number | null; totalRevenue: number | null; totalExpenses: number | null; projects: ProjectSummary[] };
type ProjectDetails = {
  projectId: string; projectName: string; budget: number; budgetIsPeriodTotal: boolean;
  revenue: number; revenueTruncated: boolean; expenses: number; progressPercent: number; dateRangeApplied: boolean;
  // Point 121: COALESCE(user-entered, linked-PO-sum). null (never 0) when
  // neither source exists -- rendered as no card at all, not a zero.
  projectValue: number | null;
};

// R11 point 6b: this was the last hardcoded rupee-glyph formatter in
// projexa/src (Priority 17 already converted every sibling component to
// currencyLabel()). This dashboard aggregates across a company's own
// projects, not one project's own transaction currency, so -- same as
// every other currencyLabel() call site with no per-row currencyId -- id
// is undefined, which resolves to the org's base currency (see
// currencyLabel()'s own comment).
function fmt(n: number, currencies: Currency[]) {
  return `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

export function DashboardHierarchyClient() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string>("__all__");
  const [orgDashboard, setOrgDashboard] = useState<OrgDashboard | null>(null);
  const [projectId, setProjectId] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [loading, setLoading] = useState(false);
  // R67 E-23: the company chart's own load state, so a failed org-dashboard
  // read renders "Couldn't load project data — Retry" instead of an empty
  // chart that reads as "this company has no projects".
  const [barsLoading, setBarsLoading] = useState(false);
  const [barsError, setBarsError] = useState<string | null>(null);
  const orgMoney = useOrgMoney();

  // Company level: load the current user's real memberships once.
  useEffect(() => {
    getJson<{ companies: Company[] }>("/api/dashboard-hierarchy/companies").then((data) => {
      if (!data) return;
      setCompanies(data.companies);
      if (data.companies.length > 0) setCompanyId(data.companies[0].id);
    });
  }, []);

  // Department level: real HR departments for the selected company.
  useEffect(() => {
    if (!companyId) return;
    setDepartmentId("__all__");
    getJson<{ departments: Department[] }>(`/api/dashboard-hierarchy/companies/${companyId}/departments`).then((data) => {
      if (data) setDepartments(data.departments);
    });
  }, [companyId]);

  // Project level: the company's (optionally department-filtered) project
  // list. R67 E-23: the From/To range is sent to the SAME call -- it narrows
  // revenue and expenses server-side; the BOQ-derived budget is a property of
  // the BOQ line, not of a period, and the chart says so when a range is set.
  const loadOrgDashboard = useCallback(async () => {
    if (!companyId) return;
    setBarsLoading(true);
    setBarsError(null);
    const qs = new URLSearchParams();
    if (departmentId !== "__all__") qs.set("departmentId", departmentId);
    if (fromDate) qs.set("from", fromDate);
    if (toDate) qs.set("to", toDate);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const data = await getJson<OrgDashboard>(`/api/dashboard-hierarchy/companies/${companyId}/dashboard${suffix}`);
    if (!data) {
      setOrgDashboard(null);
      setBarsError("the workspace backend did not answer");
    } else {
      setOrgDashboard(data);
    }
    setBarsLoading(false);
  }, [companyId, departmentId, fromDate, toDate]);

  useEffect(() => {
    if (!companyId) return;
    setProjectId("");
    setDetails(null);
    void loadOrgDashboard();
  }, [companyId, departmentId, loadOrgDashboard]);

  // Details view: Revenue/Budget/Expense/Progress for the selected project, date-range filtered.
  function loadDetails() {
    if (!companyId || !projectId) return;
    setLoading(true);
    const qs = new URLSearchParams();
    if (fromDate) qs.set("from", fromDate);
    if (toDate) qs.set("to", toDate);
    getJson<ProjectDetails>(`/api/dashboard-hierarchy/companies/${companyId}/projects/${projectId}?${qs.toString()}`)
      .then(setDetails)
      .finally(() => setLoading(false));
  }
  useEffect(loadDetails, [companyId, projectId, fromDate, toDate]);

  // Point 121: a user-entered value always wins over the PO-derived
  // fallback -- editing it here is a deliberate human override.
  async function editProjectValue() {
    if (!projectId) return;
    const raw = window.prompt("Project value (leave blank to clear and fall back to linked purchase orders):", details?.projectValue?.toString() ?? "");
    if (raw === null) return;
    const projectValue = raw.trim() === "" ? null : Number(raw);
    if (projectValue !== null && !Number.isFinite(projectValue)) return;
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectValue }),
    });
    loadDetails();
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1">
            <Label className="text-xs">Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.country ? ` (${c.country})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId} disabled={!companyId}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="All departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {companies.length === 0 && (
        <p className="text-sm text-px-muted">No company memberships found for this account.</p>
      )}

      {/* R67 E-23 (R-206, C-07): Sumeet's company chart. One row per project
          ordered by revenue descending, three thin bars per row on ONE shared
          axis, the value printed at each bar end, the whole row a door to
          that project's dashboard. The From/To range sits above it because it
          is what the range applies to. */}
      {companyId && (
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base">Revenue, budget and earned value by project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input type="date" className="h-9 w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input type="date" className="h-9 w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
            <HierarchyProjectBars
              projects={orgDashboard?.projects ?? null}
              orgMoney={orgMoney}
              loading={barsLoading}
              error={barsError}
              onRetry={() => void loadOrgDashboard()}
              dateRangeApplied={Boolean(fromDate || toDate)}
            />
          </CardContent>
        </Card>
      )}

      {orgDashboard && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-heading text-base">Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {orgDashboard.projects.length === 0 ? (
              <p className="py-6 text-center text-sm text-px-muted">No projects in this scope.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>Expenses</TableHead>
                    <TableHead>Tasks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgDashboard.projects.map((p) => (
                    <TableRow
                      key={p.id}
                      data-state={p.id === projectId ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => setProjectId(p.id)}
                    >
                      <TableCell className="font-medium">{p.name}</TableCell>
                      {/* R67 E-23/G-05: revenue and expenses are now
                          `number | null` -- null is the redacted-for-this-role
                          case, and the one money formatter renders it as the
                          en dash rather than a confident zero. */}
                      <TableCell>{orgMoney.money(p.revenue)}</TableCell>
                      <TableCell>{orgMoney.money(p.expenses)}</TableCell>
                      <TableCell>{p.taskCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {projectId && (
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-heading text-base">{details?.projectName ?? "Project details"}</CardTitle>
            {/* Real screen navigation (2026-08-30) -- cross-linking fix
                (module #36): this hierarchy drill-down never linked into the
                real per-project dashboard (/dashboard/project), which has its
                own richer KPI-tile view of the same project. */}
            <Button size="sm" variant="outline" onClick={() => router.push(`/dashboard/project?projectId=${projectId}`)}>Open Project Dashboard</Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* R67 E-23: the From/To inputs moved UP, next to the chart the
                range actually applies to. Two identical date pairs on one
                screen, driving the same two state values, is a duplicate
                control -- the details below still honour the range set above,
                and say so. */}
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-xs text-px-muted">
                {fromDate || toDate
                  ? `Showing ${fromDate || "the beginning"} to ${toDate || "today"}, from the range set above.`
                  : "Showing every date. Set a range above to narrow revenue and expenses."}
              </p>
              {details?.budgetIsPeriodTotal && (
                <p className="text-xs text-px-muted">Budget is an annual allocation and is not affected by the date range.</p>
              )}
              {details && (
                <Button variant="outline" size="sm" onClick={editProjectValue}>
                  {details.projectValue !== null ? "Edit Project Value" : "Set Project Value"}
                </Button>
              )}
            </div>

            {loading || !details ? (
              <p className="py-6 text-center text-sm text-px-muted">Loading...</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {details.projectValue !== null && (
                    <DashboardCard title="Project Value" value={fmt(details.projectValue, currencies)} icon={Landmark} variant="total" />
                  )}
                  <DashboardCard title="Revenue" value={fmt(details.revenue, currencies)} icon={TrendingUp} variant="completed" />
                  <DashboardCard title="Budget" value={fmt(details.budget, currencies)} icon={Wallet} variant="total" />
                  <DashboardCard title="Expenses" value={fmt(details.expenses, currencies)} icon={Receipt} variant="pending" />
                  <DashboardCard title="Progress" value={`${details.progressPercent}%`} icon={Activity} variant="total" />
                </div>
                {details.revenueTruncated && (
                  <p className="text-xs text-destructive">Revenue figures may be incomplete for this date range (too many invoices to load in full).</p>
                )}
              </div>
            )}

            <CategoryDistributionCharts companyId={companyId} projectId={projectId} />
          </CardContent>
        </Card>
      )}

      {!projectId && orgDashboard && orgDashboard.projects.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-px-muted"><Building2 className="size-4" /> Select a project above to see its graphical detail report.</p>
      )}
    </div>
  );
}
