"use client";

// Real-screen conversion (2026-08-30): replaces LabourClient.tsx's old
// "Mark Attendance" Dialog popup with a real create screen. No Object Page
// -- a daily attendance row is a write-once transaction (dailyCost computed
// server-side at write time from the roster entry's own dailyRate), same
// class as Expenses/Stock Entries.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type RosterEntry = { id: string; name: string; isActive: boolean };

export default function AttendanceCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterId, setRosterId] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("present");
  const [hoursWorked, setHoursWorked] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ roster?: RosterEntry[] }>(`/api/labour-roster?projectId=${encodeURIComponent(projectId)}`)
      .then((d) => setRoster((d.roster ?? []).filter((r) => r.isActive)))
      .catch((err) => toast.error(errorMessage(err, "Couldn't load roster")));
  }, [projectId]);

  const missing = [...(rosterId ? [] : ["Worker"]), ...(attendanceDate ? [] : ["Date"])];

  async function createAttendance() {
    if (missing.length) return;
    setSubmitting(true);
    try {
      await fetchJson("/api/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, rosterId, attendanceDate, status, hoursWorked: hoursWorked ? Number(hoursWorked) : undefined }),
      });
      toast.success("Attendance recorded");
      router.push(`/labour?projectId=${projectId}&tab=attendance`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't record attendance"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Labour / Mark Attendance"
      title="Mark Attendance"
      mode="create"
      hasDraft={false}
      onSave={createAttendance}
      onCancel={() => router.push(`/labour?projectId=${projectId}&tab=attendance`)}
      onBack={() => router.push(`/labour?projectId=${projectId}&tab=attendance`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Saving…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Worker</Label>
          <Select value={rosterId} onValueChange={setRosterId}>
            <SelectTrigger><SelectValue placeholder="Select worker" /></SelectTrigger>
            <SelectContent>{roster.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="present">Present</SelectItem>
              <SelectItem value="half_day">Half Day</SelectItem>
              <SelectItem value="absent">Absent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Hours Worked (optional)</Label><Input type="number" value={hoursWorked} onChange={(e) => setHoursWorked(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
