"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, Briefcase, CalendarClock, Wallet, Building2 } from "lucide-react";

type Employee = { id: string; departmentId: string | null };
type Department = { id: string; name: string };
type LeaveRequest = { id: string; status: string };
type JobOpening = { id: string; status: string };
type PayrollRun = { id: string; month: number; year: number; status: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function HrDashboardClient() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [empRes, deptRes, leaveRes, openRes, runsRes] = await Promise.all([
          fetch("/api/employees"),
          fetch("/api/hr/departments"),
          fetch("/api/leave/requests"),
          fetch("/api/recruitment/job-openings"),
          fetch("/api/payroll/runs"),
        ]);
        setEmployees((await empRes.json()).employees ?? []);
        setDepartments((await deptRes.json()).departments ?? []);
        setLeaveRequests((await leaveRes.json()).requests ?? []);
        setOpenings((await openRes.json()).jobOpenings ?? []);
        setRuns((await runsRes.json()).runs ?? []);
      } catch {
        toast.error("Couldn't load HR dashboard");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const pendingLeave = useMemo(() => leaveRequests.filter((r) => r.status === "pending").length, [leaveRequests]);
  const openPositions = useMemo(() => openings.filter((o) => o.status === "open"), [openings]);
  const draftRun = useMemo(() => runs.find((r) => r.status === "draft"), [runs]);
  const headcountByDept = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      const key = e.departmentId ?? "__none__";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, name: id === "__none__" ? "Unassigned" : departments.find((d) => d.id === id)?.name ?? "Unknown", count }))
      .sort((a, b) => b.count - a.count);
  }, [employees, departments]);

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardCard title="Total Headcount" value={employees.length} icon={Users} variant="total" subtitle={`${departments.length} department(s)`} />
        <DashboardCard title="Open Positions" value={openPositions.length} icon={Briefcase} variant="pending" subtitle="across active job openings" />
        <DashboardCard title="Pending Leave Approvals" value={pendingLeave} icon={CalendarClock} variant={pendingLeave > 0 ? "overdue" : "completed"} subtitle="awaiting a decision" />
        <DashboardCard
          title="Upcoming Payroll Run"
          value={draftRun ? `${MONTHS[draftRun.month - 1]} ${draftRun.year}` : "None"}
          icon={Wallet}
          variant={draftRun ? "pending" : "completed"}
          subtitle={draftRun ? "draft — not yet processed" : "no draft run open"}
        />
      </div>

      <Card className="shadow-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="size-4" /> Headcount by Department</CardTitle></CardHeader>
        <CardContent>
          {headcountByDept.length === 0 ? (
            <p className="py-6 text-center text-sm text-px-muted">No employees yet.</p>
          ) : (
            <div className="space-y-2">
              {headcountByDept.map((d) => (
                <div key={d.id} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm">{d.name}</span>
                  <div className="h-2 flex-1 rounded-full bg-px-cloud2">
                    <div
                      className="h-2 rounded-full bg-px-orange"
                      style={{ width: `${Math.max(4, (d.count / Math.max(...headcountByDept.map((x) => x.count))) * 100)}%` }}
                    />
                  </div>
                  <Badge variant="outline">{d.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Link href="/employees" className="block"><Card className="shadow-card transition-shadow hover:shadow-md"><CardContent className="p-4"><p className="font-medium">Employee Directory</p><p className="text-sm text-px-muted">Departments, org chart, leave</p></CardContent></Card></Link>
        <Link href="/payroll" className="block"><Card className="shadow-card transition-shadow hover:shadow-md"><CardContent className="p-4"><p className="font-medium">Payroll</p><p className="text-sm text-px-muted">Runs, structures, statutory rules</p></CardContent></Card></Link>
        <Link href="/recruitment" className="block"><Card className="shadow-card transition-shadow hover:shadow-md"><CardContent className="p-4"><p className="font-medium">Recruitment</p><p className="text-sm text-px-muted">Openings, candidates, pipeline</p></CardContent></Card></Link>
      </div>
    </div>
  );
}
