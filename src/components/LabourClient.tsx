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
// Real screen navigation (2026-08-30): the "Add Worker"/"Mark Attendance"
// Dialog popups are gone -- Add Worker routes to a real create screen
// (RosterCreateClient.tsx), roster rows route to a real Object Page
// (RosterObjectClient.tsx, which gained real Edit/Deactivate this
// conversion -- updateRosterEntry() didn't exist before). Mark Attendance
// routes to a real create screen (AttendanceCreateClient.tsx) -- no Object
// Page for attendance rows, a write-once daily transaction log same as
// Expenses/Stock Entries.
//
// R67 F-06 (R-088/R-094) -- THE DATA PATH, REWRITTEN. Three faults, measured:
//
//  1. ONE PROMISE.ALLSETTLED GATED EVERYTHING. Roster, attendance and vendors
//     were awaited together and a single `loading` flag hid all three tabs
//     behind one spinner, so the roster -- the thing the user came for -- did
//     not appear until the slowest of the three answered. Each now has its own
//     state and paints the moment its OWN promise settles.
//  2. THE ATTENDANCE LOG WAS UNBOUNDED AND EAGER. Every visit fetched the
//     project's ENTIRE attendance history, workers x days, before the user had
//     clicked the Attendance tab even once. It is now fetched on first
//     activation of that tab, windowed to the last 30 days (?from=&to=, a real
//     server-side filter added to VERIDIAN's listAttendance in the same
//     change), with the window printed on the tab and a "Load older" control
//     that widens it in 30-day steps.
//  3. VENDORS WAS FETCHED PER SCREEN. /labour, /labour/new and /labour/[id]
//     each fetched the same never-changing subcontractor list on every mount.
//     They now share one tab-lifetime cache (src/lib/reference-lookups.ts).
//
// The vendors lookup is display-only -- a company name beside a worker -- so
// its failure still degrades that cell to an em-dash and never becomes an
// error card.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { StatusPill, StatusPillTone, type StatusTone } from "@/components/ui/status-pill";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fetchJson } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import { Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { loadVendors, type Vendor } from "@/lib/reference-lookups";
import { EMPTY_VALUE, MONEY_CELL_CLASS } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";

type RosterEntry = { id: string; name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: string; isActive: boolean };
type AttendanceEntry = { id: string; rosterId: string; attendanceDate: string; status: string; hoursWorked: string | null; dailyCost: string };

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as DocumentsClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

// R67 G-04 (R-231): the roster header reads ID | Name | Trade | Company |
// Daily Rate | Status, and the Daily Rate header carries the currency, so
// "AED" is stated once instead of forty times down the column.
const COLUMNS: ScreenColumn[] = [
  { label: "ID", field: "employeeCode", type: "text", importance: "High" },
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Trade", field: "trade", type: "text", importance: "High" },
  { label: "Company", field: "vendorId", type: "text", importance: "High" },
  { label: "Daily Rate", field: "dailyRate", type: "number", importance: "High" },
  { label: "Status", field: "isActive", type: "text", importance: "High" },
];

// Exported so labour/page.tsx's <Suspense> fallback shows the SAME headers the
// real table will show -- the point of the skeleton is that nothing moves when
// the data lands.
export const LABOUR_FALLBACK_COLUMN_LABELS = ["S.No", ...COLUMNS.map((c) => c.label)];
export const ATTENDANCE_COLUMN_LABELS = ["Date", "Worker", "Status", "Hours", "Cost"];

/** The money column, so the header can carry the unit and the cell can be right-aligned. */
const MONEY_FIELDS = new Set(["dailyRate"]);

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

