"use client";

// R67 MERGE (lane D0 x lane F2). Lane F2's item F-19 (audit R-245) asked that
// a create form's lookup say which of its three states it is in, and that a
// FAILED lookup never look like "this org has none". Lane D0 rebuilt this
// screen onto the shared CreateScreen + useSubmit archetype (D-72 / D-67) and
// implements exactly that rule -- the lookup's failure reaches the form as a
// banner with Retry and as the primary's own disabled reason, and the empty
// placeholder is reachable only from a successful read. Under decision D-11
// the version on main is canonical, and F2's separate useLookup()/
// LookupFieldError pair is not folded in beside it: that would leave two
// mechanisms for one rule on one screen. F2's helpers stay in the repo for the
// create forms that still use them.

// Real-screen conversion (2026-08-30) -- replaces ScheduleTimesheetClient.tsx's
// old "Log Time" Dialog popup with a real create screen. A separate screen
// from the Task Object Page's own inline "Log Time" action (ScheduleTaskObjectClient.tsx)
// because this one's real job is picking WHICH task to log against, when
// the user hasn't navigated to a specific task first.
//
// R67 D-46: THE FIRST DEFECT. The task fetch was swallowed --
// `.catch(() => { /* task dropdown is a convenience */ })` -- so when the
// activities read failed the dropdown was simply empty, Save stayed disabled,
// and its reason read "Task, hours, and date are required": the form blamed
// the user for a backend failure and gave them no way to fix it, because
// there was no task to pick. That fix is kept, on the archetype's own
// banner + extraMissing rather than on a hand-rolled paragraph.
//
// R67 D-72 / D-67: THE SECOND. This was the last construction create screen
// still on the kit's ObjectScreen in mode="create", and the only one where
// BOTH outcomes of a save were a toast:
//
//     if (!issueId || !hours || !spentOn) { toast.error(...); return; }
//     ...
//     toast.success("Time logged");
//     ...
//     catch { toast.error(err.message) }
//
// so a refused POST left a form that looked exactly as it had before the
// click, with the reason already fading; the guard on the first line meant a
// click could produce no request at all and no lasting evidence either way;
// and there was no ceiling on the request, so a hung upstream left "Logging…"
// on the button indefinitely. All three are the shared submit's job now.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { ApiError, fetchJson } from "@/lib/fetch-json";
import { useSubmit } from "@/lib/use-submit";
import type { CreateField } from "@/lib/create-screen";
import { getLastChoice, setLastChoice } from "@/lib/last-choice";
import { writeStoredProjectId } from "@/lib/project-preference";
import { focusRailProjectSwitcher } from "@/lib/rail-focus";
import {
  OTHER_CATEGORY_LABEL,
  OTHER_CATEGORY_VALUE,
  loadCategoryNames,
  mergeCategoryNames,
  resolveCategoryValue,
} from "@/lib/time-categories";
import { HOURS_MAX, HOURS_STEP, hoursError } from "@/lib/time-entry";

type Task = { id: string; number: number; title: string };

/** D-80: this picker's memory is scoped per user, per project, per picker. */
const TASK_PICKER = "task";

// R67 D-50: the task select's four honest states, in the screen's own words.
// Exported because they are the acceptance -- a test that re-typed them could
// pass while the screen said something else.
export const TASKS_LOADING_LABEL = "Loading tasks…";
export const TASKS_FAILED_LABEL = "Couldn't load this project's tasks";
export const TASKS_EMPTY_LABEL = "This project has no tasks yet";

/** The rail-disagreement line D-51 quotes. The project's own name may contain a hyphen, so the separator is the em-dash. */
export function projectLine(projectName: string): string {
  return `Project: ${projectName} — change in the top bar`;
}

export const RAIL_NOT_ON_SCREEN = "The project switcher is not on screen — scroll to the top bar";

