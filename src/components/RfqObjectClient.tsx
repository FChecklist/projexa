"use client";

// Real-screen conversion (2026-08-30): RFQs never had a real detail view --
// getRfq() didn't exist before this conversion (only listRfqs). Real
// Object Page on the kit's ObjectScreen, also surfacing the real quotation
// comparison (compareQuotationsForRfq -- ranked by total, already had a
// working route via [id]/comparison, just no screen showing it). Scoring
// criteria, negotiation rounds, and reverse auctions are real, separately-
// built capabilities in erp-procurement-workflow-service.ts that this
// conversion does NOT surface -- a genuinely separate depth wave beyond
// this pass's List Report -> Object Page scope, disclosed here rather than
// silently skipped (see PROJEXA_REAL_SCREEN_CONVERSION_TRACKER.md module
// #22).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type Rfq = {
  id: string; rfqNumber: number; status: string; postingDate: string;
  items: { id: string; description: string; quantity: string }[];
  suppliers: { supplierId: string }[];
};
type ComparisonRow = { id: string; quotationNumber: number; supplierId: string; total: number; weightedScore: number | null };
type Vendor = { id: string; vendorName: string };

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", sent: "waiting" };

export default function RfqObjectClient({ rfqId }: { rfqId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const label = currencyLabel(undefined, currencies);
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [comparison, setComparison] = useState<ComparisonRow[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function load() {
    try {
      const [rfqData, cmpData, vendorData] = await Promise.all([
        fetchJson<Rfq>(`/api/procurement/rfqs/${rfqId}`),
        fetchJson<{ comparison?: ComparisonRow[] }>(`/api/procurement/rfqs/${rfqId}/comparison`).catch(() => ({ comparison: [] })),
        fetchJson<{ vendors?: Vendor[] }>("/api/vendors").catch(() => ({ vendors: [] })),
      ]);
      setRfq(rfqData);
      setComparison(cmpData.comparison ?? []);
      setVendors(vendorData.vendors ?? []);
      setLoadError(null);
    } catch (err) {
      setRfq(null);
      setLoadError(errorMessage(err, "Couldn't load this RFQ"));
    }
  }
  useEffect(() => { load(); }, [rfqId]);

  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/procurement/rfqs/${rfqId}/send`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to send RFQ");
      toast.success("RFQ sent to suppliers");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send RFQ");
    } finally {
      setSending(false);
    }
  }

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.vendorName ?? id;

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!rfq) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Procurement / RFQ"
      title={`RFQ-${rfq.rfqNumber}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[rfq.status] ?? "neutral", label: rfq.status }}
      facets={[{ label: "Posting Date", value: formatDate(rfq.postingDate) }, { label: "Vendors Invited", value: String(rfq.suppliers.length) }]}
      onBack={() => router.push("/procurement?tab=rfqs")}
      messages={[]}
    >
      {rfq.status === "draft" && (
        <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
          <Button size="sm" disabled={sending} onClick={send}><Send className="size-4" /> {sending ? "Sending…" : "Send to Vendors"}</Button>
        </div>
      )}
      <div className="px-4 py-3">
        <h4 className="mb-2 text-sm font-semibold text-ct-navy">Items</h4>
        <Table>
          <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Quantity</TableHead></TableRow></TableHeader>
          <TableBody>
            {rfq.items.map((i) => (
              <TableRow key={i.id}><TableCell>{i.description}</TableCell><TableCell className="text-right">{i.quantity}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="px-4 py-3">
        <h4 className="mb-2 text-sm font-semibold text-ct-navy">Quotation Comparison</h4>
        {comparison.length === 0 ? (
          <p className="text-sm text-ct-muted">No quotations received yet.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Weighted Score</TableHead></TableRow></TableHeader>
            <TableBody>
              {comparison.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{vendorName(c.supplierId)}</TableCell>
                  <TableCell className="text-right">{label}{c.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right">{c.weightedScore ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </ObjectScreen>
  );
}
