"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";
import { formatDate } from "@/lib/format-date";

type Diary = {
  id: string;
  diaryDate: string;
  weather: string | null;
  workDone: string | null;
  labourCount: number | null;
  issues: string | null;
};

export default function SiteDiaryClient({ projectId }: { projectId: string }) {
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [diaryDate, setDiaryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weather, setWeather] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [labourCount, setLabourCount] = useState("");
  const [issues, setIssues] = useState("");
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/site-diary?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setDiaries(data.diaries ?? []);
    } catch {
      toast.error("Couldn't load site diary");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createDiary() {
    if (!diaryDate) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/site-diary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, diaryDate, weather: weather || undefined, workDone: workDone || undefined,
          labourCount: labourCount ? Number(labourCount) : undefined,
          issues: issues || undefined, instructions: instructions || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success("Diary entry saved");
      setWeather(""); setWorkDone(""); setLabourCount(""); setIssues(""); setInstructions(""); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't save diary entry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Entry</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Site Diary Entry</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={diaryDate} onChange={(e) => setDiaryDate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Weather</Label><Input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="e.g. Clear, 28°C" /></div>
              </div>
              <div className="space-y-1.5"><Label>Work Done</Label><Textarea value={workDone} onChange={(e) => setWorkDone(e.target.value)} rows={3} /></div>
              <div className="space-y-1.5"><Label>Labour Count</Label><Input type="number" value={labourCount} onChange={(e) => setLabourCount(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Issues (optional)</Label><Textarea value={issues} onChange={(e) => setIssues(e.target.value)} rows={2} /></div>
              <div className="space-y-1.5"><Label>Instructions (optional)</Label><Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} /></div>
            </div>
            <DialogFooter><Button onClick={createDiary} disabled={submitting}>{submitting ? "Saving…" : "Save Entry"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : diaries.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No diary entries yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Weather</TableHead><TableHead>Work Done</TableHead>
                  <TableHead>Labour</TableHead><TableHead>Issues</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diaries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-px-muted">{formatDate(d.diaryDate)}</TableCell>
                    <TableCell>{d.weather ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{d.workDone ?? "—"}</TableCell>
                    <TableCell>{d.labourCount ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-px-muted">{d.issues ?? "—"}</TableCell>
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
