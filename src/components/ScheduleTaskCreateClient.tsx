"use client";

// Real-screen conversion (2026-08-30) -- replaces ScheduleBoardClient.tsx's
// old "New Task" Dialog popup with a real create screen, same fields.
//
// R67 F-09 (R-122), D-04: the task-type list is resolved in this screen's
// server component and handed in as `types`, so the Type select is populated
// on the FIRST render. It used to be fetched after hydration, which meant the
// select spent its first frames showing "Loading…" with nothing in it, and the
// default type could not be preselected until a round trip had completed.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { invalidateScheduleProject } from "@/lib/schedule-cache";
import type { IssueType } from "@/lib/schedule-reference";
import {
  SCHEDULE_TYPE_HINT,
  SCHEDULE_TYPE_PLACEHOLDER,
  scheduleTypeDisabled,
  scheduleTypesState,
} from "@/lib/schedule-type-state";

const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

// R67 G-04 (R-231): the four states, their one instruction each, and the
// rule that "Loading…" is never a value all live in
// src/lib/schedule-type-state.ts, where they are unit-tested. This file
// renders them.
//
// R67 F-09 (R-122) merged with the above: the list arrives as a PROP,
// resolved by the server component in parallel with the project, so
// "loading" is not one of the states this screen can be in -- the first
// rendered frame already knows the answer. `typesUnavailable` is what keeps
// the other three honest: without it a failed lookup would arrive as [] and
// the control would tell the org it has no task types when VERIDIAN in fact
// returned a 502.

export default function ScheduleTaskCreateClient({
  projectId,
  types = [],
  typesUnavailable = false,
}: {
  projectId: string;
  types?: IssueType[];
  typesUnavailable?: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  // The default type is resolvable synchronously now, so the select never
  // renders empty and then fills in.
  const [typeId, setTypeId] = useState(() => (types.find((t) => t.isDefault) ?? types[0])?.id ?? "");
  const typesState = scheduleTypesState({ loaded: types, failed: typesUnavailable });
  const [priority, setPriority] = useState("no_priority");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createTask() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/schedule/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title: title.trim(), typeId: typeId || undefined, priority, dueDate: dueDate || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create task");
      // The new task must be visible the moment the user lands back on any
      // schedule tab -- a cached pre-write board would read as a lost write.
      invalidateScheduleProject(projectId);
      toast.success("Task created");
      router.push(`/schedule/tasks/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create task");
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
      saveDisabled={submitting || !title.trim()}
      saveDisabledReason={submitting ? "Creating…" : !title.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pour foundation slab" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-task-type">Type</Label>
            {/* No loading branch, and no "Loading…" placeholder: the list
                is resolved server-side (F-09), so this control is only ever
                ready, empty or error -- and G-04's three sentences say
                which. */}
            <Select value={typeId} onValueChange={setTypeId} disabled={scheduleTypeDisabled(typesState)}>
              <SelectTrigger id="schedule-task-type" className="w-full" data-testid="schedule-task-type">
                <SelectValue placeholder={SCHEDULE_TYPE_PLACEHOLDER[typesState]} />
              </SelectTrigger>
              <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
            {SCHEDULE_TYPE_HINT[typesState] && (
              <p className="text-[12px]" style={{ color: "var(--status-needs-you-text)" }}>{SCHEDULE_TYPE_HINT[typesState]}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{PRIORITY_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5"><Label>Due Date (optional)</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