export default function ScheduleLogTimeClient({
  projectId,
  projectName,
}: {
  projectId: string;
  /** R67 D-51: the form has to SAY which project it is logging against. */
  projectName?: string | null;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [categories, setCategories] = useState<string[]>(mergeCategoryNames([]));
  const [rememberedTask, setRememberedTask] = useState<string | null>(null);
  // R67 D-51 + F-19: the page passes the name when it already had it for free.
  // On the fast path it deliberately made no call, so the name is resolved here
  // instead -- after first paint, costing the form nothing.
  const [resolvedName, setResolvedName] = useState<string | null>(projectName ?? null);
  const [railNote, setRailNote] = useState<string | null>(null);

  useEffect(() => {
    if (projectName) {
      setResolvedName(projectName);
      return;
    }
    let live = true;
    void fetchJson<{ projects?: { id: string; name: string }[] }>("/api/projects")
      .then((d) => {
        if (!live) return;
        setResolvedName((d.projects ?? []).find((p) => p.id === projectId)?.name ?? null);
      })
      .catch(() => {
        // A name we could not look up is not worth an error region: the line
        // below degrades to "this project", which is still true.
        if (live) setResolvedName(null);
      });
    return () => {
      live = false;
    };
  }, [projectId, projectName]);
  const [values, setValues] = useState<Record<string, string>>({
    spentOn: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    setRememberedTask(getLastChoice(TASK_PICKER, projectId));
  }, [projectId]);

  // R67 D-51: the rail is told which project this form resolved, so the chip
  // above the form and the form itself cannot disagree while it is being
  // filled in. The shell subscribes to this write.
  useEffect(() => {
    writeStoredProjectId(projectId);
  }, [projectId]);

  // R67 D-51: the project's own construction categories, unioned with the
  // customer's BOQ vocabulary so a project with no categories yet is not a
  // dead end. A failed lookup degrades to the seeded list rather than to an
  // empty required select.
  useEffect(() => {
    let live = true;
    void loadCategoryNames(projectId).then((names) => {
      if (live) setCategories(names);
    });
    return () => {
      live = false;
    };
  }, [projectId]);

  const loadTasks = useCallback(async () => {
    setTasksError(null);
    setTasksLoading(true);
    try {
      const data = await fetchJson<{ tasks?: Task[] }>(
        `/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`
      );
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch (err) {
      setTasks([]);
      setTasksError({
        status: err instanceof ApiError ? err.status : null,
        message: err instanceof Error && err.message ? err.message : null,
      });
    } finally {
      setTasksLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const timesheetHref = `/schedule?projectId=${encodeURIComponent(projectId)}&tab=timesheet`;

  const categoryIsOther = values.category === OTHER_CATEGORY_VALUE;

  const fields: CreateField[] = [
    {
      name: "issueId",
      label: "Task",
      // R67 D-80: typing filters the activity list, a one-task project is
      // preselected, and the last task logged on this project is offered back.
      kind: "combobox",
      required: true,
      loading: tasksLoading,
      // Nothing to choose: a live control over an empty list invites the user
      // to try, and then says nothing when they do.
      disabled: Boolean(tasksError) || (!tasksLoading && tasks.length === 0),
      // R67 D-50: the three required fields validated only on submit, via a
      // toast reading "Task, hours, and date are required". Each now says which
      // question was not answered, at the field, when the user leaves it.
      validate: (value) => (value ? null : "Choose the task these hours were spent on"),
      placeholder: tasksError
        ? TASKS_FAILED_LABEL
        : tasksLoading
          ? TASKS_LOADING_LABEL
          : tasks.length === 0
            ? TASKS_EMPTY_LABEL
            : "Type an activity number or name",
      options: tasks.map((t) => ({ value: t.id, label: `#${t.number} ${t.title}`, hint: undefined })),
      storedValue: rememberedTask,
      wide: true,
      // R67 D-50: four states, each with its own words, and never silence. The
      // fetch used to end in `.catch(() => { /* convenience */ })`, so a 504
      // left an empty dropdown under a required label with nothing said -- and
      // the user could not tell "this project has no tasks" from "the request
      // failed".
      help: tasksLoading ? (
        TASKS_LOADING_LABEL
      ) : tasksError ? (
        <>
          {TASKS_FAILED_LABEL}
          {tasksError.message ? `: ${tasksError.message}` : ""}{" "}
          <button
            type="button"
            onClick={() => void loadTasks()}
            className="font-medium underline underline-offset-2"
          >
            Retry
          </button>
        </>
      ) : tasks.length === 0 ? (
        <>
          {TASKS_EMPTY_LABEL}{" "}
          <button
            type="button"
            onClick={() => router.push(`/schedule/tasks/new?projectId=${encodeURIComponent(projectId)}`)}
            className="font-medium underline underline-offset-2"
          >
            Create one
          </button>
        </>
      ) : undefined,
    },
    {
      name: "hours",
      label: "Hours",
      kind: "number",
      required: true,
      placeholder: "e.g. 7.5",
      // R67 D-50: more than a day, zero, and a stray 7.37 are all refused at
      // the field, in the field's own words, on blur.
      validate: (value) => hoursError(value),
    },
    { name: "spentOn", label: "Date", kind: "date", required: true },
    {
      // R67 D-51: was a free-text "Activity Type (optional)" whose placeholder
      // read "e.g. Development, Site Visit" -- a software team's vocabulary on
      // a site product, optional and free text, so the byCategory breakdown
      // grouped on two or three spellings per person and produced no usable
      // subtotal.
      name: "category",
      label: "Category",
      kind: "select",
      required: true,
      placeholder: "Pick a category",
      options: [
        ...categories.map((name) => ({ value: name, label: name })),
        { value: OTHER_CATEGORY_VALUE, label: OTHER_CATEGORY_LABEL },
      ],
    },
    ...(categoryIsOther
      ? [
          {
            // What was typed is what is stored -- never the sentinel.
            name: "categoryOther",
            label: "Category (specify)",
            kind: "text" as const,
            required: true,
            placeholder: "e.g. Snagging",
          },
        ]
      : []),
    { name: "comments", label: "Comments", kind: "text", wide: true },
  ];

  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Time entry",
    buildRequest: () => ({
      input: "/api/timesheets",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId: values.issueId,
          hours: values.hours,
          spentOn: values.spentOn,
          // D-51: the chosen category persists into the existing activityType
          // column -- see src/lib/time-categories.ts for why, and for what
          // changes when the backend gains a real category column.
          activityType: resolveCategoryValue(values.category, values.categoryOther) || undefined,
          comments: values.comments || undefined,
        }),
      },
    }),
    // A time entry has no object page -- it is a line in the timesheet -- so
    // the destination is the tab it just joined. R67 D-50: the new row is
    // named in the URL so the timesheet can highlight it and build its receipt
    // from the row the SERVER stored.
    onSuccess: (data: { id?: unknown } | undefined) => {
      setLastChoice(TASK_PICKER, projectId, values.issueId);
      const id = typeof data?.id === "string" ? data.id : "";
      router.replace(id ? `${timesheetHref}&highlight=${encodeURIComponent(id)}` : timesheetHref);
    },
  });

  return (
    <CreateScreen
      module="Schedule"
      moduleHref={timesheetHref}
      objectLabel="Time entry"
      title="Log Time"
      fields={fields}
      values={values}
      onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      // A task that cannot be chosen is not the user's omission. The reason
      // names the real blocker rather than the field it makes unfillable.
      extraMissing={tasksError ? ["this project's activities could not be loaded"] : []}
      banner={
        <>
          {/* R67 D-51: the form never said which project it was logging
              against, while the top rail could be showing something else
              entirely. */}
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-px-muted">
            <span className="text-ct-navy" data-testid="log-time-project">
              {projectLine(resolvedName ?? "this project")}
            </span>
            <button
              type="button"
              // R67 D-51: the rail is where the choice is made, so that is where
              // the user is sent -- and when the rail is not on screen the
              // control says so instead of appearing to do nothing.
              onClick={() => setRailNote(focusRailProjectSwitcher() ? null : RAIL_NOT_ON_SCREEN)}
              className="font-medium underline underline-offset-2"
            >
              Change project
            </button>
            {railNote && <span className="text-px-muted">{railNote}</span>}
          </p>
          {/* R67 D-50 merge: the task failure is reported ONCE, on the field
              itself, with the Retry beside it -- see the `help` above. A
              PaneErrorCard here as well would put two Retry buttons on screen
              for one failure, which is the duplicate-control fault the audit
              records elsewhere. The Save label still names the real blocker
              through extraMissing, so the primary never blames the user for a
              backend failure. */}
        </>
      }
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
      onCancel={() => router.push(timesheetHref)}
    />
  );
}
