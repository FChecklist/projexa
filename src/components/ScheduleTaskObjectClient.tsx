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
//
// ─── R67 lane D22 (item D-77, rec R-289) ──────────────────────────────────
// THREE THINGS THIS PAGE COULD NOT ANSWER. It never showed the task's TYPE
// (bug/task/story -- the one field createIssue actually requires), never
// showed WHO IT IS ASSIGNED TO even though getIssue has always returned
// assigneeIds, and never showed the TIME LOGGED against it even though it
// carried a Log Time control that wrote exactly that. It also always sent Back
// to the Timeline, whichever tab you had clicked from. All four are fixed
// here; Edit moves into the header per the global object-screen rule, and
// Delete (an archive) stays isolated in the footer and now asks first.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
// The FORKED ObjectScreen (programme decision D-09) -- it is the only one with
// a header-actions slot. See src/components/screens/ScreenFrame.tsx's header.
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type Task = {
  id: string; projectId: string; number: number; title: string; description: string | null;
  priority: string; statusId: string; typeId: string | null; startDate: string | null; dueDate: string | null;
  completionPercentage: number; isArchived: boolean;
  /** getIssue has always returned these; nothing ever displayed them. */
  assigneeIds?: string[];
};
type StatusOption = { id: string; name: string };
type TypeOption = { id: string; name: string };
type OrgUser = { id: string; name: string; email: string; role: string };
type TimeEntry = { id: string; issueId: string; hours: string; spentOn: string };

// R67 lane D22 (item D-49, rec R-125): where this activity's percentage came
// from, and which BOQ lines it delivers. Served by
// GET /api/schedule/tasks/[id]/completion.
type LinkedBoqLine = {
  boqLineItemId: string;
  code: string | null;
  description: string;
  unit: string;
  quantity: number;
  weight: number;
  linkedBoqVersion: number | null;
  currentBoqVersion: number | null;
  supersededButMatched: boolean;
  scopeRemoved: boolean;
};
type CompletionProvenance = {
  issueId: string;
  completionPercentage: number;
  completionSource: string;
  lastProgressAt: string | null;
  links: LinkedBoqLine[];
};

const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

