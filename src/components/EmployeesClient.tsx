"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Loader2, Plus, Check, X, Users, Building2, Network } from "lucide-react";
import { useOrgRole } from "@/hooks/use-org-role";
import { formatDate } from "@/lib/format-date";
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

export default function EmployeesClient() {
  const { isHrAdmin } = useOrgRole();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [orgChart, setOrgChart] = useState<OrgChart | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);

  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<string>("pending");

  // Priority 17 remaining gap: companies list + a shared filter scope for
  // both the Directory and Leave tabs (client-side filter, matching this
  // component's existing deptFilter/leaveStatusFilter precedent rather than
  // a server round-trip).
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  // -- Employee profile dialog
  const [profileOpen, setProfileOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("active");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [profileCompanyId, setProfileCompanyId] = useState<string>("__none__");
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [viewEmployee, setViewEmployee] = useState<Employee | null>(null);

  // -- Department dialog
  const [deptOpen, setDeptOpen] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [deptDescription, setDeptDescription] = useState("");
  const [deptSubmitting, setDeptSubmitting] = useState(false);

  // -- Leave request dialog
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);

  // -- Leave balance dialog
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balUserId, setBalUserId] = useState("");
  const [balLeaveType, setBalLeaveType] = useState("");
  const [balYear, setBalYear] = useState(String(new Date().getFullYear()));
  const [balTotalDays, setBalTotalDays] = useState("");
  const [balanceSubmitting, setBalanceSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [empRes, deptRes, chartRes, leaveRes, balRes, companiesRes] = await Promise.all([
        fetch("/api/employees"),
        fetch("/api/hr/departments"),
        fetch("/api/hr/org-chart"),
        fetch("/api/leave/requests"),
        fetch("/api/leave/balances"),
        fetch("/api/companies"),
      ]);
      const empData = await empRes.json();
      const deptData = await deptRes.json();
      const chartData = await chartRes.json();
      const leaveData = await leaveRes.json();
      const balData = await balRes.json();
      const companiesData = await companiesRes.json().catch(() => ({}));
      setEmployees(empData.employees ?? []);
      setDepartments(deptData.departments ?? []);
      setOrgChart(chartData);
      setLeaveRequests(leaveData.requests ?? []);
      setLeaveBalances(balData.balances ?? []);
      setCompanies(companiesData.companies ?? []);
    } catch {
      toast.error("Couldn't load HR data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function selectProfileUser(id: string) {
    setUserId(id);
    const existing = employees.find((e) => e.id === id)?.profile;
    setEmployeeCode(existing?.employeeCode ?? "");
    setJobTitle(existing?.jobTitle ?? "");
    setEmploymentType(existing?.employmentType ?? "full_time");
    setDateOfJoining(existing?.dateOfJoining ? existing.dateOfJoining.slice(0, 10) : "");
    setEmploymentStatus(existing?.employmentStatus ?? "active");
    setEmergencyContactName(existing?.emergencyContactName ?? "");
    setEmergencyContactPhone(existing?.emergencyContactPhone ?? "");
    setProfileCompanyId(existing?.companyId ?? "__none__");
  }

  async function saveProfile() {
    if (!userId.trim()) return;
    setProfileSubmitting(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId, employeeCode: employeeCode || undefined, jobTitle: jobTitle || undefined,
          employmentType, dateOfJoining: dateOfJoining || undefined,
          employmentStatus, emergencyContactName: emergencyContactName || undefined, emergencyContactPhone: emergencyContactPhone || undefined,
          companyId: profileCompanyId === "__none__" ? undefined : profileCompanyId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success("Employee profile saved");
      setUserId(""); setEmployeeCode(""); setJobTitle(""); setDateOfJoining("");
      setEmploymentStatus("active"); setEmergencyContactName(""); setEmergencyContactPhone(""); setProfileCompanyId("__none__");
      setProfileOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't save employee profile");
    } finally {
      setProfileSubmitting(false);
    }
  }

  async function createDepartment() {
    if (!deptName.trim()) return;
    setDeptSubmitting(true);
    try {
      const res = await fetch("/api/hr/departments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: deptName, description: deptDescription || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success("Department created");
      setDeptName(""); setDeptDescription(""); setDeptOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create department");
    } finally {
      setDeptSubmitting(false);
    }
  }

  async function createLeaveRequest() {
    if (!leaveType.trim() || !startDate || !endDate) return;
    setLeaveSubmitting(true);
    try {
      const res = await fetch("/api/leave/requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveType, startDate, endDate, reason: reason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success("Leave request submitted");
      setLeaveType(""); setStartDate(""); setEndDate(""); setReason(""); setLeaveOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't submit leave request");
    } finally {
      setLeaveSubmitting(false);
    }
  }

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

  async function saveBalance() {
    if (!balUserId || !balLeaveType.trim() || !balTotalDays) return;
    setBalanceSubmitting(true);
    try {
      const res = await fetch("/api/leave/balances", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: balUserId, leaveType: balLeaveType, year: Number(balYear), totalDays: Number(balTotalDays) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success("Leave balance saved");
      setBalUserId(""); setBalLeaveType(""); setBalTotalDays(""); setBalanceOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't save leave balance");
    } finally {
      setBalanceSubmitting(false);
    }
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
      cell: ({ row }) => <Button size="sm" variant="ghost" onClick={() => setViewEmployee(row.original)}>View</Button>,
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
    <Tabs defaultValue="directory" className="space-y-4">
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
            <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
              <DialogTrigger asChild><Button><Plus className="size-4" /> Employee Profile</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create / Update Employee Profile</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>User</Label>
                    <Select value={userId} onValueChange={selectProfileUser}>
                      <SelectTrigger><SelectValue placeholder="Select existing user account" /></SelectTrigger>
                      <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} ({e.email})</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5"><Label>Employee Code (optional)</Label><Input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Designation (optional)</Label><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Site Architect" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label>Employment Type</Label>
                      <Select value={employmentType} onValueChange={setEmploymentType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full_time">Full Time</SelectItem>
                          <SelectItem value="part_time">Part Time</SelectItem>
                          <SelectItem value="contract">Contract</SelectItem>
                          <SelectItem value="intern">Intern</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5"><Label>Date of Joining (optional)</Label><Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} /></div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Employment Status</Label>
                    <Select value={employmentStatus} onValueChange={setEmploymentStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="on_leave">On Leave</SelectItem>
                        <SelectItem value="terminated">Terminated</SelectItem>
                        <SelectItem value="resigned">Resigned</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5"><Label>Emergency Contact Name (optional)</Label><Input value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Emergency Contact Phone (optional)</Label><Input value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} /></div>
                  </div>
                  {companies.length > 0 && (
                    <div className="space-y-1.5">
                      <Label>Company / Office (optional)</Label>
                      <Select value={profileCompanyId} onValueChange={setProfileCompanyId}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Unattributed</SelectItem>
                          {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <p className="text-xs text-px-muted">Department and reporting manager are managed from user administration, not here.</p>
                </div>
                <DialogFooter><Button onClick={saveProfile} disabled={profileSubmitting}>{profileSubmitting ? "Saving…" : "Save"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
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
          <Dialog open={deptOpen} onOpenChange={setDeptOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> New Department</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Department</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Name</Label><Input value={deptName} onChange={(e) => setDeptName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Description (optional)</Label><Input value={deptDescription} onChange={(e) => setDeptDescription(e.target.value)} /></div>
              </div>
              <DialogFooter><Button onClick={createDepartment} disabled={deptSubmitting}>{deptSubmitting ? "Creating…" : "Create"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
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
              <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
                <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Request Leave</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Request Leave</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5"><Label>Leave Type</Label><Input value={leaveType} onChange={(e) => setLeaveType(e.target.value)} placeholder="e.g. Casual, Sick, Earned" /></div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5"><Label>Start Date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>End Date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
                    </div>
                    <div className="space-y-1.5"><Label>Reason (optional)</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                  </div>
                  <DialogFooter><Button onClick={createLeaveRequest} disabled={leaveSubmitting}>{leaveSubmitting ? "Submitting…" : "Submit"}</Button></DialogFooter>
                </DialogContent>
              </Dialog>
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
            <Dialog open={balanceOpen} onOpenChange={setBalanceOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="size-4" /> Set Balance</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Set Leave Balance</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Employee</Label>
                    <Select value={balUserId} onValueChange={setBalUserId}>
                      <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                      <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5"><Label>Leave Type</Label><Input value={balLeaveType} onChange={(e) => setBalLeaveType(e.target.value)} placeholder="e.g. Casual" /></div>
                    <div className="space-y-1.5"><Label>Year</Label><Input type="number" value={balYear} onChange={(e) => setBalYear(e.target.value)} /></div>
                  </div>
                  <div className="space-y-1.5"><Label>Total Days</Label><Input type="number" value={balTotalDays} onChange={(e) => setBalTotalDays(e.target.value)} /></div>
                </div>
                <DialogFooter><Button onClick={saveBalance} disabled={balanceSubmitting}>{balanceSubmitting ? "Saving…" : "Save"}</Button></DialogFooter>
              </DialogContent>
            </Dialog>
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

      {/* Employee detail view (Priority 15 Wave 2) */}
      <Dialog open={!!viewEmployee} onOpenChange={(open) => { if (!open) setViewEmployee(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{viewEmployee?.name}</DialogTitle></DialogHeader>
          {viewEmployee && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-px-muted">Email</p><p>{viewEmployee.email}</p></div>
                <div><p className="text-xs text-px-muted">Department</p><p>{departmentName(viewEmployee.departmentId)}</p></div>
                <div><p className="text-xs text-px-muted">Designation</p><p>{viewEmployee.profile?.jobTitle ?? "—"}</p></div>
                <div><p className="text-xs text-px-muted">Reports To</p><p>{employeeName(viewEmployee.reportingToId)}</p></div>
                <div><p className="text-xs text-px-muted">Employee Code</p><p>{viewEmployee.profile?.employeeCode ?? "—"}</p></div>
                <div><p className="text-xs text-px-muted">Employment Type</p><p>{viewEmployee.profile?.employmentType?.replace(/_/g, " ") ?? "—"}</p></div>
                <div><p className="text-xs text-px-muted">Joined</p><p>{viewEmployee.profile?.dateOfJoining ? formatDate(viewEmployee.profile.dateOfJoining) : "—"}</p></div>
                <div>
                  <p className="text-xs text-px-muted">Employment Status</p>
                  {viewEmployee.profile?.employmentStatus ? (
                    <Badge variant={EMPLOYMENT_STATUS_VARIANT[viewEmployee.profile.employmentStatus] ?? "outline"}>{viewEmployee.profile.employmentStatus.replace(/_/g, " ")}</Badge>
                  ) : "—"}
                </div>
              </div>
              <div className="border-t border-px-border pt-3">
                <p className="mb-1 text-xs font-semibold text-px-muted">Emergency Contact</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-px-muted">Name</p><p>{viewEmployee.profile?.emergencyContactName ?? "—"}</p></div>
                  <div><p className="text-xs text-px-muted">Phone</p><p>{viewEmployee.profile?.emergencyContactPhone ?? "—"}</p></div>
                </div>
              </div>
            </div>
          )}
          {isHrAdmin && viewEmployee && (
            <DialogFooter>
              <Button variant="outline" onClick={() => { selectProfileUser(viewEmployee.id); setViewEmployee(null); setProfileOpen(true); }}>Edit Profile</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
