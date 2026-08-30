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
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Download, Sparkles, Send, Link2, Ban } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDateTime } from "@/lib/format-date";

type ActionItem = { id: string; task: { id: string; title: string; status: string; dueDate: string | null; userId: string | null } };
type SuggestedActionItem = { title: string; assignee: string | null; dueDateHint: string | null };
type Meeting = {
  id: string; projectId: string | null; title: string; meetingType: string; status: string; scheduledAt: string;
  attendees: string[]; agenda: string[]; minutes: string | null; systemId: string | null;
  publishedAt: string | null; aiSummary: string | null; aiKeyDecisions: string[]; aiSuggestedActionItems: SuggestedActionItem[];
  actionItems: ActionItem[];
};
type ShareLink = { id: string; token: string; expiresAt: string; revokedAt: string | null; createdAt: string };

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", published: "done" };

export default function MoMObjectClient({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ title: "", meetingType: "team", scheduledAt: "", attendees: "", agenda: "" });
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [minutesDraft, setMinutesDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionTitle, setActionTitle] = useState("");
  const [actionAssignee, setActionAssignee] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");

  async function load() {
    try {
      const [data, linkData] = await Promise.all([
        fetchJson<Meeting>(`/api/moms/${meetingId}`),
        fetchJson<{ links?: ShareLink[] }>(`/api/moms/${meetingId}/share-links`).catch(() => ({ links: [] })),
      ]);
      setMeeting(data);
      setMinutesDraft(data.minutes ?? "");
      setLinks(linkData.links ?? []);
      setLoadError(null);
    } catch (err) {
      setMeeting(null);
      setLoadError(errorMessage(err, "Couldn't load this meeting"));
    }
  }
  useEffect(() => { load(); }, [meetingId]);

  function toLocalInputValue(iso: string) {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function startEdit() {
    if (!meeting) return;
    setDraft({
      title: meeting.title, meetingType: meeting.meetingType, scheduledAt: toLocalInputValue(meeting.scheduledAt),
      attendees: meeting.attendees.join(", "), agenda: meeting.agenda.join("\n"),
    });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.title.trim() || !draft.scheduledAt) { toast.error("Title and date/time are required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/moms/${meetingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(), meetingType: draft.meetingType, scheduledAt: new Date(draft.scheduledAt).toISOString(),
          attendees: draft.attendees.split(",").map((s) => s.trim()).filter(Boolean),
          agenda: draft.agenda.split("\n").map((s) => s.trim()).filter(Boolean),
        }),
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

  async function publish() {
    setPublishing(true);
    try {
      const res = await fetch(`/api/moms/${meetingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to publish meeting");
      toast.success("Meeting published and locked");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't publish meeting");
    } finally {
      setPublishing(false);
    }
  }

  async function saveMinutes() {
    setBusy("minutes");
    try {
      const res = await fetch(`/api/moms/${meetingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: minutesDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save minutes");
      toast.success("Minutes saved");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save minutes");
    } finally {
      setBusy(null);
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

  function promoteSuggestion(s: SuggestedActionItem) {
    setActionTitle(s.title);
    setActionAssignee(s.assignee ?? "");
  }

  async function addActionItem() {
    if (!actionTitle.trim() || !actionAssignee.trim()) { toast.error("Title and assignee (user id) are required"); return; }
    setBusy("action");
    try {
      const res = await fetch(`/api/moms/${meetingId}/action-items`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: actionTitle.trim(), assigneeUserId: actionAssignee.trim(), dueDate: actionDueDate || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to add action item");
      toast.success("Action item added");
      setActionTitle(""); setActionAssignee(""); setActionDueDate("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add action item");
    } finally {
      setBusy(null);
    }
  }

  async function createShareLink() {
    setBusy("share");
    try {
      const res = await fetch(`/api/moms/${meetingId}/share-links`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.whatsappHref) throw new Error(data?.error ?? "Failed to create a share link");
      window.open(data.whatsappHref, "_blank", "noopener,noreferrer");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to share to WhatsApp");
    } finally {
      setBusy(null);
    }
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
      onEdit={!isPublished && mode === "display" ? startEdit : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onBack={() => router.push(meeting.projectId ? `/moms?projectId=${meeting.projectId}` : "/moms")}
      saveDisabled={saving || !draft.title.trim() || !draft.scheduledAt}
      saveDisabledReason={saving ? "Saving…" : !draft.title.trim() || !draft.scheduledAt ? "Title and date/time are required" : undefined}
      messages={isPublished ? [{ level: "info", text: "This meeting is published and locked -- its details and minutes cannot be edited." }] : []}
    >
      {!isPublished && mode === "display" && (
        <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
          <Button size="sm" disabled={publishing} onClick={publish}>{publishing ? "Publishing…" : "Publish & Lock"}</Button>
        </div>
      )}

      {mode === "edit" ? (
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5"><Label>Title</Label><Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={draft.meetingType} onValueChange={(v) => setDraft((d) => ({ ...d, meetingType: v }))}>
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
            <div className="space-y-1.5"><Label>Date &amp; time</Label><Input type="datetime-local" value={draft.scheduledAt} onChange={(e) => setDraft((d) => ({ ...d, scheduledAt: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Attendees (comma-separated)</Label><Input value={draft.attendees} onChange={(e) => setDraft((d) => ({ ...d, attendees: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Agenda (one per line)</Label><Textarea value={draft.agenda} onChange={(e) => setDraft((d) => ({ ...d, agenda: e.target.value }))} rows={3} /></div>
        </div>
      ) : (
        <div className="space-y-5 px-4 py-3">
          {(meeting.attendees.length > 0 || meeting.agenda.length > 0) && (
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
          )}

          <div>
            <h4 className="mb-1.5 font-semibold text-ct-navy text-sm">Minutes</h4>
            <Textarea value={minutesDraft} onChange={(e) => setMinutesDraft(e.target.value)} rows={8} placeholder="Type live meeting notes here…" disabled={isPublished} />
            <div className="mt-2 flex items-center gap-2">
              {!isPublished && (
                <Button size="sm" onClick={saveMinutes} disabled={busy === "minutes"}>{busy === "minutes" ? "Saving…" : "Save Minutes"}</Button>
              )}
              <Button size="sm" variant="outline" onClick={generateSummary} disabled={busy === "ai"}>
                {busy === "ai" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Generate AI Summary
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a href={`/api/moms/${meeting.id}/pdf`} target="_blank" rel="noopener noreferrer"><Download className="size-3.5" /> PDF</a>
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
                          <Button size="sm" variant="ghost" onClick={() => promoteSuggestion(s)}>Add as Action Item</Button>
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
              <p className="text-sm text-ct-muted">No action items yet.</p>
            ) : (
              <ul className="mb-2 space-y-1 text-sm">
                {meeting.actionItems.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-md border border-ct-border px-2 py-1.5">
                    <span>{a.task.title}</span>
                    <span className="text-xs text-ct-muted">{a.task.status}{a.task.dueDate ? ` · due ${new Date(a.task.dueDate).toLocaleDateString()}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5"><Label>Title</Label><Input className="w-52" value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Assignee (user id)</Label>
                <Input className="w-40" value={actionAssignee} onChange={(e) => setActionAssignee(e.target.value)} placeholder="usr_abc123" />
              </div>
              <div className="space-y-1.5"><Label>Due Date (optional)</Label><Input type="date" className="w-40" value={actionDueDate} onChange={(e) => setActionDueDate(e.target.value)} /></div>
              <Button size="sm" disabled={busy === "action"} onClick={addActionItem}>{busy === "action" ? "Adding…" : "Add"}</Button>
            </div>
            <p className="mt-1 text-xs text-ct-muted">No org directory/picker yet -- paste a known VERIDIAN user ID.</p>
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
            <Button size="sm" variant="outline" disabled={busy === "share"} onClick={createShareLink}>
              {busy === "share" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Create Share Link &amp; Send via WhatsApp
            </Button>
          </div>
        </div>
      )}
    </ObjectScreen>
  );
}
