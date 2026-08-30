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
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type ChangeOrder = {
  id: string; projectId: string; number: number; title: string; reason: string | null;
  costImpact: string; scheduleImpactDays: number; status: string;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendingOpen, setSendingOpen] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      setLoadError(errorMessage(err, "Couldn't load this change order"));
    }
  }

  useEffect(() => { load(); }, [changeOrderId]);

  async function submitForApproval() {
    if (!signerName.trim() || !signerEmail.trim()) {
      toast.error("Signer name and email are required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail.trim())) {
      toast.error(`"${signerEmail.trim()}" is not a valid email address`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/change-orders/${changeOrderId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", signers: [{ name: signerName, email: signerEmail }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit for approval");
      toast.success("Sent for e-signature approval");
      setSendingOpen(false); setSignerName(""); setSignerEmail("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit for approval");
    } finally {
      setSubmitting(false);
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

        {co.status === "draft" && (
          <div className="border-t border-ct-border pt-3">
            {!sendingOpen ? (
              <Button size="sm" variant="outline" onClick={() => setSendingOpen(true)}>Send for Approval</Button>
            ) : (
              <div className="space-y-2 max-w-sm">
                <p className="text-xs text-ct-muted">Real signing request, tamper-evident audit trail (same workflow used for contracts).</p>
                <div className="space-y-1.5"><Label>Signer name</Label><Input value={signerName} onChange={(e) => setSignerName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Signer email</Label><Input type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} /></div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={submitting} onClick={submitForApproval}>{submitting ? "Sending…" : "Send"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSendingOpen(false)}>Cancel</Button>
                </div>
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
