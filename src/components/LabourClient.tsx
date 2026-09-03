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
// documents, drawings and change-orders. The row-index (S.No) column is
// likewise not real data and stays hardcoded, always rendered first.
//
// Real-screen conversion (2026-08-30): the "Add Worker"/"Mark Attendance"
// Dialog popups are gone -- Add Worker routes to a real create screen
// (RosterCreateClient.tsx), roster rows route to a real Object Page
// (RosterObjectClient.tsx). Mark Attendance routes to a real create screen
// (AttendanceCreateClient.tsx).
//
// R67 D-32 (audit R-083/R-084/R-086/R-092) and D-30 (R-082/R-089). Four
// things changed here and each fixes something the screen was actually doing
// wrong:
//
//  1. IT NAMED NO PROJECT. The header said "Manpower & Attendance" while the
//     top rail could read "All projects" and every call underneath carried
//     exactly one projectId. The header now prints the project in the context
//     tint, and when that project was reached by falling back to the org's
//     first one, it says so in a sentence instead of leaving the user to
//     guess.
//  2. THE ACTIONS LIVED INSIDE A TAB. "+ Add Worker" was inside the Roster
//     tab body, so it vanished on Attendance. Filter | Export | + New Worker
//     is now one header trio, in that fixed order, on every tab.
//  3. LOADING WAS A SPINNER IN A 128px BOX that the real table then resized,
//     moving whatever the user was aiming at. It is now a skeleton built from
//     the same columns array, captioned with what is loading.
//  4. THE ATTENDANCE TAB WAS A FLAT TRANSACTION LOG plus a button. It is now
//     a list of DAILY SHEETS -- one row per date, opening
//     /labour/attendance/{date} -- because attendance is marked a day at a
//     time, not a row at a time. The one-worker form stays reachable as
//     "Mark one worker".
//
// Every disabled control carries its reason in the visible label, in the
// product's existing "Label (reason)" form.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusPill, StatusPillTone, type StatusTone } from "@/components/ui/status-pill";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import DataLoadError from "@/components/DataLoadError";
import SkeletonTable from "@/components/SkeletonTable";
import LabourDailySummaryClient from "@/components/LabourDailySummaryClient";
import { PageHeading, type PageHeadingAction } from "@/components/PageHeading";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDayMonthYear } from "@/lib/format-date";
import { useOrgMoney } from "@/lib/use-org-money";
import { EMPTY_VALUE } from "@/lib/format-money";
import { csvFilename, downloadCsv, toCsv } from "@/lib/csv-export";
import { ATTENDANCE_STATUS_LABEL, loadFailureSentence } from "@/lib/attendance-sheet";
import { recordCountLabel } from "@/lib/pane-state";

type RosterEntry = { id: string; name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: string; isActive: boolean };
type AttendanceEntry = { id: string; rosterId: string; attendanceDate: string; status: string; hoursWorked: string | null; dailyCost: string };
type Vendor = { id: string; vendorName: string };

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

const SHEET_HEADERS = ["Date", "Workers marked", "Present", "Half day", "Absent", "Cost", "Status"];

// R67 D-53: "summary" is Sumeet's report 4 -- trade-wise attendance and daily
// cost for ONE date, which is the number a site manager reads every morning
// and the module had nowhere to show.
const VALID_TABS = new Set(["roster", "attendance", "summary"]);

type StatusFilter = "active" | "inactive" | "all";

export type RosterFilterState = { q: string; trade: string; company: string; status: StatusFilter };

const EMPTY_FILTER: RosterFilterState = { q: "", trade: "", company: "", status: "active" };

