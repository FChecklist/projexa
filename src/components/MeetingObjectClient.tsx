"use client";

// Real-screen conversion (2026-08-30): "View" opened a Dialog popup that was
// really an Object Page in disguise (its own real per-meeting GET, agenda/
// participants/outcomes all nested inside). Real Object Page on the kit's
// ObjectScreen. Real Edit (title/date-time/duration) -- updateMeeting()
// didn't exist before this conversion, so a reschedule had no path except
// deleting/re-creating the meeting. No Delete -- no status/isCancelled
// column exists on pms_meetings, so none is faked (see updateMeeting()'s
// own comment in pms-meeting-service.ts). Agenda/participants stay
// read-only (no update-agenda/add-participant endpoint exists); adding an
// outcome (Minutes) was already real and stays exactly as it was.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTimeMedium } from "@/lib/format-date";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type AgendaItem = { id: string; position: number; title: string; issueId: string | null; durationMinutes: number | null };
type Outcome = { id: string; notes: string | null; createdAt: string };
type Participant = { id: string; userId: string; responseStatus: string | null };
type MeetingDetail = {
  id: string; projectId: string; title: string; scheduledAt: string; durationMinutes: number | null;
  agendaItems: AgendaItem[]; outcomes: Outcome[]; participants: Participant[];
};

// R67 G-05: this local copy pinned the locale but not the time zone, so the
// SSR pass stamped a meeting in UTC and the browser in the visitor's zone --
// a different clock time, and near midnight a different DATE. One shared,
// fully pinned helper now.
const formatDateTime = formatDateTimeMedium;
// datetime-local inputs need "YYYY-MM-DDTHH:mm" in local time, not an ISO
// string with a Z/offset -- same conversion createMeeting's own dialog used.
function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MeetingObjectClient({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ title: "", scheduledAt: "", durationMinutes: "" });
  const [saving, setSaving] = useState(false);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [addingOutcome, setAddingOutcome] = useState(false);

  async function load() {
    try {
      const data = await fetchJson<MeetingDetail>(`/api/meetings/${meetingId}`);
      setDetail(data);
      setLoadError(null);
    } catch (err) {
      setDetail(null);
      setLoadError(errorMessage(err, "Couldn't load this meeting"));
    }
  }
  useEffect(() => { load(); }, [meetingId]);

  function startEdit() {
    if (!detail) return;
    setDraft({ title: detail.title, scheduledAt: toLocalInputValue(detail.scheduledAt), durationMinutes: detail.durationMinutes ? String(detail.durationMinutes) : "" });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.title.trim() || !draft.scheduledAt) { toast.error("Title and date/time are required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title.trim(), scheduledAt: new Date(draft.scheduledAt).toISOString(), durationMinutes: draft.durationMinutes ? Number(draft.durationMinutes) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save meeting");
      toast.success("Meeting saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save meeting");
    } finally {
      setSaving(false);
    }
  }

  async function addOutcome() {
    if (!outcomeNotes.trim()) return;
    setAddingOutcome(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/outcomes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: outcomeNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add outcome");
      toast.success("Outcome recorded");
      setOutcomeNotes("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add outcome");
    } finally {
      setAddingOutcome(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!detail) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Meetings / Meeting"
      title={mode === "edit" ? "Edit Meeting" : detail.title}
      mode={mode}
      hasDraft={false}
      facets={[
        { label: "When", value: formatDateTime(detail.scheduledAt) },
        { label: "Duration", value: detail.durationMinutes ? `${detail.durationMinutes} min` : "—" },
      ]}
      onEdit={mode === "display" ? startEdit : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onBack={() => router.push(`/meetings?projectId=${detail.projectId}`)}
      saveDisabled={saving || !draft.title.trim() || !draft.scheduledAt}
      saveDisabledReason={saving ? "Saving…" : !draft.title.trim() || !draft.scheduledAt ? "Title and date/time are required" : undefined}
      messages={[]}
    >
      {mode === "edit" ? (
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5"><Label>Title</Label><Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Date &amp; time</Label><Input type="datetime-local" value={draft.scheduledAt} onChange={(e) => setDraft((d) => ({ ...d, scheduledAt: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Duration (minutes)</Label><Input type="number" value={draft.durationMinutes} onChange={(e) => setDraft((d) => ({ ...d, durationMinutes: e.target.value }))} /></div>
          </div>
        </div>
      ) : (
        <div className="space-y-4 px-4 py-3">
          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-ct-navy">Agenda</h4>
            {detail.agendaItems.length === 0 ? (
              <p className="text-sm text-ct-muted">No agenda items.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {detail.agendaItems.map((a) => <li key={a.id}>{a.title}</li>)}
              </ul>
            )}
          </div>

          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-ct-navy"><Users className="size-3.5" /> Participants</h4>
            {detail.participants.length === 0 ? (
              <p className="text-sm text-ct-muted">No participants added.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {detail.participants.map((p) => (
                  <Badge key={p.id} variant="outline">{p.userId} · {p.responseStatus ?? "pending"}</Badge>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-ct-navy">Minutes / Outcomes</h4>
            {detail.outcomes.length === 0 ? (
              <p className="mb-2 text-sm text-ct-muted">No outcomes recorded yet.</p>
            ) : (
              <ul className="mb-2 space-y-2">
                {detail.outcomes.map((o) => (
                  <li key={o.id} className="rounded-md border border-ct-border bg-ct-cloud/40 p-2 text-sm">
                    <p>{o.notes}</p>
                    <p className="mt-1 text-xs text-ct-muted">{formatDateTime(o.createdAt)}</p>
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
    </ObjectScreen>
  );
}
