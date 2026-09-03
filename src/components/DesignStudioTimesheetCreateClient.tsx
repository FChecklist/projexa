"use client";

// R67 WS-H (item H-01). "New Timesheet Entry" -- the real create route the
// old /schedule/log-time screen becomes an alias for.
//
// TWO THINGS THE ITEM IS SPECIFIC ABOUT, both implemented literally:
//  1. The primary is disabled WITH THE REASON NAMED -- "Save (2 required:
//     Task, Hours)" -- which is the /labour/new pattern correction C-11
//     records as this product's good one, rather than a greyed-out button
//     that says nothing.
//  2. On 201 it lands on the OBJECT PAGE with the footer message "Timesheet
//     entry TS-000123 saved", never back on an empty form. A create screen
//     that resets itself makes the user check whether anything was saved.
//
// ── MERGE NOTE (D-11 point 4): what /schedule/log-time's client contributed ──
// Lanes D0 and F2 had just rebuilt src/components/ScheduleLogTimeClient.tsx,
// and item H-01 turns /schedule/log-time into an alias for THIS route, so that
// file is removed. Its FILE goes; none of its BEHAVIOUR does -- all three of
// the defects lane D0's commit fixed are carried over here rather than
// silently dropped:
//
//   D-46  the task fetch used to be swallowed, so a failed activities read
//         left an empty dropdown and a Save whose reason blamed the user for
//         a field they had no way to fill. It now reaches the screen as a
//         banner with Retry AND is named in the primary's own reason.
//   D-72  both outcomes of a save used to be a toast, so a refusal left a form
//         that looked untouched with the reason already fading. The save runs
//         through the shared useSubmit() hook, whose sentence for a refusal, a
//         timeout and a click-that-sent-nothing are three different, tested
//         sentences rendered in place with "Try again".
//   D-67  the request had no ceiling, so a hung upstream left the button
//         saying "Saving…" indefinitely. useSubmit() owns that deadline.
//
// What is NOT taken from that file is its "Save (Task, Hours)" label: item
// H-01 quotes "Save (2 required: Task, Hours)" for this screen, and the item's
// own words win over the generic archetype's. The archetype itself is
// untouched and its other twelve screens are unaffected.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PaneErrorCard } from "@/components/PaneState";
import { ApiError, fetchJson } from "@/lib/fetch-json";
import { useSubmit } from "@/lib/use-submit";
import {
  DESIGN_STUDIO_CATEGORIES,
  requiredReason,
  savedMessage,
  validateHours,
} from "@/lib/design-studio-timesheet";

type Task = { id: string; number: number; title: string };
type SavedEntry = { id: string; ref?: string };

export default function DesignStudioTimesheetCreateClient({
  projectId,
  projectName,
  preselectedTaskId,
  today,
}: {
  projectId: string;
  projectName: string;
  preselectedTaskId?: string;
  /** ISO yyyy-mm-dd, resolved on the server so the default date is not the visitor's clock. */
  today: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksError, setTasksError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [taskId, setTaskId] = useState(preselectedTaskId ?? "");
  const [hours, setHours] = useState("");
  const [spentOn, setSpentOn] = useState(today);
  const [category, setCategory] = useState<string>(DESIGN_STUDIO_CATEGORIES[0]);
  const [comments, setComments] = useState("");

  const loadTasks = useCallback(async () => {
    setTasksError(null);
    try {
      const data = await fetchJson<{ tasks?: Task[] }>(`/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`);
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch (err) {
      // D-46, carried over: NOT swallowed. An empty dropdown over a failed
      // read is the form blaming the user for a backend fault.
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

  const backHref = `/design-studio?projectId=${encodeURIComponent(projectId)}`;

  const missing: string[] = [];
  if (!taskId) missing.push("Task");
  if (validateHours(hours)) missing.push("Hours");
  // A task that cannot be chosen is not the user's omission -- the reason
  // names the real blocker rather than the field it makes unfillable.
  if (tasksError) missing.push("this project's tasks could not be loaded");

  const submit = useSubmit<SavedEntry>({
    objectLabel: "Timesheet entry",
    buildRequest: () =>
      missing.length > 0
        ? null
        : {
            input: "/api/timesheets",
            init: {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                issueId: taskId,
                hours,
                spentOn,
                activityType: category,
                comments: comments || undefined,
              }),
            },
          },
    // The receipt travels WITH the navigation, so the object page can show it
    // in its own footer message area -- the create screen is gone by then, and
    // a toast that outlives the screen it belongs to is exactly the "did that
    // save?" problem this replaces.
    onSuccess: (saved) => {
      const ref = saved.ref ?? saved.id;
      router.push(
        `/design-studio/timesheets/${encodeURIComponent(saved.id)}?projectId=${encodeURIComponent(projectId)}&saved=${encodeURIComponent(savedMessage(ref))}`
      );
    },
  });

  return (
    <ObjectScreen
      breadcrumb={`Design Studio / ${projectName} / New Timesheet Entry`}
      title="New Timesheet Entry"
      mode="create"
      hasDraft={false}
      onSave={submit.submit}
      onCancel={() => router.push(backHref)}
      onBack={() => router.push(backHref)}
      saveDisabled={submit.saving || submit.saved || missing.length > 0}
      // ObjectScreen renders "Save (<reason>)" itself, so the reason alone
      // is what makes the primary read "Save (2 required: Task, Hours)".
      saveDisabledReason={submit.saving ? "Saving..." : requiredReason(missing)}
      // D-72, carried over: a refusal, a timeout and a click that sent nothing
      // are three different sentences, written once in the hook and shown IN
      // PLACE with every value still on the form -- never a fading toast.
      messages={submit.failure ? [{ level: "error", text: submit.failure.message }] : []}
    >
      {tasksError && (
        <div className="px-4 pt-3">
          <PaneErrorCard entity="this project's tasks" error={tasksError} onRetry={() => void loadTasks()} />
        </div>
      )}
      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="new-entry-task">Task</Label>
          <Select value={taskId} onValueChange={setTaskId}>
            <SelectTrigger id="new-entry-task" className="w-full">
              <SelectValue placeholder={tasksError ? "Could not be loaded" : "Select a task"} />
            </SelectTrigger>
            <SelectContent>{tasks.map((t) => <SelectItem key={t.id} value={t.id}>#{t.number} {t.title}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-entry-date">Date</Label>
          <Input id="new-entry-date" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-entry-hours">Hours</Label>
          <Input id="new-entry-hours" type="number" min="0.25" max="24" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} />
          {hours.trim() !== "" && validateHours(hours) && <p className="text-[12px] text-px-error">{validateHours(hours)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-entry-category">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="new-entry-category" className="w-full"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>{DESIGN_STUDIO_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-entry-comments">Comments</Label>
          <Input id="new-entry-comments" value={comments} onChange={(e) => setComments(e.target.value)} />
        </div>
      </div>
    </ObjectScreen>
  );
}
