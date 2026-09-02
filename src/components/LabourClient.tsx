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
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { StatusPill, StatusPillTone, type StatusTone } from "@/components/ui/status-pill";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fetchJson } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import { Loader2, Plus } from "lucide-react";
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

// R67 G-02 (R-087). This map used to be shadcn Badge variants, and every one
// of the three was wrong for what it meant:
//   present    -> "default", which is the SAFFRON PRIMARY FILL. Saffron means
//                 "the one action on this screen"; painting a resting,
//                 nothing-to-do-here state in it made a log entry look like a
//                 button, and white-on-saffron measures 2.60:1 besides.
//   half_day   -> "secondary", a neutral grey that said nothing at all.
//   absent     -> "destructive", bright red. Rose is reserved for late and
//                 error; a worker who did not come in is not an error.
// The tones below are the M24 four, each carrying its own glyph AND its own
// word (the word is the attendance status itself), so the row is readable in
// greyscale and to a colour-blind reader.
const ATTENDANCE_TONE: Record<string, StatusTone> = {
  present: "done",
  half_day: "needs-you",
  absent: "late",
};

const VALID_TABS = new Set(["roster", "attendance"]);

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
      // R67 G-02: was <Badge variant="default"> for active -- the saffron
      // primary fill, on a row that is merely "this worker is on the roster".
      // active -> sage tick, inactive -> grey circle, both with their word.
      return <StatusPill status={r.isActive ? "active" : "inactive"} />;
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
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<{ roster?: string; attendance?: string }>({});

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
            )}
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
                      {/* R67 G-02: glyph + word, never the tone alone. An
                          attendance value the backend adds later that is not
                          in ATTENDANCE_TONE draws neutral with its own raw
                          word, so a new state is visible rather than
                          silently coloured as something it is not. */}
                      <TableCell>
                        <StatusPillTone tone={ATTENDANCE_TONE[a.status] ?? "neutral"} label={a.status.replace(/_/g, " ")} />
                      </TableCell>
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
