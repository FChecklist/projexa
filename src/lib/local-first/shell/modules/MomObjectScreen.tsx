"use client";

// LOCAL-FIRST shell, one Minutes of Meeting: details, agenda and minutes from the laptop's own copy, and "Amend the minutes" offline
// (update_mom_minutes through the outbox; the amendment is shown at once and marked "Waiting to sync"). Published minutes are locked, as
// online. "Add an action item" works offline too (add_meeting_action_item: a title and an optional due date; the server makes it a task for the
// person who saves it). The AI summary, share links, publish, edit details and the PDF need a connection (not synced, or no registered
// function), and the screen says so in words; so do the attendees' names of a meeting that is already on the server (the sync does not
// carry them: they can hold e-mail addresses).

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format-date";
import type { ShellScreenProps } from "../types";
import { isPublished, type MomObjectData } from "./moms-adapter";
import { addMomActionItemOffline, amendMinutesOffline, canProposeEdits } from "./documents-writes";
import { copyTextToClipboard, momShareText } from "./share-text";
import { CopyNote, Facts, NOT_SYNCED, NO_PROJECT, OnlineOnly, StateMessage, Waiting, dateText, projectQuery } from "./DocumentsShared";

const BACK = { href: "/moms", label: "Back to Minutes of Meetings" };

