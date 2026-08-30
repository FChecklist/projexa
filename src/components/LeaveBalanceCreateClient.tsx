"use client";

// Real-screen conversion (2026-08-30) -- replaces EmployeesClient.tsx's old
// "Set Leave Balance" Dialog popup with a real create screen. No Object
// Page: setLeaveBalance() is an upsert-on-write with no separate get/list
// -by-id, and no delete exists -- matches this module's own precedent.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";

type Employee = { id: string; name: string };

export default function LeaveBalanceCreateClient() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [userId, setUserId] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [totalDays, setTotalDays] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ employees?: Employee[] }>("/api/employees").then((d) => setEmployees(d.employees ?? [])).catch(() => {});
  }, []);

  async function saveBalance() {
    if (!userId || !leaveType.trim() || !totalDays) {
      toast.error("Employee, leave type, and total days are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/leave/balances", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, leaveType, year: Number(year), totalDays: Number(totalDays) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save leave balance");
      toast.success("Leave balance saved");
      router.push("/employees?tab=leave");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save leave balance");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Employees / Set Leave Balance"
      title="Set Leave Balance"
      mode="create"
      hasDraft={false}
      onSave={saveBalance}
      onCancel={() => router.push("/employees?tab=leave")}
      onBack={() => router.push("/employees?tab=leave")}
      saveDisabled={submitting || !userId || !leaveType.trim() || !totalDays}
      saveDisabledReason={submitting ? "Saving…" : (!userId || !leaveType.trim() || !totalDays) ? "Employee, leave type, and total days are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Employee</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Leave Type</Label><Input value={leaveType} onChange={(e) => setLeaveType(e.target.value)} placeholder="e.g. Casual" /></div>
          <div className="space-y-1.5"><Label>Year</Label><Input type="number" value={year} onChange={(e) => setYear(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>Total Days</Label><Input type="number" value={totalDays} onChange={(e) => setTotalDays(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
