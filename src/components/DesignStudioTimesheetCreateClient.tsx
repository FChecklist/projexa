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
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import {
  DESIGN_STUDIO_CATEGORIES,
  requiredReason,
  savedMessage,
  todayIso,
  validateHours,
} from "@/lib/design-studio-timesheet";

type Task = { id: string; number: number; title: string };

export default function DesignStudioTimesheetCreateClient({
  projectId,
  projectName,
  preselectedTaskId,
}: {
  projectId: string;
  projectName: string;
  preselectedTaskId?: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState(preselectedTaskId ?? "");
  const [hours, setHours] = useState("");
  const [spentOn, setSpentOn] = useState(() => todayIso());
  const [category, setCategory] = useState<string>(DESIGN_STUDIO_CATEGORIES[0]);
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ level: "error" | "success" | "info"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ tasks?: Task[] }>(`/api/schedule/tasks?projectId=${encodeURIComponent(projectId)}`)
      .then((data) => { if (!cancelled) setTasks(data.tasks ?? []); })
      .catch((err) => { if (!cancelled) setMessage({ level: "error", text: err instanceof Error ? err.message : "Could not load this project's tasks" }); });
    return () => { cancelled = true; };
  }, [projectId]);

  const missing: string[] = [];
  if (!taskId) missing.push("Task");
  if (validateHours(hours)) missing.push("Hours");

  const backHref = `/design-studio?projectId=${encodeURIComponent(projectId)}`;

  async function save() {
    if (missing.length > 0) return;
    setSubmitting(true);
    try {
      const saved = await fetchJson<{ id: string; ref?: string }>("/api/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: taskId, hours, spentOn, activityType: category, comments: comments || undefined }),
      });
      // The receipt travels WITH the navigation, so the object page can show
      // it in its own footer message area -- the create screen is gone by
      // then, and a toast that outlives the screen it belongs to is exactly
      // the "did that save?" problem this replaces.
      const ref = saved.ref ?? saved.id;
      router.push(`/design-studio/timesheets/${encodeURIComponent(saved.id)}?projectId=${encodeURIComponent(projectId)}&saved=${encodeURIComponent(savedMessage(ref))}`);
    } catch (err) {
      setMessage({ level: "error", text: err instanceof Error ? err.message : "The entry was not saved" });
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb={`Design Studio / ${projectName} / New Timesheet Entry`}
      title="New Timesheet Entry"
      mode="create"
      hasDraft={false}
      onSave={save}
      onCancel={() => router.push(backHref)}
      onBack={() => router.push(backHref)}
      saveDisabled={submitting || missing.length > 0}
      // ObjectScreen renders "Save (<reason>)" itself, so the reason alone
      // is what makes the primary read "Save (2 required: Task, Hours)".
      saveDisabledReason={submitting ? "Saving..." : requiredReason(missing)}
      messages={message ? [{ level: message.level, text: message.text }] : []}
    >
      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="new-entry-task">Task</Label>
          <Select value={taskId} onValueChange={setTaskId}>
            <SelectTrigger id="new-entry-task" className="w-full"><SelectValue placeholder="Select a task" /></SelectTrigger>
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
