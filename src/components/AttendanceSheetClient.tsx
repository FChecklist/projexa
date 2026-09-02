"use client";

// R67 D-30 (audit R-082/R-089, "Daily Attendance Sheet: mark the whole roster
// in one save"). Marking a site's attendance was one worker per screen:
// /labour/attendance/new is a four-field form with a Worker dropdown, so a
// 38-worker roster meant opening the form 38 times, each one a separate POST
// and a separate transaction, and a mis-marked worker could not be corrected
// at all (the single-row endpoint 409s on a repeat). This is the sheet: one
// row per worker, one Save, one call.
//
// THREE THINGS THIS SCREEN IS DELIBERATE ABOUT
//
//  1. UNMARKED IS NOT ABSENT. A worker nobody has touched renders "—" in both
//     the status and the cost column and is not sent at all; Absent is a
//     positive statement worth 0. Collapsing the two would silently invent
//     absences for anyone the supervisor had not got to yet.
//  2. A PAST DATE OPENS READ-ONLY. Yesterday's sheet is a record, not a form.
//     It takes an explicit Edit, and Cancel confirms before discarding, which
//     is the same rule the object pages follow.
//  3. THE SAVED FOOTER LINE IS THE RECEIPT, and its numbers come from the
//     SERVER's response, not from this component's own running total -- the
//     server recomputes every cost from the roster's dailyRate, so quoting the
//     local total would be quoting an unverified number.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DataLoadError from "@/components/DataLoadError";
import SkeletonTable from "@/components/SkeletonTable";
import { PageHeading } from "@/components/PageHeading";
import { fetchJson } from "@/lib/fetch-json";
import { formatDayMonthYear } from "@/lib/format-date";
import { formatMoney } from "@/lib/format-money";
import { useCurrencies } from "@/lib/currency";
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_KEY,
  ATTENDANCE_STATUS_LABEL,
  type AttendanceStatus,
  loadFailureSentence,
  rowCost,
  saveFailureSentence,
  summariseByTrade,
} from "@/lib/attendance-sheet";

type RosterEntry = {
  id: string;
  name: string;
  employeeCode: string | null;
  trade: string | null;
  vendorId: string | null;
  dailyRate: string;
  isActive: boolean;
};
type AttendanceEntry = { id: string; rosterId: string; attendanceDate: string; status: string; hoursWorked: string | null; dailyCost: string };
type Vendor = { id: string; vendorName: string };
type Mark = { status: AttendanceStatus | null; hoursWorked: string };

