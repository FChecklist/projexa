"use client";

// Priority 16 Part 2 (PROJEXA-WORKPROGRESS-NO-ACTIVITY-PICKER): the
// "Activity ID" field used to be a free-text box with placeholder "Paste
// the activity's ID from VERIDIAN" and zero discovery UI -- unusable on any
// brand-new project (construction_activities has zero rows until the first
// activity is created). Replaced with a real Select sourced from the new
// /api/work-progress/activities endpoint, plus an inline "New Activity"
// dialog for when the list is empty (or a new activity is simply needed).
// See control/priority16_e2e_testing_plan.md "GAP -- Work Progress".
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";

type Entry = {
  id: string;
  activityId: string;
  entryDate: string;
  quantityDone: string;
  percentComplete: number;
  remarks: string | null;
};
type Activity = { id: string; name: string; unit: string | null };

function progressVariant(pct: number): "default" | "secondary" | "destructive" | "outline" {
  if (pct >= 100) return "outline";
  if (pct >= 50) return "default";
  return "secondary";
}

export default function WorkProgressClient({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [activityId, setActivityId] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantityDone, setQuantityDone] = useState("");
  const [percentComplete, setPercentComplete] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [newActivityOpen, setNewActivityOpen] = useState(false);
  const [newActivityName, setNewActivityName] = useState("");
  const [newActivityUnit, setNewActivityUnit] = useState("");
  const [creatingActivity, setCreatingActivity] = useState(false);

  const activitiesById = new Map(activities.map((a) => [a.id, a]));

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      toast.error("Couldn't load work progress");
    } finally {
      setLoading(false);
    }
  }

  const loadActivities = useCallback(async () => {
    setActivitiesLoading(true);
    try {
      const res = await fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      const loaded: Activity[] = data.activities ?? [];
      setActivities(loaded);
      // Keep the current selection if it's still valid; otherwise default to
      // the first activity so the picker isn't blank when there's exactly one.
      setActivityId((prev) => (loaded.some((a) => a.id === prev) ? prev : (loaded[0]?.id ?? "")));
    } catch {
      toast.error("Couldn't load activities");
    } finally {
      setActivitiesLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [projectId]);
  useEffect(() => { loadActivities(); }, [loadActivities]);

  async function createEntry() {
    if (!activityId || !entryDate || quantityDone === "" || percentComplete === "") return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/work-progress", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, activityId, entryDate,
          quantityDone: Number(quantityDone), percentComplete: Number(percentComplete),
          remarks: remarks || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success("Progress logged");
      setQuantityDone(""); setPercentComplete(""); setRemarks(""); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't log progress");
    } finally {
      setSubmitting(false);
    }
  }

  async function createActivity() {
    if (!newActivityName.trim()) return;
    setCreatingActivity(true);
    try {
      const res = await fetch("/api/work-progress/activities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: newActivityName.trim(), unit: newActivityUnit || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create activity");
      toast.success("Activity created");
      setNewActivityName(""); setNewActivityUnit(""); setNewActivityOpen(false);
      await loadActivities();
      setActivityId(data.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create activity");
    } finally {
      setCreatingActivity(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> Log Progress</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Log Work Progress</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Activity</Label>
                {activitiesLoading ? (
                  <div className="flex h-9 items-center gap-2 text-xs text-px-muted"><Loader2 className="size-3.5 animate-spin" /> Loading activities…</div>
                ) : activities.length === 0 ? (
                  <p className="text-xs text-px-muted">
                    No activities yet for this project.{" "}
                    <button type="button" className="font-medium text-px-ink underline" onClick={() => setNewActivityOpen(true)}>
                      Create the first one
                    </button>.
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <Select value={activityId} onValueChange={setActivityId}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select an activity" /></SelectTrigger>
                      <SelectContent>
                        {activities.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}{a.unit ? ` (${a.unit})` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" onClick={() => setNewActivityOpen(true)} title="New activity">
                      <Plus className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Quantity Done</Label><Input type="number" value={quantityDone} onChange={(e) => setQuantityDone(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>% Complete</Label><Input type="number" min={0} max={100} value={percentComplete} onChange={(e) => setPercentComplete(e.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label>Remarks (optional)</Label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={createEntry} disabled={submitting || !activityId}>{submitting ? "Saving…" : "Log Entry"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={newActivityOpen} onOpenChange={setNewActivityOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>New Activity</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={newActivityName} onChange={(e) => setNewActivityName(e.target.value)} placeholder="e.g. Column casting - Level 3" />
              </div>
              <div className="space-y-1.5">
                <Label>Unit (optional)</Label>
                <Input value={newActivityUnit} onChange={(e) => setNewActivityUnit(e.target.value)} placeholder="e.g. cum, sqm, nos" />
              </div>
            </div>
            <DialogFooter><Button onClick={createActivity} disabled={creatingActivity || !newActivityName.trim()}>{creatingActivity ? "Creating…" : "Create Activity"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No progress entries logged yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Activity</TableHead><TableHead>Qty Done</TableHead>
                  <TableHead>% Complete</TableHead><TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-px-muted">{new Date(e.entryDate).toLocaleDateString()}</TableCell>
                    <TableCell>{activitiesById.get(e.activityId)?.name ?? <span className="font-mono text-xs">{e.activityId}</span>}</TableCell>
                    <TableCell>{e.quantityDone}</TableCell>
                    <TableCell><Badge variant={progressVariant(e.percentComplete)}>{e.percentComplete}%</Badge></TableCell>
                    <TableCell className="text-px-muted">{e.remarks ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
