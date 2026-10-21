"use client";

// Real-screen conversion (2026-08-30) -- replaces ScheduleSprintsClient.tsx's
// old "New Sprint" Dialog popup with a real create screen.
//
// G3 guided errors: a refused or impossible save is a full panel (what happened, why, the numbered steps, the exact place to fix it, the way
// back) instead of a fading toast, and everything typed survives a "Fix it now" detour, a reload and a sign-in that ran out.
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { GuidedSubmitFailure } from "@/components/GuidedError";
import { DraftRestoredNote } from "@/components/DraftRestoredNote";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSubmit } from "@/lib/use-submit";
import { fault, useCheckedSubmit, useFormDraft } from "@/lib/guided-form";

export default function ScheduleSprintCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const draftKey = `sprint-new:${projectId}`;
  const draft = useFormDraft(draftKey, { name: "", goal: "", startDate: "", endDate: "" });
  const { name, goal, startDate, endDate } = draft.values;
  const back = `/schedule?projectId=${projectId}&tab=sprints`;

  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Sprint",
    buildRequest: () => ({
      input: "/api/schedule/sprints",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: name.trim(), goal: goal.trim() || undefined, startDate: startDate || undefined, endDate: endDate || undefined }),
      },
    }),
    onSuccess: () => {
      draft.clear();
      toast.success("Sprint created");
      router.push(back);
    },
  });

  const checked = useCheckedSubmit(submit, () => {
    if (startDate && endDate && endDate < startDate) {
      return fault("SPRINT_DATES_ORDER", "sprint-end", `The end date ${endDate} is before the start date ${startDate}. A sprint cannot end before it begins.`);
    }
    return null;
  });
  const change = (field: string, value: string) => {
    checked.clearFault();
    draft.onChange(field, value);
  };

  return (
    <ObjectScreen
      breadcrumb="Schedule / New Sprint"
      title="New Sprint"
      mode="create"
      hasDraft={false}
      onSave={checked.onSubmit}
      onCancel={() => router.push(back)}
      onBack={() => router.push(back)}
      saveDisabled={submit.saving || submit.saved || !name.trim()}
      saveDisabledReason={submit.saving ? "Creating…" : !name.trim() ? "Name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <DraftRestoredNote draft={draft} />
        <GuidedSubmitFailure failure={checked.failure} onRetry={checked.onRetry} draftKey={draftKey} />
        <div className="space-y-1.5">
          <Label htmlFor="sprint-name">Name</Label>
          <Input id="sprint-name" value={name} onChange={(e) => change("name", e.target.value)} placeholder="e.g. Sprint 4" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sprint-goal">Goal (optional)</Label>
          <Textarea id="sprint-goal" value={goal} onChange={(e) => change("goal", e.target.value)} rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label htmlFor="sprint-start">Start Date</Label><Input id="sprint-start" type="date" value={startDate} onChange={(e) => change("startDate", e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="sprint-end">End Date</Label><Input id="sprint-end" type="date" value={endDate} onChange={(e) => change("endDate", e.target.value)} /></div>
        </div>
      </div>
    </ObjectScreen>
  );
}
