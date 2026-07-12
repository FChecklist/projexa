"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus } from "lucide-react";

type Entry = {
  id: string;
  activityId: string;
  entryDate: string;
  quantityDone: string;
  percentComplete: number;
  remarks: string | null;
};

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

  useEffect(() => { load(); }, [projectId]);

  async function createEntry() {
    if (!activityId.trim() || !entryDate || quantityDone === "" || percentComplete === "") return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/work-progress", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, activityId: activityId.trim(), entryDate,
          quantityDone: Number(quantityDone), percentComplete: Number(percentComplete),
          remarks: remarks || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success("Progress logged");
      setActivityId(""); setQuantityDone(""); setPercentComplete(""); setRemarks(""); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't log progress");
    } finally {
      setSubmitting(false);
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
                <Label>Activity ID</Label>
                <Input value={activityId} onChange={(e) => setActivityId(e.target.value)} placeholder="Paste the activity's ID from VERIDIAN" />
                <p className="text-xs text-px-muted">Category/activity setup has no self-service form yet — this ID must already exist in VERIDIAN.</p>
              </div>
              <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Quantity Done</Label><Input type="number" value={quantityDone} onChange={(e) => setQuantityDone(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>% Complete</Label><Input type="number" min={0} max={100} value={percentComplete} onChange={(e) => setPercentComplete(e.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label>Remarks (optional)</Label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={createEntry} disabled={submitting}>{submitting ? "Saving…" : "Log Entry"}</Button></DialogFooter>
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
                  <TableHead>Date</TableHead><TableHead>Activity ID</TableHead><TableHead>Qty Done</TableHead>
                  <TableHead>% Complete</TableHead><TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-px-muted">{new Date(e.entryDate).toLocaleDateString()}</TableCell>
                    <TableCell className="font-mono text-xs">{e.activityId}</TableCell>
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
