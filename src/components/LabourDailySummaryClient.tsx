"use client";

// R67 D-53 (audit R-181) -- Sumeet's report 4, "Daily Summary".
//
// The Manpower module could tell you WHO was marked (the roster, the sheet)
// but never WHAT THE DAY COST BY TRADE, which is the one number a site manager
// reads every morning. This is that tab.
//
// Three things it deliberately does NOT do:
//
//  1. It does not add up anything itself. Every count and every money figure
//     comes from VERIDIAN's manpower-daily-summary report, which computes them
//     in SQL inside one transaction. A browser-side re-add would be a second
//     source of truth for the same number and the two would eventually differ.
//  2. It does not make two hops. /labour is already the slowest screen in the
//     product because it chains its lookups; this tab is one fetch.
//  3. It does not colour-code status. Present / Half day / Absent each carry a
//     glyph AND the word, so the sheet survives a monochrome print and a
//     colour-blind reader.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DataLoadError from "@/components/DataLoadError";
import SkeletonTable from "@/components/SkeletonTable";
import { errorMessage, fetchJson } from "@/lib/fetch-json";
import { formatDateNumeric } from "@/lib/format-date";

import { useOrgMoney } from "@/lib/use-org-money";
import { csvFilename, downloadCsv, toCsv } from "@/lib/csv-export";
import {
  ATTENDANCE_STATUS_GLYPH,
  ATTENDANCE_STATUS_LABEL,
  shiftIsoDate,
  type AttendanceStatus,
} from "@/lib/attendance-sheet";

export type SummaryTradeRow = {
  trade: string;
  present: number;
  absent: number;
  halfDay: number;
  headcount: number;
  cost: number;
};

export type SummaryPerson = {
  id: string;
  employeeCode: string | null;
  name: string;
  trade: string | null;
  company: string | null;
  dailyRate: number;
  status: string;
  cost: number;
};

export type DailySummaryResponse = {
  date: string;
  rows: SummaryTradeRow[];
  totals: SummaryTradeRow;
  people: SummaryPerson[];
};

/** The trade a person belongs to for grouping purposes -- the same bucket name the server used. */
export const UNCATEGORISED_TRADE_LABEL = "Uncategorised trade";

/**
 * Exported for the sibling test: which people sit under a given trade row.
 * The un-traded bucket is the ONE case where the row's label is not the
 * person's own trade value, so it is resolved here rather than by comparing
 * strings at three call sites.
 */
export function peopleForTrade(people: readonly SummaryPerson[], trade: string): SummaryPerson[] {
  return people.filter((person) => {
    const bucket = person.trade && person.trade.trim() !== "" ? person.trade.trim() : UNCATEGORISED_TRADE_LABEL;
    return bucket === trade;
  });
}

function isAttendanceStatus(value: string): value is AttendanceStatus {
  return value === "present" || value === "half_day" || value === "absent";
}

/** Glyph AND word. An unrecognised status prints itself rather than vanishing. */
export function statusDisplay(status: string): string {
  return isAttendanceStatus(status)
    ? `${ATTENDANCE_STATUS_GLYPH[status]} ${ATTENDANCE_STATUS_LABEL[status]}`
    : status;
}

const HEADERS = ["Trade", "Present", "Absent", "Half-day", "Headcount", "Daily cost"];
const PERSON_HEADERS = ["S.No", "ID", "Name", "Company", "Daily Rate", "Status"];

