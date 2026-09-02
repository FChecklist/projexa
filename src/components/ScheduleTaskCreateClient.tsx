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

const PRIORITY_OPTIONS = ["no_priority", "low", "medium", "high", "urgent"];

export default function ScheduleTaskCreateClient({ projectId, types = [] }: { projectId: string; types?: IssueType[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  // The default type is resolvable synchronously now, so the select never
  // renders empty and then fills in.
  const [typeId, setTypeId] = useState(() => (types.find((t) => t.isDefault) ?? types[0])?.id ?? "");
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
            <Label>Type</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              {/* No "Loading…" placeholder any more: the list is resolved
                  server-side, so an empty one means this org genuinely has no
                  task types, and saying "Loading" would be a lie. */}
              <SelectTrigger className="w-full" disabled={types.length === 0}><SelectValue placeholder={types.length ? "Select a type" : "No task types configured"} /></SelectTrigger>
              <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
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
