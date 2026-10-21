"use client";

// Real-screen conversion (2026-08-30): the Change Orders list never had a
// detail view -- "reason" wasn't even shown anywhere. Real Object Page on
// the kit's ObjectScreen.
//
// No Edit/Delete: there is no updateChangeOrder()/deleteChangeOrder() in the
// backend at all -- a change order's terms are fixed once created (matches
// this codebase's own "financial/contractual records aren't edited after
// the fact" convention, same as journal entries). The one real lifecycle
// action on a draft is Send for Approval (real e-signature dispatch, not a
// status flag flip -- approve/reject only ever happens via an actual signer
// completing/declining, never a button here).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson } from "@/lib/fetch-json";
import { viaPxApi } from "@/lib/px-api";
// GUIDED ERRORS (G2): every refusal on this screen is the guide panel (what happened, why, the steps, the exact place to fix it, the way back), never a
// toast that fades; the signer's details are checked here first and the typed values survive leaving the screen.
import { GuidedError } from "@/components/GuidedError";
import FaultPanel from "@/components/FaultPanel";
import { useDraft } from "@/lib/error-guide/use-draft";
import { contextFromError, currentScreen } from "@/lib/error-guide/context";
import { signerFaults } from "@/lib/error-guide/g2-faults";
import { findFocusTarget, highlightElement } from "@/lib/error-guide/focus";
import type { GuideContext } from "@/lib/error-guide/types";

type ChangeOrder = {
  id: string; projectId: string; number: number; title: string; reason: string | null;
  costImpact: string; scheduleImpactDays: number; status: string;
  // R-98 fix (2026-09-19, Owner-authorized): the real link to whichever BOQ
  // revision carried this approved change's scope forward -- null until
  // someone actually creates one from this screen (see the "approved"
  // block below). See schema.ts's own column comment for the full history.
  boqRevisionId: string | null;
};
type SignatureStatus = {
  signatureRequest: {
    status: string;
    signers: { name: string; email: string; status: string; declineReason: string | null }[];
  } | null;
};

const STATUS_TONE: Record<string, "needs-you" | "running" | "waiting" | "done" | "late" | "neutral"> = {
  draft: "neutral", pending_approval: "waiting", approved: "done", rejected: "late",
};

