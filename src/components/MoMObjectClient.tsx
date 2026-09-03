"use client";

// Real-screen conversion (2026-08-30): replaces the old inline "selected"
// panel (a Card toggled by local state, not a real URL) with a real Object
// Page. This module's backend was already far richer than the old UI
// surfaced -- publish/lock, action items, and share-link management all
// existed in veri-meeting-service.ts with working v1 routes, just never
// wired to any button.
//
// ─── R67 D-17 / D-19 / D-21 ───────────────────────────────────────────────
// What the R66 audit recorded about this screen, and what each change closes:
//
//  D-17  Minutes are Sumeet's LIVE artefact -- typed during the meeting -- but
//        the only way to keep them was to remember to press "Save Minutes".
//        They now autosave on a 2s debounce (the fork's ObjectScreen owns the
//        timing), the explicit button is "Save now", and the state is stated
//        beside the Minutes heading as "Saving…" / "Saved HH:mm" / "Not saved
//        - retrying". A failed save NEVER clears the box: the text stays, the
//        save retries with back-off, and the failure sits in the persistent
//        footer band instead of a toast that vanishes.
//
//  D-17  Delete did not exist at all, and Edit disappeared silently once a
//        meeting was published -- a missing feature and a broken one look
//        identical. Both are now always rendered and disabled with the reason
//        beside them (see src/components/screens/ObjectScreen.tsx, the
//        PROJEXA-local fork this screen imports).
//
//  D-17  Publish was ONE CLICK and irreversible: it locks the title, date,
//        attendees, agenda and minutes forever. It is now behind a confirm
//        that states that blast radius in words, and is refused while there
//        is unsaved minutes text.
//
//  D-17  The PDF was a ghost icon-link and the share was an outline button,
//        both buried in the body. They are now a worded Export menu in the
//        object header: Export PDF / Send on WhatsApp / Copy link. Published
//        meetings keep it -- a locked meeting is exactly the one you send.
//
//  D-19  The assignee field asked for a pasted VERIDIAN user id and apologised
//        on screen for having no directory. It is a real people picker over
//        GET /api/org-users, with the meeting's own attendees listed first.
//
//  D-21  The share link named VERIDIAN to a PROJEXA customer and pointed at
//        whichever host answered. The proxy now sends brand + shareOrigin and
//        the composed message comes back from the server; this screen reports
//        the expiry and lists live links with a worded Revoke.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ObjectScreen } from "@/components/screens/ObjectScreen";
import type { FieldMessage, StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { ObjectContext } from "@/components/shell/shell-screen-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Loader2, Sparkles } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDateTime, formatTime } from "@/lib/format-date";
import {
  ACTION_ITEM_VALIDATION_MESSAGE, addActionItemDisabledReason, displayNameOf,
  groupOrgUsers, initialsOf, roleLabelOf, type OrgUser,
} from "@/lib/org-user-picker";

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

/**
 * R67 A-20 -- THE COMPOSER'S OBJECT-PAGE CARDS PUT THE CURSOR ON THE REAL
 * CONTROL. "Save minutes" and "Share via WhatsApp" are both live on THIS page,
 * so those cards navigate here with ?focus=minutes / ?focus=share and this
 * focuses the control they name -- rather than doing it, which would make a
 * card execute a write from one click, or doing nothing, which would land the
 * user on a long page to find the button themselves. Same shape as A-04's
 * ?focus=activity on the Work Progress form, and the targets are explicit
 * data-focus attributes rather than a positional querySelector, because both
 * controls are this file's own markup.
 *
 * IT IS A SEPARATE COMPONENT BEHIND A SUSPENSE BOUNDARY -- the convention this
 * repo already uses for useSearchParams() (search-command.tsx's
 * SearchDialogWithProject, M24Shell's RouteProjectIdReader), because reading it
 * in the page's own component opts the route out of static rendering. It is
 * mounted only once the meeting has loaded, which is when the controls it looks
 * for exist. It renders nothing.
 */
function FocusRequest() {
  const focus = useSearchParams().get("focus");
  useEffect(() => {
    if (!focus) return;
    const control = document.querySelector<HTMLElement>(`[data-focus="${focus}"]`);
    control?.focus();
    control?.scrollIntoView({ block: "center" });
  }, [focus]);
  return null;
}


// Escalating, bounded. A save that keeps failing must not hammer the API, and
// must not give up silently either -- the last step repeats until it works or
// the user leaves, with the box still holding their text.
const RETRY_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000];