const COLUMN_HEADERS = ["ID", "Name", "Trade", "Company", "Attendance", "Hours", "Cost"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AttendanceSheetClient({
  projectId,
  projectName,
  attendanceDate,
}: {
  projectId: string;
  projectName: string;
  attendanceDate: string;
}) {
  const router = useRouter();
  const currencies = useCurrencies();

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedLine, setSavedLine] = useState<string | null>(null);

  // A past date is a record: it opens read-only and takes an explicit Edit.
  // Today (and any future date a user reaches by URL) opens ready to mark.
  const isPastDate = attendanceDate < todayIso();
  const [editing, setEditing] = useState(!isPastDate);

  const load = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    const [rosterR, attendanceR, vendorsR] = await Promise.allSettled([
      fetchJson<{ roster?: RosterEntry[] }>(`/api/labour-roster?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ attendance?: AttendanceEntry[] }>(
        `/api/attendance?projectId=${encodeURIComponent(projectId)}&attendanceDate=${encodeURIComponent(attendanceDate)}`
      ),
      fetchJson<{ vendors?: Vendor[] }>(`/api/vendors`),
    ]);

    const errors: string[] = [];
    const activeRoster = rosterR.status === "fulfilled" ? (rosterR.value.roster ?? []).filter((r) => r.isActive) : [];
    if (rosterR.status === "rejected") errors.push(loadFailureSentence(rosterR.reason, "roster"));
    setRoster(activeRoster);

    const existing = attendanceR.status === "fulfilled" ? attendanceR.value.attendance ?? [] : [];
    if (attendanceR.status === "rejected") errors.push(loadFailureSentence(attendanceR.reason, "attendance for this date"));

    // Company is a display-only lookup: its failure degrades to an en-dash,
    // never to an alert, matching LabourClient's own posture.
    setVendors(vendorsR.status === "fulfilled" ? vendorsR.value.vendors ?? [] : []);

    const seeded: Record<string, Mark> = {};
    for (const row of existing) {
      const status = ATTENDANCE_STATUSES.find((s) => s === row.status);
      if (!status) continue;
      seeded[row.rosterId] = { status, hoursWorked: row.hoursWorked ?? "" };
    }
    setMarks(seeded);
    setLoadErrors(errors);
    setLoading(false);
  }, [projectId, attendanceDate]);

  useEffect(() => { void load(); }, [load]);

  const vendorName = (id: string | null) => (id && vendors.find((v) => v.id === id)?.vendorName) || "—";

  const totals = useMemo(
    () => summariseByTrade(roster.map((r) => ({ trade: r.trade, dailyRate: r.dailyRate, status: marks[r.id]?.status ?? null }))),
    [roster, marks]
  );

  function setStatus(rosterId: string, status: AttendanceStatus) {
    if (!editing) return;
    setMarks((prev) => ({ ...prev, [rosterId]: { status, hoursWorked: prev[rosterId]?.hoursWorked ?? "" } }));
  }

  function setHours(rosterId: string, hoursWorked: string) {
    setMarks((prev) => ({ ...prev, [rosterId]: { status: prev[rosterId]?.status ?? null, hoursWorked } }));
  }

  // P / H / A anywhere in a worker's row marks that worker, so a whole sheet
  // can be filled from the keyboard without reaching for the mouse.
  function onRowKeyDown(rosterId: string, event: React.KeyboardEvent<HTMLTableRowElement>) {
    if (!editing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "radio") return;
    const status = ATTENDANCE_STATUS_KEY[event.key.toLowerCase()];
    if (!status) return;
    event.preventDefault();
    setStatus(rosterId, status);
  }

  async function saveSheet() {
    const rows = roster
      .filter((r) => marks[r.id]?.status)
      .map((r) => ({
        rosterId: r.id,
        status: marks[r.id].status as AttendanceStatus,
        ...(marks[r.id].hoursWorked ? { hoursWorked: Number(marks[r.id].hoursWorked) } : {}),
      }));
    if (rows.length === 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      const result = await fetchJson<{ savedCount: number; totalCost: number; attendanceDate: string }>("/api/attendance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, attendanceDate, rows }),
      });
      setSavedLine(
        `Attendance for ${formatDayMonthYear(result.attendanceDate ?? attendanceDate)} saved — ${result.savedCount} rows, ${formatMoney(result.totalCost, currencies)}`
      );
      // The sheet stays on screen in display mode: the supervisor's next act
      // is usually to check what was recorded, not to start again.
      setEditing(false);
    } catch (err) {
      setSaveError(saveFailureSentence(err));
    } finally {
      setSaving(false);
    }
  }

  function cancelEditing() {
    if (!window.confirm("Discard the marks you have made on this sheet? They have not been saved.")) return;
    setEditing(false);
    void load();
  }

  const markedCount = totals.markedCount;
  const saveDisabledReason = saving ? `Saving ${markedCount} rows…` : markedCount === 0 ? "No rows marked" : undefined;

  const headerActions = editing
    ? [
        {
          label: "Save sheet",
          variant: "default" as const,
          disabledReason: saveDisabledReason,
          onClick: () => void saveSheet(),
          testId: "attendance-sheet-save",
        },
        ...(isPastDate ? [{ label: "Cancel", onClick: cancelEditing }] : []),
      ]
    : [{ label: "Edit", variant: "default" as const, onClick: () => setEditing(true), testId: "attendance-sheet-edit" }];

  return (
    <div className="flex-1 space-y-4 p-6">
      <PageHeading
        title="Daily Attendance"
        breadcrumb={`Manpower / Attendance / ${formatDayMonthYear(attendanceDate)}`}
        project={projectName}
        note={isPastDate && !editing ? "This sheet is a past record — choose Edit to change it." : undefined}
        actions={headerActions}
      />

      <Button variant="outline" size="sm" onClick={() => router.push(`/labour?projectId=${projectId}&tab=attendance`)}>
        ← Back to Attendance
      </Button>

      {loadErrors.length > 0 && <DataLoadError messages={loadErrors} onRetry={() => void load()} />}

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <SkeletonTable headers={COLUMN_HEADERS} rows={5} caption={`Loading the sheet for ${projectName}…`} />
          ) : roster.length === 0 ? (
            <div className="space-y-3 py-10 text-center">
              <p className="text-sm text-px-muted">No active workers on this project&apos;s roster yet.</p>
              <Button size="sm" onClick={() => router.push(`/labour/new?projectId=${projectId}`)}>+ New Worker</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMN_HEADERS.map((header) => (
                    <TableHead key={header} className={header === "Cost" || header === "Hours" ? "text-right" : undefined}>
                      {header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((worker) => {
                  const mark = marks[worker.id];
                  const cost = rowCost(worker.dailyRate, mark?.status ?? null);
                  return (
                    <TableRow key={worker.id} onKeyDown={(event) => onRowKeyDown(worker.id, event)}>
                      <TableCell className="text-px-muted">{worker.employeeCode ?? "—"}</TableCell>
                      <TableCell className="font-medium">{worker.name}</TableCell>
                      <TableCell className="text-px-muted">{worker.trade ?? "—"}</TableCell>
                      <TableCell className="text-px-muted">{vendorName(worker.vendorId)}</TableCell>
                      <TableCell>
                        {editing ? (
                          <div role="radiogroup" aria-label={`Attendance for ${worker.name}`} className="flex flex-wrap gap-1">
                            {ATTENDANCE_STATUSES.map((status) => {
                              const checked = mark?.status === status;
                              return (
                                <label
                                  key={status}
                                  className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-3 text-[13px] ${
                                    checked ? "border-ct-navy bg-ct-navy text-white" : "border-ct-border2 text-ct-navy"
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    className="sr-only"
                                    name={`attendance-${worker.id}`}
                                    value={status}
                                    checked={checked}
                                    onChange={() => setStatus(worker.id, status)}
                                  />
                                  {ATTENDANCE_STATUS_LABEL[status]}
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <span className={mark?.status ? undefined : "text-px-muted"}>
                            {mark?.status ? ATTENDANCE_STATUS_LABEL[mark.status] : "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {editing ? (
                          <Input
                            type="number"
                            step="0.25"
                            min="0"
                            max="24"
                            className="ml-auto h-9 w-20 text-right"
                            aria-label={`Hours for ${worker.name}`}
                            value={mark?.hoursWorked ?? ""}
                            onChange={(event) => setHours(worker.id, event.target.value)}
                          />
                        ) : (
                          <span className={mark?.hoursWorked ? undefined : "text-px-muted"}>{mark?.hoursWorked || "—"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cost === null ? <span className="text-px-muted">—</span> : formatMoney(cost, currencies)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {totals.trades.length > 0 && (
                <TableFooter>
                  {totals.trades.map((trade) => (
                    <TableRow key={trade.trade}>
                      <TableCell />
                      <TableCell className="text-px-muted">{trade.trade}</TableCell>
                      <TableCell className="text-px-muted" colSpan={2}>
                        {trade.present} present · {trade.halfDay} half day · {trade.absent} absent
                      </TableCell>
                      <TableCell className="text-px-muted">{trade.marked} marked</TableCell>
                      <TableCell />
                      <TableCell className="text-right tabular-nums">{formatMoney(trade.cost, currencies)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={6} className="font-semibold">Day total</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totals.totalCost, currencies)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      {/* The persistent message area: a receipt that survives, not a toast
          that disappears before the supervisor has read it. */}
      {saveError && (
        <Card role="alert" className="border-px-error-border bg-px-error-light">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm text-px-error">
            <span>{saveError}</span>
            <Button size="sm" variant="outline" onClick={() => void saveSheet()}>Retry</Button>
          </CardContent>
        </Card>
      )}
      {savedLine && !saveError && (
        <p role="status" className="text-[13px] text-px-muted">{savedLine}</p>
      )}
    </div>
  );
}