export default function LabourDailySummaryClient({
  projectId,
  projectName,
  date,
  onDateChange,
}: {
  projectId: string;
  projectName: string;
  date: string;
  /** The date lives in the URL (?tab=summary&date=…) so Back restores the day the user was on. */
  onDateChange: (nextDate: string) => void;
}) {
  const router = useRouter();
  // R67 G-05 merge: the org's currency is resolved once for the screen and the
  // formatter comes back bound to it, so no cell can be rendered with the wrong
  // currency by forgetting to pass one.
  const orgMoney = useOrgMoney();
  const money = orgMoney.money;
  const [summary, setSummary] = useState<DailySummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // D3 x D21 merge: this used to be a lane-local /api/attendance/summary
      // proxy, but lane D21 landed a DIFFERENT report on that exact path (the
      // from/to trade-wise summary, with ./pdf and ./share siblings). This tab
      // now goes through the generic reports proxy that has existed since R42,
      // which reaches the same VERIDIAN /reports/manpower-daily-summary and adds
      // withTiming() + veridianErrorResponse(). See the merge note in
      // src/app/api/attendance/summary/route.ts.
      const data = await fetchJson<DailySummaryResponse>(
        `/api/reports/manpower-daily-summary?projectId=${encodeURIComponent(projectId)}&date=${encodeURIComponent(date)}`
      );
      setSummary(data);
      setError(null);
    } catch (err) {
      setSummary(null);
      // The item's own sentence, with the backend's own words after it. Never
      // an empty table -- that would read as "nobody worked that day", which is
      // a different and much more expensive fact than "we could not ask".
      setError(errorMessage(err, "Could not load the summary"));
    } finally {
      setLoading(false);
    }
  }, [projectId, date]);

  useEffect(() => { void load(); }, [load]);

  // A day change collapses whatever trade was open: the expander's contents
  // belong to the day that produced them.
  useEffect(() => { setExpanded(null); }, [date]);

  const rows = summary?.rows ?? [];
  const people = useMemo(() => summary?.people ?? [], [summary]);
  const totals = summary?.totals;

  function exportSummary() {
    if (!summary) return;
    const code = (orgMoney.currency ?? "");
    const body: unknown[][] = [];
    for (const row of rows) {
      body.push([row.trade, row.present, row.absent, row.halfDay, row.headcount, row.cost]);
      // The people sit under their own trade, so the exported file is the same
      // shape as the expanded screen rather than a second, flatter report.
      peopleForTrade(people, row.trade).forEach((person, index) => {
        body.push([
          `  ${index + 1}`,
          person.employeeCode ?? "",
          person.name,
          person.company ?? "",
          person.dailyRate,
          isAttendanceStatus(person.status) ? ATTENDANCE_STATUS_LABEL[person.status] : person.status,
        ]);
      });
    }
    if (totals) body.push(["Total", totals.present, totals.absent, totals.halfDay, totals.headcount, totals.cost]);
    const csv = toCsv(
      ["Trade", "Present", "Absent", "Half-day", "Headcount", code ? `Daily cost (${code})` : "Daily cost"],
      body
    );
    downloadCsv(csvFilename("daily-summary", projectName, date), csv);
  }

  const exportReason = loading ? "Loading…" : rows.length === 0 ? "Nothing to export" : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onDateChange(shiftIsoDate(date, -1))}>
            Previous day
          </Button>
          <span className="text-[13px] font-medium tabular-nums">{formatDateNumeric(date)}</span>
          <Button variant="outline" size="sm" onClick={() => onDateChange(shiftIsoDate(date, 1))}>
            Next day
          </Button>
        </div>
        {/* The programme's shared Export/Share control (C05-24) is not in this
            branch; this uses the repo's own RFC-4180 CSV writer, which is what
            the roster and the Materials master already export through. */}
        <Button
          variant="outline"
          size="sm"
          disabled={!!exportReason}
          title={exportReason}
          onClick={exportSummary}
          data-testid="labour-summary-export"
        >
          {exportReason ? `Export (${exportReason})` : "Export"}
        </Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <SkeletonTable headers={HEADERS} rows={4} caption={`Loading the daily summary for ${projectName}…`} />
          ) : error ? (
            <div className="p-4">
              <DataLoadError messages={[error]} onRetry={() => void load()} />
            </div>
          ) : rows.length === 0 ? (
            <p className="flex flex-wrap items-center justify-center gap-1 py-10 text-center text-sm text-px-muted">
              <span>{`No attendance marked for ${formatDateNumeric(date)} —`}</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={() => router.push(`/labour/attendance/new?projectId=${projectId}&date=${date}`)}
              >
                Mark attendance
              </Button>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {HEADERS.map((header) => (
                    <TableHead key={header} className={header === "Trade" ? undefined : "text-right"}>
                      {header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const open = expanded === row.trade;
                  const members = peopleForTrade(people, row.trade);
                  return [
                    <TableRow key={row.trade}>
                      <TableCell>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-medium"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : row.trade)}
                        >
                          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          {row.trade}
                        </button>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.present}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.absent}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.halfDay}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.headcount}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.cost)}</TableCell>
                    </TableRow>,
                    open ? (
                      <TableRow key={`${row.trade}-people`}>
                        <TableCell colSpan={HEADERS.length} className="bg-px-cloud/30 p-0">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {PERSON_HEADERS.map((header) => (
                                  <TableHead
                                    key={header}
                                    className={header === "Daily Rate" ? "text-right" : undefined}
                                  >
                                    {header}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {members.map((person, index) => (
                                <TableRow key={person.id}>
                                  <TableCell className="text-px-muted">{index + 1}</TableCell>
                                  <TableCell className="text-px-muted">{person.employeeCode ?? "—"}</TableCell>
                                  <TableCell className="font-medium">{person.name}</TableCell>
                                  <TableCell className="text-px-muted">{person.company ?? "—"}</TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {money(person.dailyRate)}
                                  </TableCell>
                                  <TableCell>{statusDisplay(person.status)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableCell>
                      </TableRow>
                    ) : null,
                  ];
                })}
                {totals && (
                  <TableRow className="font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.present}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.absent}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.halfDay}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.headcount}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(totals.cost)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
