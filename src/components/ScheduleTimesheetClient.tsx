"use client";

// Priority 17 Wave 1: Timesheet view for the Schedule module, over the
// previously-unexposed VERIDIAN pms-time-service.ts. Lists time logged
// against this project's tasks and lets the current user log new time
// against any task. Honest limitation: logging time requires a real
// VERIDIAN user session (pms_time_entries.user_id is a hard FK to
// compliance.users, so it can't fall back to PROJEXA's shared API-key
// identity the way task creation does) -- PROJEXA has no per-user identity
// bridge to VERIDIAN yet, the same pre-existing gap already documented on
// the leave-approval and quotation-approval buttons. The dialog is real and
// wired; the POST will surface that 400 until the identity bridge exists.
// R67 F-11 (R-146). Two changes here, both about what the tab shows while it
// is still working:
//
//  1. NO FULL-PANE SPINNER. The tab used to replace its entire contents with a
//     centred spinner, so the header, the toggle and "+ Log Time" -- none of
//     which depend on the request -- disappeared for the duration and came back
//     in a different place. It now renders its real frame immediately and only
//     the rows are grey.
//  2. IT LISTENS. A time log written from /schedule/log-time appends itself to
//     this project's cached timesheet before its 201 comes back, so the entry
//     is on screen the moment the user lands here. This panel subscribes to
//     that cache key and re-renders, showing the unconfirmed row labelled
//     "Saving…" and excluding it from the total -- a pending write is never
//     drawn as a recorded one.
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import TableLoadingRows from "@/components/TableLoadingRows";
import { loadSchedule, peekSchedule, subscribeSchedule, warmSchedule, type TimesheetEntry, type TimesheetPayload } from "@/lib/schedule-cache";

type Entry = TimesheetEntry;

const COLUMN_HEADERS = ["Task", "Date", "Hours", "Activity", "Comments"];

export default function ScheduleTimesheetClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const resource = mineOnly ? "timesheetsMine" : "timesheets";

  // R67 F-09 (R-122): reads through the shared 60 s schedule session cache, so
  // returning to this tab -- or hovering it first -- costs no request. The
  // "mine only" view is a separate cache key, not a parameter, so toggling can
  // never serve the other view's rows.
  const load = useCallback(async (options: { force?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadSchedule<TimesheetPayload>(resource, projectId, options);
      setEntries(data.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load timesheet");
    } finally {
      setLoading(false);
    }
  }, [projectId, resource]);

  useEffect(() => { load(); }, [load]);

  // R67 F-11: the optimistic append (and its reconciliation) happen in the
  // cache, not in this component's state -- this is how they get here.
  useEffect(() => {
    return subscribeSchedule(resource, projectId, () => {
      const cached = peekSchedule<TimesheetPayload>(resource, projectId);
      if (cached) setEntries(cached.entries ?? []);
    });
  }, [resource, projectId]);

  // Only confirmed rows count. A pending row's hours are not logged time yet.
  const totalHours = entries.filter((e) => !e.pending).reduce((sum, e) => sum + Number(e.hours), 0);
  const pendingCount = entries.filter((e) => e.pending).length;

  // Real screen navigation (2026-08-30) -- replaces the old "Log Time"
  // Dialog popup with a real create route.
  //
  // R67 F-11: hovering it prefetches the route chunk AND warms the project's
  // task list, which is the one field on that form the user cannot type -- so
  // the select is filled from the first frame instead of a round trip later.
  function warmLogTime() {
    router.prefetch(`/schedule/log-time?projectId=${projectId}`);
    warmSchedule("tasks", projectId);
  }
  const logTimeButton = (
    <Button
      onClick={() => router.push(`/schedule/log-time?projectId=${projectId}`)}
      onMouseEnter={warmLogTime}
      onFocus={warmLogTime}
    >
      <Plus className="size-4" /> Log Time
    </Button>
  );

  const toggleButton = (
    <Button variant={mineOnly ? "default" : "outline"} size="sm" onClick={() => setMineOnly((v) => !v)} disabled={loading}>
      {mineOnly ? "Showing my entries" : "Show my entries only"}
    </Button>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">{toggleButton}{logTimeButton}</div>
        <TableLoadingRows headers={COLUMN_HEADERS} rows={3} caption="Loading timesheet…" />
      </div>
    );
  }
  if (error) {
    return (
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="p-4 text-sm text-px-error">Could not load timesheet: {error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">{toggleButton}{logTimeButton}</div>
      {entries.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-sm text-px-muted">No time logged yet.</CardContent></Card>
      ) : (
        <Card className="shadow-card">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>{COLUMN_HEADERS.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id} data-pending={entry.pending ? "true" : undefined} className={entry.pending ? "opacity-70" : undefined}>
                    <TableCell>
                      {entry.pending ? (
                        // No link: the row has no server id yet, so there is
                        // nothing to navigate to. It says what it is instead --
                        // and says, in words, that it is not saved yet.
                        <span>
                          {entry.issue ? `#${entry.issue.number} ${entry.issue.title}` : entry.issueId}
                          <span className="ml-2 text-[12px] text-px-muted">Saving…</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => router.push(`/schedule/tasks/${entry.issueId}`)}
                        >
                          {entry.issue ? `#${entry.issue.number} ${entry.issue.title}` : entry.issueId}
                        </button>
                      )}
                    </TableCell>
                    <TableCell>{entry.spentOn}</TableCell>
                    <TableCell>{entry.hours}</TableCell>
                    <TableCell>{entry.activityType ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{entry.comments ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t border-px-border p-3 text-right text-sm font-medium text-px-ink">
              {pendingCount > 0 ? (
                <span className="mr-3 font-normal text-px-muted">
                  {pendingCount === 1 ? "1 entry still saving" : `${pendingCount} entries still saving`} — not counted below
                </span>
              ) : null}
              Total: {totalHours.toFixed(2)} hrs
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
