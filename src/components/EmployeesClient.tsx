"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Loader2, Plus, Check, X, Users, Building2, Network } from "lucide-react";
import { useOrgRole } from "@/hooks/use-org-role";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
// Priority 17 remaining gap (2026-07-15): employee_profiles/leave_requests
// gained a companyId column (were orgId-only before this wave) -- reuses
// the exact selector AccountingClient.tsx/LeadsClient.tsx already use, not
// a third copy.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";

const EMPLOYMENT_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default", on_leave: "secondary", terminated: "destructive", resigned: "outline",
};

type Employee = {
  id: string;
  name: string;
  email: string;
  role: string;
  departmentId: string | null;
  reportingToId: string | null;
  profile: {
    employeeCode: string | null;
    jobTitle: string | null;
    employmentType: string | null;
    dateOfJoining: string | null;
    dateOfBirth: string | null;
    employmentStatus: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    companyId: string | null;
  } | null;
};

type Department = { id: string; name: string; description: string | null; headName: string | null; memberCount: number };

type OrgChartNode = Employee;
type OrgChart = { employees: OrgChartNode[]; roots: OrgChartNode[]; byManager: Record<string, OrgChartNode[]> };

// The render path indexes into `roots` and `byManager` directly, so anything
// that is not actually that shape must become null before it is stored --
// see the comment on load() for the crash this prevents.
function isOrgChart(value: unknown): value is OrgChart {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OrgChart>;
  return Array.isArray(candidate.roots) && !!candidate.byManager && typeof candidate.byManager === "object";
}

type LeaveRequest = {
  id: string;
  userId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  numDays: string;
  reason: string | null;
  status: string;
  companyId: string | null;
};

type LeaveBalance = { id: string; userId: string; leaveType: string; year: number; totalDays: string; usedDays: string };

const LEAVE_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default", pending: "secondary", rejected: "destructive",
};

const VALID_TABS = new Set(["directory", "departments", "orgchart", "leave"]);

