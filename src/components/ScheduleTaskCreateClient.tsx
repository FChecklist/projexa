"use client";

// Real-screen conversion (2026-08-30) -- replaces ScheduleBoardClient.tsx's
// old "New Task" Dialog popup with a real create screen, same fields.
//
// ─── R67 D-47 (audit R-121) ─────────────────────────────────────────────────
// The form could set a title, a type, a priority and a due date. A programme
// needs the four things it could not send at all: a START, a DURATION, what
// the activity FOLLOWS, and which BOQ line it earns its value against -- which
// is why the Timeline it feeds could not draw a bar, could not draw a
// dependency line, and had nothing to compare against a baseline.
//
// Four more defects, all of them the form talking past the user:
//   * Nothing validated until submit, and then only through a toast.
//   * The Type select's PLACEHOLDER was the word "Loading…" -- a loading state
//     rendered as if it were a choice. A disabled trigger with a skeleton bar
//     says the same thing without pretending to be an option.
//   * The primary button said "Save (Title is required)" and nothing else, so a
//     form missing two things named one.
//   * Every optional lookup was swallowed (`/* convenience */`), so a failed
//     fetch left an empty dropdown with no explanation and no way to retry.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import {
  activitySaveReason,
  dueDateError,
  dueDateFromDuration,
  durationFieldValue,
  missingActivityFields,
} from "@/lib/schedule-activity";

type IssueType = { id: string; name: string; isDefault?: boolean | null };
type ScheduleTask = { id: string; number?: number; title: string };
type BoqLineItem = { id: string; itemCode: string | null; description: string | null };
type Boq = { id: string; lineItems?: BoqLineItem[] };

const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

/** A lookup that feeds one field. A failure degrades that field and offers Retry -- it never empties a dropdown in silence. */
type Lookup<T> = { rows: T[]; loading: boolean; error: string | null };
const emptyLookup = <T,>(): Lookup<T> => ({ rows: [], loading: true, error: null });

export const NO_PREDECESSOR_VALUE = "__none__";

