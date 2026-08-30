"use client";

// Real-screen conversion (2026-08-30) -- replaces ScheduleSprintsClient.tsx's
// old "New Sprint" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function ScheduleSprintCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createSprint() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/schedule/sprints", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: name.trim(), goal: goal.trim() || undefined, startDate: startDate || undefined, endDate: endDate || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create sprint");
      toast.success("Sprint created");
      router.push(`/schedule?projectId=${projectId}&tab=sprints`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create sprint");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Schedule / New Sprint"
      title="New Sprint"
      mode="create"
      hasDraft={false}
      onSave={createSprint}
      onCancel={() => router.push(`/schedule?projectId=${projectId}&tab=sprints`)}
      onBack={() => router.push(`/schedule?projectId=${projectId}&tab=sprints`)}
      saveDisabled={submitting || !name.trim()}
      saveDisabledReason={submitting ? "Creating…" : !name.trim() ? "Name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sprint 4" />
        </div>
        <div className="space-y-1.5">
          <Label>Goal (optional)</Label>
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Start Date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>End Date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
      </div>
    </ObjectScreen>
  );
}
