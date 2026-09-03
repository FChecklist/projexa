"use client";

// Real-screen conversion (2026-08-30) -- replaces ScheduleTimesheetClient.tsx's
// old "Log Time" Dialog popup with a real create screen. A separate screen
// from the Task Object Page's own inline "Log Time" action (ScheduleTaskObjectClient.tsx)
// because this one's real job is picking WHICH task to log against, when
// the user hasn't navigated to a specific task first.
//
// ─── R67 D-51 (audit R-145 / R-149) ─────────────────────────────────────────
// Two defects:
//
//   * "Activity Type (optional)" was a free-text box whose placeholder read
//     "e.g. Development, Site Visit" -- a software team's vocabulary on a site
//     product, optional, and free text, so designerTimesheetReport's byCategory
//     breakdown grouped on two or three spellings per person and produced no
//     usable subtotal. It is now a REQUIRED "Category *" select over the
//     project's own construction categories (unioned with the customer's BOQ
//     vocabulary so a project with no categories yet is not a dead end), plus
//     "Other (specify)" which reveals a text field. The chosen value is still
//     persisted into the existing activityType column -- see
//     src/lib/time-categories.ts for why, and for what changes when the backend
//     gains a real category column.
//   * The form never said which project it was logging against, while the top
//     rail could be showing something else entirely. It now prints the resolved
//     project above Task, offers a "Change project" link that focuses the rail's
//     own switcher, and writes the resolved project INTO the rail so the two
//     cannot disagree while the form is being filled in.
//
// ─── R67 D-50 (audit R-142 / R-143 / R-151) ─────────────────────────────────
// Three more:
//
//   * The task fetch ended in `.catch(() => { /* task dropdown is a
//     convenience */ })`. It is not a convenience -- it is the required field
//     this whole screen exists to fill in. A 504 left an empty dropdown under a
//     required label with nothing said, and the user could not tell "this
//     project has no tasks" from "the request failed". The select now has four
//     honest states: loading, ready, empty (with a way to create one) and error
//     (with the backend's own sentence and a Retry that re-runs the fetch).
//   * The three required fields validated only on submit, via a toast reading
//     "Task, hours, and date are required". Each now validates on blur with its
//     own message under the field, and the primary button counts and NAMES what
//     is still missing.
//   * A successful save produced a toast that had gone by the time the user
//     looked up. It now lands on the timesheet with the new row highlighted and
//     a receipt in the persistent footer message area, built from the row the
//     SERVER stored.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import EntityCombobox from "@/components/EntityCombobox";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { getLastChoice, setLastChoice } from "@/lib/last-choice";
import { writeRailProject } from "@/lib/rail-project";
import { focusRailProjectSwitcher } from "@/lib/rail-focus";
import {
  OTHER_CATEGORY_LABEL,
  OTHER_CATEGORY_VALUE,
  mergeCategoryNames,
  resolveCategoryValue,
} from "@/lib/time-categories";
import {
  DATE_REQUIRED_MESSAGE,
  HOURS_MAX,
  HOURS_STEP,
  TASK_REQUIRED_MESSAGE,
  hoursError,
  missingFields,
  saveReason,
} from "@/lib/time-entry";

type Task = { id: string; number: number; title: string };
type Category = { id: string; name: string };