// The attendance window. 30 days is the default a site manager reads daily;
// "Load older" widens it a month at a time rather than reaching for the whole
// history, which is exactly the unbounded call this item removes.
export const ATTENDANCE_WINDOW_STEP_DAYS = 30;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// Per-field cell renderer -- this screen isn't built on the kit's
// ListScreen, so unlike a generic column-type-driven renderer, the actual
// cell value for each known field is still this project's own formatting
// logic (including the vendorId -> company-name lookup), looked up by
// field name so a registry row can reorder/relabel these 6 columns live
// (the hard-stop test) without changing what renders.
function renderRosterCell(field: string, r: RosterEntry, vendorName: (id: string | null) => string, money: (v: number | string | null | undefined) => string) {
  switch (field) {
    // R67 G-04 (R-231): the en-dash for an empty cell, everywhere, never the
    // em-dash and never a blank.
    case "employeeCode":
      return <span className="text-px-muted">{r.employeeCode ?? EMPTY_VALUE}</span>;
    case "name":
      return <span className="font-medium">{r.name}</span>;
    case "trade":
      return <span className="text-px-muted">{r.trade ?? EMPTY_VALUE}</span>;
    case "vendorId":
      return <span className="text-px-muted">{vendorName(r.vendorId)}</span>;
    // R67 G-05: was `${currencyLabel}${r.dailyRate}` -- the raw drizzle
    // numeric string, so "1200" and "1200.5" rendered with different
    // precision in the same column. Now the one money formatter: two
    // decimals, tabular figures, right-aligned, currency in the header.
    case "dailyRate":
      return <span>{money(r.dailyRate)}</span>;
    case "isActive":
      // R67 G-02: was <Badge variant="default"> for active -- the saffron
      // primary fill, on a row that is merely "this worker is on the roster".
      // active -> sage tick, inactive -> grey circle, both with their word.
      return <StatusPill status={r.isActive ? "active" : "inactive"} />;
    default:
      return String((r as unknown as Record<string, unknown>)[field] ?? EMPTY_VALUE);
  }
}

// D-04's visible budget, client side: a wait that crosses 3 s stops being
// "fast" and the reader is told the request is still running rather than left
// to guess whether anything is happening.
function useSlowRequestFlag(pending: boolean, afterMs = 3_000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(timer);
  }, [pending, afterMs]);
  return slow;
}

