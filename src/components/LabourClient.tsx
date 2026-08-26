"use client";

// R46 P8 seq132: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list and R46 P8 seq128/seq134/seq127 established
// for documents.list/variations.list/drawings.list (see DocumentsClient.tsx's
// header comment for the full history). This screen never adopted the
// kit's ListScreen component -- it's a plain shadcn Table -- so only the
// Roster tab's 6 real data columns (ID/Name/Trade/Company/Daily Rate/
// Status) are registry-driven: COLUMNS is now the fallback used when
// labour/page.tsx's server-side resolve of the manpower.list
// screen_definitions row returns null (404/error), same "keep the
// hardcoded version behind a flag until verified" contract as permits,
// documents, drawings and change-orders. The Attendance tab is a separate
// transactional log (not the "manpower list" itself) and stays fully
// hardcoded, same as Documents' category filter or ChangeOrders' Actions
// column staying outside their registry-driven columns. The row-index
// (S.No) column is likewise not real data and stays hardcoded, always
// rendered first.
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
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import PrimarySubmit from "@/components/PrimarySubmit";
import { Loader2, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";

type RosterEntry = { id: string; name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: string; isActive: boolean };
type AttendanceEntry = { id: string; rosterId: string; attendanceDate: string; status: string; hoursWorked: string | null; dailyCost: string };
type Vendor = { id: string; vendorName: string };

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as DocumentsClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "ID", field: "employeeCode", type: "text", importance: "High" },
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Trade", field: "trade", type: "text", importance: "High" },
  { label: "Company", field: "vendorId", type: "text", importance: "High" },
  { label: "Daily Rate", field: "dailyRate", type: "number", importance: "High" },
  { label: "Status", field: "isActive", type: "text", importance: "High" },
];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  present: "default", half_day: "secondary", absent: "destructive",
};

// Per-field cell renderer -- this screen isn't built on the kit's
// ListScreen, so unlike a generic column-type-driven renderer, the actual
// cell value for each known field is still this project's own formatting
// logic (including the vendorId -> company-name lookup), looked up by
// field name so a registry row can reorder/relabel these 6 columns live
// (the hard-stop test) without changing what renders.
function renderRosterCell(field: string, r: RosterEntry, vendorName: (id: string | null) => string) {
  switch (field) {
    case "employeeCode":
      return <span className="text-px-muted">{r.employeeCode ?? "—"}</span>;
    case "name":
      return <span className="font-medium">{r.name}</span>;
    case "trade":
      return <span className="text-px-muted">{r.trade ?? "—"}</span>;
    case "vendorId":
      return <span className="text-px-muted">{vendorName(r.vendorId)}</span>;
    case "dailyRate":
      return <span>{r.dailyRate}</span>;
    case "isActive":
      return <Badge variant={r.isActive ? "default" : "outline"}>{r.isActive ? "active" : "inactive"}</Badge>;
    default:
      return String((r as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function LabourClient({ projectId, registryColumns }: { projectId: string; registryColumns?: RegistryColumn[] | null }) {
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<{ roster?: string; attendance?: string }>({});

  const [rosterOpen, setRosterOpen] = useState(false);
  const [name, setName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [trade, setTrade] = useState("");
  const [vendorId, setVendorId] = useState("");
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
    // allSettled: a failing vendors lookup must not blank the roster, and a
    // failing roster must not be reported to the user as "no workers".
    const [rosterR, attR, vendorsR] = await Promise.allSettled([
      fetchJson<{ roster?: RosterEntry[] }>(`/api/labour-roster?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ attendance?: AttendanceEntry[] }>(`/api/attendance?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ vendors?: Vendor[] }>(`/api/vendors`),
    ]);

    const errors: { roster?: string; attendance?: string } = {};
    if (rosterR.status === "fulfilled") setRoster(rosterR.value.roster ?? []);
    else { setRoster([]); errors.roster = errorMessage(rosterR.reason, "Roster"); }

    if (attR.status === "fulfilled") setAttendance(attR.value.attendance ?? []);
    else { setAttendance([]); errors.attendance = errorMessage(attR.reason, "Attendance"); }

    // Vendors is a display-only lookup (company name); its failure degrades to
    // an em-dash rather than to an alert.
    setVendors(vendorsR.status === "fulfilled" ? (vendorsR.value.vendors ?? []) : []);

    setLoadErrors(errors);
    setLoading(false);
  }

  useEffect(() => { load(); }, [projectId]);

  const vendorName = (id: string | null) => (id && vendors.find((v) => v.id === id)?.vendorName) || "—";

  const rosterMissing = [
    ...(name.trim() ? [] : ["Name"]),
    ...(dailyRate ? [] : ["Daily Rate"]),
  ];
  const attMissing = [
    ...(rosterId ? [] : ["Worker"]),
    ...(attendanceDate ? [] : ["Date"]),
  ];

  async function createRoster() {
    if (!name.trim() || !dailyRate) return;
    setRosterSubmitting(true);
    try {
      await fetchJson("/api/labour-roster", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, name, employeeCode: employeeCode || undefined, trade: trade || undefined,
          vendorId: vendorId || undefined, dailyRate: Number(dailyRate),
        }),
      });
      toast.success("Worker added to roster");
      setName(""); setEmployeeCode(""); setTrade(""); setVendorId(""); setDailyRate(""); setRosterOpen(false);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add worker"));
    } finally {
      setRosterSubmitting(false);
    }
  }

  async function createAttendance() {
    if (!rosterId || !attendanceDate) return;
    setAttSubmitting(true);
    try {
      await fetchJson("/api/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, rosterId, attendanceDate, status, hoursWorked: hoursWorked ? Number(hoursWorked) : undefined }),
      });
      toast.success("Attendance recorded");
      setHoursWorked(""); setAttOpen(false);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't record attendance"));
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
                <div className="space-y-1.5"><Label>ID (optional)</Label><Input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="e.g. EMP-001" /></div>
                <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Trade (optional)</Label><Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Mason, Electrician" /></div>
                <div className="space-y-1.5">
                  <Label>Company (optional)</Label>
                  <Select value={vendorId} onValueChange={setVendorId}>
                    <SelectTrigger><SelectValue placeholder="Select subcontractor" /></SelectTrigger>
                    <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Daily Rate</Label><Input type="number" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} /></div>
              </div>
              <DialogFooter>
                <PrimarySubmit missing={rosterMissing} submitting={rosterSubmitting} submittingLabel="Adding…" onClick={createRoster}>
                  Add Worker
                </PrimarySubmit>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : loadErrors.roster ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.roster]} onRetry={load} /></div>
            ) : roster.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No workers on the roster yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S.No</TableHead>
                    {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.map((r, i) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-px-muted">{i + 1}</TableCell>
                      {columns.map((col) => (
                        <TableCell key={col.field}>{renderRosterCell(col.field, r, vendorName)}</TableCell>
                      ))}
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
              <DialogFooter>
                <PrimarySubmit missing={attMissing} submitting={attSubmitting} submittingLabel="Saving…" onClick={createAttendance}>
                  Record
                </PrimarySubmit>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : loadErrors.attendance ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.attendance]} onRetry={load} /></div>
            ) : attendance.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No attendance recorded yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Worker</TableHead><TableHead>Status</TableHead><TableHead>Hours</TableHead><TableHead>Cost</TableHead></TableRow></TableHeader>
                <TableBody>
                  {attendance.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-px-muted">{formatDate(a.attendanceDate)}</TableCell>
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