export default function ScheduleTaskObjectClient({ taskId, fromTab = null }: { taskId: string; fromTab?: string | null }) {
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [assignees, setAssignees] = useState<OrgUser[]>([]);
  const [hoursLogged, setHoursLogged] = useState<number | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [values, setValues] = useState<Partial<Task>>({});
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // R67 D-77: archiving is isolated AND asks. It is not destructive in the
  // database (isArchived, a real soft delete) but it removes the task from
  // every board and backlog somebody is working from, which is destructive
  // enough to be worth one confirming click.
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  // R67 lane D22 (item D-49): the site-records link. Loaded alongside the task
  // rather than folded into it -- it is construction data about a schedule
  // row, and a project with no BOQ at all must still open this page.
  const [provenance, setProvenance] = useState<CompletionProvenance | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPercent, setManualPercent] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // Real "Log Time" action, folded into the task it belongs to instead of a
  // separate popup or a task-picker dialog elsewhere (Board's old quick
  // Dialog and Timesheet's own Dialog both did this as a modal; the task IS
  // the natural place for it).
  const [loggingTimeOpen, setLoggingTimeOpen] = useState(false);
  const [logHours, setLogHours] = useState("");
  const [logSpentOn, setLogSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [loggingTime, setLoggingTime] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<Task>(`/api/schedule/tasks/${taskId}`);
      setTask(data);
      setValues(data);
      setLoadError(null);
      // Everything below enriches the page and none of it may keep the page
      // from opening -- each is caught to its own empty value.
      const assigneeIds = data.assigneeIds ?? [];
      const [board, typeData, timeData, people] = await Promise.all([
        // Status options come from the board's own column list (the real
        // status taxonomy for this project) -- no separate endpoint needed.
        fetchJson<{ columns: StatusOption[] }>(`/api/board?projectId=${encodeURIComponent(data.projectId)}`).catch(() => ({ columns: [] })),
        fetchJson<{ types: TypeOption[] }>("/api/schedule/types").catch(() => ({ types: [] })),
        // The real query parameter is issueId, not taskId: pms_time_entries
        // points at pms_issues, and /api/timesheets refuses a request with
        // neither projectId nor issueId. "Task" is this screen's word for the
        // same row.
        fetchJson<{ entries: TimeEntry[] }>(`/api/timesheets?issueId=${encodeURIComponent(taskId)}`).catch(() => ({ entries: [] })),
        // Names, from the ids getIssue already returns. A screen never prints
        // a user id (R-289).
        assigneeIds.length
          ? fetchJson<{ users: OrgUser[] }>(`/api/org/users?ids=${encodeURIComponent(assigneeIds.join(","))}`).catch(() => ({ users: [] }))
          : Promise.resolve({ users: [] as OrgUser[] }),
      ]);
      setStatuses(board.columns ?? []);
      setTypes(typeData.types ?? []);
      setHoursLogged((timeData.entries ?? []).reduce((sum, e) => sum + Number(e.hours || 0), 0));
      setAssignees(people.users ?? []);
      // Never fatal: an activity nobody linked to a BOQ line is the normal
      // case on a non-construction project, and this page must open anyway.
      const prov = await fetchJson<CompletionProvenance>(`/api/schedule/tasks/${taskId}/completion`).catch(() => null);
      setProvenance(prov);
    } catch (err) {
      setTask(null);
      setLoadError(errorMessage(err, "Couldn't load this task"));
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  // R67 D-77: Back returns to the tab the click came from. Declared here, above
  // every handler that uses it, so archiving and Back can never disagree about
  // where "back" is.
  const backHref = task
    ? `/schedule?projectId=${encodeURIComponent(task.projectId)}${fromTab ? `&tab=${encodeURIComponent(fromTab)}` : ""}`
    : "/schedule";

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
      router.push(backHref);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't archive task");
      setArchiving(false);
    }
  }

  // R67 lane D22 (item D-49): the explicit override. A separate endpoint from
  // the ordinary PATCH because VERIDIAN enforces the note there -- typing over
  // a figure derived from real site quantities is a decision that has to say
  // why, or the schedule and the site records diverge with no record of who
  // chose which.
  async function submitManualCompletion() {
    setManualSaving(true);
    setManualError(null);
    try {
      const res = await fetch(`/api/schedule/tasks/${taskId}/completion`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completionPercentage: Number(manualPercent), note: manualNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't set the percentage");
      setManualOpen(false);
      setManualNote("");
      await load();
    } catch (err) {
      setManualError(errorMessage(err, "Couldn't set the percentage"));
    } finally {
      setManualSaving(false);
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
      // R67 D-77: the "Time logged" facet is now on this page, so it has to
      // move when you log time on it.
      await load();
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
  // R67 D-77: the same loading skeleton shape as the work-progress entry page
  // -- the page's own frame while it arrives, not the word "Loading" floating
  // in an empty column.
  if (!task) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const statusLabel = statuses.find((s) => s.id === task.statusId)?.name ?? task.statusId;
  const typeLabel = types.find((t) => t.id === task.typeId)?.name ?? null;
  const linkedToBoq = !!provenance && provenance.links.length > 0;
  // A name, or nothing -- an id is never a substitute for a name.
  const assigneeLabel = assignees.length ? assignees.map((u) => u.name).join(", ") : "Unassigned";

  return (
    <ObjectScreen
      breadcrumb="Schedule / Task"
      title={`#${task.number} ${task.title}`}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: task.isArchived ? "neutral" : task.completionPercentage >= 100 ? "done" : "waiting", label: task.isArchived ? "archived" : statusLabel }}
      facets={[
        // R67 D-77: type, assignee and time logged -- all three were already in
        // the data and none of them were on the screen.
        ...(typeLabel ? [{ label: "Type", value: typeLabel }] : []),
        { label: "Priority", value: task.priority.replace(/_/g, " ") },
        { label: "Due", value: task.dueDate ?? "—" },
        { label: "Assignee", value: assigneeLabel },
        { label: "% Complete", value: `${task.completionPercentage}%` },
        { label: "Time logged", value: hoursLogged === null ? "—" : `${hoursLogged} h` },
        // R67 lane D22 (item D-49): the codes, not the ids. A QS recognises
        // "R60SK-A"; nobody recognises a 25-character key.
        ...(provenance && provenance.links.length > 0
          ? [{ label: "Linked BOQ items", value: provenance.links.map((l) => l.code ?? "(no code)").join(", ") }]
          : []),
      ]}
      // R67 D-77: Edit is a header action, per the global object-screen rule,
      // and it is this page's one primary.
      headerActions={mode === "display" && !task.isArchived ? (
        <Button size="sm" onClick={() => { setValues(task); setConfirmingArchive(false); setMode("edit"); }}>Edit</Button>
      ) : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => { setValues(task); setMode("display"); } : undefined}
      // Delete asks first. The footer button opens the confirm at the bottom of
      // the body, immediately above it, rather than archiving on one click.
      onDelete={!task.isArchived ? () => setConfirmingArchive(true) : undefined}
      deleteDisabledReason={task.isArchived ? "Already archived" : archiving ? "Archiving…" : undefined}
      onBack={() => router.push(backHref)}
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
              {/* R67 lane D22 (item D-49): when the activity is linked to BOQ
                  lines the percentage is DERIVED from the site crew's own
                  recorded quantities, so the plain number field is replaced by
                  an explicit "Set % manually" path that records the override
                  and demands a reason. An unlinked activity keeps the plain
                  field: there is nothing to overrule. */}
              {linkedToBoq ? (
                <div className="space-y-1.5">
                  <Label>% Complete</Label>
                  <p className="text-[12.5px] text-ct-muted">Derived from site records &mdash; use &ldquo;Set % manually&rdquo; below to overrule it.</p>
                </div>
              ) : (
                <div className="space-y-1.5"><Label>% Complete</Label><Input type="number" min="0" max="100" value={values.completionPercentage ?? 0} onChange={(e) => setValues((v) => ({ ...v, completionPercentage: Number(e.target.value) }))} /></div>
              )}
            </div>

            {linkedToBoq && (
              <div className="space-y-2 rounded-md border border-ct-border p-3">
                {!manualOpen ? (
                  <Button size="sm" variant="outline" onClick={() => { setManualOpen(true); setManualPercent(String(task.completionPercentage)); }}>
                    Set % manually
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1.5">
                        <Label>% Complete</Label>
                        <Input type="number" min="0" max="100" className="w-24" value={manualPercent} onChange={(e) => setManualPercent(e.target.value)} />
                      </div>
                      <div className="min-w-[16rem] flex-1 space-y-1.5">
                        <Label>Why (required)</Label>
                        <Input value={manualNote} onChange={(e) => setManualNote(e.target.value)} placeholder="e.g. Client walkdown agreed 80%" />
                      </div>
                      <Button
                        size="sm"
                        onClick={submitManualCompletion}
                        disabled={manualSaving || !manualNote.trim() || manualPercent.trim() === ""}
                        title={!manualNote.trim() ? "Say why you are overruling the site records" : undefined}
                      >
                        {manualSaving ? "Saving…" : "Set manually"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setManualOpen(false); setManualNote(""); setManualError(null); }}>Cancel</Button>
                    </div>
                    {!manualNote.trim() && <p className="text-[12px] text-ct-muted">Say why you are overruling the site records.</p>}
                    {manualError && <p role="alert" className="text-[12.5px] text-px-error">{manualError}</p>}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-ct-navy whitespace-pre-wrap">{task.description || <span className="text-ct-muted">No description.</span>}</p>
            <dl className="grid grid-cols-3 gap-3 text-[13px]">
              <div><dt className="text-ct-muted">Start Date</dt><dd className="text-ct-navy">{task.startDate ?? "—"}</dd></div>
              <div><dt className="text-ct-muted">Due Date</dt><dd className="text-ct-navy">{task.dueDate ?? "—"}</dd></div>
              <div><dt className="text-ct-muted">Status</dt><dd className="text-ct-navy">{statusLabel}</dd></div>
            </dl>

            {/* R67 lane D22 (item D-49, rec R-125): the provenance line and the
                BOQ lines this activity delivers. Closes the double entry where
                a site engineer records quantities against a BOQ line and a PM
                separately retypes a percent here. */}
            {linkedToBoq && (
              <section className="space-y-2 border-t border-ct-border pt-3">
                <h3 className="text-[13px] font-medium text-ct-navy">Linked BOQ items</h3>
                <p className="text-[12.5px] text-ct-muted">
                  {provenance!.completionSource === "site_records"
                    ? `Progress from site records: ${provenance!.completionPercentage} %${provenance!.lastProgressAt ? ` (last entry ${formatDate(provenance!.lastProgressAt)})` : ""}`
                    : `Progress set manually: ${provenance!.completionPercentage} %`}
                </p>
                <ul className="space-y-1 text-[12.5px]">
                  {provenance!.links.map((link) => (
                    <li key={link.boqLineItemId} className="flex flex-wrap items-baseline gap-2">
                      <a className="text-px-steel underline-offset-2 hover:underline" href={`/work-progress?boq=${encodeURIComponent(link.code ?? "")}`}>
                        <span className="font-mono">{link.code ?? "(no code)"}</span> &mdash; {link.description}
                      </a>
                      {link.supersededButMatched && (
                        <span className="text-ct-muted">Linked to {link.code} (Rev {link.currentBoqVersion})</span>
                      )}
                      {link.scopeRemoved && <span className="text-px-warning">scope removed</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {/* R67 D-77: the inline confirm for the footer's isolated Delete. It
            sits at the very bottom of the body, directly above the button that
            opened it -- inline, never a modal (the global no-dialogs rule). */}
        {mode === "display" && confirmingArchive && !task.isArchived && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-[color:var(--color-veri-status-late)] px-3 py-2 text-[12.5px] text-ct-navy">
            <span>Archiving removes this task from the board and every backlog; its time entries and links are kept</span>
            <Button size="sm" variant="outline" disabled={archiving} onClick={handleArchive}>{archiving ? "Archiving…" : "Archive"}</Button>
            <Button size="sm" variant="ghost" disabled={archiving} onClick={() => setConfirmingArchive(false)}>Cancel</Button>
          </div>
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
