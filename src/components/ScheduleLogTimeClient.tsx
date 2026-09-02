"use client";

// Real-screen conversion (2026-08-30) -- replaces ScheduleTimesheetClient.tsx's
// old "Log Time" Dialog popup with a real create screen. A separate screen
// from the Task Object Page's own inline "Log Time" action (ScheduleTaskObjectClient.tsx)
// because this one's real job is picking WHICH task to log against, when
// the user hasn't navigated to a specific task first.
//
// R67 F-09 (R-122), D-04: the project's task list is resolved in this screen's
// server component and handed in as `tasks`, so the Task select is populated
// on the FIRST render. It used to be fetched after hydration -- an empty
// dropdown on the one field the whole screen exists to pick.
//
// R67 F-11 (R-146). Two further changes:
//
//  1. THE SELECT HAS A CLIENT FALLBACK. resolveScheduleTasks() never throws --
//     a failed lookup returns an empty list -- so a backend blip used to render
//     "No tasks on this project yet" on a project full of tasks. The server now
//     says which of the two it was, and when the lookup FAILED this reads the
//     project's task list out of the shared schedule session cache (warmed by
//     the Board, and by hovering "+ Log Time") before deciding what to say.
//  2. SAVE IS ACKNOWLEDGED IMMEDIATELY. The entry is appended to this project's
//     cached timesheet as a pending row and the user is taken to the Timesheet
//     tab at once, instead of watching a disabled button until the POST comes
//     back. When it lands the row is replaced by the server's own answer; when
//     it fails the row is removed and the failure is shown in the backend's own
//     words. An optimistic write that cannot be undone would be a lie -- this
//     one is undone.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  appendPendingTimeEntry,
  peekSchedule,
  reconcileTimesheets,
  removePendingTimeEntry,
  type ScheduleTaskRef,
  type TimesheetEntry,
} from "@/lib/schedule-cache";
import type { ScheduleTask } from "@/lib/schedule-reference";

export default function ScheduleLogTimeClient({
  projectId,
  tasks = [],
  tasksUnavailable = false,
}: {
  projectId: string;
  tasks?: ScheduleTask[];
  tasksUnavailable?: boolean;
}) {
  const router = useRouter();
  const [issueId, setIssueId] = useState("");
  const [hours, setHours] = useState("");
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [activityType, setActivityType] = useState("");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fallbackTasks, setFallbackTasks] = useState<ScheduleTask[]>([]);

  // Only ever consulted when the server-side lookup failed -- never to second-
  // guess a successful empty list, which is a real answer.
  useEffect(() => {
    if (!tasksUnavailable) return;
    const cached = peekSchedule<{ tasks?: ScheduleTaskRef[] }>("tasks", projectId);
    if (cached?.tasks?.length) setFallbackTasks(cached.tasks);
  }, [tasksUnavailable, projectId]);

  const options: ScheduleTask[] = tasks.length > 0 ? tasks : fallbackTasks;
  const listFailed = tasksUnavailable && options.length === 0;

  function logTime() {
    if (!issueId || !hours || !spentOn) {
      toast.error("Task, hours, and date are required");
      return;
    }
    setSubmitting(true);

    const chosen = options.find((t) => t.id === issueId) ?? null;
    const pending: TimesheetEntry = {
      // Prefixed so it can never collide with a real pms_time_entries id, and
      // so a stray pending row is identifiable in the cache.
      id: `pending:${projectId}:${Date.now()}`,
      issueId,
      hours,
      spentOn,
      activityType: activityType || null,
      comments: comments || null,
      issue: chosen ? { id: chosen.id, number: chosen.number, title: chosen.title } : null,
      pending: true,
    };
    appendPendingTimeEntry(projectId, pending);
    router.push(`/schedule?projectId=${projectId}&tab=timesheet`);

    void (async () => {
      try {
        const res = await fetch("/api/timesheets", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueId, hours, spentOn, activityType: activityType || undefined, comments: comments || undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Failed to log time");
        // Re-reads the timesheet the user is now looking at (that is what
        // replaces the pending row with the stored one) and drops the rest of
        // this project's schedule cache.
        await reconcileTimesheets(projectId);
        toast.success("Time logged");
      } catch (err) {
        removePendingTimeEntry(projectId, pending.id);
        toast.error(err instanceof Error ? err.message : "Couldn't log time");
      }
    })();
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
      saveDisabled={submitting || !issueId || !hours || !spentOn}
      saveDisabledReason={submitting ? "Logging…" : !issueId || !hours || !spentOn ? "Task, hours, and date are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Task</Label>
          <Select value={issueId} onValueChange={setIssueId}>
            {/* The list is resolved server-side, so an empty one after a
                SUCCESSFUL lookup means this project genuinely has no tasks yet.
                A FAILED lookup is a different fact and says so -- it used to
                render as "No tasks on this project yet" on a project full of
                them. */}
            <SelectTrigger className="w-full" disabled={options.length === 0}>
              <SelectValue
                placeholder={
                  options.length
                    ? "Select a task"
                    : listFailed
                      ? "Couldn't load this project's tasks"
                      : "No tasks on this project yet"
                }
              />
            </SelectTrigger>
            <SelectContent>{options.map((t) => <SelectItem key={t.id} value={t.id}>#{t.number} {t.title}</SelectItem>)}</SelectContent>
          </Select>
          {listFailed ? (
            <p role="status" className="text-[12.5px] text-px-muted">
              Couldn&apos;t load this project&apos;s tasks. Reload the page to try again.
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Hours</Label><Input type="number" min="0" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>Activity Type (optional)</Label><Input value={activityType} onChange={(e) => setActivityType(e.target.value)} placeholder="e.g. Development, Site Visit" /></div>
        <div className="space-y-1.5"><Label>Comments (optional)</Label><Input value={comments} onChange={(e) => setComments(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
