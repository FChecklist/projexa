"use client";

// LOCAL-FIRST shell, New billing milestone (/billing-milestones/new, Sumeet R-95, checklist 2.14). Works with no network: the milestone is kept
// on the laptop at once and sent as create_progress_claim when connected. It is a DRAFT until a person with the billing role confirms it online:
// no money is posted and no invoice is made by this screen (billing-writes.ts says exactly what the server does with it). The customer the
// milestone is billed to is chosen from the organisation's customers on this laptop; the server checks that it is this project's client.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShellScreenProps } from "../types";
import type { BillingData } from "./billing-adapter";
import { DRAFT_UNTIL_CONFIRMED, createBillingMilestoneOffline, mayCreateBillingMilestone } from "./billing-writes";
import { CopyNote, SaveNote, Screen, StateMessage, fieldClass, projectName, textHandlers, withProject } from "./DeliveryParts";

const BACK = "text-px-ink underline underline-offset-2";

export default function BillingNewScreen({ shell, data }: ShellScreenProps<BillingData>) {
  const [customerId, setCustomerId] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [retention, setRetention] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (data.state !== "local") return <StateMessage testId="billing-new" title="New billing milestone" state={data.state} what="billing milestone" />;
  const { projectId, choices } = data;
  const label = projectName(shell, projectId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await createBillingMilestoneOffline(
        shell.data,
        { projectId, boqId: choices.boq?.id ?? "", customerId, milestoneDescription: description, scheduledDate, retentionPercent: retention },
        choices
      );
      if (!result.queued) return setNote({ ok: false, text: result.message });
      setNote({
        ok: true,
        text: `${shell.connectivity === "online" ? "Saved on this laptop and being sent." : "Saved on this laptop. It will be sent to the server when you are connected."} It stays a draft until a person with the billing role confirms it online.`,
      });
      setDescription("");
      setScheduledDate("");
      setRetention("");
      shell.refresh();
    } catch {
      setNote({ ok: false, text: "This could not be kept on the laptop. Nothing was saved; please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen testId="billing-new" state="local" title={`New billing milestone${label ? ` / ${label}` : ""}`}>
      <CopyNote testId="billing-new-copy-note" syncedAt={data.syncedAt} />
      <p className="mt-2 rounded-md border border-black/10 bg-px-concrete p-3 text-sm text-px-ink" data-testid="billing-draft-words">{DRAFT_UNTIL_CONFIRMED}</p>
      {!mayCreateBillingMilestone(shell.data.role) ? (
        <p className="mt-4 text-sm text-px-muted" data-testid="billing-new-role">Creating a billing milestone needs the manager role. {shell.connectivity === "online" ? "" : "It can be done when you are connected."}</p>
      ) : !choices.boq ? (
        <p className="mt-4 text-sm text-px-muted" data-testid="billing-new-no-boq">This project has no approved BOQ on this laptop yet, and a billing milestone needs one to bill against.</p>
      ) : choices.customers.length === 0 ? (
        <p className="mt-4 text-sm text-px-muted" data-testid="billing-new-no-customers">
          {data.customerNames === "not_allowed"
            ? "The customers are not part of what your role keeps on this laptop, so a customer cannot be chosen here."
            : "The customers are not on this laptop yet. They arrive with the next sync."}
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-xl rounded-lg border border-black/10 bg-white p-4" data-testid="billing-new-form">
          <p className="text-sm text-px-ink" data-testid="billing-new-boq">
            Billed against the approved BOQ: {choices.boq.title ?? "BOQ"}{choices.boq.version !== null ? ` (version ${choices.boq.version})` : ""}
          </p>
          <label className="mt-3 block text-sm">
            Billed to
            <select aria-label="Billed to" className={fieldClass} value={customerId} {...textHandlers(setCustomerId)} required>
              <option value="">Choose a customer</option>
              {choices.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.billedHere ? " (billed on this project)" : ""}</option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Milestone achieved
            <textarea aria-label="Milestone" rows={2} className={fieldClass} value={description} {...textHandlers(setDescription)} required />
          </label>
          <label className="mt-3 block text-sm">
            Billing date
            <input aria-label="Billing date" type="date" className={fieldClass} value={scheduledDate} {...textHandlers(setScheduledDate)} required />
          </label>
          <label className="mt-3 block text-sm">
            Retention % (optional)
            <input aria-label="Retention" inputMode="decimal" className={fieldClass} value={retention} {...textHandlers(setRetention)} />
          </label>
          <p className="mt-3 text-xs text-px-muted">
            The server checks that the customer is this project&apos;s client. If it is not, the milestone comes back to you as not accepted, with what you typed kept.
          </p>
          <Button type="submit" className="mt-4" disabled={saving}>{saving ? "Saving…" : "Save billing milestone (draft)"}</Button>
          <SaveNote note={note} />
        </form>
      )}
      <p className="mt-3 text-sm"><a className={BACK} href={withProject("/billing-milestones", projectId)}>Back to the billing milestones</a></p>
    </Screen>
  );
}
