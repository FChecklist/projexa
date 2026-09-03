"use client";

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
import { PaneErrorCard } from "@/components/PaneState";
import { ApiError, fetchJson } from "@/lib/fetch-json";
import { useSubmit } from "@/lib/use-submit";
import type { CreateField } from "@/lib/create-screen";

type Task = { id: string; number: number; title: string };

export default function ScheduleLogTimeClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksError, setTasksError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({
    spentOn: new Date().toISOString().slice(0, 10),
  });

  const loadTasks = useCallback(async () => {
    setTasksError(null);
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
    }
  }, [projectId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const timesheetHref = `/schedule?projectId=${encodeURIComponent(projectId)}&tab=timesheet`;

  const fields: CreateField[] = [
    {
      name: "issueId",
      label: "Task",
      kind: "select",
      required: true,
      placeholder: tasksError ? "Could not be loaded" : "Select a task",
      options: tasks.map((t) => ({ value: t.id, label: `#${t.number} ${t.title}` })),
      wide: true,
    },
    { name: "hours", label: "Hours", kind: "number", required: true, placeholder: "e.g. 2" },
    { name: "spentOn", label: "Date", kind: "date", required: true },
    { name: "activityType", label: "Activity Type", kind: "text", placeholder: "e.g. Development, Site Visit" },
    { name: "comments", label: "Comments", kind: "text", wide: true },
  ];

  const submit = useSubmit({
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
          activityType: values.activityType || undefined,
          comments: values.comments || undefined,
        }),
      },
    }),
    // A time entry has no object page -- it is a line in the timesheet -- so
    // the destination is the tab it just joined.
    onSuccess: () => router.replace(timesheetHref),
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
        tasksError ? (
          <PaneErrorCard entity="this project's activities" error={tasksError} onRetry={() => void loadTasks()} />
        ) : undefined
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
