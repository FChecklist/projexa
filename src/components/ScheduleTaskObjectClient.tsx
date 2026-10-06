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
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
// R67 F-34 (D-09): the FORKED ObjectScreen, which adds the `loading` variant.
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import { SCHEDULE_TASK_OBJECT_BREADCRUMB } from "@/lib/object-breadcrumbs";
import { ObjectContext } from "@/components/shell/shell-screen-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { localBaseVersion, updateTaskLocally, type TaskPatch } from "@/lib/local-first/local-writes";
import { useLocalWrites } from "@/lib/local-first/use-local-writes";
import { useDraft } from "@/lib/local-first/outbox-drafts";
import { PendingSyncMarker } from "@/components/PendingSyncMarker";

import { viaPxApi } from "@/lib/px-api";
type Task = {
  id: string; projectId: string; number: number; title: string; description: string | null;
  priority: string; statusId: string; startDate: string | null; dueDate: string | null;
  completionPercentage: number; isArchived: boolean;
};
type StatusOption = { id: string; name: string };

const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

/** The task fields a waiting local edit (the outbox op's params) can carry. */
const EDITABLE_FIELDS = ["title", "description", "priority", "statusId", "startDate", "dueDate", "completionPercentage"] as const;
function waitingFields(edit: Record<string, unknown>): Partial<Task> {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) if (key in edit) out[key] = edit[key];
  return out as Partial<Task>;
}

/** An empty date input and a missing date are the same thing. */
const norm = (key: (typeof EDITABLE_FIELDS)[number], v: unknown) => ((key === "startDate" || key === "dueDate" || key === "description") && (v === "" || v === undefined) ? null : v);

/**
 * LOCAL-FIRST (FB data:F3): ONLY the fields the person changed since the form opened. A field they did not touch is never
 * sent -- in particular a BOQ-linked task's % complete, which the server derives and refuses as typed.
 */
export function changedTaskFields(opened: Partial<Task>, values: Partial<Task>): TaskPatch {
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (!(key in values)) continue;
    const now = norm(key, values[key]);
    if (now !== norm(key, opened[key])) patch[key] = now;
  }
  return patch as TaskPatch;
}