export default function LabourClient({ projectId, registryColumns, initialTab }: { projectId: string; registryColumns?: RegistryColumn[] | null; initialTab?: string }) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "roster");

  // null means "not resolved yet" -- distinct from [], which is a real,
  // confirmed empty roster. The old single `loading` boolean could not tell
  // those apart per panel.
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const [attendance, setAttendance] = useState<AttendanceEntry[] | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [windowDays, setWindowDays] = useState(ATTENDANCE_WINDOW_STEP_DAYS);
  // Resolved on the client only. Computing "today" during render would make the
  // server's HTML and the client's first render disagree across a midnight
  // boundary; null until the effect below runs is the honest initial state.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const loadedRangeRef = useRef<string | null>(null);
  // R67 F-06 review fix: the range a request is IN FLIGHT for, as distinct from
  // the one already loaded. loadedRangeRef is only set when a request resolves,
  // so hovering the Attendance tab and then clicking it used to start the same
  // request twice -- the hover began it, and the tab effect could not yet see
  // that it had. Cleared on failure, so a Retry is always a real retry.
  const requestedRangeRef = useRef<string | null>(null);

  // dailyRate and dailyCost have no per-row currencyId (roster entries are
  // always in the org's base currency), which is exactly what useOrgMoney()
  // resolves -- and, when the org has no currency row at all, what makes it
  // render the bare number behind a warning glyph instead of guessing.
  const orgMoney = useOrgMoney();

  const rosterSlow = useSlowRequestFlag(roster === null && rosterError === null);
  const attendanceSlow = useSlowRequestFlag(attendanceLoading);

  // The FIRST load shows its skeleton immediately: this component mounts
  // directly after the page's own <Suspense> fallback (which already had the
  // headers on screen), so a 150 ms anti-flash delay here would produce
  // 150 ms of nothing between the two. A later Retry does use the delay,
  // because that one can genuinely come back instantly.
  //
  // State, not a ref: this value is READ DURING RENDER, and a ref read in
  // render is exactly the "your component will not update as expected" case
  // React's own lint rule names.
  const [skeletonDelayMs, setSkeletonDelayMs] = useState(0);

  const loadRoster = useCallback(async () => {
    setRoster(null);
    setRosterError(null);
    try {
      const data = await fetchJson<{ roster?: RosterEntry[] }>(`/api/labour-roster?projectId=${encodeURIComponent(projectId)}`);
      setRoster(data.roster ?? []);
    } catch (err) {
      setRoster([]);
      setRosterError(errorMessage(err, "Roster"));
    } finally {
      setSkeletonDelayMs(150);
    }
  }, [projectId]);

  // Roster and vendors are started together but settle independently: the
  // roster table renders as soon as the roster answers, whatever the vendor
  // lookup is doing.
  useEffect(() => {
    void loadRoster();
    void loadVendors().then(setVendors);
  }, [loadRoster]);

  useEffect(() => {
    setRange({ from: isoDaysAgo(windowDays), to: isoToday() });
  }, [windowDays]);

  const loadAttendance = useCallback(async (from: string, to: string) => {
    // Claim the range BEFORE the await. loadedRangeRef is only set when the
    // request resolves, so on its own it cannot answer "is this already in
    // flight?" -- and hover-then-click asks exactly that question twice within
    // a few hundred milliseconds.
    requestedRangeRef.current = `${from}..${to}`;
    setAttendanceLoading(true);
    setAttendanceError(null);
    try {
      const query = new URLSearchParams({ projectId, from, to });
      const data = await fetchJson<{ attendance?: AttendanceEntry[] }>(`/api/attendance?${query.toString()}`);
      setAttendance(data.attendance ?? []);
      loadedRangeRef.current = `${from}..${to}`;
    } catch (err) {
      setAttendance([]);
      setAttendanceError(errorMessage(err, "Attendance"));
      loadedRangeRef.current = null;
      // Released on failure, so Retry is a real retry rather than a no-op.
      requestedRangeRef.current = null;
    } finally {
      setAttendanceLoading(false);
    }
  }, [projectId]);

  // THE DEFERRED FETCH. Nothing asks for attendance until the Attendance tab is
  // actually on screen, and then only for the current window.
  useEffect(() => {
    if (activeTab !== "attendance" || !range) return;
    const key = `${range.from}..${range.to}`;
    // Either already loaded, or already asked for -- the second is what the
    // hover below arms, and skipping only the first would make hover-then-click
    // fire the same request twice.
    if (loadedRangeRef.current === key || requestedRangeRef.current === key) return;
    void loadAttendance(range.from, range.to);
  }, [activeTab, range, loadAttendance]);

  // Shared by the tab's hover and focus handlers so the two cannot drift apart.
  const warmAttendance = useCallback(() => {
    if (!range) return;
    const key = `${range.from}..${range.to}`;
    if (loadedRangeRef.current === key || requestedRangeRef.current === key) return;
    void loadAttendance(range.from, range.to);
  }, [range, loadAttendance]);

  const vendorName = (id: string | null) => (id && vendors.find((v) => v.id === id)?.vendorName) || EMPTY_VALUE;
  const workerName = (id: string) => (roster ?? []).find((r) => r.id === id)?.name ?? id;

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  const rangeLabel = range ? `${formatDate(range.from)} – ${formatDate(range.to)}` : null;

  return (
    <>
    <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="roster">Roster</TabsTrigger>
        {/* Hovering the tab warms the request, so the panel is usually already
            filled by the time the click lands. */}
        <TabsTrigger
          value="attendance"
          onMouseEnter={warmAttendance}
          onFocus={warmAttendance}
        >
          Attendance{rangeLabel ? <span className="ml-1.5 text-[11px] font-normal text-px-muted">{rangeLabel}</span> : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="roster" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "Add
              Worker" Dialog popup with a real create route. Hover prefetches
              the route chunk so the click is instant. */}
          <Button
            onMouseEnter={() => router.prefetch(`/labour/new?projectId=${projectId}`)}
            onFocus={() => router.prefetch(`/labour/new?projectId=${projectId}`)}
            onClick={() => router.push(`/labour/new?projectId=${projectId}`)}
          >
            <Plus className="size-4" /> Add Worker
          </Button>
        </div>
        {roster === null && !rosterError ? (
          <TableLoadingRows
            headers={LABOUR_FALLBACK_COLUMN_LABELS}
            rows={4}
            caption={rosterSlow ? "Still loading…" : "Loading the roster…"}
            delayMs={skeletonDelayMs}
          />
        ) : (
          <Card className="shadow-card">
            <CardContent className="p-0">
              {rosterError ? (
                <div className="p-4"><DataLoadError messages={[rosterError]} onRetry={loadRoster} /></div>
              ) : (roster ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-px-muted">No workers on the roster yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>S.No</TableHead>
                      {/* R67 G-05: the currency is stated once, in the money
                          column header, instead of forty times down it. */}
                      {columns.map((col) => (
                        <TableHead key={col.field} className={MONEY_FIELDS.has(col.field) ? "text-right" : undefined}>
                          {col.label}
                          {MONEY_FIELDS.has(col.field) ? orgMoney.unitSuffix : ""}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Real screen navigation (2026-08-30) -- rows open the
                        real Object Page, where Edit/Deactivate now live. */}
                    {(roster ?? []).map((r, i) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-px-cloud/40"
                        onMouseEnter={() => router.prefetch(`/labour/${r.id}`)}
                        onClick={() => router.push(`/labour/${r.id}`)}
                      >
                        <TableCell className="text-px-muted">{i + 1}</TableCell>
                        {columns.map((col) => (
                          <TableCell key={col.field} className={MONEY_FIELDS.has(col.field) ? MONEY_CELL_CLASS : undefined}>
                            {renderRosterCell(col.field, r, vendorName, orgMoney.money)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="attendance" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-px-muted">
            {rangeLabel ? `Showing ${rangeLabel}` : "Showing the last 30 days"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={attendanceLoading}
              onClick={() => setWindowDays((d) => d + ATTENDANCE_WINDOW_STEP_DAYS)}
            >
              Load older
            </Button>
            {/* Real screen navigation (2026-08-30) -- replaces the old "Mark
                Attendance" Dialog popup with a real create route. */}
            <Button
              disabled={(roster ?? []).length === 0}
              onMouseEnter={() => router.prefetch(`/labour/attendance/new?projectId=${projectId}`)}
              onFocus={() => router.prefetch(`/labour/attendance/new?projectId=${projectId}`)}
              onClick={() => router.push(`/labour/attendance/new?projectId=${projectId}`)}
            >
              <Plus className="size-4" /> Mark Attendance
            </Button>
          </div>
        </div>
        {attendance === null && !attendanceError ? (
          <TableLoadingRows
            headers={ATTENDANCE_COLUMN_LABELS}
            rows={4}
            caption={attendanceSlow ? "Still loading…" : "Loading attendance…"}
          />
        ) : (
          <Card className="shadow-card">
            <CardContent className="p-0">
              {attendanceError ? (
                <div className="p-4">
                  <DataLoadError
                    messages={[attendanceError]}
                    onRetry={() => { if (range) void loadAttendance(range.from, range.to); }}
                  />
                </div>
              ) : (attendance ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-px-muted">
                  No attendance recorded{rangeLabel ? ` between ${rangeLabel}` : ""} yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Worker</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      {/* R67 G-05: the currency once, in the header. */}
                      <TableHead className="text-right">Cost{orgMoney.unitSuffix}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(attendance ?? []).map((a) => (
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
                        <TableCell className="text-right tabular-nums">{a.hoursWorked ?? EMPTY_VALUE}</TableCell>
                        {/* R67 G-05: was the raw drizzle numeric string. */}
                        <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(a.dailyCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
    {/* R67 G-05: once, at the foot of the screen, explaining the warning
        glyph on every unlabelled figure -- and nothing at all when the org
        has a currency. */}
    <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </>
  );
}
