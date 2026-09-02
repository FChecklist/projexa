"use client";

// Real-screen conversion (2026-08-30): replaces the old inline "selected"
// panel (a Card toggled by local state, not a real URL) with a real Object
// Page. This module's backend was already far richer than the old UI
// surfaced -- publish/lock, action items, and share-link management all
// existed in veri-meeting-service.ts with working v1 routes, just never
// wired to any button:
//  - Edit (title/type/date) -- updateVeriMeetingDetails() existed since
//    Wave 44 specifically "for the publish/lock workflow to mean anything"
//    but was never called from any route; this conversion added that
//    PATCH branch (see v1/projexa/veri-meetings/[id]/route.ts's comment).
//  - Publish & Lock -- publishVeriMeeting() had a working v1 route, no UI.
//  - Action Items -- addMeetingActionItem() had a working v1 route, no UI;
//    AI-suggested action items (aiSuggestedActionItems) were computed and
//    stored but never displayed at all.
//  - Share Links -- listMeetingShareLinks() had a working v1 route, no UI
//    (only "create + open WhatsApp" existed, with no way to see or revoke
//    an existing link). Revoke had no PROJEXA route until this conversion.
// Once published, meeting-level fields AND minutes lock server-side
// (assertEditable) -- the UI mirrors that by hiding Edit/Save-Minutes
// rather than letting a click 409.
//
// R67 lane D22 (item D-58, rec R-187): the icon-only PDF glyph and the
// "Create Share Link & Send via WhatsApp" sentence-in-a-button are replaced by
// the shared ShareSheet (Export PDF / Share on WhatsApp / Share link), and the
// action-item Assignee free-text box -- which asked a human to paste a
// VERIDIAN user id and hinted `usr_abc123` -- is now a real people picker over
// the org directory. No screen in this module prints a user id any more.
//
// ─── R67 lane D22 (item D-75, rec R-287): THIS PAGE OPENS READ-ONLY ────────
//
// WHAT WAS WRONG. Arriving at a meeting put you straight into a half-edit
// state: the minutes were a live <textarea> with their own "Save Minutes"
// button, the action-item composer sat open with three empty inputs, and the
// loudest control on the screen -- the only saffron one -- was "Publish &
// Lock", an IRREVERSIBLE action (there is no unpublish anywhere in this
// codebase) offered above minutes that were still empty. Three different save
// paths, none of them named Save, and the riskiest button was the brightest.
//
// WHAT IT IS NOW. Everything is display text until the header's single Edit is
// pressed; edit mode has exactly ONE Save / Cancel pair, in the footer, that
// commits the details, the minutes and any newly agreed action items together.
// Publish & Lock is a secondary control that says why it cannot be pressed
// ("Publish & Lock (no minutes yet)") and asks inline before it fires. Exactly
// one saffron button exists on arrival: Edit.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
// R67 lane D22 (item D-63, rec R-203): the FORKED ObjectScreen, not the kit's.
// The fork adds one thing -- a header-actions slot -- because R-203's global
// object-screen rule puts an object's own actions in its header, in a fixed
// order, and the kit's ObjectScreen puts Edit in the footer with no way to add
// Export/Share beside it. See src/components/screens/ScreenFrame.tsx's header
// for why this is a fork and not a kit change (programme decision D-09).
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import type { FieldMessage, StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, Link2, Ban, Plus, X } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDateTime, formatDayMonthYear } from "@/lib/format-date";
import {
  meetingShareSummary, canPublishMeeting, publishLockLabel, PUBLISH_LOCK_CONFIRM, PUBLISH_LOCK_LABEL,
} from "@/lib/mom-format";
import type { MoMDraftActionItem } from "@/lib/mom-draft";
import ShareSheet, { type ShareLinkResult } from "@/components/ShareSheet";
import OrgUserPicker from "@/components/OrgUserPicker";
import AttendeesField from "@/components/AttendeesField";
import { takeFooterMessage } from "@/lib/footer-message";