export default function ScheduleTaskObjectClient({
  taskId,
  backTo,
  createdNumber,
}: {
  taskId: string;
  /**
   * R67 D-44: the list's own URL, carrying the project, the tab and the filter
   * the user had. Validated by the page before it reaches here.
   */
  backTo?: string;
  /**
   * R67 D-47: the activity number the create screen just wrote, so this page
   * opens with "Activity #12 created" in its persistent message area instead of
   * the create screen bouncing to an empty form. Validated as digits by the
   * page before it reaches here.
   */
  createdNumber?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [task, setTask] = useState<Task | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [mode, setModeState] = useState<"display" | "edit">("display");
  // load() runs on its own (an "applied" event, Retry): while the person is editing it must not replace what they typed (data:F5).
  const modeRef = useRef<"display" | "edit">("display");
  const setMode = (m: "display" | "edit") => { modeRef.current = m; setModeState(m); };
  const [values, setValues] = useState<Partial<Task>>({});
  // LOCAL-FIRST (data:F12): what the form opened with -- the values the person started from and the laptop's server version
  // AT LOAD. A save sends only what changed from `opened`, based on `baseVersion`, never on whatever the laptop holds later.
  const [opened, setOpened] = useState<Partial<Task>>({});
  const baseVersion = useRef<number | null>(null);
  // LOCAL-FIRST "Edit again": a draft (an edit the server did not take) named in the URL opens the form filled with it.
  const { draft, clear: clearDraft } = useDraft(searchParams?.get("draft"));
  const [draftNote, setDraftNote] = useState(false);
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
      if (modeRef.current !== "edit") {
        setValues(data);
        baseVersion.current = await localBaseVersion({ projectId: data.projectId, kind: "tasks", id: taskId }).catch(() => null);
      }
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

  // LOCAL-FIRST: an edit made on this laptop that the server has not confirmed yet. Flag off = an empty view and nothing changes.
  // Only an applied edit of THIS task reloads it (data:F5); another task of the project being applied is not this form's news.
  const pending = useLocalWrites("tasks", task?.projectId, { onApplied: (applied) => { if (applied.recordId === taskId) void load(); } });

  // "Edit again": once the task is loaded, open the form with the draft's fields laid over it.
  useEffect(() => {
    if (!draft || !task || draft.functionId !== "update_task" || draft.params.issueId !== taskId) return;
    const start = { ...task, ...waitingFields(pending.edits.get(taskId) ?? {}) };
    setOpened(start);
    setValues({ ...start, ...waitingFields(draft.params) });
    setMode("edit");
    setDraftNote(true);
    // Once per draft, when the task is there to lay it over (not on every pending-edit change).
  }, [draft, task?.id]);

  async function handleSave() {
    setSaving(true);
    let refused: string | null = null;
    try {
      // LOCAL-FIRST (flag px-local-first=1, see src/lib/local-first/local-writes.ts): with this task on the laptop at a server
      // version, the edit is written to the laptop at once and sent by the outbox (the server still decides, and says if
      // somebody else changed the task meanwhile). Anything else returns null and the save below runs as it always did.
      if (task) {
        const patch = changedTaskFields(opened, values);
        if (Object.keys(patch).length === 0) {
          toast.success("Nothing changed.");
          setMode("display");
          void clearDraft();
          return;
        }
        const loaded: Record<string, unknown> = {};
        for (const key of Object.keys(patch) as (keyof TaskPatch)[]) loaded[key] = norm(key, opened[key]);
        const result = await updateTaskLocally({ projectId: task.projectId, taskId, patch, baseVersion: baseVersion.current, loaded });
        if (result?.queued) {
          toast.success("Task saved on this laptop. It is being sent to the server.");
          setMode("display");
          setDraftNote(false);
          void clearDraft();
          return;
        }
        // Refused before it was stored (too long, a derived %): the form keeps the text; the online save may still take it.
        if (result && !result.queued) refused = result.refused;
      }
      const res = await viaPxApi(`/api/schedule/tasks/${taskId}`, {
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
      setDraftNote(false);
      void clearDraft();
      await load();
    } catch (err) {
      toast.error(refused ?? (err instanceof Error ? err.message : "Couldn't save task"));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      const res = await viaPxApi(`/api/schedule/tasks/${taskId}`, {
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
      const res = await viaPxApi("/api/timesheets", {
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
  // R67 F-34 (R-290): the SAME frame the route's own loading.tsx paints, so the
  // hand-over from the route skeleton to this client is invisible and the word
  // "Loading" is never alone on the screen. It says what it is waiting for after
  // 3 s and offers Retry at 8 s, D-04's abort budget.
  if (!task) return (
    <KitObjectScreen
      loading
      breadcrumb={SCHEDULE_TASK_OBJECT_BREADCRUMB.breadcrumb}
      label={SCHEDULE_TASK_OBJECT_BREADCRUMB.label}
      actions={SCHEDULE_TASK_OBJECT_BREADCRUMB.actions}
    />
  );

  // The server's row with this laptop's waiting edit laid over it (what the person last saved is what they see).
  const waiting = pending.edits.get(taskId);
  const view: Task = waiting ? { ...task, ...waitingFields(waiting) } : task;

  const statusLabel = statuses.find((s) => s.id === view.statusId)?.name ?? view.statusId;

  return (
    <>
    {/* R67 A-21: "<project> › Task #14 Shuttering, ground floor". The number is
        part of the label because it is how this product identifies a task on
        every other screen -- the page heading, the board card and the timesheet
        all lead with it. */}
    <ObjectContext moduleId="schedule" label={`#${view.number} ${view.title}`} projectId={view.projectId} />
    <KitObjectScreen
      breadcrumb={SCHEDULE_TASK_OBJECT_BREADCRUMB.breadcrumb}
      title={`#${view.number} ${view.title}`}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: view.isArchived ? "neutral" : view.completionPercentage >= 100 ? "done" : "waiting", label: view.isArchived ? "archived" : statusLabel }}
      facets={[
        { label: "Priority", value: view.priority.replace(/_/g, " ") },
        { label: "% Complete", value: `${view.completionPercentage}%` },
      ]}
      onEdit={!view.isArchived ? () => { setOpened(view); setValues(view); setMode("edit"); } : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => { setValues(view); setMode("display"); setDraftNote(false); } : undefined}
      onDelete={!view.isArchived ? handleArchive : undefined}
      deleteDisabledReason={view.isArchived ? "Already archived" : archiving ? "Archiving…" : undefined}
      onBack={() => router.push(backTo ?? `/schedule?projectId=${view.projectId}&tab=timeline`)}
      saveDisabled={saving || !values.title?.trim()}
      saveDisabledReason={saving ? "Saving…" : !values.title?.trim() ? "Title is required" : undefined}
      // R67 D-47: the create screen's receipt, in the persistent message area
      // rather than a toast that has gone by the time the page paints.
      messages={[
        ...(createdNumber ? [{ level: "success" as const, text: `Activity #${createdNumber} created` }] : []),
        ...(draftNote && draft ? [{ level: "warning" as const, text: `${draft.message} Your changes are filled in below: check them and save again.` }] : []),
      ]}
    >
      <div className="space-y-3 px-4 py-3">
        {waiting ? <div><PendingSyncMarker /></div> : null}
        {mode === "edit" ? (
          <>
            <div className="space-y-1.5"><Label>Title</Label><Input value={values.title ?? ""} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Description</Label><Textarea rows={3} value={values.description ?? ""} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={values.statusId ?? view.statusId} onValueChange={(statusId) => setValues((v) => ({ ...v, statusId }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={values.priority ?? view.priority} onValueChange={(priority) => setValues((v) => ({ ...v, priority }))}>
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
            <p className="text-sm text-ct-navy whitespace-pre-wrap">{view.description || <span className="text-ct-muted">No description.</span>}</p>
            <dl className="grid grid-cols-3 gap-3 text-[13px]">
              <div><dt className="text-ct-muted">Start Date</dt><dd className="text-ct-navy">{view.startDate ?? "—"}</dd></div>
              <div><dt className="text-ct-muted">Due Date</dt><dd className="text-ct-navy">{view.dueDate ?? "—"}</dd></div>
              <div><dt className="text-ct-muted">Status</dt><dd className="text-ct-navy">{statusLabel}</dd></div>
            </dl>
          </>
        )}

        {mode === "display" && !view.isArchived && (
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
    </KitObjectScreen>
    </>
  );
}
