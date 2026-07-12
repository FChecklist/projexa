"use client";

import { useEffect, useState } from "react";
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
import { Loader2, Plus } from "lucide-react";

type RosterEntry = { id: string; name: string; trade: string | null; skillLevel: string | null; dailyRate: string; isActive: boolean };
type AttendanceEntry = { id: string; rosterId: string; attendanceDate: string; status: string; hoursWorked: string | null; dailyCost: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  present: "default", half_day: "secondary", absent: "destructive",
};

export default function LabourClient({ projectId }: { projectId: string }) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [rosterOpen, setRosterOpen] = useState(false);
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [rosterSubmitting, setRosterSubmitting] = useState(false);

  const [attOpen, setAttOpen] = useState(false);
  const [rosterId, setRosterId] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("present");
  const [hoursWorked, setHoursWorked] = useState("");
  const [attSubmitting, setAttSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [rosterRes, attRes] = await Promise.all([
        fetch(`/api/labour-roster?projectId=${encodeURIComponent(projectId)}`),
        fetch(`/api/attendance?projectId=${encodeURIComponent(projectId)}`),
      ]);
      const rosterData = await rosterRes.json();
      const attData = await attRes.json();
      setRoster(rosterData.roster ?? []);
      setAttendance(attData.attendance ?? []);
    } catch {
      toast.error("Couldn't load manpower data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createRoster() {
    if (!name.trim() || !dailyRate) return;
    setRosterSubmitting(true);
    try {
      const res = await fetch("/api/labour-roster", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, trade: trade || undefined, dailyRate: Number(dailyRate) }),
      });
      if (!res.ok) throw new Error();
      toast.success("Worker added to roster");
      setName(""); setTrade(""); setDailyRate(""); setRosterOpen(false);
      load();
    } catch {
      toast.error("Couldn't add worker");
    } finally {
      setRosterSubmitting(false);
    }
  }

  async function createAttendance() {
    if (!rosterId || !attendanceDate) return;
    setAttSubmitting(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, rosterId, attendanceDate, status, hoursWorked: hoursWorked ? Number(hoursWorked) : undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success("Attendance recorded");
      setHoursWorked(""); setAttOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't record attendance");
    } finally {
      setAttSubmitting(false);
    }
  }

  const workerName = (id: string) => roster.find((r) => r.id === id)?.name ?? id;

  return (
    <Tabs defaultValue="roster" className="space-y-4">
      <TabsList>
        <TabsTrigger value="roster">Roster</TabsTrigger>
        <TabsTrigger value="attendance">Attendance</TabsTrigger>
      </TabsList>

      <TabsContent value="roster" className="space-y-4">
        <div className="flex justify-end">
          <Dialog open={rosterOpen} onOpenChange={setRosterOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> Add Worker</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Worker to Roster</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Trade (optional)</Label><Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Mason, Electrician" /></div>
                <div className="space-y-1.5"><Label>Daily Rate</Label><Input type="number" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} /></div>
              </div>
              <DialogFooter><Button onClick={createRoster} disabled={rosterSubmitting}>{rosterSubmitting ? "Adding…" : "Add Worker"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : roster.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No workers on the roster yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Trade</TableHead><TableHead>Daily Rate</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {roster.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-px-muted">{r.trade ?? "—"}</TableCell>
                      <TableCell>{r.dailyRate}</TableCell>
                      <TableCell><Badge variant={r.isActive ? "default" : "outline"}>{r.isActive ? "active" : "inactive"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="attendance" className="space-y-4">
        <div className="flex justify-end">
          <Dialog open={attOpen} onOpenChange={setAttOpen}>
            <DialogTrigger asChild><Button disabled={roster.length === 0}><Plus className="size-4" /> Mark Attendance</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Mark Attendance</DialogTitle></DialogHeader>
              <div className="space-y-3">
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
              <DialogFooter><Button onClick={createAttendance} disabled={attSubmitting}>{attSubmitting ? "Saving…" : "Record"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : attendance.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No attendance recorded yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Worker</TableHead><TableHead>Status</TableHead><TableHead>Hours</TableHead><TableHead>Cost</TableHead></TableRow></TableHeader>
                <TableBody>
                  {attendance.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-px-muted">{new Date(a.attendanceDate).toLocaleDateString()}</TableCell>
                      <TableCell className="font-medium">{workerName(a.rosterId)}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{a.status.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell>{a.hoursWorked ?? "—"}</TableCell>
                      <TableCell>{a.dailyCost}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
