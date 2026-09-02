"use client";

// R67 D-07 -- the Design Studio timesheet.
//
// DECISION D-07: "A day grid, one row per task, in Sumeet's exact columns
// Date | Project | Category | Task | Hours with status at row level (Draft /
// Submitted / Approved / Sent back); the week view is a filter over the same
// rows, not a second grid." Its `where` clause is "a /design-studio route (new)
// reusing ScheduleTimesheetClient's data layer" -- so this reads the SAME
// GET /api/timesheets?projectId= the Schedule module's Timesheet tab reads. No
// second endpoint, no second source of truth for the same hours.
//
// The row shape, the day grouping and the week filter live in
// src/lib/design-studio-timesheet.ts, where they are tested. This file is the
// screen: four honest states (loading, failed, empty, data), never an empty
// grid over a failed read.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";
import DataLoadError from "@/components/DataLoadError";
import ScreenLoading from "@/components/ScreenLoading";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";
import { mayAssertEmpty } from "@/lib/read-outcome";
import {
  TIMESHEET_STATUS_LABELS,
  filterToWeek,
  groupByDay,
  toTimesheetRows,
  totalHours,
  weekStartOf,
  type TimesheetApiEntry,
  type TimesheetRow,
} from "@/lib/design-studio-timesheet";

type ViewMode = "all" | "week";

// The muted state palette WS-G's chip contract asks for: never the saffron
// primary-action colour, and rose reserved for the one state that needs the
// designer to act again.
const STATUS_TONE: Record<TimesheetRow["status"], string> = {
  draft: "text-px-muted",
  submitted: "text-px-ink",
  approved: "text-px-teal",
  rejected: "text-px-error",
};

export default function DesignStudioTimesheetClient({
  projectId,
  projectName,
  today,
}: {
  projectId: string;
  projectName: string;
  /** ISO yyyy-mm-dd, resolved on the server so the week filter is not hydration-dependent. */
  today: string;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<TimesheetApiEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("week");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<{ entries?: TimesheetApiEntry[] }>(
        `/api/timesheets?projectId=${encodeURIComponent(projectId)}`
      );
      setEntries(data.entries ?? []);
    } catch (err) {
      // A failed read must never become an empty grid: `entries` stays null, so
      // the empty sentence below cannot be reached.
      setEntries(null);
      setLoadError(errorMessage(err, "Couldn't load the timesheet"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const allRows = useMemo(
    () => (entries ? toTimesheetRows(entries, projectName) : []),
    [entries, projectName]
  );
  const weekStart = weekStartOf(today);
  // THE WEEK VIEW IS A FILTER, not a second grid -- one row shape, one table.
  const rows = view === "week" ? filterToWeek(allRows, weekStart) : allRows;
  const days = groupByDay(rows);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant={view === "week" ? "default" : "outline"} size="sm" onClick={() => setView("week")}>
            This week
          </Button>
          <Button variant={view === "all" ? "default" : "outline"} size="sm" onClick={() => setView("all")}>
            All entries
          </Button>
          <span className="text-sm text-px-muted">
            {view === "week" ? `Week of ${formatDate(weekStart)}` : "Every entry on this project"}
          </span>
        </div>
        <Button size="sm" onClick={() => router.push(`/schedule/log-time?projectId=${projectId}`)}>
          <Plus className="size-4" /> Log time
        </Button>
      </div>

      {loadError && <DataLoadError messages={[loadError]} onRetry={load} />}

      {loading ? (
        <ScreenLoading entity="the timesheet" rows={5} columns={6} />
      ) : loadError ? null : days.length === 0 ? (
        // Only reachable when the read SUCCEEDED and returned nothing -- the
        // standing rule in src/lib/read-outcome.ts.
        <Card>
          <CardContent className="py-16 text-center text-sm text-px-muted">
            {mayAssertEmpty(loadError)
              ? view === "week"
                ? `No time logged on ${projectName} in the week of ${formatDate(weekStart)}. Press Log time to add some.`
                : `No time logged on ${projectName} yet. Press Log time to add some.`
              : "Couldn't load the timesheet — see the error above."}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-card">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead className="text-right tabular-nums">Hours</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((day) =>
                  day.rows.map((row, index) => (
                    <TableRow key={row.id}>
                      {/* One row per task; the date is written once per day, so
                          the grid reads as a day grid rather than a flat list. */}
                      <TableCell className="whitespace-nowrap">
                        {index === 0 ? formatDate(day.date) : ""}
                      </TableCell>
                      <TableCell>{row.project}</TableCell>
                      <TableCell>{row.category}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => router.push(`/schedule/tasks/${row.issueId}`)}
                        >
                          {row.task}
                        </button>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.hours.toFixed(2)}</TableCell>
                      <TableCell>
                        {/* Glyph plus word, never colour alone. */}
                        <span className={`inline-flex items-center gap-1.5 ${STATUS_TONE[row.status]}`}>
                          <span aria-hidden>{row.status === "approved" ? "●" : "○"}</span>
                          {TIMESHEET_STATUS_LABELS[row.status]}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <div className="border-t border-px-border p-3 text-right text-sm font-medium text-px-ink">
              Total: {totalHours(rows).toFixed(2)} hrs
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
