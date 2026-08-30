"use client";

// Real-screen conversion (2026-08-30) -- replaces EmployeesClient.tsx's old
// "Request Leave" Dialog popup with a real create screen. Known
// pre-existing limitation: requestLeave() requires a real VERIDIAN user
// session (attributes the request to the caller's own dbUser id) --
// PROJEXA's shared-API-key proxy doesn't have one, so Submit will surface
// that honest 400 until the identity bridge exists (same gap as Log Time /
// Journal Entry submit / employee-profile save).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LeaveRequestCreateClient() {
  const router = useRouter();
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createLeaveRequest() {
    if (!leaveType.trim() || !startDate || !endDate) {
      toast.error("Leave type, start date, and end date are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/leave/requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveType, startDate, endDate, reason: reason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit leave request");
      toast.success("Leave request submitted");
      router.push("/employees?tab=leave");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit leave request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Employees / Request Leave"
      title="Request Leave"
      mode="create"
      hasDraft={false}
      onSave={createLeaveRequest}
      onCancel={() => router.push("/employees?tab=leave")}
      onBack={() => router.push("/employees?tab=leave")}
      saveDisabled={submitting || !leaveType.trim() || !startDate || !endDate}
      saveDisabledReason={submitting ? "Submitting…" : (!leaveType.trim() || !startDate || !endDate) ? "Leave type, start date, and end date are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Leave Type</Label><Input value={leaveType} onChange={(e) => setLeaveType(e.target.value)} placeholder="e.g. Casual, Sick, Earned" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Start Date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>End Date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>Reason (optional)</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
