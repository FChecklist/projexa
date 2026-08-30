"use client";

// Real-screen conversion (2026-08-30): sales quotations (erp_quotations --
// a genuinely different entity from Procurement's Supplier Quotations,
// module #22, which live in erp_supplier_quotations) never had a detail
// view -- getQuotation() didn't exist before this conversion (only
// getQuotationForPdf, built specifically for PDF rendering). Real Object
// Page on the kit's ObjectScreen. The old "Convert to Sales Order" Dialog
// popup is now a real inline toolbar form (order date + Convert), not a
// second popup.
//
// Real, pre-existing, deliberate constraint (not introduced here): the
// pending_approval -> approved transition specifically requires a real
// session user + manager permission (see the route's own long comment) --
// every other transition (submit/reject/mark sent/mark lost/mark expired,
// plus create/revision/convert) works normally via PROJEXA's API key.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, FileDown, ArrowRightCircle, Loader2 } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type QuotationItem = { id: string; description: string; quantity: string; rate: string; amount: string };
type Quotation = {
  id: string; quotationNumber: number; customerId: string | null; customerName: string | null;
  quotationDate: string; validTill: string | null; status: string; version: number; revisionOf: string | null;
  currencyId: string | null; exchangeRate: string; grandTotal: string; items: QuotationItem[];
};

const NEXT_ACTIONS: Record<string, { label: string; status: string }[]> = {
  draft: [{ label: "Submit for Approval", status: "pending_approval" }],
  pending_approval: [{ label: "Approve", status: "approved" }, { label: "Reject to Draft", status: "draft" }],
  approved: [{ label: "Mark Sent", status: "sent" }],
  sent: [{ label: "Mark Lost", status: "lost" }, { label: "Mark Expired", status: "expired" }],
  ordered: [], lost: [], expired: [],
};
const STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral", pending_approval: "waiting", approved: "waiting", sent: "running", ordered: "done", lost: "late", expired: "late",
};

export default function SalesQuotationObjectClient({ quotationId }: { quotationId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function load() {
    try {
      setQuotation(await fetchJson<Quotation>(`/api/quotations/${quotationId}`));
      setLoadError(null);
    } catch (err) {
      setQuotation(null);
      setLoadError(errorMessage(err, "Couldn't load this quotation"));
    }
  }
  useEffect(() => { load(); }, [quotationId]);

  async function transition(status: string) {
    setBusy(`status-${status}`);
    try {
      const res = await fetch(`/api/quotations/${quotationId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update quotation status");
      toast.success(`Quotation → ${status}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update quotation status");
    } finally {
      setBusy(null);
    }
  }

  async function createRevision() {
    setBusy("revision");
    try {
      const res = await fetch(`/api/quotations/${quotationId}/revisions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to create revision");
      toast.success(`Revision v${(quotation?.version ?? 1) + 1} created`);
      router.push(`/quotations/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create revision");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    setBusy("pdf");
    try {
      const res = await fetch(`/api/quotations/${quotationId}/pdf`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quotation-${quotation?.quotationNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't download quotation PDF");
    } finally {
      setBusy(null);
    }
  }

  async function convertToOrder() {
    setBusy("convert");
    try {
      const res = await fetch(`/api/quotations/${quotationId}/convert`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderDate }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to convert quotation");
      toast.success("Converted to a sales order");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't convert quotation");
    } finally {
      setBusy(null);
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
  if (!quotation) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const label = currencyLabel(quotation.currencyId, currencies);
  const canRevise = !["ordered", "lost", "expired"].includes(quotation.status);

  return (
    <ObjectScreen
      breadcrumb="Quotations / Quotation"
      title={`Quotation #${quotation.quotationNumber}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[quotation.status] ?? "neutral", label: quotation.status.replace(/_/g, " ") }}
      facets={[
        { label: "Customer", value: quotation.customerName ?? "—" },
        { label: "Date", value: formatDate(quotation.quotationDate) },
        { label: "Valid Till", value: quotation.validTill ? formatDate(quotation.validTill) : "—" },
        { label: "Version", value: `v${quotation.version}${quotation.revisionOf ? " (revision)" : ""}` },
        { label: "Grand Total", value: `${label}${Number(quotation.grandTotal).toLocaleString()}` },
      ]}
      onBack={() => router.push("/quotations")}
      messages={[]}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-ct-border px-4 py-3">
        {(NEXT_ACTIONS[quotation.status] ?? []).map((action) => (
          <Button key={action.status} size="sm" variant="outline" disabled={busy !== null} onClick={() => transition(action.status)}>
            {busy === `status-${action.status}` ? "Working…" : action.label}
          </Button>
        ))}
        {canRevise && (
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={createRevision} title="New revision">
            <Copy className="size-3.5" /> {busy === "revision" ? "Creating…" : "New Revision"}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={downloadPdf}>
          {busy === "pdf" ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />} Download PDF
        </Button>
      </div>

      {quotation.status === "sent" && (
        <div className="flex items-end gap-2 border-b border-ct-border px-4 py-3">
          <div className="space-y-1.5"><Label>Order Date</Label><Input type="date" className="w-40" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
          <Button size="sm" disabled={busy !== null} onClick={convertToOrder}>
            <ArrowRightCircle className="size-3.5" /> {busy === "convert" ? "Converting…" : "Convert to Sales Order"}
          </Button>
        </div>
      )}

      <Table>
        <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>
          {quotation.items.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.description}</TableCell>
              <TableCell className="text-right">{Number(i.quantity).toLocaleString()}</TableCell>
              <TableCell className="text-right">{label}{Number(i.rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right">{label}{Number(i.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ObjectScreen>
  );
}
