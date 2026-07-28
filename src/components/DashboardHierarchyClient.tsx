"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { Wallet, TrendingUp, Receipt, Activity, Building2 } from "lucide-react";
import { CategoryDistributionCharts } from "@/components/CategoryDistributionCharts";

type Company = { id: string; name: string; slug: string; country: string | null; role: string };
type Department = { id: string; name: string; memberCount: number };
type ProjectSummary = { id: string; name: string; revenue: number; expenses: number; taskCount: number; delayedTaskCount: number };
type OrgDashboard = { totalProjects: number; totalBudget: number; totalRevenue: number; totalExpenses: number; projects: ProjectSummary[] };
type ProjectDetails = {
  projectId: string; projectName: string; budget: number; budgetIsPeriodTotal: boolean;
  revenue: number; revenueTruncated: boolean; expenses: number; progressPercent: number; dateRangeApplied: boolean;
};

function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

export function DashboardHierarchyClient() {
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

  // Project level: the company's (optionally department-filtered) project list.
  useEffect(() => {
    if (!companyId) return;
    setProjectId("");
    setDetails(null);
    const qs = departmentId !== "__all__" ? `?departmentId=${departmentId}` : "";
    getJson<OrgDashboard>(`/api/dashboard-hierarchy/companies/${companyId}/dashboard${qs}`).then(setOrgDashboard);
  }, [companyId, departmentId]);

  // Details view: Revenue/Budget/Expense/Progress for the selected project, date-range filtered.
  useEffect(() => {
    if (!companyId || !projectId) return;
    setLoading(true);
    const qs = new URLSearchParams();
    if (fromDate) qs.set("from", fromDate);
    if (toDate) qs.set("to", toDate);
    getJson<ProjectDetails>(`/api/dashboard-hierarchy/companies/${companyId}/projects/${projectId}?${qs.toString()}`)
      .then(setDetails)
      .finally(() => setLoading(false));
  }, [companyId, projectId, fromDate, toDate]);

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
                      <TableCell>{fmt(p.revenue)}</TableCell>
                      <TableCell>{fmt(p.expenses)}</TableCell>
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
          <CardHeader>
            <CardTitle className="font-heading text-base">{details?.projectName ?? "Project details"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input type="date" className="h-9 w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input type="date" className="h-9 w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              {details?.budgetIsPeriodTotal && (
                <p className="text-xs text-px-muted">Budget is an annual allocation and is not affected by the date range.</p>
              )}
            </div>

            {loading || !details ? (
              <p className="py-6 text-center text-sm text-px-muted">Loading...</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <DashboardCard title="Revenue" value={fmt(details.revenue)} icon={TrendingUp} variant="completed" />
                  <DashboardCard title="Budget" value={fmt(details.budget)} icon={Wallet} variant="total" />
                  <DashboardCard title="Expenses" value={fmt(details.expenses)} icon={Receipt} variant="pending" />
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