type ActionItem = { id: string; task: { id: string; title: string; status: string; dueDate: string | null; userId: string | null } };
type SuggestedActionItem = { title: string; assignee: string | null; dueDateHint: string | null };
type Meeting = {
  id: string; projectId: string | null; title: string; meetingType: string; status: string; scheduledAt: string;
  attendees: string[]; agenda: string[]; minutes: string | null; systemId: string | null;
  publishedAt: string | null; aiSummary: string | null; aiKeyDecisions: string[]; aiSuggestedActionItems: SuggestedActionItem[];
  actionItems: ActionItem[];
};
// shareUrl is resolved by this repo's own /api/moms/[id]/share-links proxy
// (R67 D-63) so the Share controls are real links on arrival, not buttons that
// have to round-trip before they know where they point.
type ShareLink = { id: string; token: string; expiresAt: string; revokedAt: string | null; createdAt: string; shareUrl?: string };

type Draft = {
  title: string;
  meetingType: string;
  scheduledAt: string;
  attendees: string[];
  agenda: string[];
  minutes: string;
  newActionItems: MoMDraftActionItem[];
};

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", published: "done" };

function emptyActionItem(): MoMDraftActionItem {
  return { title: "", assigneeUserId: null, assigneeName: null, dueDate: "" };
}

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function draftFrom(meeting: Meeting): Draft {
  return {
    title: meeting.title,
    meetingType: meeting.meetingType,
    scheduledAt: toLocalInputValue(meeting.scheduledAt),
    attendees: [...meeting.attendees],
    agenda: meeting.agenda.length ? [...meeting.agenda] : [""],
    minutes: meeting.minutes ?? "",
    newActionItems: [emptyActionItem()],
  };
}

