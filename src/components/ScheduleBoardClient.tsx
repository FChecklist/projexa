"use client";

// R67 MERGE (lane D0 x lane F2). Lane D0 (item D-46) replaced this tab's
// wordless spinner with a skeleton in the real shape plus a waiting caption
// that names the module at 2 s, counts from 3 s and offers a way out at 8 s.
// Lane F2 (item F-31, audit R-275) put a machine-readable
// data-state="loading|ready|empty|error" and aria-busy on the region, which is
// what the pass-2 latency script waits on to decide a screen is usable -- its
// `usable` column was empty for all thirteen measured pages without it. Under
// decision D-11 D0's markup is canonical, so it is kept exactly and F2's
// attribute is added around it by ListStateRegion.

// Wave 141 (PROJEXA gap analysis): Kanban/backlog board view over the same
// pms_issues/pms_issue_statuses data already powering the Schedule/Gantt
// timeline -- a missing UI, not missing data. No new drag-and-drop
// dependency added (projexa has none installed); this uses native HTML5
// drag-and-drop plus a "Move to..." dropdown per card as a keyboard/
// pointer-friendly fallback.
//
// Priority 16 Part 2 (PROJEXA-SCHEDULE-NO-CREATE-UI): adds the "New Task"
// dialog this board never had -- pms-issue-service.ts's createIssue() was
// always fully working, but no PROJEXA route/UI reached it (see
// control/priority16_e2e_testing_plan.md "GAP -- Schedule"). Placed here
// (Board/Kanban view) rather than the Gantt/Timeline tab, which stays
// read-only -- drag-to-reschedule there is a separate, larger feature.
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PaneErrorCard, PaneWaitingCaption } from "@/components/PaneState";
import { ListStateRegion } from "@/components/ListScreenFrame";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type BoardIssue = {
  id: string; number: number; title: string; priority: string; statusId: string; completionPercentage: number;
};
type BoardColumn = {
  id: string; name: string; group: string; color: string | null; position: number; issues: BoardIssue[];
};

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  urgent: "destructive", high: "destructive", medium: "secondary", low: "outline", no_priority: "outline",
};

export default function ScheduleBoardClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [loading, setLoading] = useState(true);
  // R67 D-46: the transport's own answer, so the shared dictionary writes the
  // sentence instead of this screen re-printing a string.
  const [error, setError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setStartedAt(Date.now());
    setError(null);
    try {
      const res = await fetch(`/api/board?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError({ status: res.status, message: typeof data?.error === "string" ? data.error : null });
        return;
      }
      setColumns(Array.isArray(data?.columns) ? data.columns : []);
    } catch (err) {
      setError({ status: null, message: err instanceof Error ? err.message : null });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function moveIssue(issueId: string, statusId: string) {
    setMovingId(issueId);
    // Optimistic update so the card jumps immediately instead of waiting on
    // a round trip; reloads from the server after to stay consistent.
    setColumns((prev) => {
      const issue = prev.flatMap((c) => c.issues).find((i) => i.id === issueId);
      if (!issue) return prev;
      return prev.map((c) => ({
        ...c,
        issues: c.id === statusId
          ? [...c.issues.filter((i) => i.id !== issueId), { ...issue, statusId }]
          : c.issues.filter((i) => i.id !== issueId),
      }));
    });
    try {
      const res = await fetch("/api/board", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, statusId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't move issue");
      load();
    } finally {
      setMovingId(null);
    }
  }

  function onDrop(e: React.DragEvent, statusId: string) {
    e.preventDefault();
    const issueId = e.dataTransfer.getData("text/issue-id");
    if (issueId) moveIssue(issueId, statusId);
  }

  // Real screen navigation (2026-08-30) -- replaces the old "New Task"
  // Dialog popup with a real create route.
  //
  // R67 D-79: this no longer sits in a header row of its own. The module's
  // header now carries Filter | Export | + New on EVERY tab, and two controls
  // that create the same object on one screen is the duplicate-control fault
  // the audit records elsewhere. It stays where it is the only way forward --
  // inside the empty state.
  const newTaskButton = (
    <Button onClick={() => router.push(`/schedule/tasks/new?projectId=${projectId}`)}><Plus className="size-4" /> New Task</Button>
  );

  // R67 D-46: three board columns, the width they will really be, instead of
  // a spinner centred in an empty pane.
  if (loading) {
    return (
      <ListStateRegion state="loading" className="space-y-4">
        <PaneWaitingCaption startedAt={startedAt} entity="the board" onRetry={() => void load()} />
        <div className="flex gap-4 overflow-x-auto">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-72 shrink-0 space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      </ListStateRegion>
    );
  }
  if (error) {
    return (
      <ListStateRegion state="error">
        <PaneErrorCard entity="the board" error={error} onRetry={() => void load()} />
      </ListStateRegion>
    );
  }
  if (columns.length === 0 || columns.every((c) => c.issues.length === 0)) {
    return (
      <ListStateRegion state="empty">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-px-muted">
          No issues yet.
          {newTaskButton}
        </CardContent>
      </Card>
      </ListStateRegion>
    );
  }

  return (
    <ListStateRegion state={columns.length > 0 ? "ready" : "empty"} className="space-y-4">
      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((column) => (
          <div
            key={column.id}
            className="w-72 shrink-0"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, column.id)}
          >
            <Card className="shadow-card h-full">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between font-heading text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block size-2 rounded-full" style={{ backgroundColor: column.color ?? "#94a3b8" }} />
                    {column.name}
                  </span>
                  <Badge variant="outline">{column.issues.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-3 pt-0">
                {column.issues.length === 0 ? (
                  <p className="py-6 text-center text-xs text-px-muted">No issues</p>
                ) : (
                  column.issues.map((issue) => (
                    <div
                      key={issue.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/issue-id", issue.id)}
                      onClick={() => router.push(`/schedule/tasks/${issue.id}`)}
                      className={`cursor-pointer rounded-md border border-px-border bg-white p-2.5 text-sm shadow-sm transition-opacity hover:border-px-ink/30 ${movingId === issue.id ? "opacity-50" : ""}`}
                    >
                      <p className="mb-1.5 font-medium text-px-ink">{issue.title}</p>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-px-muted">#{issue.number}</span>
                        <Badge variant={PRIORITY_VARIANT[issue.priority] ?? "outline"} className="text-[10px]">
                          {issue.priority.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      {/* Real screen navigation (2026-08-30): the card itself
                          now opens the real Task Object Page (click →
                          /schedule/tasks/[id]), which is also where "Log
                          Time" now lives as a real inline action instead of
                          a separate popup here. "Move to…" stays on the
                          card -- real drag-and-drop's own keyboard/pointer
                          fallback, not a popup. stopPropagation so choosing
                          a column doesn't also navigate away. */}
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="w-full rounded border border-px-border py-1 text-xs text-px-muted hover:bg-px-cloud/60">
                              Move to…
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {columns.filter((c) => c.id !== column.id).map((target) => (
                              <DropdownMenuItem key={target.id} onClick={() => moveIssue(issue.id, target.id)}>
                                {target.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </ListStateRegion>
  );
}
