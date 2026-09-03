"use client";

// Real-screen conversion (2026-08-30) -- replaces ScheduleBoardClient.tsx's
// old "New Task" Dialog popup with a real create screen, same fields.
//
// R67 F-19 (R-245): the type lookup says which of its three states it is in --
// "Loading task types…", the options, or "Couldn't load task types — Retry".
// Type is OPTIONAL (the server applies its own default), so a failed lookup
// does not block Save; the button keeps naming the real missing field.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// R67 F-19 x G-04. F-19 owns the FETCH (one shared, status-aware hook with an
// AbortController, used by every create form); G-04 owns what the CONTROL SAYS
// (four states, a skeleton in the control's own shape, and never a word in the
// value slot that could be read as a chosen type). The state machine is derived
// from the lookup below, so there is one request and one vocabulary.
import { useLookup } from "@/lib/use-lookup";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SCHEDULE_TYPE_HINT,
  SCHEDULE_TYPE_PLACEHOLDER,
  scheduleTypeDisabled,
  scheduleTypesState,
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
  const typeLookup = useLookup<IssueType>({
    url: "/api/schedule/types",
    pick: (d) => d.types as IssueType[] | undefined,
    label: "task types",
  });
  const [typeId, setTypeId] = useState("");
  const [priority, setPriority] = useState("no_priority");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Preselect the org's default type once the lookup answers, exactly as
  // before -- only the fetch moved into the shared, status-aware hook.
  useEffect(() => {
    if (typeLookup.status !== "ready" || typeId) return;
    const defaultType = typeLookup.options.find((t) => t.isDefault) ?? typeLookup.options[0];
    if (defaultType) setTypeId(defaultType.id);
  }, [typeLookup.status, typeLookup.options, typeId]);

  // G-04's four states, derived from F-19's lookup rather than from a second
  // fetch. The distinction G-04 exists to make is preserved exactly: a failed
  // read is "error", and only a SUCCESSFUL read with no rows is "empty" -- the
  // two used to collapse into "this org has no task types".
  const typesState = scheduleTypesState({
    loaded: typeLookup.status === "loading" ? null : typeLookup.options,
    failed: typeLookup.status === "error",
  });

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
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pour foundation slab" />
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
                <SelectContent>{typeLookup.options.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
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
