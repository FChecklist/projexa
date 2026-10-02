"use client";

// LOCAL-FIRST shell, the Design Studio review queue (/design-studio/review): the project's SUBMITTED entries from the laptop's own copy,
// one group per designer per day (a manager approves a DAY), with Approve and Return (a reason is required, as online).
//
// THE DECISION IS THE SERVER'S. Approve queues approve_timesheet and Return queues reject_timesheet (one op per entry of the day) in the
// outbox; nothing changes on the laptop: each entry stays "Submitted" with "Approval waiting to be sent" beside it until the server
// answers, under the person's live role and its own refusal of self-review. The laptop only declines to OFFER what the online screen does
// not offer either: a role below manager, and the person's own hours.
//
// NEEDS A CONNECTION: designer names (only the user id is synced; organisation people are not consumed on the laptop yet), so another
// designer is shown as "A designer" with a short id to tell groups apart.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDayLabel, formatHours } from "@/lib/design-studio-timesheet";
import type { ShellScreenProps } from "../types";
import { undecided, type ReviewData, type ReviewGroup } from "./design-change-adapter";
import { approveTimeEntryOffline, notQueuedMessage, rejectTimeEntryOffline } from "./design-change-writes";
import { CopyNote, NOT_SYNCED, NO_PROJECT, Note, OnlineOnly, StateMessage, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";
import { EntryStatus } from "./DesignStudioTimesheetScreen";

export const designerLabel = (g: Pick<ReviewGroup, "self" | "userId">): string => (g.self ? "You" : g.userId === "unknown" ? "A designer" : `A designer (${g.userId.slice(0, 6)})`);

function Group({ shell, group, projectId, mayDecide, onDone }: { shell: ShellScreenProps["shell"]; group: ReviewGroup; projectId: string; mayDecide: boolean; onDone: (note: string) => void }) {
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const open = undecided(group.entries);

  async function decide(kind: "approve" | "reject") {
    setBusy(true);
    let kept = 0;
    let refused: string | null = null;
    for (const e of open) {
      const input = { projectId, timeEntryId: e.id };
      const result = kind === "approve" ? await approveTimeEntryOffline(input, writeAccess(shell)) : await rejectTimeEntryOffline({ ...input, rejectionReason: reason }, writeAccess(shell));
      if (result.queued) kept++;
      else refused = notQueuedMessage(result.reason);
    }
    setBusy(false);
    setReturning(false);
    onDone(kept > 0 ? `${kept} entr${kept === 1 ? "y" : "ies"} ${kind === "approve" ? "to approve" : "to send back"}. ${keptNote(shell)} The server decides.` : refused ?? "Nothing to decide.");
  }

  return (
    <li className="rounded-lg border border-black/10 bg-white p-3" data-testid="ds-review-group" data-group={group.key}>
      <p className="text-sm font-medium text-px-ink">{designerLabel(group)} · {formatDayLabel(group.spentOn)} · {formatHours(group.hours)} h</p>
      <ul className="mt-2 space-y-1 text-sm">
        {group.entries.map((e) => (
          <li key={e.id} data-testid="ds-review-entry" data-entry-id={e.id}>
            <a className="underline-offset-2 hover:underline" href={`/design-studio/timesheets/${encodeURIComponent(e.id)}${projectQuery(projectId)}`}>{e.task}</a> · {e.activityType ?? "-"} · {formatHours(e.hours)} h · <EntryStatus entry={e} />
          </li>
        ))}
      </ul>
      {group.self ? (
        <p className="mt-2 text-xs text-px-muted" data-testid="ds-review-self">You cannot review your own hours.</p>
      ) : !mayDecide ? null : open.length === 0 ? (
        <p className="mt-2 text-xs text-px-muted" data-testid="ds-review-decided">Your decision is waiting to be sent.</p>
      ) : returning ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) void decide("reject");
          }}
        >
          <label className="text-sm">Reason *<input className="mt-1 block w-72 rounded border border-black/20 p-1.5 text-sm" data-testid="ds-review-reason" value={reason} {...textInput(setReason)} /></label>
          <Button type="submit" size="sm" data-testid="ds-review-return-send" disabled={busy || !reason.trim()} title={!reason.trim() ? "A reason is required" : undefined}>Return</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setReturning(false)}>Cancel</Button>
        </form>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" data-testid="ds-review-approve" disabled={busy} onClick={() => void decide("approve")}>Approve</Button>
          <Button size="sm" variant="outline" data-testid="ds-review-return" disabled={busy} onClick={() => setReturning(true)}>Return</Button>
        </div>
      )}
    </li>
  );
}

export default function DesignStudioReviewScreen({ shell, data }: ShellScreenProps<ReviewData>) {
  const [note, setNote] = useState<string | null>(null);
  const project = shell.data.projects.find((p) => p.id === shell.projectId);
  const title = `Design Studio${project ? ` / ${project.name}` : ""} / Review`;
  if (data.state === "no_project") return <StateMessage testId="ds-review" state="no_project" title="Design Studio / Review">{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="ds-review" state="not_synced" title={title}>{NOT_SYNCED}</StateMessage>;

  const mayDecide = mayOffer(shell.data.role, "approve_timesheet") && mayOffer(shell.data.role, "reject_timesheet");
  return (
    <section data-testid="ds-review" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/design-studio${projectQuery(data.projectId)}`}>Design Studio</a></p>
      <h1 className="font-heading text-2xl text-px-ink">{title}</h1>
      <CopyNote testId="ds-review-copy-note" syncedAt={data.syncedAt} />
      {!mayDecide ? <p className="mt-2 text-sm text-px-muted" data-testid="ds-review-role">Approving and returning timesheets needs a manager or higher. You can see the queue.</p> : null}
      {data.groups.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted" data-testid="ds-review-empty">Nothing is waiting for review on this project.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {data.groups.map((g) => (
            <Group key={g.key} shell={shell} group={g} projectId={data.projectId} mayDecide={mayDecide} onDone={(text) => { setNote(text); shell.refresh(); }} />
          ))}
        </ul>
      )}
      <Note text={note} />
      <OnlineOnly>Designer names are shown when you are online.</OnlineOnly>
    </section>
  );
}
