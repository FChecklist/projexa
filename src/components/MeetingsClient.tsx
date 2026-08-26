"use client";

// Wave 141 (PROJEXA gap analysis): Meetings/MOM (Minutes of Meeting) module.
// Manual CRUD only -- the AI voice-to-MOM capture flow (GAP-MOM-VOICE-TICKETS)
// is a separate, still-pending item blocked on a speech-to-text provider
// choice, intentionally out of scope here.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Users } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import LoadError from "@/components/LoadError";

type Meeting = {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number | null;
};

type AgendaItem = { id: string; position: number; title: string; issueId: string | null; durationMinutes: number | null };
type Outcome = { id: string; notes: string | null; createdAt: string };
type Participant = { id: string; userId: string; responseStatus: string | null };
type MeetingDetail = Meeting & { agendaItems: AgendaItem[]; outcomes: Outcome[]; participants: Participant[] };

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function MeetingsClient({ projectId }: { projectId: string }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [agendaText, setAgendaText] = useState("");
  const [participantIds, setParticipantIds] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [addingOutcome, setAddingOutcome] = useState(false);

  // R52 Gate 2 / F_030. Recorded as "the route does a server-side fetch with no
  // try/catch fallback, so the raw error replaces the entire page body". Not so:
  // meetings/page.tsx renders PageHeading + ProjectLoadError and gates only the
  // module slot. The live defect is here -- res.ok unread on the module's own
  // list call, which turns a 504 into "No meetings scheduled yet."
  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<{ meetings?: Meeting[] }>(`/api/meetings?projectId=${encodeURIComponent(projectId)}`);
      setMeetings(data.meetings ?? []);
    } catch (err) {
      setMeetings([]);
      const msg = errorMessage(err, "Couldn't load meetings");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createMeeting() {
    if (!title.trim() || !scheduledAt) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title, scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
          agendaItems: agendaText.split("\n").map((l) => l.trim()).filter(Boolean),
          participantUserIds: participantIds.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Meeting created");
      setTitle(""); setScheduledAt(""); setDurationMinutes(""); setAgendaText(""); setParticipantIds(""); setOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create meeting");
    } finally {
      setSubmitting(false);
    }
  }

  async function viewMeeting(id: string) {
    setViewingId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/meetings/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDetail(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load meeting");
      setViewingId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function addOutcome() {
    if (!viewingId || !outcomeNotes.trim()) return;
    setAddingOutcome(true);
    try {
      const res = await fetch(`/api/meetings/${viewingId}/outcomes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: outcomeNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Outcome recorded");
      setOutcomeNotes("");
      viewMeeting(viewingId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add outcome");
    } finally {
      setAddingOutcome(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Meeting</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Meeting</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly site coordination" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Date &amp; time</Label><Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Duration (minutes)</Label><Input type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} placeholder="60" /></div>
              </div>
              <div className="space-y-1.5">
                <Label>Agenda items (one per line, optional)</Label>
                <Textarea value={agendaText} onChange={(e) => setAgendaText(e.target.value)} rows={3} placeholder={"Review open RFIs\nSite safety walkthrough"} />
              </div>
              <div className="space-y-1.5">
                <Label>Participant user IDs (comma-separated, optional)</Label>
                <Input value={participantIds} onChange={(e) => setParticipantIds(e.target.value)} placeholder="usr_abc123, usr_def456" />
                <p className="text-xs text-px-muted">No org directory/picker yet -- paste known VERIDIAN user IDs.</p>
              </div>
            </div>
            <DialogFooter><Button onClick={createMeeting} disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            /* Error BEFORE empty. The empty state states a fact about the
               user's data and may only be shown when the read succeeded. */
            <div className="p-4"><LoadError message={loadError} onRetry={load} /></div>
          ) : meetings.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No meetings scheduled yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead><TableHead>When</TableHead><TableHead>Duration</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetings.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.title}</TableCell>
                    <TableCell className="text-px-muted">{formatDateTime(m.scheduledAt)}</TableCell>
                    <TableCell className="text-px-muted">{m.durationMinutes ? `${m.durationMinutes} min` : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => viewMeeting(m.id)}>View</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewingId} onOpenChange={(v) => { if (!v) { setViewingId(null); setDetail(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{detail?.title ?? "Meeting"}</DialogTitle></DialogHeader>
          {detailLoading || !detail ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <p className="text-sm text-px-muted">{formatDateTime(detail.scheduledAt)}{detail.durationMinutes ? ` · ${detail.durationMinutes} min` : ""}</p>

              <div>
                <h4 className="mb-1.5 text-sm font-semibold text-px-ink">Agenda</h4>
                {detail.agendaItems.length === 0 ? (
                  <p className="text-sm text-px-muted">No agenda items.</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {detail.agendaItems.map((a) => <li key={a.id}>{a.title}</li>)}
                  </ul>
                )}
              </div>

              <div>
                <h4 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-px-ink"><Users className="size-3.5" /> Participants</h4>
                {detail.participants.length === 0 ? (
                  <p className="text-sm text-px-muted">No participants added.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.participants.map((p) => (
                      <Badge key={p.id} variant="outline">{p.userId} · {p.responseStatus ?? "pending"}</Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="mb-1.5 text-sm font-semibold text-px-ink">Minutes / Outcomes</h4>
                {detail.outcomes.length === 0 ? (
                  <p className="mb-2 text-sm text-px-muted">No outcomes recorded yet.</p>
                ) : (
                  <ul className="mb-2 space-y-2">
                    {detail.outcomes.map((o) => (
                      <li key={o.id} className="rounded-md border border-px-border bg-px-cloud/40 p-2 text-sm">
                        <p>{o.notes}</p>
                        <p className="mt-1 text-xs text-px-muted">{formatDateTime(o.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="space-y-2">
                  <Textarea value={outcomeNotes} onChange={(e) => setOutcomeNotes(e.target.value)} rows={2} placeholder="Record a decision, action item, or minutes note…" />
                  <Button size="sm" onClick={addOutcome} disabled={addingOutcome || !outcomeNotes.trim()}>
                    {addingOutcome ? "Adding…" : "Add Outcome"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
