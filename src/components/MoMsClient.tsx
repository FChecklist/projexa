"use client";

// Wave 143 (Minutes of Meeting module): live meeting-notes creation, AI
// summary generation, and PDF export -- wired to VERI Meeting Intelligence
// (veri-meeting-service.ts) via /api/moms, not PROJEXA's basic scheduling
// CRUD (/api/meetings). WhatsApp-send is a disclosed gap -- no such
// integration exists anywhere in this codebase (see PROGRESS.md) -- so that
// button stays disabled with an explicit label rather than faking it.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Loader2, NotebookText, Download, Sparkles, Send, Plus } from "lucide-react";

type Meeting = {
  id: string;
  title: string;
  status: string;
  scheduledAt: string;
  minutes: string | null;
  aiSummary: string | null;
};

export default function MoMsClient({ projectId }: { projectId: string }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [minutesDraft, setMinutesDraft] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/moms?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setMeetings(data.meetings ?? []);
    } catch {
      toast.error("Couldn't load meeting minutes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function handleCreate(formData: FormData) {
    setSaving(true);
    try {
      const res = await fetch("/api/moms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formData.get("title"),
          scheduledAt: formData.get("scheduledAt"),
          projectId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create meeting");
      }
      toast.success("Meeting created");
      setDialogOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create meeting");
    } finally {
      setSaving(false);
    }
  }

  async function saveMinutes(id: string) {
    setBusyAction("minutes");
    try {
      const res = await fetch(`/api/moms/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: minutesDraft }),
      });
      if (!res.ok) throw new Error("Failed to save minutes");
      toast.success("Minutes saved");
      load();
    } catch {
      toast.error("Failed to save minutes");
    } finally {
      setBusyAction(null);
    }
  }

  async function generateSummary(id: string) {
    setBusyAction("ai");
    try {
      const res = await fetch(`/api/moms/${id}/generate-intelligence`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to generate AI summary");
      }
      toast.success("AI summary generated");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate AI summary");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">Minutes of Meeting for this project — live notes, AI summary, PDF export.</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="size-4" /> New Meeting</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Meeting</DialogTitle></DialogHeader>
            <form action={handleCreate} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="scheduledAt">Date &amp; time</Label>
                <Input id="scheduledAt" name="scheduledAt" type="datetime-local" required />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : "Create"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : meetings.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No meetings recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Meeting</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetings.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="flex items-center gap-2 font-medium"><NotebookText className="size-4 text-px-muted" />{m.title}</TableCell>
                    <TableCell className="text-px-muted">{new Date(m.scheduledAt).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline">{m.status}</Badge></TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => { setSelected(m); setMinutesDraft(m.minutes ?? ""); }}>Minutes</Button>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={`/api/moms/${m.id}/pdf`} target="_blank" rel="noopener noreferrer"><Download className="size-3.5" /> PDF</a>
                      </Button>
                      <Button variant="ghost" size="sm" disabled title="WhatsApp send is not implemented anywhere in this codebase yet — disclosed gap, not wired up.">
                        <Send className="size-3.5" /> WhatsApp
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card className="shadow-card">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">{selected.title} — Minutes</p>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Close</Button>
            </div>
            <Textarea value={minutesDraft} onChange={(e) => setMinutesDraft(e.target.value)} rows={8} placeholder="Type live meeting notes here..." />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => saveMinutes(selected.id)} disabled={busyAction === "minutes"}>
                {busyAction === "minutes" ? <Loader2 className="size-4 animate-spin" /> : "Save Minutes"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => generateSummary(selected.id)} disabled={busyAction === "ai"}>
                {busyAction === "ai" ? <Loader2 className="size-4 animate-spin" /> : <><Sparkles className="size-3.5" /> Generate AI Summary</>}
              </Button>
            </div>
            {selected.aiSummary && <p className="rounded border border-px-border bg-px-muted/5 p-3 text-sm">{selected.aiSummary}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