export default function ScheduleTaskCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [types, setTypes] = useState<Lookup<IssueType>>(emptyLookup<IssueType>());
  const [predecessors, setPredecessors] = useState<Lookup<ScheduleTask>>(emptyLookup<ScheduleTask>());
  const [boqLines, setBoqLines] = useState<Lookup<BoqLineItem>>(emptyLookup<BoqLineItem>());
  const [typeId, setTypeId] = useState("");
  const [priority, setPriority] = useState("no_priority");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  // R67 D-56: a milestone is an activity with a zero-length window (Finish =
  // Start). Storing it that way needs no column and no migration -- pms_issues
  // already carries both dates, and "no duration" IS what a milestone means on
  // a programme. The Timeline draws those rows as diamonds.
  const [isMilestone, setIsMilestone] = useState(false);
  const [duration, setDuration] = useState("");
  const [predecessorId, setPredecessorId] = useState("");
  const [boqLineItemId, setBoqLineItemId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [touched, setTouched] = useState<{ title?: boolean; start?: boolean; due?: boolean }>({});

  const loadTypes = useCallback(async () => {
    setTypes((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchJson<{ types?: IssueType[] }>("/api/schedule/types");
      const rows = data.types ?? [];
      setTypes({ rows, loading: false, error: null });
      // Preselect the org's default type once the list has actually arrived --
      // never before, so the trigger cannot briefly show a value that is not in
      // the list.
      const preferred = rows.find((t) => t.isDefault) ?? rows[0];
      if (preferred) setTypeId((current) => current || preferred.id);
    } catch (err) {
      setTypes({ rows: [], loading: false, error: errorMessage(err, "Couldn't load the activity types") });
    }
  }, []);

  const loadPredecessors = useCallback(async () => {
    setPredecessors((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchJson<{ tasks?: ScheduleTask[] }>(
        `/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`
      );
      setPredecessors({ rows: data.tasks ?? [], loading: false, error: null });
    } catch (err) {
      setPredecessors({ rows: [], loading: false, error: errorMessage(err, "Couldn't load this project's activities") });
    }
  }, [projectId]);

  const loadBoqLines = useCallback(async () => {
    setBoqLines((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchJson<{ boqs?: Boq[] }>(`/api/scope?projectId=${encodeURIComponent(projectId)}`);
      setBoqLines({ rows: (data.boqs ?? []).flatMap((b) => b.lineItems ?? []), loading: false, error: null });
    } catch (err) {
      setBoqLines({ rows: [], loading: false, error: errorMessage(err, "Couldn't load this project's BOQ lines") });
    }
  }, [projectId]);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);
  useEffect(() => {
    void loadPredecessors();
    void loadBoqLines();
  }, [loadPredecessors, loadBoqLines]);

  const missing = missingActivityFields({ title, startDate, dueDate });
  const dueError = dueDateError(startDate, dueDate);

  /**
   * D-56: ticking Milestone collapses the window onto the start date, and
   * un-ticking it hands the finish date back rather than leaving the form in a
   * state the user cannot undo.
   */
  function onMilestoneChange(next: boolean) {
    setIsMilestone(next);
    if (next) {
      setDueDate(startDate);
      setDuration("0");
    }
  }

  /** Typing a duration moves the finish date; typing a finish date moves the duration. */
  function onDurationChange(next: string) {
    setDuration(next);
    const derived = dueDateFromDuration(startDate, next);
    if (derived) setDueDate(derived);
  }
  function onDueDateChange(next: string) {
    setDueDate(next);
    setDuration(durationFieldValue(startDate, next));
  }
  function onStartDateChange(next: string) {
    setStartDate(next);
    // A milestone has no duration to preserve: its finish IS its start.
    if (isMilestone) {
      setDueDate(next);
      setDuration("0");
      return;
    }
    // Keep whichever of the pair the user last expressed an opinion about: a
    // typed duration is re-applied from the new start, otherwise the duration
    // is re-derived from the finish date that is already there.
    if (duration.trim()) {
      const derived = dueDateFromDuration(next, duration);
      if (derived) setDueDate(derived);
    } else {
      setDuration(durationFieldValue(next, dueDate));
    }
  }

  async function createTask() {
    if (missing.length || dueError) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      const data = await fetchJson<{ id?: string; number?: number }>("/api/schedule/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: title.trim(),
          typeId: typeId || undefined,
          priority,
          startDate,
          dueDate: dueDate || undefined,
          durationDays: dueDate ? undefined : duration.trim() ? Number(duration) : undefined,
          predecessorId: predecessorId && predecessorId !== NO_PREDECESSOR_VALUE ? predecessorId : undefined,
          boqLineItemId: boqLineItemId || undefined,
        }),
      });
      toast.success("Task created");
      // D-47: land on the object in display mode with a receipt, rather than
      // bouncing to an empty form. The number comes from the row the server
      // wrote, so the message cannot name an activity that was not created.
      const created = data?.number ? `?created=${encodeURIComponent(String(data.number))}` : "";
      router.push(`/schedule/tasks/${data.id}${created}`);
    } catch (err) {
      setSaveError(errorMessage(err, "Couldn't create this activity"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Schedule / New Task"
      title="New Task"
      mode="create"
      hasDraft={false}
      onSave={createTask}
      onCancel={() => router.push(`/schedule?projectId=${projectId}`)}
      onBack={() => router.push(`/schedule?projectId=${projectId}`)}
      saveDisabled={submitting || missing.length > 0 || !!dueError}
      // ObjectScreen renders "Save (<reason>)" itself; src/lib/schedule-activity.ts
      // owns the whole progression and is asserted there.
      saveDisabledReason={activitySaveReason(missing, { submitting, blocked: dueError })}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <FormField label="Title" required error={touched.title && !title.trim() ? "Title is required" : undefined}>
          {(f) => (
            <Input
              {...f}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              placeholder="e.g. Pour foundation slab"
            />
          )}
        </FormField>

        <div className="grid grid-cols-2 gap-2">
          <FormField label="Type" error={types.error ?? undefined}>
            {(f) =>
              types.loading ? (
                // A loading state is never an option in a list: the trigger is
                // disabled and shows a skeleton bar instead of the word
                // "Loading…" sitting where a real type would be.
                <div
                  {...f}
                  aria-busy="true"
                  data-testid="type-loading"
                  className="flex h-9 w-full items-center rounded-md border border-px-border px-3 opacity-60"
                >
                  <Skeleton className="h-4 w-24" />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={typeId} onValueChange={setTypeId}>
                    <SelectTrigger {...f} className="min-w-40 flex-1">
                      <SelectValue placeholder={types.rows.length ? "Select a type" : "No types configured"} />
                    </SelectTrigger>
                    <SelectContent>
                      {types.rows.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {types.error && (
                    <Button type="button" variant="outline" size="sm" onClick={() => void loadTypes()}>Retry</Button>
                  )}
                </div>
              )
            }
          </FormField>
          <FormField label="Priority">
            {(f) => (
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger {...f} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </FormField>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <FormField
            label="Start Date"
            required
            error={touched.start && !startDate ? "Start date is required" : undefined}
          >
            {(f) => (
              <Input
                {...f}
                type="date"
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, start: true }))}
              />
            )}
          </FormField>
          <FormField
            label="Duration (days)"
            hint={isMilestone ? "A milestone has no duration" : "Or set the finish date — each derives the other"}
          >
            {(f) => (
              <Input
                {...f}
                type="number"
                min={0}
                step={1}
                value={duration}
                disabled={isMilestone}
                title={isMilestone ? "A milestone has no duration" : undefined}
                onChange={(e) => onDurationChange(e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Due Date"
            error={touched.due ? dueError : undefined}
            hint={isMilestone ? "Follows the start date" : undefined}
          >
            {(f) => (
              <Input
                {...f}
                type="date"
                value={dueDate}
                disabled={isMilestone}
                title={isMilestone ? "A milestone finishes on the day it starts" : undefined}
                onChange={(e) => onDueDateChange(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, due: true }))}
              />
            )}
          </FormField>
        </div>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="size-4"
            checked={isMilestone}
            onChange={(e) => onMilestoneChange(e.target.checked)}
          />
          <span>Milestone (finish is the same day as start)</span>
        </label>

        <FormField label="Predecessor (optional)" error={predecessors.error ?? undefined} hint="The activity this one follows">
          {(f) => (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={predecessorId} onValueChange={setPredecessorId}>
                <SelectTrigger {...f} className="min-w-64 flex-1" disabled={predecessors.loading || predecessors.rows.length === 0}>
                  <SelectValue
                    placeholder={
                      predecessors.loading
                        ? "Loading activities…"
                        : predecessors.error
                          ? "Activities did not load"
                          : predecessors.rows.length === 0
                            ? "This is the first activity on the project"
                            : "Select an activity"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PREDECESSOR_VALUE}>No predecessor</SelectItem>
                  {predecessors.rows.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.number ? `#${t.number} ` : ""}{t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {predecessors.error && (
                <Button type="button" variant="outline" size="sm" onClick={() => void loadPredecessors()}>Retry</Button>
              )}
            </div>
          )}
        </FormField>

        <FormField label="BOQ item (optional)" error={boqLines.error ?? undefined} hint="The scope line this activity delivers">
          {(f) => (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={boqLineItemId} onValueChange={setBoqLineItemId}>
                <SelectTrigger {...f} className="min-w-64 flex-1" disabled={boqLines.loading || boqLines.rows.length === 0}>
                  <SelectValue
                    placeholder={
                      boqLines.loading
                        ? "Loading BOQ lines…"
                        : boqLines.error
                          ? "BOQ lines did not load"
                          : boqLines.rows.length === 0
                            ? "No BOQ lines on this project yet"
                            : "Select a BOQ line"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {boqLines.rows.map((line) => (
                    <SelectItem key={line.id} value={line.id}>
                      {[line.itemCode, line.description].filter(Boolean).join(" — ") || line.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {boqLines.error && (
                <Button type="button" variant="outline" size="sm" onClick={() => void loadBoqLines()}>Retry</Button>
              )}
            </div>
          )}
        </FormField>

        {saveError && <p role="alert" className="text-[13px] text-px-error">{saveError}</p>}
      </div>
    </ObjectScreen>
  );
}