export default function ChangeOrderObjectClient({ changeOrderId }: { changeOrderId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const formatCurrency = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const [co, setCo] = useState<ChangeOrder | null>(null);
  const [signatureStatus, setSignatureStatus] = useState<SignatureStatus | null>(null);
  const [loadError, setLoadError] = useState<GuideContext | null>(null);
  const draft = useDraft(`change-order-send:${changeOrderId}`, { open: false, name: "", email: "" });
  const sendingOpen = draft.value.open;
  const setSendingOpen = (open: boolean) => draft.set({ open });
  const signerName = draft.value.name;
  const signerEmail = draft.value.email;
  const [attempted, setAttempted] = useState(false);
  const [actionFailure, setActionFailure] = useState<GuideContext | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creatingRevision, setCreatingRevision] = useState(false);

  async function load() {
    try {
      const data = await fetchJson<ChangeOrder>(`/api/change-orders/${changeOrderId}`);
      setCo(data);
      setLoadError(null);
      if (data.status === "pending_approval") {
        fetchJson<SignatureStatus>(`/api/change-orders/${changeOrderId}/signature-status`).then(setSignatureStatus).catch(() => setSignatureStatus(null));
      }
    } catch (err) {
      setCo(null);
      setLoadError(contextFromError(err, { entityId: changeOrderId, entityType: "change_order" }));
    }
  }

  useEffect(() => { load(); }, [changeOrderId]);

  // R-98 fix (2026-09-19, Owner-authorized): resolves the project's own
  // CURRENT BOQ (same real GET WorkspaceBoqCard/BillingMilestonesClient
  // already use for this) and navigates to its own Create Revision screen,
  // carrying this change order's id so the new revision links back to it --
  // ScopeReviseClient.tsx reads ?fromChangeOrder= and forwards it as
  // sourceChangeOrderId to POST /api/scope/[id]/revisions.
  async function createBoqRevisionFromThisChangeOrder() {
    if (!co) return;
    setCreatingRevision(true);
    try {
      const boqRes = await viaPxApi(`/api/reports/boq-analysis?projectId=${encodeURIComponent(co.projectId)}`);
      const boqData = await boqRes.json().catch(() => ({}));
      if (!boqRes.ok || !boqData.row?.boqId) {
        setActionFailure({ ...currentScreen(), projectId: co.projectId, entityId: co.id, entityType: "change_order", status: 0, code: "CO_NO_APPROVED_BOQ", serverMessage: "This project has no approved BOQ to revise yet." });
        return;
      }
      router.push(`/scope/${boqData.row.boqId}/revise?fromChangeOrder=${encodeURIComponent(co.id)}`);
    } catch (err) {
      setActionFailure(contextFromError(err, { projectId: co.projectId, entityId: co.id, entityType: "change_order", serverMessage: "Could not look up this project's current BOQ." }));
    } finally {
      setCreatingRevision(false);
    }
  }

  const signerProblems = signerFaults({ name: signerName, email: signerEmail });

  async function submitForApproval() {
    setAttempted(true);
    setActionFailure(null);
    if (signerProblems.length > 0) {
      const el = findFocusTarget(signerProblems[0].field);
      if (el) highlightElement(el);
      return;
    }
    setSubmitting(true);
    try {
      await fetchJson(`/api/change-orders/${changeOrderId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", signers: [{ name: signerName.trim(), email: signerEmail.trim() }] }),
      });
      draft.startFresh();
      setAttempted(false);
      await load();
    } catch (err) {
      setActionFailure(contextFromError(err, { projectId: co?.projectId, entityId: changeOrderId, entityType: "change_order" }));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <GuidedError ctx={loadError} onRetry={() => void load()} />
      </div>
    );
  }
  if (!co) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Change Orders / Change Order"
      title={`CO-${co.number} ${co.title}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[co.status] ?? "neutral", label: co.status.replace(/_/g, " ") }}
      facets={[
        { label: "Cost Impact", value: formatCurrency(Number(co.costImpact)) },
        { label: "Schedule Impact", value: co.scheduleImpactDays > 0 ? `+${co.scheduleImpactDays}d` : co.scheduleImpactDays === 0 ? "—" : `${co.scheduleImpactDays}d` },
      ]}
      onBack={() => router.push(`/change-orders?projectId=${co.projectId}`)}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div>
          <Label className="text-ct-muted">Reason</Label>
          <p className="mt-1 text-sm text-ct-navy whitespace-pre-wrap">{co.reason || <span className="text-ct-muted">No reason given.</span>}</p>
        </div>

        {actionFailure && <GuidedError ctx={actionFailure} onRetry={() => void (actionFailure.code === "CO_NO_APPROVED_BOQ" ? createBoqRevisionFromThisChangeOrder() : submitForApproval())} draftKey={`change-order-send:${changeOrderId}`} />}

        {co.status === "draft" && (
          <div className="border-t border-ct-border pt-3">
            {!sendingOpen ? (
              <Button size="sm" variant="outline" onClick={() => setSendingOpen(true)}>Send for Approval</Button>
            ) : (
              <div className="space-y-2 max-w-sm">
                {draft.restored && <p role="status" data-testid="co-send-draft-restored" className="text-xs text-px-info">We put back the signer you had typed.</p>}
                {attempted && <FaultPanel faults={signerProblems} draftKey={`change-order-send:${changeOrderId}`} />}
                <p className="text-xs text-ct-muted">Real signing request, tamper-evident audit trail (same workflow used for contracts).</p>
                <div className="space-y-1.5"><Label htmlFor="co-signer-name">Signer name</Label><Input id="co-signer-name" value={signerName} onChange={(e) => draft.set({ name: e.target.value })} />{attempted && signerProblems.find((f) => f.field === "co-signer-name") && <p role="alert" className="text-xs text-px-error">{signerProblems.find((f) => f.field === "co-signer-name")!.message}</p>}</div>
                <div className="space-y-1.5"><Label htmlFor="co-signer-email">Signer email</Label><Input id="co-signer-email" type="text" inputMode="email" value={signerEmail} onChange={(e) => draft.set({ email: e.target.value })} />{attempted && signerProblems.find((f) => f.field === "co-signer-email") && <p role="alert" className="text-xs text-px-error">{signerProblems.find((f) => f.field === "co-signer-email")!.message}</p>}</div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={submitting} onClick={submitForApproval}>{submitting ? "Sending…" : "Send"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSendingOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {co.status === "approved" && (
          <div className="border-t border-ct-border pt-3">
            <Label className="text-ct-muted">BOQ Link</Label>
            {co.boqRevisionId ? (
              <p className="mt-1 text-sm text-ct-navy">
                This change is reflected in{" "}
                <button type="button" className="underline underline-offset-2" onClick={() => router.push(`/scope/${co.boqRevisionId}`)}>
                  a BOQ revision
                </button>.
              </p>
            ) : (
              <div className="mt-1 space-y-1.5">
                <p className="text-sm text-ct-muted">This approved change has not yet been carried into a BOQ revision.</p>
                <Button size="sm" variant="outline" disabled={creatingRevision} onClick={createBoqRevisionFromThisChangeOrder}>
                  {creatingRevision ? "Opening…" : "Create BOQ Revision from this Change Order"}
                </Button>
              </div>
            )}
          </div>
        )}

        {co.status === "pending_approval" && (
          <div className="border-t border-ct-border pt-3">
            <Label className="text-ct-muted">Signature Status</Label>
            {!signatureStatus || !signatureStatus.signatureRequest ? (
              <p className="mt-1 text-sm text-ct-muted">No signature request created yet.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {signatureStatus.signatureRequest.signers.map((s) => (
                  <li key={s.email} className={s.status === "declined" ? "text-px-error" : "text-ct-navy"}>
                    {s.name} ({s.email}): {s.status}{s.status === "declined" && s.declineReason ? ` — "${s.declineReason}"` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