export default function MomObjectScreen({ shell, data }: ShellScreenProps<MomObjectData>) {
  const [editing, setEditing] = useState(false);
  // The minutes box is uncontrolled (read at Save): long free text, no re-render per keystroke.
  const minutesRef = useRef<HTMLTextAreaElement | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [itemTitle, setItemTitle] = useState("");
  const [itemDue, setItemDue] = useState("");
  const [itemNote, setItemNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [itemSaving, setItemSaving] = useState(false);
  const [copied, setCopied] = useState<{ ok: boolean; text: string } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [share, setShare] = useState<{ ok: boolean; text: string; url?: string } | null>(null);

  if (data.state === "no_project") return <StateMessage testId="mom-object" state="no_project" title="Minutes of Meeting" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="mom-object" state="not_synced" title="Minutes of Meeting" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") return <StateMessage testId="mom-object" state="not_found" title="Minutes of Meeting" back={BACK}>This meeting is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;

  const { mom, projectId, pendingActionItems } = data;
  const locked = isPublished(mom);
  const mayAmend = !locked && canProposeEdits(shell.data.role);
  // an action item is a follow-up task: it can be added after the minutes are published, as it can online
  const mayAddItem = canProposeEdits(shell.data.role);

  // R-C04 parity with the online page: Export PDF (the same /api/moms/<id>/pdf relay) and Share link (the same share-links route). Both need the
  // server, so offline (or for a meeting that has not reached the server yet) they are disabled and the reason is written beside them.
  const serverReason = shell.connectivity !== "online"
    ? "Needs a connection. Export the PDF or make a share link once you are online."
    : mom.waiting ? "This meeting is still waiting to sync. It can be exported and shared once the server has it." : null;

  async function makeShareLink() {
    setShareBusy(true);
    try {
      const res = await fetch(`/api/moms/${encodeURIComponent(mom.id)}/share-links`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { shareUrl?: string; error?: string } | null;
      if (!res.ok || !body?.shareUrl) throw new Error(body?.error ?? "The server did not make a share link.");
      const copiedOk = await copyTextToClipboard(body.shareUrl);
      setShare({ ok: true, url: body.shareUrl, text: copiedOk ? "Share link made and copied." : "Share link made. Select it below and copy it." });
    } catch (err) {
      setShare({ ok: false, text: err instanceof Error ? err.message : "Could not make a share link." });
    } finally {
      setShareBusy(false);
    }
  }

  async function addItem() {
    setItemSaving(true);
    const result = await addMomActionItemOffline(shell.data, { projectId, meetingId: mom.id, title: itemTitle, dueDate: itemDue });
    setItemSaving(false);
    if (!result.ok) return setItemNote({ ok: false, text: result.message });
    setItemTitle("");
    setItemDue("");
    setItemNote({ ok: true, text: shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected." });
    shell.refresh();
  }

  async function save() {
    const draft = minutesRef.current?.value ?? "";
    if (draft === (mom.minutes ?? "")) {
      setEditing(false);
      return setNote("Nothing was changed.");
    }
    setSaving(true);
    const result = await amendMinutesOffline(shell.data, { projectId, meetingId: mom.id, minutes: draft });
    setSaving(false);
    if (!result.ok) return setNote(result.message);
    setEditing(false);
    setNote(shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected.");
    shell.refresh();
  }

  return (
    <section data-testid="mom-object" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/moms${projectQuery(projectId)}`}>Minutes of Meetings</a></p>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="mom-title">{mom.title}<Waiting show={mom.waiting} /></h1>
      <p className="text-sm capitalize text-px-muted" data-testid="mom-status">{mom.status ?? "-"}{locked ? " · locked" : ""}</p>
      <CopyNote testId="mom-copy-note" syncedAt={data.syncedAt} />
      <Facts
        rows={[
          ["When", mom.scheduledAt && Number.isFinite(Date.parse(mom.scheduledAt)) ? formatDateTime(mom.scheduledAt) : "-"],
          ["Type", mom.meetingType ?? "-"],
          ["Published", dateText(mom.publishedAt)],
          [
            "Attendees",
            mom.attendeeNames && mom.attendeeNames.length > 0
              ? `${mom.attendeeNames.join(", ")} (typed on this laptop)`
              : mom.attendeeCount === null ? "-" : `${mom.attendeeCount} invited (names are shown online)`,
          ],
        ]}
      />
      <div className="mt-5">
        <h2 className="text-sm font-medium text-px-ink">Agenda</h2>
        {mom.agenda && mom.agenda.length > 0 ? (
          <ol className="mt-1 list-decimal pl-5 text-sm" data-testid="mom-agenda">{mom.agenda.map((a, i) => <li key={i}>{a}</li>)}</ol>
        ) : (
          <p className="mt-1 text-sm text-px-muted">No agenda on this laptop.</p>
        )}
      </div>
      <div className="mt-5">
        <h2 className="text-sm font-medium text-px-ink">Minutes</h2>
        {editing ? (
          <form
            data-testid="mom-amend-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <textarea className="mt-1 h-48 w-full rounded border border-black/20 p-2 text-sm" data-testid="mom-minutes-input" ref={minutesRef} defaultValue={mom.minutes ?? ""} />
            <div className="mt-2 flex gap-2">
              <Button type="submit" size="sm" data-testid="mom-amend-save" disabled={saving}>Save</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <>
            <p className="mt-1 whitespace-pre-wrap text-sm" data-testid="mom-minutes">{mom.minutes ?? "No minutes recorded yet."}</p>
            {mayAmend ? (
              <Button
                className="mt-2"
                variant="outline"
                size="sm"
                data-testid="mom-amend-open"
                onClick={() => setEditing(true)}
              >
                Amend the minutes
              </Button>
            ) : null}
            {locked ? <p className="mt-2 text-xs text-px-muted" data-testid="mom-locked">These minutes are published and locked.</p> : null}
            <Button
              className="mt-2 ml-2"
              variant="outline"
              size="sm"
              data-testid="mom-whatsapp"
              onClick={async () => {
                const text = momShareText({ title: mom.title, scheduledAt: mom.scheduledAt, status: mom.status, agenda: mom.agenda, minutes: mom.minutes });
                setCopied({ ok: await copyTextToClipboard(text), text });
              }}
            >
              Copy minutes for WhatsApp
            </Button>
            {serverReason ? (
              <>
                <Button className="mt-2 ml-2" variant="outline" size="sm" disabled data-testid="mom-export-pdf" aria-disabled="true">Export PDF</Button>
                <Button className="mt-2 ml-2" variant="outline" size="sm" disabled data-testid="mom-share-link" aria-disabled="true">Share link</Button>
                <p className="mt-2 text-xs text-px-muted" data-testid="mom-server-reason">{serverReason}</p>
              </>
            ) : (
              <>
                <a
                  className="mt-2 ml-2 inline-flex h-8 items-center rounded-md border border-black/20 px-3 text-sm text-px-ink"
                  href={`/api/moms/${encodeURIComponent(mom.id)}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="mom-export-pdf"
                >
                  Export PDF
                </a>
                <Button className="mt-2 ml-2" variant="outline" size="sm" data-testid="mom-share-link" disabled={shareBusy} onClick={() => void makeShareLink()}>
                  {shareBusy ? "Making the link..." : "Share link"}
                </Button>
              </>
            )}
            {share ? (
              <div className="mt-2" role="status" data-testid="mom-share-note" data-ok={share.ok ? "1" : "0"}>
                <p className="text-xs text-px-ink">{share.text}</p>
                {share.url ? <input readOnly className="mt-1 w-full rounded border border-black/20 p-2 text-xs" value={share.url} onFocus={(e) => e.currentTarget.select()} data-testid="mom-share-url" /> : null}
              </div>
            ) : null}
            {copied?.ok ? <p className="mt-2 text-xs text-px-ink" role="status" data-testid="mom-copied">Copied. Paste it into WhatsApp.</p> : null}
            {copied && !copied.ok ? (
              <div data-testid="mom-copy-manual">
                <p className="mt-2 text-xs text-px-muted">This browser did not allow copying. Select the text below and copy it.</p>
                <textarea readOnly rows={8} className="mt-1 w-full rounded border border-black/20 p-2 text-xs" value={copied.text} onFocus={(e) => e.currentTarget.select()} />
              </div>
            ) : null}
          </>
        )}
        {note ? <p className="mt-2 text-xs text-px-muted" data-testid="mom-note">{note}</p> : null}
      </div>
      <div className="mt-5" data-testid="mom-actions">
        <h2 className="text-sm font-medium text-px-ink">Action items</h2>
        {pendingActionItems.length > 0 ? (
          <ul className="mt-1 list-disc pl-5 text-sm" data-testid="mom-pending-items">
            {pendingActionItems.map((item) => (
              <li key={item.opId} data-status={item.status}>
                {item.title}
                {item.dueDate ? ` (due ${formatDate(item.dueDate)})` : ""}
                <span className="ml-2 rounded bg-px-concrete px-1.5 py-0.5 text-xs text-px-muted">
                  {item.status === "pending" ? "Waiting to sync" : "Not confirmed by the server yet (see the sync panel)"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 text-xs text-px-muted" data-testid="mom-items-note">
          Action items already on the server are shown online. An item you add here becomes a task for you when it reaches the server; who owns it is set online.
        </p>
        {mayAddItem ? (
          <form
            className="mt-2 grid max-w-xl grid-cols-[1fr_auto_auto] items-center gap-2"
            data-testid="mom-item-form"
            onSubmit={(e) => {
              e.preventDefault();
              void addItem();
            }}
          >
            <input aria-label="New action item" className="rounded border border-black/20 p-2 text-sm" value={itemTitle} onChange={(e) => setItemTitle(e.currentTarget.value)} onInput={(e) => setItemTitle(e.currentTarget.value)} />
            <input aria-label="Due date for the new action item" type="date" className="rounded border border-black/20 p-2 text-sm" value={itemDue} onChange={(e) => setItemDue(e.currentTarget.value)} onInput={(e) => setItemDue(e.currentTarget.value)} />
            <Button type="submit" size="sm" data-testid="mom-item-save" disabled={itemSaving}>Add action item</Button>
          </form>
        ) : null}
        {itemNote ? (
          <p role="status" aria-live="polite" className="mt-2 text-xs text-px-muted" data-testid="mom-item-note" data-ok={itemNote.ok ? "1" : "0"}>{itemNote.text}</p>
        ) : null}
      </div>
      <OnlineOnly>The public share link, the AI summary, editing the details, publishing the minutes and the PDF need a connection (publishing locks the minutes, so it is done online). Attendee names of a meeting already on the server are shown online.</OnlineOnly>
    </section>
  );
}
