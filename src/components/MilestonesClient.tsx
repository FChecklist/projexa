"use client";

// Sumeet requirement #2 ("TIMELINES AND MILESTONES OF A PROJECT (BOTH ARE
// DIFFERENT)"). The Timeline tab (ScheduleGanttClient) already draws
// milestones as diamonds and shows a "Milestones: N" count, but nothing in
// PROJEXA could ever CREATE one or see its own record -- VERIDIAN's
// pms_milestones/listMilestones/createMilestone always existed and already
// fed the Gantt's own payload (schedule-service.ts's getGanttData()), the
// gap was purely a missing write surface reachable from PROJEXA. This tab is
// that surface: a milestone's own record (name/description/targetDate/
// status), completely separate from -- but linkable to -- the Timeline's
// activities.
//
// completionPercentage is never entered here -- it is always DERIVED
// server-side from the average completionPercentage of the activities
// (pms_issues) linked to this milestone via their own milestoneId, exactly
// as computeMilestoneCompletionPercentage() computes it. A milestone with no
// linked activities yet reads 0%, honestly, rather than 100% (nothing left
// to do) or blank (no data).
//
// No delete: a milestone that is no longer wanted is set to status
// 'cancelled', never removed -- "ALL DATA WILL BE LOGGED AND NOT DELETED"
// per the Owner's own requirement, same append-only discipline this
// codebase already uses for change orders / progress claims / schedule
// tasks' isArchived flag.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export type Milestone = {
  id: string;
  name: string;
  description: string | null;
  targetDate: string | null;
  status: "planned" | "in_progress" | "completed" | "cancelled";
  completionPercentage: number;
};

const STATUS_VARIANT: Record<Milestone["status"], "default" | "secondary" | "destructive" | "outline"> = {
  planned: "outline",
  in_progress: "secondary",
  completed: "default",
  cancelled: "destructive",
};

const STATUS_LABEL: Record<Milestone["status"], string> = {
  planned: "Planned",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const NAME_REQUIRED = "Name is required";

/**
 * Pure, so the create-form's wiring is verifiable without typing into a
 * controlled text input -- in this repo's test environment (React 19 +
 * happy-dom under bun test) fireEvent.change updates the DOM node but never
 * reaches React's onChange, so a controlled input's state cannot be driven
 * from a test at all (see PermitCreateClient.test.tsx / BudgetAnalyticalClient.test.tsx
 * for the same, already-documented limitation in this codebase). Empty
 * strings become undefined, never sent as "" -- description/targetDate are
 * optional columns, and an empty-string write is a different fact from "not
 * provided" for a nullable date column.
 */
export function buildMilestoneCreatePayload(projectId: string, name: string, description: string, targetDate: string) {
  return {
    projectId,
    name: name.trim(),
    description: description.trim() || undefined,
    targetDate: targetDate || undefined,
  };
}

export default function MilestonesClient({ projectId }: { projectId: string }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ milestones?: Milestone[] }>(
        `/api/milestones?projectId=${encodeURIComponent(projectId)}`
      );
      setMilestones(data.milestones ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load milestones"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function createMilestone() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fetchJson("/api/milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMilestoneCreatePayload(projectId, name, description, targetDate)),
      });
      toast.success(`Milestone "${name.trim()}" created`);
      setName(""); setDescription(""); setTargetDate("");
      setFormOpen(false);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "The milestone was not created"));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(milestoneId: string, status: Milestone["status"]) {
    setStatusSavingId(milestoneId);
    try {
      const updated = await fetchJson<Milestone>(`/api/milestones/${encodeURIComponent(milestoneId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setMilestones((prev) => prev.map((m) => (m.id === milestoneId ? { ...m, ...updated } : m)));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update the milestone's status"));
    } finally {
      setStatusSavingId(null);
    }
  }

  const saveLabel = saving ? "Saving…" : !name.trim() ? `Save (${NAME_REQUIRED})` : "Save";

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!formOpen ? (
          <Button onClick={() => setFormOpen(true)}><Plus className="size-4" /> New Milestone</Button>
        ) : null}
      </div>

      {formOpen && (
        <Card className="shadow-card">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="milestone-name">Name</Label>
                <Input id="milestone-name" className="w-64" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Foundation complete" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="milestone-target-date">Target date</Label>
                <Input id="milestone-target-date" type="date" className="w-40" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="milestone-description">Description</Label>
              <Textarea id="milestone-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex gap-2">
              <Button onClick={createMilestone} disabled={saving || !name.trim()} title={!name.trim() ? NAME_REQUIRED : undefined}>
                {saveLabel}
              </Button>
              <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : milestones.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No milestones yet.</p>
          ) : (
            <ul className="divide-y divide-px-border">
              {milestones.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-[220px] space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      <Badge variant={STATUS_VARIANT[m.status]} className="text-[10px]">{STATUS_LABEL[m.status]}</Badge>
                    </div>
                    {m.description && <p className="text-xs text-px-muted">{m.description}</p>}
                    <p className="text-xs text-px-muted">
                      {m.targetDate ? `Target: ${m.targetDate}` : "No target date"} · {m.completionPercentage}% complete
                    </p>
                  </div>
                  <select
                    aria-label={`Status for ${m.name}`}
                    className="rounded-md border border-px-border bg-transparent px-2 py-1 text-xs"
                    value={m.status}
                    disabled={statusSavingId === m.id}
                    onChange={(e) => changeStatus(m.id, e.target.value as Milestone["status"])}
                  >
                    {(Object.keys(STATUS_LABEL) as Milestone["status"][]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
