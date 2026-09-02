"use client";

// Real-screen conversion (2026-08-30) -- replaces ScheduleBoardClient.tsx's
// old "New Task" Dialog popup with a real create screen, same fields.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SCHEDULE_TYPE_HINT,
  SCHEDULE_TYPE_PLACEHOLDER,
  scheduleTypeDisabled,
  scheduleTypesState,
  type ScheduleTypesState,
} from "@/lib/schedule-type-state";

type IssueType = { id: string; name: string; isDefault?: boolean | null };
const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

// R67 G-04 (R-231): the four states, their one instruction each, and the
// rule that "Loading…" is never a value all live in
// src/lib/schedule-type-state.ts, where they are unit-tested. This file
// renders them.

export default function ScheduleTaskCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [types, setTypes] = useState<IssueType[]>([]);
  const [typeId, setTypeId] = useState("");
  const [typesState, setTypesState] = useState<ScheduleTypesState>("loading");
  const [priority, setPriority] = useState("no_priority");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/schedule/types")
      .then((res) => {
        // A non-OK response used to fall into .then() and produce
        // `data.types ?? []`, i.e. an empty list -- so a 502 from VERIDIAN
        // was displayed as "this org has no task types". Those are different
        // facts and the user is told which one happened.
        if (!res.ok) throw new Error(`schedule/types ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const loaded: IssueType[] = data.types ?? [];
        setTypes(loaded);
        const defaultType = loaded.find((t) => t.isDefault) ?? loaded[0];
        if (defaultType) setTypeId(defaultType.id);
        setTypesState(scheduleTypesState({ loaded, failed: false }));
      })
      // The type dropdown is a convenience -- create still works, because the
      // server applies the org's default type when none is sent. So this is
      // reported beside the control, not as a blocking error.
      .catch(() => setTypesState(scheduleTypesState({ loaded: null, failed: true })));
  }, []);


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
            {typesState === "loading" ? (
              // A disabled skeleton in the control's own shape: it says
              // "something is coming here", it cannot be opened onto an empty
              // menu, and it puts no word in the value slot that could be
              // read as a chosen type. Nothing moves when the real select
              // replaces it -- same height, same width.
              <div
                id="schedule-task-type"
                aria-busy="true"
                aria-disabled="true"
                aria-label="Type, loading"
                data-testid="schedule-task-type-loading"
                className="flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 opacity-60"
              >
                <Skeleton className="h-4 w-28" />
              </div>
            ) : (
              <Select value={typeId} onValueChange={setTypeId} disabled={scheduleTypeDisabled(typesState)}>
                <SelectTrigger id="schedule-task-type" className="w-full" data-testid="schedule-task-type">
                  <SelectValue placeholder={SCHEDULE_TYPE_PLACEHOLDER[typesState]} />
                </SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
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
