"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";

type ChangeOrder = {
  id: string; number: number; title: string; reason: string | null; costImpact: string; scheduleImpactDays: number; status: string;
};

type SignatureStatus = {
  signatureRequest: {
    id: string; status: string; title: string; completedAt: string | null;
    signers: { name: string; email: string; status: string; signOrder: number | null; signedAt: string | null; declinedAt: string | null; declineReason: string | null }[];
  } | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", pending_approval: "secondary", approved: "default", rejected: "destructive",
};

// Real, honest signature-progress summary for a pending_approval change
// order -- deliberately NOT a one-click approve/reject button. A naive
// button here would let any team member flip a change order to "approved"
// regardless of whether the actual external signer signed anything,
// defeating the entire point of using e-signature instead of a status flag
// (PROJEXA_GAP_ANALYSIS.md gap #5). The real approval mechanism is
// VERIDIAN's e-signature completion path (esignature-service.ts), which now
// auto-transitions the change order's own status once every signer has
// signed (or rejects it if a signer declines) -- this cell only reports
// that real progress, it never causes it.
function SignatureStatusCell({ data, loading }: { data: SignatureStatus | undefined; loading: boolean }) {
  if (loading) return <span className="text-xs text-px-muted">Checking signature status…</span>;
  if (!data || !data.signatureRequest) {
    return <span className="text-xs text-px-muted">No signature request created yet</span>;
  }
  const { signers, status } = data.signatureRequest;
  const signedCount = signers.filter((s) => s.status === "signed").length;
  const declined = signers.find((s) => s.status === "declined");
  if (status === "declined" || declined) {
    return (
      <span className="text-xs text-px-error">
        Declined by {declined?.name ?? "a signer"}{declined?.declineReason ? ` — "${declined.declineReason}"` : ""}
      </span>
    );
  }
  if (status === "voided") return <span className="text-xs text-px-muted">Signature request voided</span>;
  return (
    <span className="text-xs text-px-muted" title={signers.map((s) => `${s.name} (${s.email}): ${s.status}`).join(", ")}>
      Awaiting signature ({signedCount} of {signers.length} signed)
    </span>
  );
}

export default function ChangeOrdersClient({ projectId }: { projectId: string }) {
  const currencies = useCurrencies();
  // Priority 17 re-sweep fix: was Intl.NumberFormat(..., { currency: "INR" })
  // -- forced both symbol and grouping to India regardless of the org's real
  // base currency. Closure over `currencies` so every existing
  // formatCurrency(...) call site below is unchanged.
  const formatCurrency = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const [items, setItems] = useState<ChangeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [signatureStatuses, setSignatureStatuses] = useState<Record<string, SignatureStatus>>({});
  const [signatureStatusLoading, setSignatureStatusLoading] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [costImpact, setCostImpact] = useState("");
  const [scheduleImpactDays, setScheduleImpactDays] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittingId, setSubmittingId] = useState<ChangeOrder | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/change-orders?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      const changeOrders: ChangeOrder[] = data.changeOrders ?? [];
      setItems(changeOrders);
      // Only pending_approval rows have anything to show here -- draft has
      // no signature request yet, approved/rejected already have their
      // final Badge, no need to spend a request on those.
      const pending = changeOrders.filter((c) => c.status === "pending_approval");
      setSignatureStatusLoading(Object.fromEntries(pending.map((c) => [c.id, true])));
      await Promise.all(pending.map(async (c) => {
        try {
          const sRes = await fetch(`/api/change-orders/${c.id}/signature-status`);
          const sData = await sRes.json();
          setSignatureStatuses((prev) => ({ ...prev, [c.id]: sData }));
        } catch {
          // Leave this row's entry unset -- SignatureStatusCell already
          // renders an honest "No signature request created yet" fallback
          // for undefined, no separate error state needed for one row.
        } finally {
          setSignatureStatusLoading((prev) => ({ ...prev, [c.id]: false }));
        }
      }));
    } catch {
      toast.error("Couldn't load change orders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createChangeOrder() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/change-orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title, reason: reason || undefined,
          costImpact: costImpact ? Number(costImpact) : 0,
          scheduleImpactDays: scheduleImpactDays ? Number(scheduleImpactDays) : 0,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Change order created");
      setTitle(""); setReason(""); setCostImpact(""); setScheduleImpactDays(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create change order");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitForApproval() {
    if (!submittingId || !signerName.trim() || !signerEmail.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/change-orders/${submittingId.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", signers: [{ name: signerName, email: signerEmail }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Sent for e-signature approval");
      setSubmittingId(null); setSignerName(""); setSignerEmail("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit for approval");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Change Order</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Change Order</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Reason (optional)</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Cost Impact ({currencyLabel(undefined, currencies).trim()})</Label><Input type="number" value={costImpact} onChange={(e) => setCostImpact(e.target.value)} placeholder="+/- amount" /></div>
                <div className="space-y-1.5"><Label>Schedule Impact (days)</Label><Input type="number" value={scheduleImpactDays} onChange={(e) => setScheduleImpactDays(e.target.value)} placeholder="+/- days" /></div>
              </div>
            </div>
            <DialogFooter><Button onClick={createChangeOrder} disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No change orders yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Cost Impact</TableHead>
                  <TableHead>Schedule Impact</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">CO-{c.number}</TableCell>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell className={Number(c.costImpact) >= 0 ? "text-px-error" : "text-px-success"}>{formatCurrency(Number(c.costImpact))}</TableCell>
                    <TableCell className="text-px-muted">{c.scheduleImpactDays > 0 ? `+${c.scheduleImpactDays}d` : c.scheduleImpactDays === 0 ? "—" : `${c.scheduleImpactDays}d`}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[c.status]}>{c.status.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-right">
                      {c.status === "draft" && <Button size="sm" variant="outline" onClick={() => setSubmittingId(c)}>Send for Approval</Button>}
                      {c.status === "pending_approval" && (
                        <SignatureStatusCell data={signatureStatuses[c.id]} loading={!!signatureStatusLoading[c.id]} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!submittingId} onOpenChange={(v) => !v && setSubmittingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send for E-Signature Approval</DialogTitle></DialogHeader>
          <p className="text-sm text-px-muted">Real signing request, tamper-evident audit trail (same workflow used for contracts).</p>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Signer name</Label><Input value={signerName} onChange={(e) => setSignerName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Signer email</Label><Input type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={submitForApproval} disabled={submitting}>{submitting ? "Sending…" : "Send"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
