"use client";

// LOCAL-FIRST shell, New Change Order (/change-orders/new): the online create screen's four fields (Title, Reason, Cost Impact, Schedule
// Impact) with its own checks and words, kept on the laptop at once as create_change_order in the outbox. The new change order appears in
// the list straight away, marked "Waiting to be sent", with no number and no status: the server assigns both (and decides whether this
// person may create it at all). The cost impact is the person's intent, sent as typed; the server stores it.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CURRENCY_FALLBACK_LABEL } from "@/lib/currency";
import type { ShellScreenProps } from "../types";
import type { ChangeOrderNewData } from "./design-change-adapter";
import { createChangeOrderOffline, notQueuedMessage, validateNewChangeOrder } from "./design-change-writes";
import { NOT_SYNCED, NO_PROJECT, Note, StateMessage, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";

const BACK = { href: "/change-orders", label: "Back to Change Orders" };
type Field = "title" | "costImpact" | "scheduleImpactDays";

export default function ChangeOrderNewScreen({ shell, data }: ShellScreenProps<ChangeOrderNewData>) {
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [costImpact, setCostImpact] = useState("");
  const [scheduleImpactDays, setScheduleImpactDays] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (data.state === "no_project") return <StateMessage testId="co-new-screen" state="no_project" title="New Change Order" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="co-new-screen" state="not_synced" title="New Change Order" back={BACK}>{NOT_SYNCED}</StateMessage>;
  const { projectId } = data;
  if (!mayOffer(shell.data.role, "create_change_order")) {
    return <StateMessage testId="co-new-screen" state="role" title="New Change Order" back={{ href: `/change-orders${projectQuery(projectId)}`, label: BACK.label }}>Your role can read change orders but not raise them.</StateMessage>;
  }

  async function save() {
    const input = { projectId, title, reason, costImpact, scheduleImpactDays };
    const errs = validateNewChangeOrder(input);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    const result = await createChangeOrderOffline(input, writeAccess(shell));
    setBusy(false);
    if (!result.queued) return setNote(notQueuedMessage(result.reason));
    setNote(keptNote(shell));
    shell.navigate(`/change-orders/${encodeURIComponent(result.tempId!)}${projectQuery(projectId)}`);
  }

  const field = (name: Field) => (errors[name] ? <p className="mt-1 text-xs text-px-error" data-testid={`co-error-${name}`}>{errors[name]}</p> : null);
  const input = "mt-1 block w-full rounded border border-black/20 p-1.5 text-sm";

  return (
    <section data-testid="co-new-screen" data-state="ready">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/change-orders${projectQuery(projectId)}`}>Change Orders</a></p>
      <h1 className="font-heading text-2xl text-px-ink">New Change Order</h1>
      <form
        className="mt-4 max-w-xl space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="block text-sm">Title *<input className={input} data-testid="co-new-title" value={title} {...textInput(setTitle)} /></label>
        {field("title")}
        <label className="block text-sm">Reason (optional)<textarea className={input} rows={2} data-testid="co-new-reason" value={reason} {...textInput(setReason)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm">Cost Impact{CURRENCY_FALLBACK_LABEL ? ` (${CURRENCY_FALLBACK_LABEL.trim()})` : ""}<input className={input} data-testid="co-new-cost" inputMode="decimal" placeholder="+/- amount" value={costImpact} {...textInput(setCostImpact)} /></label>
            {field("costImpact")}
          </div>
          <div>
            <label className="block text-sm">Schedule Impact (days)<input className={input} data-testid="co-new-days" inputMode="numeric" placeholder="+/- days" value={scheduleImpactDays} {...textInput(setScheduleImpactDays)} /></label>
            {field("scheduleImpactDays")}
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" data-testid="co-new-save" disabled={busy || !title.trim()} title={!title.trim() ? "Title is required" : undefined}>Save</Button>
          <a className="px-2 py-1.5 text-sm underline underline-offset-2" href={`/change-orders${projectQuery(projectId)}`}>Cancel</a>
        </div>
      </form>
      <Note text={note} />
    </section>
  );
}