type MinutesState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: Date }
  | { status: "retrying" };

export default function MoMObjectClient({
  meetingId,
  justCreated = false,
}: {
  meetingId: string;
  /** ?created=1 -- so the footer can name the thing that was just made. */
  justCreated?: boolean;
}) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ title: "", meetingType: "team", scheduledAt: "", attendees: "", agenda: "" });
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirming, setConfirming] = useState<"publish" | "delete" | null>(null);

  const [minutesDraft, setMinutesDraft] = useState("");
  const [minutesState, setMinutesState] = useState<MinutesState>({ status: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<FieldMessage[]>([]);

  const [actionTitle, setActionTitle] = useState("");
  const [actionAssignee, setActionAssignee] = useState<OrgUser | null>(null);
  const [actionDueDate, setActionDueDate] = useState("");
  const [actionAttempted, setActionAttempted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);

  // The last text the server has confirmed. Kept in a ref, not state, because
  // the retry timer closes over it and must always see the newest value.
  const savedMinutesRef = useRef<string>("");
  const latestMinutesRef = useRef<string>("");
  // The retry timer has to call the SAME function it was scheduled from. A
  // direct self-reference inside the useCallback would capture the first
  // instance forever (and React's lint rule refuses it), so the timer goes
  // through this always-current handle instead.
  const patchMinutesRef = useRef<(text: string) => Promise<void>>(async () => {});
  const retryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; attempt: number }>({ timer: null, attempt: 0 });
  const minutesBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const hydratedRef = useRef(false);

  const isPublished = meeting?.status === "published";

  const load = useCallback(async () => {
    try {
      const [data, linkData] = await Promise.all([
        fetchJson<Meeting>(`/api/moms/${meetingId}`),
        fetchJson<{ links?: ShareLink[] }>(`/api/moms/${meetingId}/share-links`).catch(() => ({ links: [] })),
      ]);
      setMeeting(data);
      // Only ever seed the box from the server on first load, or when there is
      // nothing unsaved in it. A reload triggered by some other action must
      // never overwrite text the user is still typing.
      const serverMinutes = data.minutes ?? "";
      if (!hydratedRef.current || latestMinutesRef.current === savedMinutesRef.current) {
        setMinutesDraft(serverMinutes);
        latestMinutesRef.current = serverMinutes;
      }
      savedMinutesRef.current = serverMinutes;
      hydratedRef.current = true;
      setLinks(linkData.links ?? []);
      setLoadError(null);
    } catch (err) {
      setMeeting(null);
      setLoadError(errorMessage(err, "Couldn't load this meeting"));
    }
  }, [meetingId]);

  useEffect(() => { void load(); }, [load]);

  // Clear any pending retry when this screen goes away, so a background timer
  // cannot fire against an unmounted component.
  useEffect(() => () => { if (retryRef.current.timer) clearTimeout(retryRef.current.timer); }, []);

  // D-17: arriving from /moms/new names what was just made, with its number,
  // in the persistent band. Landing the CURSOR in the minutes box is lane A's
  // FocusRequest above -- ?focus=minutes against this file's own
  // data-focus="minutes" -- so there is one focus mechanism on this page, not
  // a prop and a query param that could disagree.
  useEffect(() => {
    if (!meeting) return;
    if (justCreated) {
      const number = meeting.systemId ? ` (${meeting.systemId})` : "";
      setNotices((prev) =>
        prev.some((n) => n.field === "created")
          ? prev
          : [...prev, { field: "created", level: "success", text: `Created meeting ${meeting.title}${number} - start typing the minutes` }]
      );
    }
    // Runs once the meeting is first known; nothing here depends on later edits.
  }, [meeting?.id, meeting?.systemId, meeting?.title, justCreated]);

  // D-19: the org directory the picker used to apologise for not having.
  useEffect(() => {
    let cancelled = false;
    const query = pickerQuery.trim();
    const timer = setTimeout(() => {
      fetchJson<{ users?: OrgUser[] }>(`/api/org-users${query ? `?q=${encodeURIComponent(query)}` : ""}`)
        .then((data) => { if (!cancelled) setOrgUsers(data.users ?? []); })
        .catch(() => { if (!cancelled) setOrgUsers([]); });
    }, query ? 200 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pickerQuery]);

  function note(message: FieldMessage) {
    setNotices((prev) => [...prev.filter((n) => n.field !== message.field), message]);
  }

  function clearNote(field: string) {
    setNotices((prev) => prev.filter((n) => n.field !== field));
  }

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
    if (!draft.title.trim() || !draft.scheduledAt) return;
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
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to save meeting");
      clearNote("edit");
      note({ field: "edit", level: "success", text: "Meeting details saved" });
      setMode("display");
      await load();
    } catch (err) {
      note({ field: "edit", level: "error", text: errorMessage(err, "Couldn't save meeting") });
    } finally {
      setSaving(false);
    }
  }

  // ─── Minutes: autosave, explicit save, retry with back-off ───────────────
  const patchMinutes = useCallback(async (text: string) => {
    if (isPublished) return;
    if (text === savedMinutesRef.current) return; // nothing to save -- also stops the fork's onChangeCapture from firing a write for an unrelated field
    if (retryRef.current.timer) { clearTimeout(retryRef.current.timer); retryRef.current.timer = null; }
    setMinutesState({ status: "saving" });
    try {
      const res = await fetch(`/api/moms/${meetingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't save minutes");
      savedMinutesRef.current = text;
      setMeeting((prev) => (prev ? { ...prev, minutes: text } : prev));
      retryRef.current.attempt = 0;
      clearNote("minutes");
      setMinutesState({ status: "saved", at: new Date() });
    } catch (err) {
      // The text stays in the box. The failure is stated once, persistently.
      note({ field: "minutes", level: "error", text: errorMessage(err, "Couldn't save minutes") });
      setMinutesState({ status: "retrying" });
      const attempt = Math.min(retryRef.current.attempt + 1, RETRY_BACKOFF_MS.length);
      retryRef.current.attempt = attempt;
      retryRef.current.timer = setTimeout(() => { void patchMinutesRef.current(latestMinutesRef.current); }, RETRY_BACKOFF_MS[attempt - 1]);
    }
  }, [isPublished, meetingId]);

  useEffect(() => { patchMinutesRef.current = patchMinutes; }, [patchMinutes]);

  function onMinutesChange(value: string) {
    latestMinutesRef.current = value;
    setMinutesDraft(value);
  }

  // Derived from state, not from savedMinutesRef: meeting.minutes IS the last
  // value the server confirmed (patchMinutes writes it back on success), and a
  // ref read during render would not re-render the pencil or Save now.
  const hasUnsavedMinutes = minutesDraft !== (meeting?.minutes ?? "");

  async function publish() {
    setConfirming(null);
    setPublishing(true);
    try {
      const res = await fetch(`/api/moms/${meetingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to publish meeting");
      note({ field: "publish", level: "success", text: `Published and locked at ${formatTime(new Date())}` });
      await load();
    } catch (err) {
      note({ field: "publish", level: "error", text: errorMessage(err, "Couldn't publish meeting") });
    } finally {
      setPublishing(false);
    }
  }

  async function deleteMeeting() {
    if (!meeting) return;
    setConfirming(null);
    setBusy("delete");
    try {
      const res = await fetch(`/api/moms/${meetingId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't delete this meeting");
      // The confirmation belongs where the user lands, not on a screen that is
      // about to unmount -- MoMsClient renders ?deleted= as a persistent notice.
      const base = meeting.projectId ? `/moms?projectId=${meeting.projectId}&` : "/moms?";
      router.push(`${base}deleted=${encodeURIComponent(meeting.title)}`);
    } catch (err) {
      note({ field: "delete", level: "error", text: errorMessage(err, "Couldn't delete this meeting") });
      setBusy(null);
    }
  }

  async function generateSummary() {
    setBusy("ai");
    try {
      const res = await fetch(`/api/moms/${meetingId}/generate-intelligence`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to generate AI summary");
      clearNote("ai");
      note({ field: "ai", level: "success", text: "AI summary generated" });
      await load();
    } catch (err) {
      note({ field: "ai", level: "error", text: errorMessage(err, "Couldn't generate AI summary") });
    } finally {
      setBusy(null);
    }
  }

  // D-19: an AI suggestion promotes into the SAME picker -- its `assignee` is
  // free text the model read out of the minutes, so it seeds the search rather
  // than pretending to be a user id.
  function promoteSuggestion(s: SuggestedActionItem) {
    setActionTitle(s.title);
    if (s.assignee) {
      setPickerQuery(s.assignee);
      setPickerOpen(true);
    }
  }

  const addDisabledReason = addActionItemDisabledReason({
    title: actionTitle, assigneeId: actionAssignee?.id ?? "", busy: busy === "action",
  });

  async function addActionItem() {
    if (addDisabledReason) { setActionAttempted(true); return; }
    setActionAttempted(false);
    setBusy("action");
    try {
      const res = await fetch(`/api/moms/${meetingId}/action-items`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: actionTitle.trim(), assigneeUserId: actionAssignee!.id, dueDate: actionDueDate || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to add action item");
      clearNote("action");
      note({ field: "action", level: "success", text: `Action item added for ${displayNameOf(actionAssignee!)}` });
      setActionTitle(""); setActionAssignee(null); setActionDueDate(""); setPickerQuery("");
      await load();
    } catch (err) {
      note({ field: "action", level: "error", text: errorMessage(err, "Couldn't add action item") });
    } finally {
      setBusy(null);
    }
  }

  // ─── Share (D-21) ────────────────────────────────────────────────────────
  async function createShareLink(open: "whatsapp" | "clipboard") {
    setBusy("share");
    try {
      const res = await fetch(`/api/moms/${meetingId}/share-links`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.shareUrl) throw new Error(data?.error ?? "Failed to create a share link");
      if (open === "whatsapp" && data.whatsappHref) {
        window.open(data.whatsappHref, "_blank", "noopener,noreferrer");
      } else if (open === "clipboard") {
        await navigator.clipboard?.writeText(data.shareUrl).catch(() => {});
      }
      clearNote("share");
      note({
        field: "share", level: "success",
        text: `Share link created - expires ${formatDateTime(data.expiresAt)}${open === "clipboard" ? " - copied to your clipboard" : ""}`,
      });
      await load();
    } catch (err) {
      note({ field: "share", level: "error", text: errorMessage(err, "Couldn't create a share link") });
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
      clearNote("share");
      note({ field: "share", level: "success", text: "Share link revoked - it no longer opens" });
      await load();
    } catch (err) {
      note({ field: "share", level: "error", text: errorMessage(err, "Couldn't revoke share link") });
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }
  if (!meeting) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const minutesStatusText =
    minutesState.status === "saving" ? "Saving…"
    : minutesState.status === "retrying" ? "Not saved - retrying"
    : minutesState.status === "saved" ? `Saved ${formatTime(minutesState.at)}`
    : null;

  const groups = groupOrgUsers(orgUsers, meeting.attendees);
  const publishDisabledReason = hasUnsavedMinutes ? "Save minutes first" : undefined;

  return (
    <>
      {/* A-20: mounted here, after the meeting has loaded, so the control the
          composer's card named already exists when the focus is applied. */}
      <Suspense fallback={null}>
        <FocusRequest />
      </Suspense>
      {/* R67 A-21 -- THE STRIP NAMES THIS MEETING. Same reason and same moment
          as the focus request above: the meeting is fetched in the browser, so
          the title and the project only exist once it has arrived.
          `meeting.projectId` is genuinely nullable here -- a meeting can be
          filed against no project at all -- and null is published as null
          rather than being replaced with the rail's guess. */}
      <ObjectContext moduleId="moms" label={meeting.title} projectId={meeting.projectId} />
    <ObjectScreen
      breadcrumb="Minutes of Meeting / Meeting"
      title={mode === "edit" ? "Edit Meeting" : meeting.title}
      mode={mode}
      // D-17: the pencil marks unsaved live text, which is exactly what the
      // kit's hasDraft flag is for.
      hasDraft={hasUnsavedMinutes}
      headerStatus={{ tone: STATUS_TONE[meeting.status] ?? "neutral", label: meeting.status }}
      headerActions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">Export</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={`/api/moms/${meeting.id}/pdf`} target="_blank" rel="noopener noreferrer">Export PDF</a>
            </DropdownMenuItem>
            <DropdownMenuItem data-focus="share" disabled={busy === "share"} onSelect={() => void createShareLink("whatsapp")}>
              Send on WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy === "share"} onSelect={() => void createShareLink("clipboard")}>
              Copy link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      facets={[
        // D-19: "System ID" is what a database calls it; "Meeting no." is what
        // the person holding the printed minutes calls it.
        { label: "Meeting no.", value: meeting.systemId ?? "—" },
        { label: "When", value: formatDateTime(meeting.scheduledAt) },
        { label: "Type", value: meeting.meetingType },
        ...(meeting.publishedAt ? [{ label: "Published", value: formatDateTime(meeting.publishedAt) }] : []),
      ]}
      onEdit={!isPublished && mode === "display" ? startEdit : undefined}
      editDisabledReason={isPublished ? "Published meetings cannot be edited" : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      // D-17: always rendered. It used to be absent on anything but a draft,
      // which is indistinguishable from a broken build.
      onDelete={() => setConfirming("delete")}
      deleteDisabledReason={
        busy === "delete" ? "Deleting…"
        : meeting.status === "draft" ? undefined
        : "Published meetings cannot be deleted"
      }
      onBack={() => router.push(meeting.projectId ? `/moms?projectId=${meeting.projectId}` : "/moms")}
      saveDisabled={saving || !draft.title.trim() || !draft.scheduledAt}
      saveDisabledReason={saving ? "Saving…" : !draft.title.trim() || !draft.scheduledAt ? "Title and date/time are required" : undefined}
      // D-17: minutes autosave. The fork arms the kit's own 2s debounce in
      // display mode too, because live minutes are typed on the display page --
      // there is no "edit mode" to enter for them.
      onAutosave={isPublished ? undefined : () => void patchMinutes(latestMinutesRef.current)}
      messages={[
        ...(isPublished ? [{ level: "info" as const, text: "This meeting is published and locked -- its details and minutes cannot be edited." }] : []),
        ...(actionAttempted && addDisabledReason ? [{ field: "action-validation", level: "warning" as const, text: ACTION_ITEM_VALIDATION_MESSAGE }] : []),
        ...notices,
      ]}
    >
      {!isPublished && mode === "display" && (
        <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
          <Button
            size="sm"
            disabled={publishing || !!publishDisabledReason}
            title={publishDisabledReason}
            onClick={() => setConfirming("publish")}
          >
            {publishing ? "Publishing…" : "Publish & Lock"}
            {publishDisabledReason && <span className="ml-1.5 text-[11px] font-normal">({publishDisabledReason})</span>}
          </Button>
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
            <div className="mb-1.5 flex items-center gap-2">
              <h4 className="font-semibold text-ct-navy text-sm">Minutes</h4>
              {/* State beside the heading, where the eye already is -- not a
                  toast that has gone by the time the typist looks up. */}
              {minutesStatusText && (
                <span
                  role="status"
                  aria-live="polite"
                  className={`text-[11px] ${minutesState.status === "retrying" ? "text-px-error" : "text-ct-muted"}`}
                >
                  {minutesStatusText}
                </span>
              )}
            </div>
            <Textarea
              data-focus="minutes"
              ref={minutesBoxRef}
              value={minutesDraft}
              onChange={(e) => onMinutesChange(e.target.value)}
              rows={8}
              placeholder="Type live meeting notes here…"
              disabled={isPublished}
            />
            <div className="mt-2 flex items-center gap-2">
              {!isPublished && (
                <Button size="sm" onClick={() => void patchMinutes(minutesDraft)} disabled={minutesState.status === "saving" || !hasUnsavedMinutes}>
                  Save now
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => void generateSummary()} disabled={busy === "ai"}>
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
                    <span className="text-xs text-ct-muted">{a.task.status}{a.task.dueDate ? ` · due ${formatDateTime(a.task.dueDate)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5"><Label htmlFor="mom-action-title">Title</Label><Input id="mom-action-title" className="w-52" value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} /></div>

              {/* D-19: a real people picker. This used to be a text box
                  captioned "paste a known VERIDIAN user ID". */}
              <div className="space-y-1.5">
                <Label htmlFor="mom-action-assignee">Assignee</Label>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="mom-action-assignee"
                      type="button"
                      variant="outline"
                      size="sm"
                      role="combobox"
                      aria-expanded={pickerOpen}
                      className="w-56 justify-between font-normal"
                    >
                      {actionAssignee ? (
                        <span className="flex items-center gap-1.5 truncate">
                          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ct-cloud text-[10px] font-medium text-ct-navy">
                            {initialsOf(actionAssignee)}
                          </span>
                          <span className="truncate">{displayNameOf(actionAssignee)}</span>
                        </span>
                      ) : (
                        <span className="text-ct-muted">Choose an assignee</span>
                      )}
                      <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="Search people…" value={pickerQuery} onValueChange={setPickerQuery} />
                      <CommandList>
                        <CommandEmpty>
                          <div className="space-y-1.5 px-2 py-3 text-center">
                            <p className="text-xs text-ct-muted">Nobody in this organisation matches that.</p>
                            {/* Disabled-by-condition, never hidden: the reader
                                learns the capability exists and why they cannot
                                use it yet. */}
                            <Button size="sm" variant="outline" disabled title="Coming soon">
                              Invite by email <span className="ml-1 text-[11px]">(Coming soon)</span>
                            </Button>
                          </div>
                        </CommandEmpty>
                        {groups.inMeeting.length > 0 && (
                          <CommandGroup heading="In this meeting">
                            {groups.inMeeting.map((user) => (
                              <PersonRow key={user.id} user={user} onPick={() => { setActionAssignee(user); setPickerOpen(false); }} />
                            ))}
                          </CommandGroup>
                        )}
                        {groups.others.length > 0 && (
                          <CommandGroup heading={groups.inMeeting.length > 0 ? "Everyone else" : "People"}>
                            {groups.others.map((user) => (
                              <PersonRow key={user.id} user={user} onPick={() => { setActionAssignee(user); setPickerOpen(false); }} />
                            ))}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-1.5"><Label htmlFor="mom-action-due">Due Date (optional)</Label><Input id="mom-action-due" type="date" className="w-40" value={actionDueDate} onChange={(e) => setActionDueDate(e.target.value)} /></div>
              <Button size="sm" disabled={!!addDisabledReason} title={addDisabledReason} onClick={() => void addActionItem()}>
                Add
                {addDisabledReason && <span className="ml-1.5 text-[11px] font-normal">({addDisabledReason})</span>}
              </Button>
            </div>
          </div>

          <div>
            <h4 className="mb-1.5 font-semibold text-ct-navy text-sm">Share links</h4>
            {links.length === 0 ? (
              <p className="text-sm text-ct-muted">No share links created yet. Use Export → Send on WhatsApp.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {links.map((l) => {
                  const revoked = !!l.revokedAt;
                  const expired = !revoked && new Date(l.expiresAt) < new Date();
                  return (
                    <li key={l.id} className="flex items-center justify-between rounded-md border border-ct-border px-2 py-1.5">
                      <span className="text-ct-muted">
                        {revoked ? "Revoked" : expired ? "Expired" : "Active"} · expires {formatDateTime(l.expiresAt)}
                      </span>
                      {!revoked && !expired && (
                        <Button size="sm" variant="ghost" disabled={busy === `revoke-${l.id}`} onClick={() => void revokeLink(l.id)}>
                          Revoke
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* D-17: publishing locks the record forever, so the blast radius is
          stated in words before the write, not discovered after it. */}
      <AlertDialog open={confirming === "publish"} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish and lock &ldquo;{meeting.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Title, date, attendees, agenda and minutes can no longer be edited. Action items stay editable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publish()}>Publish &amp; Lock</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming === "delete"} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{meeting.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the draft meeting and everything typed into its minutes. Only a draft can be deleted; a published meeting stays as the locked record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteMeeting()}>Delete meeting</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ObjectScreen>
    </>
  );
}

function PersonRow({ user, onPick }: { user: OrgUser; onPick: () => void }) {
  return (
    <CommandItem value={user.id} onSelect={onPick} className="gap-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ct-cloud text-[10px] font-medium text-ct-navy">
        {initialsOf(user)}
      </span>
      <span className="min-w-0 flex-1 truncate">{displayNameOf(user)}</span>
      <span className="shrink-0 text-[11px] text-ct-muted">{roleLabelOf(user.role)}</span>
    </CommandItem>
  );
}
