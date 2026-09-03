"use client";

// R67 MERGE (lane D0 x lane F2). Both lanes rebuilt this screen's reads.
//
//   * Lane F2 (items F-25 / F-30, audit R-241 / R-274) fixed three things:
//     landing on Roster no longer fetches the attendance log and the vendor
//     list as well (the tab the user is looking at waited on two answers they
//     had not asked for); attendance is a DATED question, so it asks for one
//     day with a real date control and a "Show earlier days" range rather than
//     pulling the whole log; and vendors come from the shell bootstrap the
//     session already holds, so this screen asks for them not at all.
//   * Lane D0 (items D-65 / D-79) gave both panes the shared PaneState
//     presentation and the tab-aware header actions. Under decision D-11 that
//     presentation is canonical, and its tests (LabourClient.test.tsx) stay
//     exactly as they are.
//
// So: F2's per-pane state machine PRODUCES the state, D0's PaneState DECIDES
// WHAT THE SCREEN SAYS -- the union D-11's addendum describes.

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
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusPill, StatusPillTone, type StatusTone } from "@/components/ui/status-pill";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ApiError, fetchJson } from "@/lib/fetch-json";
import { PaneState } from "@/components/PaneState";
import { MANPOWER_LIST_COLUMNS } from "@/lib/module-list-columns";
import { isAbortError, type ModuleListInitial } from "@/lib/module-list-state";
import { EARLIER_DAYS, attendanceQuery, localDay } from "@/lib/attendance-query";
import { useShell } from "@/lib/shell-store";
import {
  errorPane,
  idlePane,
  loadingPane,
  needsLoad,
  readyPane,
  seededPane,
  type Pane,
} from "@/lib/pane-state";
import { recordCountLabel, type PaneStatus } from "@/lib/pane-state";
import { useProjectScope } from "@/components/shell/project-context";
import { ListHeaderActions } from "@/components/ListHeaderActions";
import { Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
// R67 D-74 keeps the ORG's date form here; R67 G-05 owns the money, through
// the one formatter in format-money.ts.
import { formatDate } from "@/lib/format";
import { EMPTY_VALUE, MONEY_CELL_CLASS } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";

// Exported so labour/page.tsx can type the roster it fetches server-side (F-18).
export type RosterEntry = { id: string; name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: string; isActive: boolean };
type AttendanceEntry = { id: string; rosterId: string; attendanceDate: string; status: string; hoursWorked: string | null; dailyCost: string };
type Vendor = { id: string; vendorName: string };

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as DocumentsClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

// R67 G-04 (R-231): the roster header reads ID | Name | Trade | Company |
// Daily Rate | Status, and the Daily Rate header carries the currency, so
// "AED" is stated once instead of forty times down the column.
// R67 F-18: the fallback labels live in src/lib/module-list-columns.ts so
// this table and the page's loading skeleton cannot disagree about a head.

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

const ATTENDANCE_COLUMNS = ["Date", "Worker", "Status", "Hours", "Cost"];

type PaneError = { status: number | null; message: string | null } | null;

/** What the transport actually said, kept whole for the dictionary to classify. */
/** The one sentence a failed pane carries. PaneState hands it to the shared
 *  dictionary, which is what turns "supabaseKey is required" into words. */
function paneMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "the request did not complete";
}

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
      // R67 D-74: was `{label}{raw string}` -- "AED 180" beside "AED 21750.00"
      // two tabs away, and unformatted for a five-figure rate. The cell that
      // holds this carries MONEY_CELL_CLASS, so the figures line up.
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

