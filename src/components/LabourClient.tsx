"use client";

// R46 P8 seq132: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list (see DocumentsClient.tsx's header comment for
// the full history). This screen never adopted the kit's ListScreen -- it's a
// plain shadcn Table -- so only the Roster tab's 6 real data columns
// (ID/Name/Trade/Company/Daily Rate/Status) are registry-driven: COLUMNS is the
// fallback used when labour/page.tsx's server-side resolve of the
// manpower.list screen_definitions row returns null. The Attendance tab is a
// separate transactional log and stays hardcoded, as does the row-index (S.No)
// column, which is not real data.
//
// Real-screen conversion (2026-08-30): the "Add Worker"/"Mark Attendance"
// Dialog popups are gone -- Add Worker routes to a real create screen
// (RosterCreateClient.tsx), roster rows route to a real Object Page
// (RosterObjectClient.tsx). Mark Attendance routes to a real create screen
// (AttendanceCreateClient.tsx) -- no Object Page for attendance rows, a
// write-once daily transaction log.
//
// R67 F-18: the ROSTER arrives as a prop, fetched by labour/page.tsx on the
// server inside its Suspense boundary, so the tab this screen opens on paints
// filled on first render.
//
// R67 F-25 (audit recommendation R-241) -- THE ATTENDANCE LOG IS NOT FETCHED
// UNTIL SOMEONE ASKS FOR IT, AND THEN ONLY FOR A DAY.
//
// This screen used to Promise.allSettled the roster, THE WHOLE UNDATED
// ATTENDANCE LOG and the vendor list on every landing, although it opens on
// Roster and shows not one attendance row until the user switches tab. A site
// with 40 workers produces 40 rows a day, so that payload grows without bound
// for a table nobody asked to see.
//
//   - Attendance is its own pane (src/lib/pane-state.ts), loaded when the
//     Attendance tab is actually opened, and scoped to ONE DAY -- today by
//     default -- with a real date picker and a "Show earlier days" control for
//     the week behind it.
//   - Vendors come from the session store the shell already filled (R67 F-21),
//     so this screen makes no request for them at all, and neither does
//     /labour/new (RosterCreateClient seeds its own lookup from the same
//     store).
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
import ListScreenFrame from "@/components/ListScreenFrame";
import { Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { MANPOWER_LIST_COLUMNS } from "@/lib/module-list-columns";
import { isAbortError, type ModuleListInitial } from "@/lib/module-list-state";
import { errorPane, idlePane, loadingPane, needsLoad, paneIsBusy, readyPane, seededPane, type Pane } from "@/lib/pane-state";
import { useShell } from "@/lib/shell-store";
import { EARLIER_DAYS, attendanceQuery, localDay } from "@/lib/attendance-query";
import { formatDate } from "@/lib/format-date";
import { EMPTY_VALUE, MONEY_CELL_CLASS } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";

// Exported so labour/page.tsx can type the rows it fetches server-side.
export type RosterEntry = { id: string; name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: string; isActive: boolean };
type AttendanceEntry = { id: string; rosterId: string; attendanceDate: string; status: string; hoursWorked: string | null; dailyCost: string };
type Vendor = { id: string; vendorName: string };

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as DocumentsClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

// R67 G-04 (R-231): the roster header reads ID | Name | Trade | Company |
// Daily Rate | Status, and the Daily Rate header carries the currency, so
// "AED" is stated once instead of forty times down the column. Those exact
// heads now live in MANPOWER_LIST_COLUMNS (F-18 moved them there so the loading
// skeleton draws the same table), which is byte-for-byte what G-04 specified --
// so the local copy that used to sit here is gone rather than duplicated.

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

export default function LabourClient({
  projectId,
  registryColumns,
  initialTab,
  initialRoster = null,
}: {
  projectId: string;
  registryColumns?: RegistryColumn[] | null;
  initialTab?: string;
  initialRoster?: ModuleListInitial<RosterEntry>;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MANPOWER_LIST_COLUMNS;
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "roster");
  // dailyRate and dailyCost have no per-row currencyId (roster entries are
  // always in the org's base currency), which is exactly what useOrgMoney()
  // resolves -- and, when the org has no currency row at all, what makes it
  // render the bare number behind a warning glyph instead of guessing. It
  // replaces F-25's raw useCurrencies()/currencyLabel() pair here.
  const orgMoney = useOrgMoney();
  // F-25: roster and attendance are Panes (declared below), not the three bare
  // useState arrays with one shared `loading` flag that used to sit here --
  // vendors now arrive with the /api/shell bootstrap, so /labour asks for them
  // not at all, and a failed attendance read can no longer read as an empty
  // roster.

  // R67 F-25: the vendor list is a session-scoped lookup the shell bootstrap
  // already holds. This screen makes no request for it. A failed bootstrap
  // degrades the Company column to an em-dash, exactly as a failed fetch did --
  // it was always a display-only lookup, never an alert.
  const shell = useShell();
  const vendors = (shell.vendors ?? []) as Vendor[];

  const [roster, setRoster] = useState<Pane<RosterEntry>>(() =>
    initialRoster ? seededPane(initialRoster.rows, initialRoster.errorMessage, Date.now()) : idlePane<RosterEntry>()
  );
  const [attendance, setAttendance] = useState<Pane<AttendanceEntry>>(idlePane<AttendanceEntry>);
  const [attendanceDay, setAttendanceDay] = useState(() => localDay());
  const [showEarlier, setShowEarlier] = useState(false);

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
      if (!force && !needsLoad(roster)) return;
      const controller = abortRef.current;
      setRoster((prev) => loadingPane(prev));
      try {
        const data = await fetchJson<{ roster?: RosterEntry[] }>(
          `/api/labour-roster?projectId=${encodeURIComponent(projectId)}`,
          { signal: controller?.signal }
        );
        if (controller?.signal.aborted) return;
        setRoster(readyPane(data.roster ?? [], Date.now()));
      } catch (err) {
        if (isAbortError(err, controller?.signal)) return;
        setRoster((prev) => errorPane(prev, errorMessage(err, "Roster")));
      }
    },
    [projectId, roster]
  );

  // Attendance is ALWAYS re-read when the day or the range changes -- that is
  // the user asking a different question, not a cache hit.
  const loadAttendance = useCallback(
    async (day: string, earlier: boolean) => {
      const controller = abortRef.current;
      setAttendance((prev) => loadingPane(prev));
      try {
        const data = await fetchJson<{ attendance?: AttendanceEntry[] }>(attendanceQuery(projectId, day, earlier), {
          signal: controller?.signal,
        });
        if (controller?.signal.aborted) return;
        setAttendance(readyPane(data.attendance ?? [], Date.now()));
      } catch (err) {
        if (isAbortError(err, controller?.signal)) return;
        setAttendance((prev) => errorPane(prev, errorMessage(err, "Attendance")));
      }
    },
    [projectId]
  );

  // Landing: the roster only, and only when the server did not already send it.
  // Attendance stays untouched until its own tab is opened -- unless the user
  // deep-linked straight to it with ?tab=attendance.
  // Synced in an effect, never during render -- see MaterialsClient's own
  // panesRef for the same reasoning.
  const rosterPaneRef = useRef(roster);
  useEffect(() => {
    rosterPaneRef.current = roster;
  });
  useEffect(() => {
    if (needsLoad(rosterPaneRef.current)) void loadRoster();
    if (activeTab === "attendance") void loadAttendance(attendanceDay, showEarlier);
    // Deliberately mount-only per project: the tab handler below owns every
    // later load, and re-running this on a tab change would double-fetch.
  }, [projectId]);

  // G-05's shared EMPTY_VALUE rather than a literal en-dash; F-25's roster is a
  // Pane, so the rows come from roster.rows.
  const vendorName = (id: string | null) => (id && vendors.find((v) => v.id === id)?.vendorName) || EMPTY_VALUE;
  const workerName = (id: string) => roster.rows.find((r) => r.id === id)?.name ?? id;

  function goToTab(tab: string) {
    setActiveTab(tab);
    if (tab === "attendance" && needsLoad(attendance)) void loadAttendance(attendanceDay, showEarlier);
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
            {/* R67 F-31: the roster region carries data-state / aria-busy, and
                a wait past 3 s says "Still loading roster… <n> s" instead of
                spinning silently. */}
            <ListScreenFrame
              label="roster"
              loading={paneIsBusy(roster)}
              error={roster.error}
              rowCount={roster.rows.length}
              onRetry={() => void loadRoster(true)}
            >
            {roster.error ? (
              <div className="p-4"><DataLoadError messages={[roster.error]} onRetry={() => loadRoster(true)} /></div>
            ) : roster.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No workers on the roster yet.</p>
            ) : (
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
                  {roster.rows.map((r, i) => (
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
            )}
            </ListScreenFrame>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="attendance" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* R67 F-25: the day is a real, visible control, so "which day am I
              looking at?" is answered on screen rather than assumed. */}
          <div className="flex items-center gap-2">
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
          {/* Real screen navigation (2026-08-30) -- replaces the old "Mark
              Attendance" Dialog popup with a real create route. */}
          <Button disabled={roster.rows.length === 0} onClick={() => router.push(`/labour/attendance/new?projectId=${projectId}`)}><Plus className="size-4" /> Mark Attendance</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            <ListScreenFrame
              label="attendance"
              loading={paneIsBusy(attendance)}
              error={attendance.error}
              rowCount={attendance.rows.length}
              onRetry={() => void loadAttendance(attendanceDay, showEarlier)}
            >
            {attendance.error ? (
              <div className="p-4"><DataLoadError messages={[attendance.error]} onRetry={() => loadAttendance(attendanceDay, showEarlier)} /></div>
            ) : attendance.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">
                {showEarlier
                  ? `No attendance recorded in the ${EARLIER_DAYS} days to ${formatDate(attendanceDay)}.`
                  : `No attendance recorded on ${formatDate(attendanceDay)}.`}
              </p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Worker</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Cost{orgMoney.unitSuffix}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {attendance.rows.map((a) => (
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
            </ListScreenFrame>
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
