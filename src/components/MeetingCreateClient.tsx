"use client";

// Real-screen conversion (2026-08-30): replaces MeetingsClient.tsx's old
// "New Meeting" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function MeetingCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [agendaText, setAgendaText] = useState("");
  const [participantIds, setParticipantIds] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const missing = [...(title.trim() ? [] : ["Title"]), ...(scheduledAt ? [] : ["Date & time"])];

  async function createMeeting() {
    if (missing.length) return;
    setSubmitting(true);
    try {
      const meeting = await fetchJson<{ id: string }>("/api/meetings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title, scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
          agendaItems: agendaText.split("\n").map((l) => l.trim()).filter(Boolean),
          participantUserIds: participantIds.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      toast.success("Meeting created");
      router.push(`/meetings/${meeting.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create meeting"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Meetings / New Meeting"
      title="New Meeting"
      mode="create"
      hasDraft={false}
      onSave={createMeeting}
      onCancel={() => router.push(`/meetings?projectId=${projectId}`)}
      onBack={() => router.push(`/meetings?projectId=${projectId}`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
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
    </ObjectScreen>
  );
}
