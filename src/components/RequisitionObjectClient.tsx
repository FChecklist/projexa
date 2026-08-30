"use client";

// Real-screen conversion (2026-08-30): requisitions already had a real
// single-item GET (getPurchaseRequisition, Priority 17 Wave 1) but no real
// detail screen -- only a flat list row with an inline Submit button. Real
// Object Page on the kit's ObjectScreen. No generic Edit/Delete -- no
// updateRequisition() exists.
//
// Real, pre-existing, deliberate constraint (not introduced by this
// conversion): submitPurchaseRequisition() requires a real session user
// (startApprovalWorkflow needs a real dbUser to attribute the workflow
// instance to -- see the route's own comment) and 400s for PROJEXA's
// Bearer-key caller. The Submit button below shows that real message via
// toast if blocked, same as the old inline button already did.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type Requisition = {
  id: string; requisitionNumber: number; purpose: string | null; status: string; postingDate: string;
  items: { id: string; description: string; quantity: string; estimatedRate: string | null }[];
};

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", submitted: "waiting", approved: "done" };

export default function RequisitionObjectClient({ requisitionId }: { requisitionId: string }) {
  const router = useRouter();
  const [req, setReq] = useState<Requisition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      setReq(await fetchJson<Requisition>(`/api/procurement/requisitions/${requisitionId}`));
      setLoadError(null);
    } catch (err) {
      setReq(null);
      setLoadError(errorMessage(err, "Couldn't load this requisition"));
    }
  }
  useEffect(() => { load(); }, [requisitionId]);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/procurement/requisitions/${requisitionId}/submit`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to submit requisition");
      toast.success("Requisition submitted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit requisition (requires a real user session)");
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
  if (!req) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Procurement / Requisition"
      title={`PR-${req.requisitionNumber}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[req.status] ?? "neutral", label: req.status }}
      facets={[{ label: "Purpose", value: req.purpose ?? "—" }, { label: "Posting Date", value: formatDate(req.postingDate) }]}
      onBack={() => router.push("/procurement?tab=requisitions")}
      messages={[]}
    >
      {req.status === "draft" && (
        <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
          <Button size="sm" disabled={submitting} onClick={submit}><Send className="size-4" /> {submitting ? "Submitting…" : "Submit"}</Button>
        </div>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Estimated Rate</TableHead></TableRow></TableHeader>
        <TableBody>
          {req.items.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.description}</TableCell>
              <TableCell className="text-right">{i.quantity}</TableCell>
              <TableCell className="text-right">{i.estimatedRate ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ObjectScreen>
  );
}
