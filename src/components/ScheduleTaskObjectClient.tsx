"use client";

// Real-screen conversion (2026-08-30): the Schedule module's core entity
// (a "task", pms_issues) had NO detail/edit screen at all -- Board only let
// you drag a card between columns or log time against it; there was no way
// to see or change a title/description/priority/dates once created. Real
// Object Page on the kit's ObjectScreen, same pattern as Scope/Permits.
//
// "Delete" maps to the existing isArchived field (real backend soft-delete,
// not invented here) -- pms-issue-service.ts has no deleteIssue() anywhere
// in the codebase, and a hard delete of a task with time entries/
// dependencies/sprint membership attached is a real data-model decision the
// backend hasn't made. Archiving is the one real "remove this from view"
// action that already exists.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Task = {
  id: string; projectId: string; number: number; title: string; description: string | null;
  priority: string; statusId: string; startDate: string | null; dueDate: string | null;
  completionPercentage: number; isArchived: boolean;
};
type StatusOption = { id: string; name: string };

const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

export default function ScheduleTaskObjectClient({
  taskId,
  backTo,
}: {
  taskId: string;
  /**
   * R67 D-44: the list's own URL, carrying the project, the tab and the filter
   * the user had. Validated by the page before it reaches here.
   */
  backTo?: string;
}) {
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [values, setValues] = useState<Partial<Task>>({});
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Real "Log Time" action, folded into the task it belongs to instead of a
  // separate popup or a task-picker dialog elsewhere (Board's old quick
  // Dialog and Timesheet's own Dialog both did this as a modal; the task IS
  // the natural place for it).
  const [loggingTimeOpen, setLoggingTimeOpen] = useState(false);
  const [logHours, setLogHours] = useState("");
  const [logSpentOn, setLogSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [loggingTime, setLoggingTime] = useState(false);

  async function load() {
    try {
      const data = await fetchJson<Task>(`/api/schedule/tasks/${taskId}`);
      setTask(data);
      setValues(data);
      setLoadError(null);
      // Status options come from the board's own column list (the real
      // status taxonomy for this project) -- no separate endpoint needed.
      const board = await fetchJson<{ columns: StatusOption[] }>(`/api/board?projectId=${encodeURIComponent(data.projectId)}`).catch(() => ({ columns: [] }));
      setStatuses(board.columns ?? []);
    } catch (err) {
      setTask(null);
      setLoadError(errorMessage(err, "Couldn't load this task"));
    }
  }

  useEffect(() => { load(); }, [taskId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/schedule/tasks/${taskId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title, description: values.description, priority: values.priority,
          statusId: values.statusId, startDate: values.startDate || null, dueDate: values.dueDate || null,
          completionPercentage: values.completionPercentage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save task");
      toast.success("Task saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save task");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      const res = await fetch(`/api/schedule/tasks/${taskId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to archive task");
      toast.success("Task archived");
      router.push(backTo ?? `/schedule?projectId=${task!.projectId}&tab=timeline`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't archive task");
    } finally {
      setArchiving(false);
    }
  }

  async function submitLogTime() {
    if (!logHours) return;
    setLoggingTime(true);
    try {
      const res = await fetch("/api/timesheets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: taskId, hours: logHours, spentOn: logSpentOn }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to log time");
      toast.success("Time logged");
      setLogHours(""); setLoggingTimeOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log time");
    } finally {
      setLoggingTime(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!task) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const statusLabel = statuses.find((s) => s.id === task.statusId)?.name ?? task.statusId;

  return (
    <ObjectScreen
      breadcrumb="Schedule / Task"
      title={`#${task.number} ${task.title}`}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: task.isArchived ? "neutral" : task.completionPercentage >= 100 ? "done" : "waiting", label: task.isArchived ? "archived" : statusLabel }}
      facets={[
        { label: "Priority", value: task.priority.replace(/_/g, " ") },
        { label: "% Complete", value: `${task.completionPercentage}%` },
      ]}
      onEdit={!task.isArchived ? () => { setValues(task); setMode("edit"); } : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => { setValues(task); setMode("display"); } : undefined}
      onDelete={!task.isArchived ? handleArchive : undefined}
      deleteDisabledReason={task.isArchived ? "Already archived" : archiving ? "Archiving…" : undefined}
      onBack={() => router.push(backTo ?? `/schedule?projectId=${task.projectId}&tab=timeline`)}
      saveDisabled={saving || !values.title?.trim()}
      saveDisabledReason={saving ? "Saving…" : !values.title?.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {mode === "edit" ? (
          <>
            <div className="space-y-1.5"><Label>Title</Label><Input value={values.title ?? ""} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Description</Label><Textarea rows={3} value={values.description ?? ""} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={values.statusId ?? task.statusId} onValueChange={(statusId) => setValues((v) => ({ ...v, statusId }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={values.priority ?? task.priority} onValueChange={(priority) => setValues((v) => ({ ...v, priority }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITY_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5"><Label>Start Date</Label><Input type="date" value={values.startDate ?? ""} onChange={(e) => setValues((v) => ({ ...v, startDate: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Due Date</Label><Input type="date" value={values.dueDate ?? ""} onChange={(e) => setValues((v) => ({ ...v, dueDate: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>% Complete</Label><Input type="number" min="0" max="100" value={values.completionPercentage ?? 0} onChange={(e) => setValues((v) => ({ ...v, completionPercentage: Number(e.target.value) }))} /></div>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ct-navy whitespace-pre-wrap">{task.description || <span className="text-ct-muted">No description.</span>}</p>
            <dl className="grid grid-cols-3 gap-3 text-[13px]">
              <div><dt className="text-ct-muted">Start Date</dt><dd className="text-ct-navy">{task.startDate ?? "—"}</dd></div>
              <div><dt className="text-ct-muted">Due Date</dt><dd className="text-ct-navy">{task.dueDate ?? "—"}</dd></div>
              <div><dt className="text-ct-muted">Status</dt><dd className="text-ct-navy">{statusLabel}</dd></div>
            </dl>
          </>
        )}

        {mode === "display" && !task.isArchived && (
          <div className="border-t border-ct-border pt-3">
            {!loggingTimeOpen ? (
              <Button size="sm" variant="outline" onClick={() => setLoggingTimeOpen(true)}>Log Time</Button>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5"><Label>Hours</Label><Input type="number" min="0" step="0.25" className="w-24" value={logHours} onChange={(e) => setLogHours(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={logSpentOn} onChange={(e) => setLogSpentOn(e.target.value)} /></div>
                <Button size="sm" onClick={submitLogTime} disabled={loggingTime || !logHours}>{loggingTime ? "Logging…" : "Save"}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setLoggingTimeOpen(false); setLogHours(""); }}>Cancel</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
