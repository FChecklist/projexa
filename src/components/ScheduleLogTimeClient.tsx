"use client";

// Real-screen conversion (2026-08-30) -- replaces ScheduleTimesheetClient.tsx's
// old "Log Time" Dialog popup with a real create screen. A separate screen
// from the Task Object Page's own inline "Log Time" action (ScheduleTaskObjectClient.tsx)
// because this one's real job is picking WHICH task to log against, when
// the user hasn't navigated to a specific task first.
//
// R67 F-19 (R-245): the task lookup is REQUIRED -- there is nothing to log
// time against without it -- so its failure is reported twice: beside the
// field ("Couldn't load tasks — Retry") and inside the primary button
// ("Save (Task list failed to load)"), rather than leaving the user with an
// empty dropdown and a Save that can never succeed.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requiredLookupFailure, useLookup } from "@/lib/use-lookup";
import { LookupFieldError } from "@/components/LookupFieldError";

type Task = { id: string; number: number; title: string };

export default function ScheduleLogTimeClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const taskLookup = useLookup<Task>({
    url: `/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`,
    pick: (d) => d.tasks as Task[] | undefined,
    label: "tasks",
  });
  const [issueId, setIssueId] = useState("");
  const [hours, setHours] = useState("");
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [activityType, setActivityType] = useState("");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const taskListFailure = requiredLookupFailure(taskLookup, "Task list");

  async function logTime() {
    if (!issueId || !hours || !spentOn) {
      toast.error("Task, hours, and date are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/timesheets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, hours, spentOn, activityType: activityType || undefined, comments: comments || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to log time");
      toast.success("Time logged");
      router.push(`/schedule?projectId=${projectId}&tab=timesheet`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log time");
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
      saveDisabled={submitting || !issueId || !hours || !spentOn || taskListFailure !== null}
      saveDisabledReason={
        submitting
          ? "Logging…"
          : // A failed REQUIRED lookup is the more useful reason: "Task, hours
            // and date are required" would blame the user for a field they
            // cannot fill.
            (taskListFailure ??
              (!issueId || !hours || !spentOn ? "Task, hours, and date are required" : undefined))
      }
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Task</Label>
          <Select value={issueId} onValueChange={setIssueId} disabled={taskLookup.status !== "ready"}>
            <SelectTrigger className="w-full"><SelectValue placeholder={taskLookup.status === "ready" ? "Select a task" : taskLookup.placeholder} /></SelectTrigger>
            <SelectContent>{taskLookup.options.map((t) => <SelectItem key={t.id} value={t.id}>#{t.number} {t.title}</SelectItem>)}</SelectContent>
          </Select>
          <LookupFieldError lookup={taskLookup} />
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