// Exported for the sibling test: the filter is the screen's own contract, not
// the backend's, so it is asserted directly rather than through the DOM.
export function filterRoster(roster: readonly RosterEntry[], filter: RosterFilterState, vendorName: (id: string | null) => string): RosterEntry[] {
  const needle = filter.q.trim().toLowerCase();
  return roster.filter((r) => {
    if (filter.status === "active" && !r.isActive) return false;
    if (filter.status === "inactive" && r.isActive) return false;
    if (filter.trade && (r.trade ?? "") !== filter.trade) return false;
    if (filter.company && vendorName(r.vendorId) !== filter.company) return false;
    if (needle && !`${r.name} ${r.employeeCode ?? ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export type AttendanceSheetSummary = {
  date: string;
  marked: number;
  present: number;
  halfDay: number;
  absent: number;
  cost: number;
};

/** Exported for the sibling test: one row per date, newest first. */
export function summariseSheets(attendance: readonly AttendanceEntry[]): AttendanceSheetSummary[] {
  const byDate = new Map<string, AttendanceSheetSummary>();
  for (const row of attendance) {
    const entry = byDate.get(row.attendanceDate) ?? { date: row.attendanceDate, marked: 0, present: 0, halfDay: 0, absent: 0, cost: 0 };
    entry.marked++;
    if (row.status === "present") entry.present++;
    else if (row.status === "half_day") entry.halfDay++;
    else if (row.status === "absent") entry.absent++;
    entry.cost = Math.round((entry.cost + Number(row.dailyCost || 0)) * 100) / 100;
    byDate.set(row.attendanceDate, entry);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

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
function renderRosterCell(
  field: string,
  r: RosterEntry,
  vendorName: (id: string | null) => string,
  money: (value: string) => string
) {
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
      return money(r.dailyRate);
    case "isActive":
      // R67 G-02: was <Badge variant="default"> for active -- the saffron
      // primary fill, on a row that is merely "this worker is on the roster".
      // active -> sage tick, inactive -> grey circle, both with their word.
      return <StatusPill status={r.isActive ? "active" : "inactive"} />;
    default:
      return String((r as unknown as Record<string, unknown>)[field] ?? EMPTY_VALUE);
  }
}

function isNumericColumn(field: string): boolean {
  return field === "dailyRate";
}

export default function LabourClient({
  projectId,
  projectName,
  resolvedByFallback = false,
  registryColumns,
  initialTab,
  initialFilter,
  initialSummaryDate,
}: {
  projectId: string;
  projectName: string;
  resolvedByFallback?: boolean;
  registryColumns?: RegistryColumn[] | null;
  initialTab?: string;
  initialFilter?: Partial<RosterFilterState>;
  /** R67 D-53: ?date= for the Daily Summary tab. Resolved on the server so the first paint already has a day. */
  initialSummaryDate?: string;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "roster");
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const orgMoney = useOrgMoney();
  // dailyRate has no per-row currencyId (roster entries are always in the
  // org's base currency) -- same undefined-id "org base currency" lookup the
  // rest of the product uses.
  // R67 G-05 merge: the org's currency is resolved ONCE per screen and the
  // formatter comes back bound to it, so a cell cannot be rendered with the
  // wrong currency by forgetting to pass one.
  const money = useCallback((value: string | number | null) => orgMoney.money(value), [orgMoney]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<{ roster?: string; attendance?: string }>({});
  const [filter, setFilter] = useState<RosterFilterState>({ ...EMPTY_FILTER, ...initialFilter });
  const [filterOpen, setFilterOpen] = useState(
    Boolean(initialFilter && Object.keys(initialFilter).length > 0)
  );
  // R67 D-53: the summary's date is screen state AND a URL param -- Back has to
  // return the user to the day they were reading, not to today.
  const [summaryDate, setSummaryDate] = useState(
    () => initialSummaryDate ?? new Date().toISOString().slice(0, 10)
  );

  const load = useCallback(async () => {
    setLoading(true);
    // allSettled: a failing vendors lookup must not blank the roster, and a
    // failing roster must not be reported to the user as "no workers".
    const [rosterR, attR, vendorsR] = await Promise.allSettled([
      fetchJson<{ roster?: RosterEntry[] }>(`/api/labour-roster?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ attendance?: AttendanceEntry[] }>(`/api/attendance?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ vendors?: Vendor[] }>(`/api/vendors`),
    ]);

    const errors: { roster?: string; attendance?: string } = {};
    // R67 D-65 merge: a FAILED REFRESH NO LONGER THROWS THE ROWS AWAY. This
    // used to be `else { setRoster([]); ... }`, which blanked a roster the
    // user could read a second ago because a refresh failed -- turning a
    // recoverable error into a screen that says this project has no workers.
    // The rows stay, and the error sentence beside them says the list may be
    // out of date.
    if (rosterR.status === "fulfilled") setRoster(rosterR.value.roster ?? []);
    else errors.roster = loadFailureSentence(rosterR.reason, "the roster");

    if (attR.status === "fulfilled") setAttendance(attR.value.attendance ?? []);
    else errors.attendance = loadFailureSentence(attR.reason, "the attendance log");

    // Vendors is a display-only lookup (company name); its failure degrades to
    // an em-dash rather than to an alert.
    setVendors(vendorsR.status === "fulfilled" ? (vendorsR.value.vendors ?? []) : []);

    setLoadErrors(errors);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const vendorName = useCallback(
    (id: string | null) => (id && vendors.find((v) => v.id === id)?.vendorName) || "—",
    [vendors]
  );

  const visibleRoster = useMemo(() => filterRoster(roster, filter, vendorName), [roster, filter, vendorName]);
  const sheets = useMemo(() => summariseSheets(attendance), [attendance]);
  const activeRosterCount = useMemo(() => roster.filter((r) => r.isActive).length, [roster]);

  const trades = useMemo(
    () => [...new Set(roster.map((r) => r.trade).filter((t): t is string => !!t && t.trim().length > 0))].sort(),
    [roster]
  );
  const companies = useMemo(
    () => [...new Set(roster.map((r) => vendorName(r.vendorId)).filter((c) => c !== "—"))].sort(),
    [roster, vendorName]
  );

  // Both the tab and the filter live in the URL, so Back restores the screen
  // as the user left it rather than resetting it to "Roster, no filter".
  const writeUrl = useCallback((tab: string, next: RosterFilterState, date?: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    for (const [key, value] of [["q", next.q], ["trade", next.trade], ["company", next.company]] as const) {
      if (value) params.set(key, value); else params.delete(key);
    }
    if (next.status === EMPTY_FILTER.status) params.delete("status"); else params.set("status", next.status);
    // R67 D-53: the date is only meaningful on the summary tab, so it is
    // written there and cleared elsewhere rather than trailing the user around
    // the screen as a stale parameter.
    if (tab === "summary" && date) params.set("date", date); else params.delete("date");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, []);

  function goToTab(tab: string) {
    setActiveTab(tab);
    writeUrl(tab, filter, summaryDate);
  }

  function updateFilter(patch: Partial<RosterFilterState>) {
    const next = { ...filter, ...patch };
    setFilter(next);
    writeUrl(activeTab, next, summaryDate);
  }

  function changeSummaryDate(nextDate: string) {
    setSummaryDate(nextDate);
    writeUrl("summary", filter, nextDate);
  }

  function exportRoster() {
    const rows = visibleRoster.map((r, i) => [
      i + 1,
      r.employeeCode ?? "",
      r.name,
      r.trade ?? "",
      vendorName(r.vendorId) === "—" ? "" : vendorName(r.vendorId),
      r.dailyRate,
      r.isActive ? "active" : "inactive",
    ]);
    // "Daily Rate (AED)" -- the currency belongs in the header, not repeated
    // on every cell, so the column stays sortable as a number in Excel.
    const code = orgMoney.currency ?? "";
    const csv = toCsv(["S.No", "ID", "Name", "Trade", "Company", code ? `Daily Rate (${code})` : "Daily Rate", "Status"], rows);
    downloadCsv(csvFilename("roster", projectName, new Date().toISOString().slice(0, 10)), csv);
  }

  const newWorkerReason = loading ? "Loading…" : undefined;
  const exportReason = loading ? "Loading…" : visibleRoster.length === 0 ? "No rows" : undefined;
  const filterReason = loading ? "Loading…" : roster.length === 0 ? "No workers to filter" : undefined;

  const headerActions: PageHeadingAction[] = [
    { label: filterOpen ? "Hide filter" : "Filter", disabledReason: filterReason, onClick: () => setFilterOpen((open) => !open) },
    { label: "Export", disabledReason: exportReason, onClick: exportRoster },
    {
      label: "+ New Worker",
      variant: "default",
      disabledReason: newWorkerReason,
      onClick: () => router.push(`/labour/new?projectId=${projectId}`),
      testId: "labour-new-worker",
    },
  ];

  // "Mark Attendance" is the Attendance tab's own primary action and keeps
  // its own reason: during load it is "Loading…", and on an empty roster it
  // says what to do first rather than being silently grey.
  const attendanceDisabledReason = loading ? "Loading…" : activeRosterCount === 0 ? "Add a worker first" : undefined;
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <PageHeading
        title="Manpower & Attendance"
        project={projectName}
        note={
          resolvedByFallback
            ? `Showing ${projectName} — pick a project in the top rail to change`
            : undefined
        }
        actions={headerActions}
      />

      {filterOpen && (
        <Card className="shadow-card">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="roster-filter-q" className="text-[12px] text-px-muted">Name or ID contains</Label>
              <Input
                id="roster-filter-q"
                className="h-9 w-56"
                value={filter.q}
                onChange={(event) => updateFilter({ q: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="roster-filter-trade" className="text-[12px] text-px-muted">Trade</Label>
              <select
                id="roster-filter-trade"
                className="h-9 rounded-md border border-ct-border2 bg-background px-2 text-sm"
                value={filter.trade}
                onChange={(event) => updateFilter({ trade: event.target.value })}
              >
                <option value="">All trades</option>
                {trades.map((trade) => <option key={trade} value={trade}>{trade}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="roster-filter-company" className="text-[12px] text-px-muted">Company</Label>
              <select
                id="roster-filter-company"
                className="h-9 rounded-md border border-ct-border2 bg-background px-2 text-sm"
                value={filter.company}
                onChange={(event) => updateFilter({ company: event.target.value })}
              >
                <option value="">All companies</option>
                {companies.map((company) => <option key={company} value={company}>{company}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="roster-filter-status" className="text-[12px] text-px-muted">Status</Label>
              <select
                id="roster-filter-status"
                className="h-9 rounded-md border border-ct-border2 bg-background px-2 text-sm"
                value={filter.status}
                onChange={(event) => updateFilter({ status: event.target.value as StatusFilter })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All</option>
              </select>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setFilter(EMPTY_FILTER); writeUrl(activeTab, EMPTY_FILTER, summaryDate); }}>
              Clear filter
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          {/* R67 D-53 */}
          <TabsTrigger value="summary">Daily Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="space-y-4">
          <Card className="shadow-card">
            <CardContent className="p-0">
              {loading ? (
                <SkeletonTable
                  headers={["S.No", ...columns.map((col) => col.label)]}
                  rows={5}
                  caption={`Loading roster for ${projectName}…`}
                />
              ) : loadErrors.roster ? (
                <div className="p-4"><DataLoadError messages={[loadErrors.roster]} onRetry={() => void load()} /></div>
              ) : roster.length === 0 ? (
                <p className="py-10 text-center text-sm text-px-muted">No workers on the roster yet.</p>
              ) : visibleRoster.length === 0 ? (
                <p className="py-10 text-center text-sm text-px-muted">No workers match this filter.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>S.No</TableHead>
                      {columns.map((col) => (
                        <TableHead key={col.field} className={isNumericColumn(col.field) ? "text-right" : undefined}>
                          {col.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Rows open the real Object Page, where Edit/Deactivate live. */}
                    {visibleRoster.map((r, i) => (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/labour/${r.id}`)}>
                        <TableCell className="text-px-muted">{i + 1}</TableCell>
                        {columns.map((col) => (
                          <TableCell
                            key={col.field}
                            className={isNumericColumn(col.field) ? "text-right tabular-nums" : undefined}
                          >
                            {renderRosterCell(col.field, r, vendorName, money)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {/* R67 D-65 merge: how many rows this IS, stated as a fact only a
                  successful read can support. On a failure or while the request
                  is in flight it renders the en-dash -- "0 records" over a read
                  that never answered is a claim nobody made. */}
              <p className="border-t border-px-border px-4 py-2 text-[12px] text-px-muted">
                {recordCountLabel(loading ? "loading" : loadErrors.roster ? "error" : "ready", roster.length)}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="space-y-4">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!!attendanceDisabledReason}
              title={attendanceDisabledReason}
              onClick={() => router.push(`/labour/attendance/new?projectId=${projectId}`)}
            >
              {attendanceDisabledReason ? `Mark one worker (${attendanceDisabledReason})` : "Mark one worker"}
            </Button>
            <Button
              size="sm"
              disabled={!!attendanceDisabledReason}
              title={attendanceDisabledReason}
              data-testid="labour-mark-attendance"
              onClick={() => router.push(`/labour/attendance/${todayIso}?projectId=${projectId}`)}
            >
              {attendanceDisabledReason ? `Mark Attendance (${attendanceDisabledReason})` : "Mark Attendance"}
            </Button>
          </div>
          <Card className="shadow-card">
            <CardContent className="p-0">
              {loading ? (
                <SkeletonTable headers={SHEET_HEADERS} rows={5} caption={`Loading attendance for ${projectName}…`} />
              ) : loadErrors.attendance ? (
                <div className="p-4"><DataLoadError messages={[loadErrors.attendance]} onRetry={() => void load()} /></div>
              ) : sheets.length === 0 ? (
                <p className="py-10 text-center text-sm text-px-muted">No attendance sheets yet — Mark Attendance starts today&apos;s.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {SHEET_HEADERS.map((header) => (
                        <TableHead key={header} className={header === "Cost" ? "text-right" : undefined}>{header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheets.map((sheet) => {
                      const complete = activeRosterCount > 0 && sheet.marked >= activeRosterCount;
                      return (
                        <TableRow
                          key={sheet.date}
                          className="cursor-pointer hover:bg-px-cloud/40"
                          onClick={() => router.push(`/labour/attendance/${sheet.date}?projectId=${projectId}`)}
                        >
                          <TableCell className="font-medium">{formatDayMonthYear(sheet.date)}</TableCell>
                          <TableCell>{sheet.marked}</TableCell>
                          <TableCell>{sheet.present}</TableCell>
                          <TableCell>{sheet.halfDay}</TableCell>
                          <TableCell>{sheet.absent}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(sheet.cost)}</TableCell>
                          <TableCell>
                            {/* R67 G-02 merge: not a Badge. `variant="default"`
                                is the saffron PRIMARY fill, which on a status
                                chip reads as an action; and colour alone is
                                never the signal. StatusPillTone carries the
                                glyph AND the word. */}
                            <span title={`Measured against the ${activeRosterCount} active workers on the roster today`}>
                              <StatusPillTone
                                tone={complete ? "done" : "waiting"}
                                label={complete ? "Complete" : "Partial"}
                              />
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <p className="text-[12px] text-px-muted">
            A sheet row opens that day&apos;s {ATTENDANCE_STATUS_LABEL.present}/{ATTENDANCE_STATUS_LABEL.half_day}/{ATTENDANCE_STATUS_LABEL.absent} marks for the whole roster.
          </p>
        </TabsContent>

        {/* R67 D-53. Mounted only while it is the active tab: its fetch is
            per-date, and pre-loading a day the user has not asked for would add
            a third hop to a screen whose whole problem is serial hops. */}
        <TabsContent value="summary" className="space-y-4">
          {activeTab === "summary" && (
            <LabourDailySummaryClient
              projectId={projectId}
              projectName={projectName}
              date={summaryDate}
              onDateChange={changeSummaryDate}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