export default function LabourClient({
  projectId,
  registryColumns,
  initialTab,
  initialRoster = null,
}: {
  projectId: string;
  registryColumns?: RegistryColumn[] | null;
  initialTab?: string;
  /** R67 F-18 / F-30: the roster labour/page.tsx already fetched on the server,
   *  in the same upstream transaction as the day's attendance summary. */
  initialRoster?: ModuleListInitial<RosterEntry>;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MANPOWER_LIST_COLUMNS;
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "roster");
  // R67 F-25: the vendor list is a session-scoped lookup the shell bootstrap
  // already holds, so this screen makes no request for it. A failed bootstrap
  // degrades the Company column to an em-dash, exactly as a failed fetch did --
  // it was always a display-only lookup, never an alert.
  const shell = useShell();
  const vendors = (shell.vendors ?? []) as Vendor[];
  // dailyRate and dailyCost have no per-row currencyId (roster entries are
  // always in the org's base currency), which is exactly what useOrgMoney()
  // resolves -- and, when the org has no currency row at all, what makes it
  // render the bare number behind a warning glyph instead of guessing.
  const orgMoney = useOrgMoney();
  const { project } = useProjectScope();
  const projectName = project?.name ?? null;
  // F-25: roster and attendance are each their own Pane, so a failed
  // attendance read can no longer read as an empty roster, and the tab the
  // user is on never waits on the tab they are not.
  const [rosterPane, setRosterPane] = useState<Pane<RosterEntry>>(() =>
    initialRoster ? seededPane(initialRoster.rows, initialRoster.errorMessage, Date.now()) : idlePane<RosterEntry>()
  );
  const [attendancePane, setAttendancePane] = useState<Pane<AttendanceEntry>>(idlePane<AttendanceEntry>);
  const [attendanceDay, setAttendanceDay] = useState(() => localDay());
  const [showEarlier, setShowEarlier] = useState(false);
  const [rosterStartedAt, setRosterStartedAt] = useState<number | null>(null);
  const [attendanceStartedAt, setAttendanceStartedAt] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [projectId]);

  const loadRoster = useCallback(
    async (force = false) => {
      const controller = abortRef.current;
      if (!force && !needsLoad(rosterPaneRef.current)) return;
      setRosterPane((prev) => loadingPane(prev));
      setRosterStartedAt(Date.now());
      try {
        const data = await fetchJson<{ roster?: RosterEntry[] }>(
          `/api/labour-roster?projectId=${encodeURIComponent(projectId)}`,
          { signal: controller?.signal }
        );
        if (controller?.signal.aborted) return;
        setRosterPane(readyPane(data.roster ?? [], Date.now()));
      } catch (err) {
        if (isAbortError(err, controller?.signal)) return;
        // The rows are NOT cleared: a failed refresh must not destroy a roster
        // the user could read a second ago. PaneState labels them "as of".
        setRosterPane((prev) => errorPane(prev, paneMessage(err)));
      }
    },
    [projectId]
  );

  // Attendance is ALWAYS re-read when the day or the range changes -- that is
  // the user asking a different question, not a cache hit.
  const loadAttendance = useCallback(
    async (day: string, earlier: boolean) => {
      const controller = abortRef.current;
      setAttendancePane((prev) => loadingPane(prev));
      setAttendanceStartedAt(Date.now());
      try {
        const data = await fetchJson<{ attendance?: AttendanceEntry[] }>(attendanceQuery(projectId, day, earlier), {
          signal: controller?.signal,
        });
        if (controller?.signal.aborted) return;
        setAttendancePane(readyPane(data.attendance ?? [], Date.now()));
      } catch (err) {
        if (isAbortError(err, controller?.signal)) return;
        setAttendancePane((prev) => errorPane(prev, paneMessage(err)));
      }
    },
    [projectId]
  );

  // Synced in an effect, never during render -- loadRoster() reads it to decide
  // whether the pane has already answered.
  const rosterPaneRef = useRef(rosterPane);
  useEffect(() => {
    rosterPaneRef.current = rosterPane;
  });

  // Landing: the roster only, and only when the server did not already send it.
  // Attendance stays untouched until its own tab is opened -- unless the user
  // deep-linked straight to it with ?tab=attendance.
  useEffect(() => {
    if (needsLoad(rosterPaneRef.current)) void loadRoster();
    if (activeTab === "attendance") void loadAttendance(attendanceDay, showEarlier);
    // Deliberately mount-only per project: goToTab owns every later load, and
    // re-running this on a tab change would double-fetch.
  }, [projectId]);

  const roster = rosterPane.rows;
  const attendance = attendancePane.rows;
  const rosterStatus = rosterPane.status;
  const attendanceStatus = attendancePane.status;
  const rosterError: PaneError = rosterPane.error ? { status: null, message: rosterPane.error } : null;
  const attendanceError: PaneError = attendancePane.error ? { status: null, message: attendancePane.error } : null;
  const rosterLoadedAt = rosterPane.asOf ? new Date(rosterPane.asOf) : null;
  const attendanceLoadedAt = attendancePane.asOf ? new Date(attendancePane.asOf) : null;

  const vendorName = (id: string | null) => (id && vendors.find((v) => v.id === id)?.vendorName) || EMPTY_VALUE;
  const workerName = (id: string) => roster.find((r) => r.id === id)?.name ?? id;

  function goToTab(tab: string) {
    setActiveTab(tab);
    if (tab === "attendance" && needsLoad(attendancePane)) void loadAttendance(attendanceDay, showEarlier);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function pickDay(day: string) {
    if (!day) return;
    setAttendanceDay(day);
    void loadAttendance(day, showEarlier);
  }

  function toggleEarlier() {
    const next = !showEarlier;
    setShowEarlier(next);
    void loadAttendance(attendanceDay, next);
  }

  return (
    <>
    <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
      {/* R67 D-79: the header trio, once, ABOVE the tabs. Each tab used to
          carry exactly one create button -- its own -- so marking attendance
          from the Roster meant finding the Attendance tab first. This is
          tab-aware, so it appears on every tab and offers that tab's own
          object first while still listing the whole module. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        </TabsList>
        <ListHeaderActions
          module="labour"
          tab={activeTab}
          projectId={projectId}
          filterDisabledReason="Filtering the roster is not built yet"
          exportDisabledReason="Exporting the roster is not built yet"
          // Attendance is written against a roster entry, so it stays in the
          // menu and says why rather than disappearing on an empty project.
          createDisabledReasons={roster.length === 0 ? { Attendance: "Add a worker to the roster first" } : {}}
        />
      </div>

      <TabsContent value="roster" className="space-y-4">
        <Card className="shadow-card">
          <CardContent className="p-2">
            <p className="px-2 py-1 text-[12px] text-px-muted">{recordCountLabel(rosterStatus, roster.length)}</p>
            <PaneState
              status={rosterStatus}
              entity="the roster"
              projectName={projectName}
              startedAt={rosterStartedAt}
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
              onRetry={() => void loadRoster(true)}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S.No</TableHead>
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
                  {roster.map((r, i) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/labour/${r.id}`)}>
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
            </PaneState>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="attendance" className="space-y-4">
        {/* R67 F-25: the day is a real, visible control, so "which day am I
            looking at?" is answered on screen rather than assumed. */}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="attendance-day" className="text-sm text-px-muted">Day</label>
          <input
            id="attendance-day"
            type="date"
            value={attendanceDay}
            max={localDay()}
            onChange={(e) => pickDay(e.target.value)}
            className="h-9 rounded-md border border-px-border bg-transparent px-2 text-sm"
          />
          <Button variant="ghost" size="sm" onClick={toggleEarlier}>
            {showEarlier ? `Show only ${formatDate(attendanceDay)}` : "Show earlier days"}
          </Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-2">
            <p className="px-2 py-1 text-[12px] text-px-muted">{recordCountLabel(attendanceStatus, attendance.length)}</p>
            <PaneState
              status={attendanceStatus}
              entity="attendance"
              projectName={projectName}
              startedAt={attendanceStartedAt}
              error={attendanceError}
              rowCount={attendance.length}
              lastLoadedAt={attendanceLoadedAt}
              skeletonColumns={ATTENDANCE_COLUMNS}
              emptyMessage={
                showEarlier
                  ? `No attendance recorded in the ${EARLIER_DAYS} days to ${formatDate(attendanceDay)}.`
                  : `No attendance recorded on ${formatDate(attendanceDay)}.`
              }
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
              onRetry={() => void loadAttendance(attendanceDay, showEarlier)}
            >
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Worker</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Cost{orgMoney.unitSuffix}</TableHead></TableRow></TableHeader>
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
                      <TableCell className="text-right tabular-nums">{a.hoursWorked ?? EMPTY_VALUE}</TableCell>
                      {/* R67 G-05: was the raw drizzle numeric string. */}
                      <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(a.dailyCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PaneState>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
    {/* R67 G-05: once, at the foot of the screen, explaining the warning
        glyph on every unlabelled figure -- and nothing at all when the org
        has a currency. */}
    <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </>
  );
}
