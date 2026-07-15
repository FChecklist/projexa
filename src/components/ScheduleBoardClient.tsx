"use client";

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
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Clock } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type BoardIssue = {
  id: string; number: number; title: string; priority: string; statusId: string; completionPercentage: number;
};
type BoardColumn = {
  id: string; name: string; group: string; color: string | null; position: number; issues: BoardIssue[];
};
type IssueType = { id: string; name: string; isDefault?: boolean | null };

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  urgent: "destructive", high: "destructive", medium: "secondary", low: "outline", no_priority: "outline",
};
const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

export default function ScheduleBoardClient({ projectId }: { projectId: string }) {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const [types, setTypes] = useState<IssueType[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState("");
  const [priority, setPriority] = useState("no_priority");
  const [dueDate, setDueDate] = useState("");
  const [creating, setCreating] = useState(false);

  // Priority 17 Wave 1: quick "Log time" action on a task card, over the
  // previously-unexposed pms-time-service.ts. Honest limitation: this POST
  // requires a real VERIDIAN user session (pms_time_entries.user_id is a
  // hard FK to compliance.users) -- PROJEXA's shared-API-key proxy has no
  // per-user identity bridge to VERIDIAN yet, so this currently surfaces
  // the same 400 the existing leave-approval/quotation-approval buttons
  // already do for the identical reason. The dialog itself is real and
  // wired, ready to work once that bridge exists.
  const [logTimeIssue, setLogTimeIssue] = useState<BoardIssue | null>(null);
  const [logHours, setLogHours] = useState("");
  const [logSpentOn, setLogSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [loggingTime, setLoggingTime] = useState(false);

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

  useEffect(() => {
    fetch("/api/schedule/types")
      .then((res) => res.json())
      .then((data) => {
        const loaded: IssueType[] = data.types ?? [];
        setTypes(loaded);
        const defaultType = loaded.find((t) => t.isDefault) ?? loaded[0];
        if (defaultType) setTypeId(defaultType.id);
      })
      .catch(() => { /* type dropdown is a convenience -- create still works with server-side default */ });
  }, []);

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

  async function createTask() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/schedule/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title: title.trim(), typeId: typeId || undefined, priority,
          dueDate: dueDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create task");
      toast.success("Task created");
      setTitle(""); setPriority("no_priority"); setDueDate(""); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create task");
    } finally {
      setCreating(false);
    }
  }

  async function submitLogTime() {
    if (!logTimeIssue || !logHours || !logSpentOn) return;
    setLoggingTime(true);
    try {
      const res = await fetch("/api/timesheets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: logTimeIssue.id, hours: logHours, spentOn: logSpentOn }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to log time");
      toast.success("Time logged");
      setLogTimeIssue(null); setLogHours("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log time");
    } finally {
      setLoggingTime(false);
    }
  }

  const newTaskButton = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> New Task</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Task</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pour foundation slab" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger className="w-full"><SelectValue placeholder={types.length ? "Select a type" : "Loading…"} /></SelectTrigger>
                <SelectContent>
                  {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5"><Label>Due Date (optional)</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={createTask} disabled={creating || !title.trim()}>{creating ? "Creating…" : "Create Task"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

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
    return (
      <div className="space-y-4">
        <div className="flex justify-end">{newTaskButton}</div>
        <Card><CardContent className="py-16 text-center text-sm text-px-muted">No issues yet.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{newTaskButton}</div>
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
                      <div className="mt-2 flex gap-1.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex-1 rounded border border-px-border py-1 text-xs text-px-muted hover:bg-px-cloud/60">
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
                        <button
                          onClick={() => setLogTimeIssue(issue)}
                          title="Log time"
                          className="rounded border border-px-border px-2 py-1 text-xs text-px-muted hover:bg-px-cloud/60"
                        >
                          <Clock className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      <Dialog open={logTimeIssue !== null} onOpenChange={(o) => { if (!o) setLogTimeIssue(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Time{logTimeIssue ? ` — #${logTimeIssue.number} ${logTimeIssue.title}` : ""}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Hours</Label><Input type="number" min="0" step="0.25" value={logHours} onChange={(e) => setLogHours(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={logSpentOn} onChange={(e) => setLogSpentOn(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={submitLogTime} disabled={loggingTime || !logHours}>{loggingTime ? "Logging…" : "Log Time"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
