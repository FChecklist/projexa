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
//
// ─── R67 D-50 (audit R-151) ─────────────────────────────────────────────────
// The whole screen -- including the "+ Log Time" button -- lived INSIDE the
// loading branch and again inside the error branch, so while the list was
// loading there was nothing on screen but a spinner, and a failed load removed
// the one control that could still be used. The header row and the button are
// now rendered unconditionally, with three skeleton rows beneath while the list
// loads, and a failure hands the backend's own sentence plus a Retry to the
// persistent footer message area rather than replacing the screen with a red
// card.
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import SkeletonTable from "@/components/SkeletonTable";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDayMonthYear } from "@/lib/format-date";
import { timeLoggedReceipt } from "@/lib/time-entry";

type Entry = {
  id: string; issueId: string; hours: string; spentOn: string; activityType: string | null; comments: string | null;
  issue?: { id: string; number: number; title: string } | null;
};

const COLUMN_LABELS = ["Date", "Project", "Category", "Task", "Hours", "Comments"];

export default function ScheduleTimesheetClient({
  projectId,
  projectName,
  highlightEntryId,
  onMessage,
}: {
  projectId: string;
  /**
   * R67 D-51: Sumeet's own column order is Date | Project | Category | Task |
   * Hours, and every row on this screen belongs to the project the page
   * resolved -- the list is fetched by projectId. Naming it in the row is what
   * makes an exported or printed timesheet readable away from this screen.
   */
  projectName?: string;
  /** R67 D-50: the entry just written, from ?highlight= -- the row to mark and to build the receipt from. */
  highlightEntryId?: string;
  /** R67 D-50: the persistent footer message area, owned by the tabs' ScreenFrame. */
  onMessage?: (message: FieldMessage | null) => void;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ entries?: Entry[] }>(
        `/api/timesheets?projectId=${encodeURIComponent(projectId)}${mineOnly ? "&mine=true" : ""}`
      );
      setEntries(data.entries ?? []);
    } catch (err) {
      setEntries([]);
      setError(errorMessage(err, "Couldn't load the timesheet"));
    } finally {
      setLoading(false);
    }
  }, [projectId, mineOnly]);

  useEffect(() => { load(); }, [load]);

  // The failure goes to the persistent message area, where it stays until it is
  // resolved, instead of replacing the screen.
  useEffect(() => {
    onMessage?.(error ? { level: "error", text: error } : null);
  }, [error, onMessage]);

  // D-50's receipt, built from the row the SERVER stored -- "a toast alone is
  // not a receipt". It appears once the list carries the entry that was just
  // written, so it can never describe a save that did not land.
  useEffect(() => {
    if (!highlightEntryId) return;
    const entry = entries.find((e) => e.id === highlightEntryId);
    if (!entry) return;
    onMessage?.({
      level: "success",
      text: timeLoggedReceipt({
        hours: entry.hours,
        spentOn: entry.spentOn,
        taskNumber: entry.issue?.number ?? null,
        taskTitle: entry.issue?.title ?? null,
      }),
    });
  }, [highlightEntryId, entries, onMessage]);

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  return (
    <div className="space-y-4">
      {/* Rendered unconditionally: a user who arrived to log time can still do
          it while the list loads, and can still do it when the list failed. */}
      <div className="flex items-center justify-between">
        <Button
          variant={mineOnly ? "default" : "outline"}
          size="sm"
          disabled={loading}
          title={loading ? "Loading…" : undefined}
          onClick={() => setMineOnly((v) => !v)}
        >
          {mineOnly ? "Showing my entries" : "Show my entries only"}
        </Button>
        <Button onClick={() => router.push(`/schedule/log-time?projectId=${projectId}`)}>
          <Plus className="size-4" /> Log Time
        </Button>
      </div>
      {loading ? (
        <Card className="shadow-card">
          <CardContent className="p-0">
            <SkeletonTable headers={COLUMN_LABELS} rows={3} caption="Loading time entries…" />
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-center gap-3 py-16 text-center text-sm text-px-muted">
            <span>The timesheet did not load — the reason is in the message area below.</span>
            <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
          </CardContent>
        </Card>
      ) : entries.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-sm text-px-muted">No time logged yet.</CardContent></Card>
      ) : (
        <Card className="shadow-card">
          <CardContent className="p-0">
            <Table>
              {/* R67 D-51: Sumeet's column order, the org date format, hours
                  right-aligned to two decimals, and the en-dash for an empty
                  cell -- never a blank one. */}
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead>Comments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow
                    key={entry.id}
                    data-testid={entry.id === highlightEntryId ? "timesheet-highlighted-row" : undefined}
                    className={entry.id === highlightEntryId ? "bg-[color:var(--color-scope-tint)]" : undefined}
                  >
                    <TableCell>{entry.spentOn ? formatDayMonthYear(entry.spentOn) : "—"}</TableCell>
                    <TableCell>{projectName ?? "—"}</TableCell>
                    <TableCell className={entry.activityType ? undefined : "text-px-muted"}>
                      {entry.activityType ?? "—"}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => router.push(`/schedule/tasks/${entry.issueId}`)}
                      >
                        {entry.issue ? `#${entry.issue.number} ${entry.issue.title}` : entry.issueId}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number(entry.hours).toFixed(2)}</TableCell>
                    <TableCell className="max-w-xs truncate">{entry.comments ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t border-px-border p-3 text-right text-sm font-medium text-px-ink tabular-nums">
              Total: {totalHours.toFixed(2)} hrs
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
