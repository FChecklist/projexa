"use client";

// Wave 141 (PROJEXA gap analysis): Kanban/backlog board view over the same
// pms_issues/pms_issue_statuses data already powering the Schedule/Gantt
// timeline -- a missing UI, not missing data. No new drag-and-drop
// dependency added (projexa has none installed); this uses native HTML5
// drag-and-drop plus a "Move to..." dropdown per card as a keyboard/
// pointer-friendly fallback.
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
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
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/board?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load board");
      setColumns(data.columns ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
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

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  }
  if (error) {
    return (
      <Card className="border-px-error-border bg-px-error-light">
        <CardContent className="p-4 text-sm text-px-error">Could not load board: {error}</CardContent>
      </Card>
    );
  }
  if (columns.length === 0 || columns.every((c) => c.issues.length === 0)) {
    return <Card><CardContent className="py-16 text-center text-sm text-px-muted">No issues yet.</CardContent></Card>;
  }

  return (
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
                    className={`rounded-md border border-px-border bg-white p-2.5 text-sm shadow-sm transition-opacity ${movingId === issue.id ? "opacity-50" : ""}`}
                  >
                    <p className="mb-1.5 font-medium text-px-ink">{issue.title}</p>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-px-muted">#{issue.number}</span>
                      <Badge variant={PRIORITY_VARIANT[issue.priority] ?? "outline"} className="text-[10px]">
                        {issue.priority.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="mt-2 w-full rounded border border-px-border py-1 text-xs text-px-muted hover:bg-px-cloud/60">
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
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}
