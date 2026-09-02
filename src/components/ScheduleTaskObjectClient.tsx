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
import { formatDate } from "@/lib/format-date";

type Task = {
  id: string; projectId: string; number: number; title: string; description: string | null;
  priority: string; statusId: string; startDate: string | null; dueDate: string | null;
  completionPercentage: number; isArchived: boolean;
};
type StatusOption = { id: string; name: string };

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

export default function ScheduleTaskObjectClient({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [values, setValues] = useState<Partial<Task>>({});
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

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
      // Never fatal: an activity nobody linked to a BOQ line is the normal
      // case on a non-construction project, and this page must open anyway.
      const prov = await fetchJson<CompletionProvenance>(`/api/schedule/tasks/${taskId}/completion`).catch(() => null);
      setProvenance(prov);
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
      router.push(`/schedule?projectId=${task!.projectId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't archive task");
    } finally {
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
  const linkedToBoq = !!provenance && provenance.links.length > 0;

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
        // R67 lane D22 (item D-49): the codes, not the ids. A QS recognises
        // "R60SK-A"; nobody recognises a 25-character key.
        ...(provenance && provenance.links.length > 0
          ? [{ label: "Linked BOQ items", value: provenance.links.map((l) => l.code ?? "(no code)").join(", ") }]
          : []),
      ]}
      onEdit={!task.isArchived ? () => { setValues(task); setMode("edit"); } : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => { setValues(task); setMode("display"); } : undefined}
      onDelete={!task.isArchived ? handleArchive : undefined}
      deleteDisabledReason={task.isArchived ? "Already archived" : archiving ? "Archiving…" : undefined}
      onBack={() => router.push(`/schedule?projectId=${task.projectId}`)}
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
