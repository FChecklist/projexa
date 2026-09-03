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
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PaneErrorCard, PaneWaitingCaption } from "@/components/PaneState";

type Entry = {
  id: string; issueId: string; hours: string; spentOn: string; activityType: string | null; comments: string | null;
  issue?: { id: string; number: number; title: string } | null;
};

export default function ScheduleTimesheetClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  // R67 D-46: what the transport said, so the shared dictionary can name the
  // failure -- a bare string could only ever be re-printed.
  const [error, setError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [mineOnly, setMineOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setStartedAt(Date.now());
    setError(null);
    try {
      const res = await fetch(`/api/timesheets?projectId=${encodeURIComponent(projectId)}${mineOnly ? "&mine=true" : ""}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError({ status: res.status, message: typeof data?.error === "string" ? data.error : null });
        return;
      }
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
    } catch (err) {
      setError({ status: null, message: err instanceof Error ? err.message : null });
    } finally {
      setLoading(false);
    }
  }, [projectId, mineOnly]);

  useEffect(() => { load(); }, [load]);

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  // Real screen navigation (2026-08-30) -- replaces the old "Log Time"
  // Dialog popup with a real create route.
  //
  // R67 D-07: the same hours also have a designer-facing layout -- the Design
  // Studio timesheet's day grid, in Sumeet's own columns with the approval
  // state on each row. It is the same read, so this is a view switch and not a
  // second module; that link is also what makes /design-studio reachable by
  // clicking (nav-routes.test.ts's C01 REACHABLE guard).
  const logTimeButton = (
    <Button onClick={() => router.push(`/schedule/log-time?projectId=${projectId}`)}>
      <Plus className="size-4" /> Log Time
    </Button>
  );

  // R67 D-79: "Log Time" left this row -- the module header carries it on
  // every tab now, and the same control twice on one screen is the
  // duplicate-control fault. The view switch is a DIFFERENT action and stays.
  const designStudioButton = (
    <Button variant="outline" onClick={() => router.push(`/design-studio?projectId=${projectId}`)}>
      Open in Design Studio
    </Button>
  );

  // R67 D-46: five table rows shaped like the real grid, not a wordless
  // spinner that says nothing about what is coming and shifts the whole pane
  // when it resolves. The waiting caption names the module at 2 s, counts
  // from 3 s and offers a way out at 8 s -- see src/lib/pane-state.ts.
  if (loading) {
    return (
      <div className="space-y-3">
        <PaneWaitingCaption startedAt={startedAt} entity="the timesheet" onRetry={() => void load()} />
        <Card className="shadow-card">
          <CardContent className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }
  if (error) {
    return <PaneErrorCard entity="the timesheet" error={error} onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant={mineOnly ? "default" : "outline"} size="sm" onClick={() => setMineOnly((v) => !v)}>
          {mineOnly ? "Showing my entries" : "Show my entries only"}
        </Button>
        {designStudioButton}
      </div>
      {entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-px-muted">
            No time logged yet.
            {logTimeButton}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-card">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Comments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => router.push(`/schedule/tasks/${entry.issueId}`)}
                      >
                        {entry.issue ? `#${entry.issue.number} ${entry.issue.title}` : entry.issueId}
                      </button>
                    </TableCell>
                    {/* R67 D-74: this printed the RAW API string
                        ("2026-09-02") -- a third date form on a module that
                        already had two. */}
                    <TableCell>{formatDate(entry.spentOn)}</TableCell>
                    <TableCell className="text-right tabular-nums">{entry.hours}</TableCell>
                    <TableCell>{entry.activityType ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{entry.comments ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t border-px-border p-3 text-right text-sm font-medium text-px-ink">
              Total: {totalHours.toFixed(2)} hrs
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
