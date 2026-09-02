"use client";

// Real-screen conversion (2026-08-30): replaces MoMsClient.tsx's old "New
// Meeting" Dialog popup with a real create screen.
//
// R67 lane D22 (item D-58, rec R-187) -- MINUTES ARE CAPTURED HERE, LIVE.
//
// WHAT WAS WRONG: this screen posted a Title and a Date & time, and nothing
// else. Everything a Minutes of Meeting actually IS -- who was there, what was
// on the agenda, what was said, and what anyone has to do next -- could only be
// entered afterwards, on the object page, one field at a time. So the screen
// named "New Meeting" could not minute a meeting. A site engineer typing
// during a coordination call had to save an empty shell first and then go
// hunting for the fields.
//
// This is the whole form, in the order a meeting actually happens: who is
// here, what we are covering, what was said, what happens next. The blocking
// rule is unchanged and deliberately minimal -- Title and Date & time, per the
// item -- because a meeting that ran and produced nothing but a title is still
// a real record, and refusing to save it would push people back to paper.
//
// The minutes autosave to this device (see mom-draft.ts): losing typed minutes
// to a closed laptop is the most expensive thing this screen can do.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import AttendeesField from "@/components/AttendeesField";
import OrgUserPicker from "@/components/OrgUserPicker";
import { setFooterMessage } from "@/lib/footer-message";
import {
  clearMoMDraft, draftHasContent, draftSavedAtLabel, loadMoMDraft, saveMoMDraft,
  type MoMDraftActionItem,
} from "@/lib/mom-draft";

const AUTOSAVE_DEBOUNCE_MS = 1500;
const MINUTES_MIN_ROWS = 8;
const MINUTES_MAX_ROWS = 24;

function emptyActionItem(): MoMDraftActionItem {
  return { title: "", assigneeUserId: null, assigneeName: null, dueDate: "" };
}

