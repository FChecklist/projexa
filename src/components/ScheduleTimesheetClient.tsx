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
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
import { formatDayMonthYear } from "@/lib/format-date";

type Entry = {
  id: string; issueId: string; hours: string; spentOn: string; activityType: string | null; comments: string | null;
  issue?: { id: string; number: number; title: string } | null;
};

export default function ScheduleTimesheetClient({
  projectId,
  projectName,
}: {
  projectId: string;
  /**
   * R67 D-51: Sumeet's own column order is Date | Project | Category | Task |
   * Hours, and every row on this screen belongs to the project the page
   * resolved -- the list is fetched by projectId. Naming it in the row is what
   * makes an exported or printed timesheet readable away from this screen.
   */
  projectName?: string;
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
      const res = await fetch(`/api/timesheets?projectId=${encodeURIComponent(projectId)}${mineOnly ? "&mine=true" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load timesheet");
      setEntries(data.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load timesheet");
    } finally {
      setLoading(false);
    }
  }, [projectId, mineOnly]);

  useEffect(() => { load(); }, [load]);

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  // Real screen navigation (2026-08-30) -- replaces the old "Log Time"
  // Dialog popup with a real create route.
  const logTimeButton = (
    <Button onClick={() => router.push(`/schedule/log-time?projectId=${projectId}`)}><Plus className="size-4" /> Log Time</Button>
  );

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  if (error) {
    return (
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="p-4 text-sm text-px-error">Could not load timesheet: {error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant={mineOnly ? "default" : "outline"} size="sm" onClick={() => setMineOnly((v) => !v)}>
          {mineOnly ? "Showing my entries" : "Show my entries only"}
        </Button>
        {logTimeButton}
      </div>
      {entries.length === 0 ? (
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
                  <TableRow key={entry.id}>
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