export default function EmployeesClient({ initialTab }: { initialTab?: string }) {
  const router = useRouter();
  const { isHrAdmin } = useOrgRole();
  // Real-screen conversion (2026-08-30): the tab used to be internal-only
  // state (Tabs' own uncontrolled `defaultValue`) -- the new Department/
  // Leave-Request/Leave-Balance create screens redirect back here with
  // `?tab=`, so the URL needs to actually drive which tab renders. Mirrors
  // AccountingClient.tsx's own fix for the identical gap.
  const [activeTab, setActiveTabState] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "directory");
  function setActiveTab(next: string) {
    setActiveTabState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [orgChart, setOrgChart] = useState<OrgChart | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  // C19 ERROR_TRUTHFUL: what failed has to be visible, not inferred from a
  // blank tab. One entry per endpoint that did not answer.
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<string>("pending");

  // Priority 17 remaining gap: companies list + a shared filter scope for
  // both the Directory and Leave tabs (client-side filter, matching this
  // component's existing deptFilter/leaveStatusFilter precedent rather than
  // a server round-trip).
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  // Real-screen conversion (2026-08-30): the Employee profile/Department/
  // Leave-Request/Leave-Balance Dialogs and their form state are gone --
  // real create/edit screens now (EmployeeCreateClient+EmployeeObjectClient,
  // DepartmentCreateClient, LeaveRequestCreateClient, LeaveBalanceCreateClient).
  // Approve/reject/bulk-approve stay here: real inline actions, not popups.
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);

  // R52 / R48_EMPLOYEES_PAGE_CLIENT_CRASH_01. This whole route rendered
  // nothing at all -- 0 <main> elements, body text "This page couldn't load",
  // an unhandled TypeError "Cannot read properties of undefined (reading
  // 'length')" on five consecutive loads.
  //
  // The cause was one line: setOrgChart(chartData) stored the response body
  // WITHOUT reading res.ok. GET /api/hr/org-chart answers a VERIDIAN failure
  // with { error: "..." } and a real status (src/app/api/hr/org-chart/route.ts:12).
  // That body parses fine and is truthy, so `!orgChart` below did not catch it,
  // and `orgChart.roots.length` read .length off undefined. Note it crashed on
  // the Directory tab too: the Org Chart tab's JSX expression is evaluated
  // eagerly here in this component's render to build TabsContent's children,
  // long before Radix decides which tab to mount.
  //
  // Two changes, both needed. (1) fetchJson reads the status first and throws
  // the backend's own message, so an error can never be mistaken for data.
  // (2) allSettled, not all -- one 502 must not blank the other four tabs, and
  // whatever DID load still renders beside an honest banner naming what didn't.
  async function load() {
    setLoading(true);
    setLoadErrors([]);
    const [empRes, deptRes, chartRes, leaveRes, balRes, companiesRes] = await Promise.allSettled([
      fetchJson<{ employees?: Employee[] }>("/api/employees"),
      fetchJson<{ departments?: Department[] }>("/api/hr/departments"),
      fetchJson<unknown>("/api/hr/org-chart"),
      fetchJson<{ requests?: LeaveRequest[] }>("/api/leave/requests"),
      fetchJson<{ balances?: LeaveBalance[] }>("/api/leave/balances"),
      fetchJson<{ companies?: Company[] }>("/api/companies"),
    ]);

    const failures: string[] = [];
    function value<T>(result: PromiseSettledResult<T>, what: string): T | null {
      if (result.status === "fulfilled") return result.value;
      failures.push(errorMessage(result.reason, what));
      return null;
    }

    setEmployees(value(empRes, "Employees")?.employees ?? []);
    setDepartments(value(deptRes, "Departments")?.departments ?? []);
    // Shape-checked, not just status-checked: a 200 that does not carry the
    // roots/byManager arrays this component indexes into is equally unusable,
    // and null is the state the render path is already written to handle.
    const chart = value(chartRes, "Org chart");
    setOrgChart(isOrgChart(chart) ? chart : null);
    setLeaveRequests(value(leaveRes, "Leave requests")?.requests ?? []);
    setLeaveBalances(value(balRes, "Leave balances")?.balances ?? []);
    setCompanies(value(companiesRes, "Companies")?.companies ?? []);

    setLoadErrors(failures);
    if (failures.length > 0) toast.error(failures[0]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function decide(id: string, decision: "approved" | "rejected") {
    setDecidingId(id);
    try {
      const res = await fetch(`/api/leave/requests/${id}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success(`Leave request ${decision}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't update leave request");
    } finally {
      setDecidingId(null);
    }
  }

  async function approveAllPending() {
    const pending = leaveRequests.filter((r) => r.status === "pending");
    if (pending.length === 0) return;
    setBulkApproving(true);
    let succeeded = 0;
    for (const r of pending) {
      try {
        const res = await fetch(`/api/leave/requests/${r.id}/decision`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "approved" }),
        });
        if (res.ok) succeeded++;
      } catch {
        // continue with remaining requests
      }
    }
    toast.success(`Approved ${succeeded} of ${pending.length} pending leave request(s)`);
    setBulkApproving(false);
    load();
  }

  const employeeName = (id: string | null) => employees.find((e) => e.id === id)?.name ?? "—";
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";

  const filteredEmployees = useMemo(
    () => (deptFilter === "all" ? employees : employees.filter((e) => e.departmentId === deptFilter))
      .filter((e) => !scope.companyId || e.profile?.companyId === scope.companyId),
    [employees, deptFilter, scope.companyId]
  );

  const filteredLeaveRequests = useMemo(
    () => (leaveStatusFilter === "all" ? leaveRequests : leaveRequests.filter((r) => r.status === leaveStatusFilter))
      .filter((r) => !scope.companyId || r.companyId === scope.companyId),
    [leaveRequests, leaveStatusFilter, scope.companyId]
  );

  const employeeColumns: ColumnDef<Employee>[] = [
    { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: "email", header: "Email", cell: ({ row }) => <span className="text-px-muted">{row.original.email}</span> },
    { id: "department", header: "Department", cell: ({ row }) => departmentName(row.original.departmentId) },
    { id: "jobTitle", header: "Designation", cell: ({ row }) => row.original.profile?.jobTitle ?? "—" },
    { id: "reportingTo", header: "Reports To", cell: ({ row }) => employeeName(row.original.reportingToId) },
    {
      id: "employmentType", header: "Employment Type",
      cell: ({ row }) => row.original.profile?.employmentType ? <Badge variant="outline">{row.original.profile.employmentType.replace(/_/g, " ")}</Badge> : "—",
    },
    { id: "employeeCode", header: "Emp. Code", cell: ({ row }) => row.original.profile?.employeeCode ?? "—" },
    {
      id: "dateOfJoining", header: "Joined",
      cell: ({ row }) => row.original.profile?.dateOfJoining ? formatDate(row.original.profile.dateOfJoining) : "—",
    },
    {
      id: "employmentStatus", header: "Status",
      cell: ({ row }) => {
        const status = row.original.profile?.employmentStatus;
        return status ? <Badge variant={EMPLOYMENT_STATUS_VARIANT[status] ?? "outline"}>{status.replace(/_/g, " ")}</Badge> : "—";
      },
    },
    {
      id: "actions", header: "",
      cell: ({ row }) => <Button size="sm" variant="ghost" onClick={() => router.push(`/employees/${row.original.id}`)}>View</Button>,
    },
  ];

  const departmentColumns: ColumnDef<Department>[] = [
    { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "description", header: "Description", cell: ({ row }) => <span className="text-px-muted">{row.original.description ?? "—"}</span> },
    { id: "head", header: "Head", cell: ({ row }) => row.original.headName ?? "—" },
    { id: "members", header: "Members", cell: ({ row }) => row.original.memberCount },
  ];

  function OrgNode({ node, depth }: { node: OrgChartNode; depth: number }) {
    const children = orgChart?.byManager[node.id] ?? [];
    return (
      <div style={{ marginLeft: depth * 20 }} className="border-l border-px-border pl-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{node.name}</span>
          {node.profile?.jobTitle && <span className="text-xs text-px-muted">— {node.profile.jobTitle}</span>}
          <Badge variant="outline" className="text-[10px]">{departmentName(node.departmentId)}</Badge>
        </div>
        {children.map((c) => <OrgNode key={c.id} node={c} depth={depth + 1} />)}
      </div>
    );
  }

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      {loadErrors.length > 0 && (
        <Card role="alert" className="border-px-error-border bg-px-error-light">
          <CardContent className="space-y-2 p-4 text-sm text-px-error">
            <p className="font-medium">Some HR data could not be loaded. What is shown below is incomplete.</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {loadErrors.map((message) => <li key={message}>{message}</li>)}
            </ul>
            <Button size="sm" variant="outline" onClick={() => load()}>Retry</Button>
          </CardContent>
        </Card>
      )}
      <TabsList>
        <TabsTrigger value="directory"><Users className="size-4" /> Directory</TabsTrigger>
        <TabsTrigger value="departments"><Building2 className="size-4" /> Departments</TabsTrigger>
        <TabsTrigger value="orgchart"><Network className="size-4" /> Org Chart</TabsTrigger>
        <TabsTrigger value="leave">Leave</TabsTrigger>
      </TabsList>

      <TabsContent value="directory" className="space-y-4">
        <CompanySelector companies={companies} scope={scope} onChange={setScope} showConsolidateToggle={false} />
        <div className="flex items-center justify-between gap-2">
          <div className="w-56">
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger><SelectValue placeholder="All departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isHrAdmin && (
            // Real screen navigation (2026-08-30) -- replaces the old
            // combined "Create / Update Employee Profile" Dialog popup with
            // a real create route (edit lives on EmployeeObjectClient now).
            <Button onClick={() => router.push("/employees/new")}><Plus className="size-4" /> Employee Profile</Button>
          )}
        </div>

        <Card className="shadow-card">
          <CardContent className="p-4">
            {filteredEmployees.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No employees yet.</p>
            ) : (
              <DataTable columns={employeeColumns} data={filteredEmployees} searchKey="name" searchPlaceholder="Search employees…" />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="departments" className="space-y-4">
        <div className="flex justify-end">
          {isHrAdmin && (
            // Real screen navigation (2026-08-30) -- replaces the old "New
            // Department" Dialog popup with a real create route.
            <Button onClick={() => router.push("/employees/departments/new")}><Plus className="size-4" /> New Department</Button>
          )}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {departments.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No departments yet.</p>
            ) : (
              <DataTable columns={departmentColumns} data={departments} searchKey="name" searchPlaceholder="Search departments…" />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="orgchart" className="space-y-4">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Reporting Hierarchy</CardTitle></CardHeader>
          <CardContent>
            {!orgChart || orgChart.roots.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No reporting hierarchy set up yet.</p>
            ) : (
              <div className="space-y-1">{orgChart.roots.map((r) => <OrgNode key={r.id} node={r} depth={0} />)}</div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="leave" className="space-y-6">
        <CompanySelector companies={companies} scope={scope} onChange={setScope} showConsolidateToggle={false} />
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Leave Requests</h3>
              <Select value={leaveStatusFilter} onValueChange={setLeaveStatusFilter}>
                <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              {isHrAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkApproving || leaveRequests.filter((r) => r.status === "pending").length === 0}
                  onClick={approveAllPending}
                >
                  {bulkApproving ? "Approving…" : "Approve All Pending"}
                </Button>
              )}
              {/* Real screen navigation (2026-08-30) -- replaces the old
                  "Request Leave" Dialog popup with a real create route. */}
              <Button size="sm" onClick={() => router.push("/employees/leave/new")}><Plus className="size-4" /> Request Leave</Button>
            </div>
          </div>

          <Card className="shadow-card">
            <CardContent className="p-0">
              {filteredLeaveRequests.length === 0 ? (
                <p className="py-10 text-center text-sm text-px-muted">No leave requests.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead><TableHead>Days</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLeaveRequests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{employeeName(r.userId)}</TableCell>
                        <TableCell className="text-px-muted">{r.leaveType}</TableCell>
                        <TableCell className="text-px-muted">{formatDate(r.startDate)} – {formatDate(r.endDate)}</TableCell>
                        <TableCell>{r.numDays}</TableCell>
                        <TableCell><Badge variant={LEAVE_STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                        <TableCell>
                          {r.status === "pending" && isHrAdmin && (
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" disabled={decidingId === r.id} onClick={() => decide(r.id, "approved")}><Check className="size-4 text-px-success" /></Button>
                              <Button size="icon" variant="ghost" disabled={decidingId === r.id} onClick={() => decide(r.id, "rejected")}><X className="size-4 text-px-error" /></Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Leave Balances</h3>
            {isHrAdmin && (
            /* Real screen navigation (2026-08-30) -- replaces the old "Set
               Leave Balance" Dialog popup with a real create route. */
            <Button size="sm" variant="outline" onClick={() => router.push("/employees/leave/balance/new")}><Plus className="size-4" /> Set Balance</Button>
            )}
          </div>
          <Card className="shadow-card">
            <CardContent className="p-0">
              {leaveBalances.length === 0 ? (
                <p className="py-10 text-center text-sm text-px-muted">No leave balances set yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Year</TableHead><TableHead>Total</TableHead><TableHead>Used</TableHead><TableHead>Remaining</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaveBalances.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{employeeName(b.userId)}</TableCell>
                        <TableCell className="text-px-muted">{b.leaveType}</TableCell>
                        <TableCell>{b.year}</TableCell>
                        <TableCell>{b.totalDays}</TableCell>
                        <TableCell>{b.usedDays}</TableCell>
                        <TableCell>{(Number(b.totalDays) - Number(b.usedDays)).toFixed(1)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

    </Tabs>
  );
}