export default function MoMCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [agenda, setAgenda] = useState<string[]>([""]);
  const [minutes, setMinutes] = useState("");
  const [actionItems, setActionItems] = useState<MoMDraftActionItem[]>([emptyActionItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [savedAtLabel, setSavedAtLabel] = useState<string | null>(null);
  const [resumable, setResumable] = useState<{ label: string | null } | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A draft is OFFERED, never silently applied: waking up to somebody else's
  // half-typed minutes in your form is worse than losing them.
  useEffect(() => {
    const draft = loadMoMDraft(projectId);
    if (draft && draftHasContent(draft)) setResumable({ label: draftSavedAtLabel(draft.savedAt) });
  }, [projectId]);

  const missing = [...(title.trim() ? [] : ["Title"]), ...(scheduledAt ? [] : ["Date & time"])];

  const persistDraft = useCallback(() => {
    const savedAt = saveMoMDraft(projectId, { title, scheduledAt, attendees, agenda, minutes, actionItems });
    setSavedAtLabel(draftSavedAtLabel(savedAt));
  }, [projectId, title, scheduledAt, attendees, agenda, minutes, actionItems]);

  useEffect(() => {
    if (submitting) return;
    if (!draftHasContent({ title, scheduledAt, attendees, agenda, minutes, actionItems })) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(persistDraft, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [persistDraft, submitting, title, scheduledAt, attendees, agenda, minutes, actionItems]);

  function resumeDraft() {
    const draft = loadMoMDraft(projectId);
    if (!draft) { setResumable(null); return; }
    setTitle(draft.title);
    setScheduledAt(draft.scheduledAt);
    setAttendees(draft.attendees);
    setAgenda(draft.agenda.length ? draft.agenda : [""]);
    setMinutes(draft.minutes);
    setActionItems(draft.actionItems.length ? draft.actionItems : [emptyActionItem()]);
    setSavedAtLabel(draftSavedAtLabel(draft.savedAt));
    setResumable(null);
  }

  function discardDraft() {
    clearMoMDraft(projectId);
    setResumable(null);
    setSavedAtLabel(null);
  }

  async function createMeeting() {
    if (missing.length) return;
    setSubmitting(true);
    try {
      const meeting = await fetchJson<{ id: string; systemId: string | null; title: string }>("/api/moms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          scheduledAt,
          projectId,
          attendees,
          agenda: agenda.map((a) => a.trim()).filter(Boolean),
          minutes: minutes.trim() ? minutes : undefined,
          actionItems: actionItems
            .filter((a) => a.title.trim())
            .map((a) => ({ title: a.title.trim(), assigneeUserId: a.assigneeUserId ?? undefined, dueDate: a.dueDate || undefined })),
        }),
      });
      clearMoMDraft(projectId);
      // The receipt belongs on the page the user lands on, not on the one they
      // are leaving -- see footer-message.ts.
      setFooterMessage(`/moms/${meeting.id}`, {
        level: "success",
        text: `Meeting ${meeting.title} saved - ${meeting.systemId ?? "MoM"}`,
      });
      router.push(`/moms/${meeting.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create meeting"));
      setSubmitting(false);
    }
  }

  const minutesRows = Math.min(MINUTES_MAX_ROWS, Math.max(MINUTES_MIN_ROWS, minutes.split("\n").length + 1));

  return (
    <ObjectScreen
      breadcrumb="Minutes of Meeting / New Meeting"
      title="New Meeting"
      mode="create"
      hasDraft={!!savedAtLabel}
      onSave={createMeeting}
      onCancel={() => router.push(`/moms?projectId=${projectId}`)}
      onBack={() => router.push(`/moms?projectId=${projectId}`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-5 px-4 py-3">
        {resumable && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-px-border2 bg-px-cloud/40 px-3 py-2 text-[12.5px]">
            <span>Resume draft from {resumable.label ?? "earlier"}?</span>
            <Button type="button" size="sm" variant="outline" onClick={resumeDraft}>Resume draft</Button>
            <Button type="button" size="sm" variant="ghost" onClick={discardDraft}>Discard it</Button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Date &amp; time</Label><Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></div>
        </div>

        <AttendeesField value={attendees} onChange={setAttendees} />

        <div className="space-y-2">
          <Label>Agenda</Label>
          <ul className="space-y-1.5">
            {agenda.map((item, i) => (
              <li key={i} className="flex items-center gap-2">
                <span aria-hidden="true" className="text-px-muted">•</span>
                <Input
                  aria-label={`Agenda item ${i + 1}`}
                  value={item}
                  placeholder="What this meeting covers"
                  onChange={(e) => setAgenda((prev) => prev.map((a, idx) => (idx === i ? e.target.value : a)))}
                  onKeyDown={(e) => {
                    // Enter adds the next bullet, the way a list behaves everywhere else.
                    if (e.key === "Enter") { e.preventDefault(); setAgenda((prev) => [...prev.slice(0, i + 1), "", ...prev.slice(i + 1)]); }
                  }}
                />
                <Button
                  type="button" variant="ghost" size="icon" aria-label={`Remove agenda item ${i + 1}`}
                  disabled={agenda.length === 1}
                  onClick={() => setAgenda((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" onClick={() => setAgenda((prev) => [...prev, ""])}>
            <Plus className="size-3.5" aria-hidden="true" /> Add agenda item
          </Button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label>Minutes</Label>
            {savedAtLabel && <span className="text-[12px] text-px-muted">Draft saved {savedAtLabel}</span>}
          </div>
          <Textarea
            value={minutes}
            rows={minutesRows}
            placeholder="Type what is being said, as it is said…"
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Action items</Label>
          <ul className="space-y-2">
            {actionItems.map((item, i) => (
              <li key={i} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1 space-y-1">
                  <span className="text-[12px] text-px-muted">Description</span>
                  <Input
                    aria-label={`Action item ${i + 1} description`}
                    value={item.title}
                    onChange={(e) => setActionItems((prev) => prev.map((a, idx) => (idx === i ? { ...a, title: e.target.value } : a)))}
                  />
                </div>
                <div className="w-56 space-y-1">
                  <span className="text-[12px] text-px-muted">Owner</span>
                  <OrgUserPicker
                    ariaLabel={`Action item ${i + 1} owner`}
                    value={item.assigneeUserId}
                    onChange={(userId, user) =>
                      setActionItems((prev) => prev.map((a, idx) => (idx === i ? { ...a, assigneeUserId: userId, assigneeName: user?.name ?? null } : a)))
                    }
                  />
                </div>
                <div className="w-40 space-y-1">
                  <span className="text-[12px] text-px-muted">Due date</span>
                  <Input
                    type="date"
                    aria-label={`Action item ${i + 1} due date`}
                    value={item.dueDate}
                    onChange={(e) => setActionItems((prev) => prev.map((a, idx) => (idx === i ? { ...a, dueDate: e.target.value } : a)))}
                  />
                </div>
                <Button
                  type="button" variant="ghost" size="icon" aria-label={`Remove action item ${i + 1}`}
                  disabled={actionItems.length === 1}
                  onClick={() => setActionItems((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" onClick={() => setActionItems((prev) => [...prev, emptyActionItem()])}>
            <Plus className="size-3.5" aria-hidden="true" /> Add action item
          </Button>
          <p className="text-[12px] text-px-muted">Each action item becomes a real task for its owner.</p>
        </div>
      </div>
    </ObjectScreen>
  );
}