/** The task select's four honest states. An empty list and a failed request are different facts. */
type TasksState =
  | { kind: "loading" }
  | { kind: "ready"; tasks: Task[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

// R67 D-80: the picker whose last choice this screen remembers.
const TASK_PICKER = "task";

export const TASKS_LOADING_LABEL = "Loading tasks…";
export const TASKS_FAILED_LABEL = "Couldn't load this project's tasks";
export const TASKS_EMPTY_LABEL = "This project has no tasks yet";

/** The rail-disagreement line D-51 quotes. The project's own name may contain a hyphen, so the separator is the em-dash this product's other R67 sentences use. */
export function projectLine(projectName: string): string {
  return `Project: ${projectName} — change in the top bar`;
}

export const RAIL_NOT_ON_SCREEN = "The project switcher is not on screen — scroll to the top bar";

export default function ScheduleLogTimeClient({
  projectId,
  projectName,
}: {
  projectId: string;
  /** Resolved server-side by the page, so the form can say what it is logging against. */
  projectName: string;
}) {
  const router = useRouter();
  const [tasksState, setTasksState] = useState<TasksState>({ kind: "loading" });
  const [categories, setCategories] = useState<string[]>(mergeCategoryNames([]));
  const [issueId, setIssueId] = useState("");
  const [hours, setHours] = useState("");
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("");
  const [otherCategory, setOtherCategory] = useState("");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [railNote, setRailNote] = useState<string | null>(null);
  // Blur-touched fields: a message appears once the user has LEFT a field, not
  // while they are still in the middle of typing into it.
  const [touched, setTouched] = useState<{ task?: boolean; hours?: boolean; date?: boolean }>({});
  // R67 D-80: the last task logged on THIS project, offered back on return.
  const [rememberedTask, setRememberedTask] = useState<string | null>(null);

  useEffect(() => {
    setRememberedTask(getLastChoice(TASK_PICKER, projectId));
  }, [projectId]);

  const loadTasks = useCallback(async () => {
    setTasksState({ kind: "loading" });
    try {
      const data = await fetchJson<{ tasks?: Task[] }>(
        `/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`
      );
      const rows = data.tasks ?? [];
      setTasksState(rows.length ? { kind: "ready", tasks: rows } : { kind: "empty" });
    } catch (err) {
      setTasksState({ kind: "error", message: errorMessage(err, TASKS_FAILED_LABEL) });
    }
  }, [projectId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    // The project's own categories, from the call that already returns them
    // alongside its activities. A failure degrades to the seeded list rather
    // than to an empty required select.
    fetchJson<{ categories?: Category[] }>(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`)
      .then((data) => setCategories(mergeCategoryNames((data.categories ?? []).map((c) => c.name))))
      .catch(() => setCategories(mergeCategoryNames([])));
  }, [projectId]);

  useEffect(() => {
    // Tint the rail to the project this form is actually logging against.
    writeRailProject(projectId);
  }, [projectId]);

  // "#12 Joinery shop drawings" is the label, so typing either the number or
  // any word of the title finds it.
  const taskOptions = useMemo(
    () => (tasksState.kind === "ready" ? tasksState.tasks.map((t) => ({ value: t.id, label: `#${t.number} ${t.title}` })) : []),
    [tasksState]
  );

  const resolvedCategory = resolveCategoryValue(category, otherCategory);
  const missing = missingFields({ issueId, hours, spentOn, category: resolvedCategory });
  const hoursMessage = hoursError(hours);

  async function logTime() {
    if (missing.length || hoursMessage) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      const entry = await fetchJson<{ id?: string }>("/api/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId,
          hours,
          spentOn,
          // Persisted into activityType until the backend gains a real category
          // column; see src/lib/time-categories.ts.
          activityType: resolvedCategory,
          comments: comments || undefined,
        }),
      });
      // Remembered only after a 201 -- a refused write is not a habit.
      setLastChoice(TASK_PICKER, projectId, issueId);
      toast.success("Time logged");
      // D-50: land on the new entry. Until C04-18 ships the entry's own route,
      // that is the timesheet with this row highlighted -- and the receipt is
      // built there from the row the SERVER stored, never from this form's
      // state, so it can never report something that was not written.
      const highlight = entry?.id ? `&highlight=${encodeURIComponent(entry.id)}` : "";
      router.push(`/schedule?projectId=${projectId}&tab=timesheet${highlight}`);
    } catch (err) {
      setSaveError(errorMessage(err, "Couldn't log time"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Schedule / Log Time"
      title="Log Time"
      mode="create"
      hasDraft={false}
      onSave={logTime}
      onCancel={() => router.push(`/schedule?projectId=${projectId}&tab=timesheet`)}
      onBack={() => router.push(`/schedule?projectId=${projectId}&tab=timesheet`)}
      saveDisabled={submitting || missing.length > 0 || !!hoursMessage}
      // ObjectScreen renders "Save (<reason>)" itself, so this is the bracket
      // contents only; src/lib/time-entry.ts owns both halves of the rule.
      saveDisabledReason={saveReason(missing, { submitting, blocked: hoursMessage })}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {/* D-51: the form names its project, and offers the one control that
            changes it, instead of leaving the user to compare the rail with the
            rows they are about to write. */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-px-border bg-px-cloud/40 px-3 py-2 text-[13px]">
          <span className="text-ct-navy" data-testid="log-time-project">
            {projectLine(projectName)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRailNote(focusRailProjectSwitcher() ? null : RAIL_NOT_ON_SCREEN)}
          >
            Change project
          </Button>
          {railNote && <span className="text-px-muted">{railNote}</span>}
        </div>

        {/* D-50: four honest states, never a silent empty list under a
            required field. */}
        <FormField
          label="Task"
          required
          error={
            tasksState.kind === "error"
              ? tasksState.message
              : touched.task && !issueId
                ? TASK_REQUIRED_MESSAGE
                : undefined
          }
        >
          {(f) => (
            <div className="flex flex-wrap items-center gap-2">
              {/* R67 D-80: a combobox, not a Select. D-50's four honest states
                  are unchanged -- they now drive the field's own placeholder and
                  its disabled state -- and on top of them the picker preselects
                  a list of one, offers back the last task logged on this
                  project, and takes the highlighted match on Enter. */}
              <div className="min-w-64 flex-1">
                <EntityCombobox
                  id={f.id}
                  aria-label="Task"
                  options={taskOptions}
                  value={issueId}
                  onChange={setIssueId}
                  loading={tasksState.kind === "loading"}
                  disabled={tasksState.kind !== "ready"}
                  storedValue={rememberedTask}
                  onBlur={() => setTouched((t) => ({ ...t, task: true }))}
                  placeholder="Type a task number or title"
                  emptyMessage="No task matches"
                />
              </div>
              {/* D-50's four states as VISIBLE TEXT, not as a placeholder
                  attribute. A placeholder disappears the moment anything is
                  typed and is not read out by every screen reader, and these
                  three sentences are the difference between "the list is empty"
                  and "we could not ask". */}
              {tasksState.kind === "loading" && (
                <span className="text-[13px] text-px-muted">{TASKS_LOADING_LABEL}</span>
              )}
              {tasksState.kind === "empty" && (
                <span className="text-[13px] text-px-muted">{TASKS_EMPTY_LABEL}</span>
              )}
              {tasksState.kind === "error" && (
                <Button type="button" variant="outline" size="sm" onClick={() => void loadTasks()}>
                  Retry
                </Button>
              )}
              {tasksState.kind === "empty" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/schedule/tasks/new?projectId=${encodeURIComponent(projectId)}`)}
                >
                  Create one
                </Button>
              )}
            </div>
          )}
        </FormField>

        <div className="grid grid-cols-2 gap-2">
          <FormField label="Hours (e.g. 7.5)" required error={touched.hours ? hoursMessage : undefined}>
            {(f) => (
              <Input
                {...f}
                type="number"
                min="0"
                max={HOURS_MAX}
                step={HOURS_STEP}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, hours: true }))}
              />
            )}
          </FormField>
          <FormField label="Date" required error={touched.date && !spentOn ? DATE_REQUIRED_MESSAGE : undefined}>
            {(f) => (
              <Input
                {...f}
                type="date"
                value={spentOn}
                onChange={(e) => setSpentOn(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, date: true }))}
              />
            )}
          </FormField>
        </div>

        <FormField label="Category" required>
          {(f) => (
            <Select value={category} onValueChange={(next) => { setCategory(next); if (next !== OTHER_CATEGORY_VALUE) setOtherCategory(""); }}>
              <SelectTrigger {...f} className="w-full"><SelectValue placeholder="Select a category" /></SelectTrigger>
              <SelectContent>
                {categories.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
                <SelectItem value={OTHER_CATEGORY_VALUE}>{OTHER_CATEGORY_LABEL}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>
        {category === OTHER_CATEGORY_VALUE && (
          <FormField label="Category name" required hint="What this time was spent on, in your own words">
            {(f) => <Input {...f} value={otherCategory} onChange={(e) => setOtherCategory(e.target.value)} />}
          </FormField>
        )}

        <div className="space-y-1.5"><Label>Comments (optional)</Label><Input value={comments} onChange={(e) => setComments(e.target.value)} /></div>

        {saveError && <p role="alert" className="text-[13px] text-px-error">{saveError}</p>}
      </div>
    </ObjectScreen>
  );
}