export default function MoMObjectClient({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Publishing is irreversible, so it asks -- inline, never a modal (the one
  // dialog this product keeps is Create Project, per correction C-01).
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  // The create screen's receipt, and anything the share controls need to say
  // (a blocked popup, a copied link) -- both land in the footer message area
  // the kit's ObjectScreen already owns, never in a toast that vanishes.
  const [screenMessages, setScreenMessages] = useState<FieldMessage[]>([]);

  useEffect(() => {
    const receipt = takeFooterMessage(`/moms/${meetingId}`);
    if (receipt) setScreenMessages([{ level: receipt.level, text: receipt.text }]);
  }, [meetingId]);

  async function load() {
    try {
      const [data, linkData] = await Promise.all([
        fetchJson<Meeting>(`/api/moms/${meetingId}`),
        fetchJson<{ links?: ShareLink[] }>(`/api/moms/${meetingId}/share-links`).catch(() => ({ links: [] })),
      ]);
      setMeeting(data);
      setLinks(linkData.links ?? []);
      setLoadError(null);
    } catch (err) {
      setMeeting(null);
      setLoadError(errorMessage(err, "Couldn't load this meeting"));
    }
  }
  useEffect(() => { load(); }, [meetingId]);

  function startEdit() {
    if (!meeting) return;
    setDraft(draftFrom(meeting));
    setConfirmingPublish(false);
    setMode("edit");
  }

  function cancelEdit() {
    setDraft(null);
    setMode("display");
  }

  /**
   * ONE Save. The details, the minutes and any newly agreed action items are
   * committed together from the single footer button.
   *
   * Three calls rather than one because VERIDIAN's PATCH is a discriminated
   * route -- { minutes } and the detail fields are different branches of
   * v1/projexa/veri-meetings/[id], and action items are their own endpoint
   * (they create real `tasks` rows). Only what actually changed is sent, and
   * the first failure stops the rest and is reported at the screen with the
   * backend's own sentence, with the page reloaded so what is shown is what
   * was actually stored -- never a Save that half-succeeded in silence.
   */
  async function saveEdit() {
    if (!meeting || !draft) return;
    if (!draft.title.trim() || !draft.scheduledAt) return;
    setSaving(true);
    try {
      const agenda = draft.agenda.map((a) => a.trim()).filter(Boolean);
      const detailsChanged =
        draft.title.trim() !== meeting.title ||
        draft.meetingType !== meeting.meetingType ||
        new Date(draft.scheduledAt).toISOString() !== new Date(meeting.scheduledAt).toISOString() ||
        draft.attendees.join(" ") !== meeting.attendees.join(" ") ||
        agenda.join(" ") !== meeting.agenda.join(" ");

      if (detailsChanged) {
        const res = await fetch(`/api/moms/${meetingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title.trim(), meetingType: draft.meetingType,
            scheduledAt: new Date(draft.scheduledAt).toISOString(),
            attendees: draft.attendees, agenda,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Couldn't save this meeting");
      }

      if (draft.minutes !== (meeting.minutes ?? "")) {
        const res = await fetch(`/api/moms/${meetingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minutes: draft.minutes }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Couldn't save the minutes");
      }

      // An action item with a description but no owner would become a task
      // nobody is assigned -- refused here rather than silently dropped.
      const pending = draft.newActionItems.filter((a) => a.title.trim());
      const ownerless = pending.find((a) => !a.assigneeUserId);
      if (ownerless) throw new Error(`Action item "${ownerless.title.trim()}" needs an owner`);
      for (const item of pending) {
        const res = await fetch(`/api/moms/${meetingId}/action-items`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: item.title.trim(), assigneeUserId: item.assigneeUserId, dueDate: item.dueDate || undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Couldn't add the action item "${item.title.trim()}"`);
      }

      setMode("display");
      setDraft(null);
      setScreenMessages([{ level: "success", text: `Meeting ${meeting.systemId ?? meeting.title} saved` }]);
      await load();
    } catch (err) {
      setScreenMessages([{ level: "error", text: errorMessage(err, "Couldn't save this meeting") }]);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      const res = await fetch(`/api/moms/${meetingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to publish meeting");
      setConfirmingPublish(false);
      setScreenMessages([{ level: "success", text: "Meeting published and locked" }]);
      await load();
    } catch (err) {
      setScreenMessages([{ level: "error", text: errorMessage(err, "Couldn't publish meeting") }]);
    } finally {
      setPublishing(false);
    }
  }

  async function generateSummary() {
    setBusy("ai");
    try {
      const res = await fetch(`/api/moms/${meetingId}/generate-intelligence`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to generate AI summary");
      toast.success("AI summary generated");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't generate AI summary");
    } finally {
      setBusy(null);
    }
  }

  /** Puts the AI's suggested wording into the first empty action-item row of the edit form. */
  function promoteSuggestion(s: SuggestedActionItem) {
    if (!meeting) return;
    // The AI's `assignee` is a NAME it read out of the minutes, not a user id,
    // so it cannot be used to pre-select an owner -- the owner is still chosen
    // deliberately from the directory.
    const base = draft ?? draftFrom(meeting);
    const rows = [...base.newActionItems];
    const emptyIndex = rows.findIndex((a) => !a.title.trim());
    if (emptyIndex >= 0) rows[emptyIndex] = { ...rows[emptyIndex], title: s.title };
    else rows.push({ ...emptyActionItem(), title: s.title });
    setDraft({ ...base, newActionItems: rows });
    setMode("edit");
  }

  // Handed to ShareSheet, which owns the WhatsApp/copy-link behaviour and the
  // blocked-popup fallback. It only ever asks for a link it does not already
  // have, so a second share reuses the first link rather than minting one.
  async function createShareLink(): Promise<ShareLinkResult> {
    const res = await fetch(`/api/moms/${meetingId}/share-links`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.shareUrl) throw new Error(data?.error ?? "Couldn't create a share link");
    await load();
    return { shareUrl: data.shareUrl as string, whatsappHref: data.whatsappHref as string };
  }

  async function revokeLink(linkId: string) {
    setBusy(`revoke-${linkId}`);
    try {
      const res = await fetch(`/api/moms/share-links/${linkId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to revoke share link");
      toast.success("Share link revoked");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't revoke share link");
    } finally {
      setBusy(null);
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
  if (!meeting) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const isPublished = meeting.status === "published";
  const activeShareUrl = links.find((l) => !l.revokedAt && new Date(l.expiresAt) > new Date() && l.shareUrl)?.shareUrl ?? null;
  // The backend refuses to share a draft (createMeetingShareLink, 409). Say so
  // on the control rather than letting the click fail.
  const shareDisabledReason = isPublished ? null : "Publish the meeting first";
  const canPublish = canPublishMeeting(meeting.minutes);
  // R67 D-63: the header actions, as words, in this fixed order --
  // Edit | Export PDF | Share on WhatsApp | Share link. One place to look on
  // every object screen, rather than an Edit in the footer, a PDF glyph beside
  // the minutes and a share button at the bottom of the page.
  //
  // R67 D-75: Edit is THE primary here. It is the one thing this page is for
  // once you have read it, and it is safe -- unlike Publish & Lock, which used
  // to hold the emphasis while being the one action that cannot be undone.
  const headerActions = mode === "display" ? (
    <span className="flex items-center gap-1">
      <Button
        size="sm"
        disabled={isPublished}
        title={isPublished ? "Published meetings are locked" : undefined}
        onClick={startEdit}
      >
        Edit
      </Button>
      <ShareSheet
        pdfHref={`/api/moms/${meeting.id}/pdf`}
        createShareLink={createShareLink}
        shareUrl={activeShareUrl}
        // The one line that goes ahead of the link, so a client who receives it
        // knows what they have been sent before opening anything.
        whatsappSummary={meetingShareSummary(meeting.title, formatDayMonthYear(meeting.scheduledAt), meeting.actionItems.length)}
        shareDisabledReason={shareDisabledReason}
        onMessage={(m) => setScreenMessages([{ level: m.level, text: m.text }])}
      />
    </span>
  ) : undefined;

  const saveMissing = !draft ? [] : [
    ...(draft.title.trim() ? [] : ["Title"]),
    ...(draft.scheduledAt ? [] : ["Date & time"]),
  ];

  return (
    <ObjectScreen
      breadcrumb="Minutes of Meeting / Meeting"
      title={mode === "edit" ? "Edit Meeting" : meeting.title}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[meeting.status] ?? "neutral", label: meeting.status }}
      facets={[
        { label: "System ID", value: meeting.systemId ?? "—" },
        { label: "When", value: formatDateTime(meeting.scheduledAt) },
        { label: "Type", value: meeting.meetingType },
        ...(meeting.publishedAt ? [{ label: "Published", value: formatDateTime(meeting.publishedAt) }] : []),
      ]}
      headerActions={headerActions}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? cancelEdit : undefined}
      onBack={() => router.push(meeting.projectId ? `/moms?projectId=${meeting.projectId}` : "/moms")}
      saveDisabled={saving || saveMissing.length > 0}
      saveDisabledReason={saving ? "Saving…" : saveMissing.length ? saveMissing.join(", ") : undefined}
      messages={[
        ...screenMessages,
        ...(isPublished ? [{ level: "info" as const, text: "This meeting is published and locked -- its details and minutes cannot be edited." }] : []),
      ]}
    >
      {mode === "display" && !isPublished && (
        <div className="flex flex-wrap items-center gap-2 border-b border-ct-border px-4 py-3">
          {/* Secondary (outlined), never the page's primary -- and it names its
              own reason while there is nothing to publish. */}
          {!confirmingPublish ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!canPublish || publishing}
              onClick={() => setConfirmingPublish(true)}
            >
              {publishing ? "Publishing…" : publishLockLabel(meeting.minutes)}
            </Button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ct-navy">
              <span>{PUBLISH_LOCK_CONFIRM}</span>
              <Button size="sm" variant="outline" disabled={publishing} onClick={publish}>
                {publishing ? "Publishing…" : PUBLISH_LOCK_LABEL}
              </Button>
              <Button size="sm" variant="ghost" disabled={publishing} onClick={() => setConfirmingPublish(false)}>Cancel</Button>
            </span>
          )}
        </div>
      )}

      {mode === "edit" && draft ? (
        <div className="space-y-5 px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Title</Label><Input value={draft.title} onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))} /></div>
            <div className="space-y-1.5"><Label>Date &amp; time</Label><Input type="datetime-local" value={draft.scheduledAt} onChange={(e) => setDraft((d) => (d ? { ...d, scheduledAt: e.target.value } : d))} /></div>
          </div>
          <div className="space-y-1.5 sm:w-1/2">
            <Label>Type</Label>
            <Select value={draft.meetingType} onValueChange={(v) => setDraft((d) => (d ? { ...d, meetingType: v } : d))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="vendor">Vendor</SelectItem>
                <SelectItem value="one_on_one">One-on-one</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* The same attendee control the create screen uses -- colleagues
              picked out of the org, externals added by name and company -- so
              nobody has to retype a comma-separated list here. */}
          <AttendeesField value={draft.attendees} onChange={(next) => setDraft((d) => (d ? { ...d, attendees: next } : d))} />

          <div className="space-y-2">
            <Label>Agenda</Label>
            <ul className="space-y-1.5">
              {draft.agenda.map((item, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-px-muted">•</span>
                  <Input
                    aria-label={`Agenda item ${i + 1}`}
                    value={item}
                    placeholder="What this meeting covers"
                    onChange={(e) => setDraft((d) => (d ? { ...d, agenda: d.agenda.map((a, idx) => (idx === i ? e.target.value : a)) } : d))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setDraft((d) => (d ? { ...d, agenda: [...d.agenda.slice(0, i + 1), "", ...d.agenda.slice(i + 1)] } : d));
                      }
                    }}
                  />
                  <Button
                    type="button" variant="ghost" size="icon" aria-label={`Remove agenda item ${i + 1}`}
                    disabled={draft.agenda.length === 1}
                    onClick={() => setDraft((d) => (d ? { ...d, agenda: d.agenda.filter((_, idx) => idx !== i) } : d))}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft((d) => (d ? { ...d, agenda: [...d.agenda, ""] } : d))}>
              <Plus className="size-3.5" aria-hidden="true" /> Add agenda item
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>Minutes</Label>
            <Textarea
              value={draft.minutes}
              rows={Math.min(24, Math.max(8, draft.minutes.split("\n").length + 1))}
              placeholder="Type what is being said, as it is said…"
              onChange={(e) => setDraft((d) => (d ? { ...d, minutes: e.target.value } : d))}
            />
          </div>

          <div className="space-y-2">
            <Label>Add action items</Label>
            <ul className="space-y-2">
              {draft.newActionItems.map((item, i) => (
                <li key={i} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[220px] flex-1 space-y-1">
                    <span className="text-[12px] text-px-muted">Description</span>
                    <Input
                      aria-label={`Action item ${i + 1} description`}
                      value={item.title}
                      onChange={(e) => setDraft((d) => (d ? { ...d, newActionItems: d.newActionItems.map((a, idx) => (idx === i ? { ...a, title: e.target.value } : a)) } : d))}
                    />
                  </div>
                  <div className="w-56 space-y-1">
                    <span className="text-[12px] text-px-muted">Owner</span>
                    <OrgUserPicker
                      ariaLabel={`Action item ${i + 1} owner`}
                      value={item.assigneeUserId}
                      onChange={(userId, user) =>
                        setDraft((d) => (d ? { ...d, newActionItems: d.newActionItems.map((a, idx) => (idx === i ? { ...a, assigneeUserId: userId, assigneeName: user?.name ?? null } : a)) } : d))
                      }
                    />
                  </div>
                  <div className="w-40 space-y-1">
                    <span className="text-[12px] text-px-muted">Due date</span>
                    <Input
                      type="date"
                      aria-label={`Action item ${i + 1} due date`}
                      value={item.dueDate}
                      onChange={(e) => setDraft((d) => (d ? { ...d, newActionItems: d.newActionItems.map((a, idx) => (idx === i ? { ...a, dueDate: e.target.value } : a)) } : d))}
                    />
                  </div>
                  <Button
                    type="button" variant="ghost" size="icon" aria-label={`Remove action item ${i + 1}`}
                    disabled={draft.newActionItems.length === 1}
                    onClick={() => setDraft((d) => (d ? { ...d, newActionItems: d.newActionItems.filter((_, idx) => idx !== i) } : d))}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft((d) => (d ? { ...d, newActionItems: [...d.newActionItems, emptyActionItem()] } : d))}>
              <Plus className="size-3.5" aria-hidden="true" /> Add action item
            </Button>
            <p className="text-[12px] text-px-muted">Each action item becomes a real task for its owner — it shows up in their &quot;Needs you&quot; list.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-5 px-4 py-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="mb-1 font-semibold text-ct-navy">Attendees</h4>
              {meeting.attendees.length === 0 ? <p className="text-ct-muted">None listed.</p> : (
                <div className="flex flex-wrap gap-1">{meeting.attendees.map((a) => <Badge key={a} variant="outline">{a}</Badge>)}</div>
              )}
            </div>
            <div>
              <h4 className="mb-1 font-semibold text-ct-navy">Agenda</h4>
              {meeting.agenda.length === 0 ? <p className="text-ct-muted">None listed.</p> : (
                <ul className="list-disc space-y-0.5 pl-4">{meeting.agenda.map((a) => <li key={a}>{a}</li>)}</ul>
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-1.5 font-semibold text-ct-navy text-sm">Minutes</h4>
            {/* Display text, not a textarea. Reading a meeting is the common
                case; editing one is the deliberate act behind Edit. */}
            {meeting.minutes?.trim() ? (
              <p className="whitespace-pre-wrap text-sm text-ct-navy">{meeting.minutes}</p>
            ) : (
              <p className="text-sm text-ct-muted">No minutes yet — press Edit to write them.</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={generateSummary} disabled={busy === "ai"}>
                {busy === "ai" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Generate AI Summary
              </Button>
            </div>
            {meeting.aiSummary && (
              <div className="mt-3 space-y-2 rounded-md border border-ct-border bg-ct-cloud/30 p-3 text-sm">
                <p>{meeting.aiSummary}</p>
                {meeting.aiKeyDecisions.length > 0 && (
                  <div>
                    <p className="font-medium text-ct-navy">Key Decisions</p>
                    <ul className="list-disc pl-4">{meeting.aiKeyDecisions.map((d) => <li key={d}>{d}</li>)}</ul>
                  </div>
                )}
                {meeting.aiSuggestedActionItems.length > 0 && (
                  <div>
                    <p className="font-medium text-ct-navy">AI-Suggested Action Items</p>
                    <ul className="space-y-1">
                      {meeting.aiSuggestedActionItems.map((s, i) => (
                        <li key={i} className="flex items-center justify-between gap-2">
                          <span>{s.title}{s.assignee ? ` — ${s.assignee}` : ""}{s.dueDateHint ? ` (${s.dueDateHint})` : ""}</span>
                          {!isPublished && (
                            <Button size="sm" variant="ghost" onClick={() => promoteSuggestion(s)}>Add as Action Item</Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-1.5 font-semibold text-ct-navy text-sm">Action Items</h4>
            {meeting.actionItems.length === 0 ? (
              <p className="text-sm text-ct-muted">No action items yet — press Edit to add one.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {meeting.actionItems.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-md border border-ct-border px-2 py-1.5">
                    <span>{a.task.title}</span>
                    <span className="text-xs text-ct-muted">{a.task.status}{a.task.dueDate ? ` · due ${new Date(a.task.dueDate).toLocaleDateString()}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 font-semibold text-ct-navy text-sm"><Link2 className="size-3.5" /> Share Links</h4>
            {links.length === 0 ? (
              <p className="text-sm text-ct-muted">No share links created yet.</p>
            ) : (
              <ul className="mb-2 space-y-1 text-sm">
                {links.map((l) => {
                  const revoked = !!l.revokedAt;
                  const expired = !revoked && new Date(l.expiresAt) < new Date();
                  return (
                    <li key={l.id} className="flex items-center justify-between rounded-md border border-ct-border px-2 py-1.5">
                      <span className="font-mono text-xs">{l.token.slice(0, 12)}…</span>
                      <span className="flex items-center gap-2">
                        <Badge variant={revoked ? "outline" : expired ? "outline" : "default"}>{revoked ? "revoked" : expired ? "expired" : "active"}</Badge>
                        {!revoked && !expired && (
                          <Button size="sm" variant="ghost" disabled={busy === `revoke-${l.id}`} onClick={() => revokeLink(l.id)}>
                            <Ban className="size-3.5" /> Revoke
                          </Button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {/* Creating and sending a link is the Share control at the top of
                this screen; what stays here is the audit view of the links
                that exist and the ability to revoke one. */}
            <p className="text-xs text-ct-muted">Use Share on WhatsApp or Share link above to create one.</p>
          </div>
        </div>
      )}
    </ObjectScreen>
  );
}
