"use client";

// LOCAL-FIRST shell, one Change Order (/change-orders/:id): what the online object page shows (CO number and title, status, cost and
// schedule impact, reason) from the laptop's own copy, and "Send for Approval" offline: the request (signer name + email) is RECORDED in
// the outbox as submit_change_order_for_approval and sent when the laptop can reach the server. The status does NOT change here: the
// approval workflow (an e-signature request) is the server's, and the screen says "Approval request waiting to be sent" until it
// answers. Only a change order the server already holds can be sent (one made on this laptop waits until the server has accepted it).
//
// NEEDS A CONNECTION (not synced, or no registered function): the signers' progress of a pending approval, "Create BOQ Revision from this
// Change Order" (needs the project's current BOQ id), editing or deleting a change order.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShellScreenProps } from "../types";
import { changeOrderPendingWord, changeOrderStatusText, scheduleImpactText, type ChangeOrderObjectData } from "./design-change-adapter";
import { notQueuedMessage, submitChangeOrderOffline, validateSigner } from "./design-change-writes";
import { CoMoney, CopyNote, Facts, NOT_SYNCED, NO_PROJECT, Note, OnlineOnly, PendingMark, StateMessage, keptNote, mayOffer, projectQuery, textInput, writeAccess } from "./DesignChangeShared";

const BACK = { href: "/change-orders", label: "Back to Change Orders" };

export default function ChangeOrderObjectScreen({ shell, data }: ShellScreenProps<ChangeOrderObjectData>) {
  const [sending, setSending] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (data.state === "no_project") return <StateMessage testId="co-object" state="no_project" title="Change Order" back={BACK}>{NO_PROJECT}</StateMessage>;
  if (data.state === "not_synced") return <StateMessage testId="co-object" state="not_synced" title="Change Order" back={BACK}>{NOT_SYNCED}</StateMessage>;
  if (data.state === "not_found") return <StateMessage testId="co-object" state="not_found" title="Change Order" back={BACK}>This change order is not in the copy on this laptop. It may be in another project, or it may not have been copied yet.</StateMessage>;

  const { co, projectId } = data;
  const pending = changeOrderPendingWord(co);
  const approvalWaiting = co.waitingOn.includes("submit_change_order_for_approval");
  const mayAsk = co.status === "draft" && !co.localOnly && !approvalWaiting && mayOffer(shell.data.role, "submit_change_order_for_approval");

  async function send() {
    const signer = { name: signerName, email: signerEmail };
    const problem = validateSigner(signer);
    if (problem) return setNote(problem);
    setBusy(true);
    const result = await submitChangeOrderOffline({ projectId, changeOrderId: co.id, signers: [signer] }, writeAccess(shell));
    setBusy(false);
    if (!result.queued) return setNote(notQueuedMessage(result.reason));
    setSending(false);
    setSignerName("");
    setSignerEmail("");
    setNote(`${keptNote(shell)} The approval itself is decided on the server.`);
    shell.refresh();
  }

  return (
    <section data-testid="co-object" data-state="local">
      <p className="text-sm"><a className="text-px-muted underline underline-offset-2" href={`/change-orders${projectQuery(projectId)}`}>Change Orders</a></p>
      <h1 className="font-heading text-2xl text-px-ink" data-testid="co-title">{co.number !== null ? `CO-${co.number} ` : ""}{co.title}<PendingMark word={pending} /></h1>
      <p className="text-sm capitalize text-px-muted" data-testid="co-status">{co.localOnly ? "Not yet accepted by the server" : changeOrderStatusText(co.status)}</p>
      <CopyNote testId="co-copy-note" syncedAt={data.syncedAt} />
      <Facts
        rows={[
          ["Cost Impact", <CoMoney key="c" value={co.costImpact} hidden={data.costHidden} />],
          ["Schedule Impact", scheduleImpactText(co.scheduleImpactDays)],
          ["Trade", co.trade ?? "—"],
        ]}
      />
      <div className="mt-5">
        <h2 className="text-sm font-medium text-px-muted">Reason</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm text-px-ink" data-testid="co-reason">{co.reason || "No reason given."}</p>
      </div>

      {co.status === "draft" && !co.localOnly ? (
        <div className="mt-5 border-t border-black/10 pt-3" data-testid="co-approval">
          {approvalWaiting ? (
            <p className="text-sm text-px-muted" data-testid="co-approval-waiting">Your request to send this change order for approval is waiting to be sent. The server decides what happens next.</p>
          ) : !mayAsk ? (
            <p className="text-sm text-px-muted" data-testid="co-approval-role">Sending a change order for approval needs a manager or higher.</p>
          ) : !sending ? (
            <Button size="sm" variant="outline" data-testid="co-send-open" onClick={() => setSending(true)}>Send for Approval</Button>
          ) : (
            <form
              className="max-w-sm space-y-2"
              data-testid="co-send-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <p className="text-xs text-px-muted">A real signing request is created on the server when this is sent.</p>
              <label className="block text-sm">Signer name<input className="mt-1 block w-full rounded border border-black/20 p-1.5 text-sm" data-testid="co-signer-name" value={signerName} {...textInput(setSignerName)} /></label>
              <label className="block text-sm">Signer email<input type="email" className="mt-1 block w-full rounded border border-black/20 p-1.5 text-sm" data-testid="co-signer-email" value={signerEmail} {...textInput(setSignerEmail)} /></label>
              <div className="flex gap-2">
                <Button type="submit" size="sm" data-testid="co-send" disabled={busy}>Send</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSending(false)}>Cancel</Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
      {co.localOnly ? <p className="mt-4 text-sm text-px-muted" data-testid="co-local-only">This change order was made on this laptop. It can be sent for approval once the server has accepted it.</p> : null}
      <Note text={note} />
      <OnlineOnly>The signers&apos; progress, creating a BOQ revision from an approved change order, and editing a change order need a connection.</OnlineOnly>
    </section>
  );
}
