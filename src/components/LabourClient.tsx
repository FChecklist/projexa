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
//
// Real-screen conversion (2026-08-30): the "Add Worker"/"Mark Attendance"
// Dialog popups are gone -- Add Worker routes to a real create screen
// (RosterCreateClient.tsx), roster rows route to a real Object Page
// (RosterObjectClient.tsx, which gained real Edit/Deactivate this
// conversion -- updateRosterEntry() didn't exist before). Mark Attendance
// routes to a real create screen (AttendanceCreateClient.tsx) -- no Object
// Page for attendance rows, a write-once daily transaction log same as
// Expenses/Stock Entries. Also fixes the same uncontrolled-Tabs-no-URL-sync
// bug found and fixed repeatedly this session.
//
// --- R67 D-65: the two panels adopt PaneState -----------------------------
//
// This screen was already better than most: it held a per-panel error and
// never printed an empty sentence over a failure. Two things were still
// wrong, and both are why D-65 exists.
//
//  1. A WORDLESS SPINNER. A Loader2 in a 128px box says something is
//     happening and nothing about what; when it resolves, a six-column table
//     appears and the whole page moves. The skeleton is the table's own
//     shape, and the wait is narrated -- named at 2 s, counted from 3 s,
//     offered a way out at 8 s.
//  2. A FAILED REFRESH THREW THE ROWS AWAY. `else { setRoster([]); ... }`
//     blanked a roster the user could read a second ago because a REFRESH
//     failed. The rows are kept now and labelled with when they were true.
//
// The failure sentence comes from the one shared dictionary
// (src/lib/task-errors.ts) rather than errorMessage()'s "Roster: <raw text>",
// so "supabaseKey is required" reads as "file storage is not configured for
// this environment" here exactly as it does on every other screen.
//
// The project name comes from D-66's ProjectContext rather than a new prop:
// the waiting line names the project, and there must be exactly one answer
// to which project that is.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ApiError, fetchJson } from "@/lib/fetch-json";
import { PaneState } from "@/components/PaneState";
import { recordCountLabel, type PaneStatus } from "@/lib/pane-state";
import { useProjectScope } from "@/components/shell/project-context";
import { Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { currencyLabel, useCurrencies } from "@/lib/currency";

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

const VALID_TABS = new Set(["roster", "attendance"]);

const ATTENDANCE_COLUMNS = ["Date", "Worker", "Status", "Hours", "Cost"];

type PaneError = { status: number | null; message: string | null } | null;

/** What the transport actually said, kept whole for the dictionary to classify. */
function toPaneError(reason: unknown): PaneError {
  return {
    status: reason instanceof ApiError ? reason.status : null,
    message: reason instanceof Error ? reason.message : null,
  };
}

// Per-field cell renderer -- this screen isn't built on the kit's
// ListScreen, so unlike a generic column-type-driven renderer, the actual
// cell value for each known field is still this project's own formatting
// logic (including the vendorId -> company-name lookup), looked up by
// field name so a registry row can reorder/relabel these 6 columns live
// (the hard-stop test) without changing what renders.
function renderRosterCell(field: string, r: RosterEntry, vendorName: (id: string | null) => string, rateCurrencyLabel: string) {
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
      return <span>{rateCurrencyLabel}{r.dailyRate}</span>;
    case "isActive":
      return <Badge variant={r.isActive ? "default" : "outline"}>{r.isActive ? "active" : "inactive"}</Badge>;
    default:
      return String((r as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function LabourClient({ projectId, registryColumns, initialTab }: { projectId: string; registryColumns?: RegistryColumn[] | null; initialTab?: string }) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "roster");
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const currencies = useCurrencies();
  // dailyRate has no per-row currencyId (roster entries are always in the
  // org's base currency) -- same undefined-id "org base currency" lookup
  // QuotationsClient.tsx etc. use for currencyLabel().
  const rosterCurrencyLabel = currencyLabel(undefined, currencies);
  const { project } = useProjectScope();
  const projectName = project?.name ?? null;
  const [rosterStatus, setRosterStatus] = useState<PaneStatus>("loading");
  const [attendanceStatus, setAttendanceStatus] = useState<PaneStatus>("loading");
  const [rosterError, setRosterError] = useState<PaneError>(null);
  const [attendanceError, setAttendanceError] = useState<PaneError>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [rosterLoadedAt, setRosterLoadedAt] = useState<Date | null>(null);
  const [attendanceLoadedAt, setAttendanceLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setRosterStatus("loading");
    setAttendanceStatus("loading");
    setStartedAt(Date.now());
    setRosterError(null);
    setAttendanceError(null);

    // allSettled: a failing vendors lookup must not blank the roster, and a
    // failing roster must not be reported to the user as "no workers".
    const [rosterR, attR, vendorsR] = await Promise.allSettled([
      fetchJson<{ roster?: RosterEntry[] }>(`/api/labour-roster?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ attendance?: AttendanceEntry[] }>(`/api/attendance?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ vendors?: Vendor[] }>(`/api/vendors`),
    ]);

    if (rosterR.status === "fulfilled") {
      setRoster(rosterR.value.roster ?? []);
      setRosterLoadedAt(new Date());
      setRosterStatus("ready");
    } else {
      // The rows are NOT cleared: a failed refresh must not destroy a roster
      // the user could read a second ago.
      setRosterError(toPaneError(rosterR.reason));
      setRosterStatus("error");
    }

    if (attR.status === "fulfilled") {
      setAttendance(attR.value.attendance ?? []);
      setAttendanceLoadedAt(new Date());
      setAttendanceStatus("ready");
    } else {
      setAttendanceError(toPaneError(attR.reason));
      setAttendanceStatus("error");
    }

    // Vendors is a display-only lookup (company name); its failure degrades to
    // an em-dash rather than to an alert.
    setVendors(vendorsR.status === "fulfilled" ? (vendorsR.value.vendors ?? []) : []);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const vendorName = (id: string | null) => (id && vendors.find((v) => v.id === id)?.vendorName) || "—";
  const workerName = (id: string) => roster.find((r) => r.id === id)?.name ?? id;

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="roster">Roster</TabsTrigger>
        <TabsTrigger value="attendance">Attendance</TabsTrigger>
      </TabsList>

      <TabsContent value="roster" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "Add
              Worker" Dialog popup with a real create route. */}
          <Button onClick={() => router.push(`/labour/new?projectId=${projectId}`)}><Plus className="size-4" /> Add Worker</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-2">
            <p className="px-2 py-1 text-[12px] text-px-muted">{recordCountLabel(rosterStatus, roster.length)}</p>
            <PaneState
              status={rosterStatus}
              entity="the roster"
              projectName={projectName}
              startedAt={startedAt}
              error={rosterError}
              rowCount={roster.length}
              lastLoadedAt={rosterLoadedAt}
              skeletonColumns={["S.No", ...columns.map((c) => c.label)]}
              emptyMessage="No workers on the roster yet."
              emptyAction={
                <Button size="sm" onClick={() => router.push(`/labour/new?projectId=${projectId}`)}>
                  <Plus className="size-4" aria-hidden /> Add Worker
                </Button>
              }
              onRetry={() => void load()}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S.No</TableHead>
                    {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Real screen navigation (2026-08-30) -- rows open the
                      real Object Page, where Edit/Deactivate now live. */}
                  {roster.map((r, i) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/labour/${r.id}`)}>
                      <TableCell className="text-px-muted">{i + 1}</TableCell>
                      {columns.map((col) => (
                        <TableCell key={col.field}>{renderRosterCell(col.field, r, vendorName, rosterCurrencyLabel)}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PaneState>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="attendance" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "Mark
              Attendance" Dialog popup with a real create route. */}
          <Button disabled={roster.length === 0} onClick={() => router.push(`/labour/attendance/new?projectId=${projectId}`)}><Plus className="size-4" /> Mark Attendance</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-2">
            <p className="px-2 py-1 text-[12px] text-px-muted">{recordCountLabel(attendanceStatus, attendance.length)}</p>
            <PaneState
              status={attendanceStatus}
              entity="attendance"
              projectName={projectName}
              startedAt={startedAt}
              error={attendanceError}
              rowCount={attendance.length}
              lastLoadedAt={attendanceLoadedAt}
              skeletonColumns={ATTENDANCE_COLUMNS}
              emptyMessage="No attendance recorded yet."
              emptyAction={
                <Button
                  size="sm"
                  disabled={roster.length === 0}
                  title={roster.length === 0 ? "Add a worker to the roster first" : undefined}
                  onClick={() => router.push(`/labour/attendance/new?projectId=${projectId}`)}
                >
                  <Plus className="size-4" aria-hidden /> Mark Attendance
                </Button>
              }
              onRetry={() => void load()}
            >
              <Table>
                <TableHeader><TableRow>{ATTENDANCE_COLUMNS.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {attendance.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-px-muted">{formatDate(a.attendanceDate)}</TableCell>
                      <TableCell className="font-medium">{workerName(a.rosterId)}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{a.status.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell>{a.hoursWorked ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{a.dailyCost}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PaneState>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
