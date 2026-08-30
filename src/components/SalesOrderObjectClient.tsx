"use client";

// Real-screen conversion (2026-08-30): sales orders never had a detail view
// at all -- line items (and their per-item deliveredQuantity, tracking
// partial fulfillment) were completely invisible in the flat list.
// getSalesOrder() didn't exist before this conversion (only the paginated
// list). Real Object Page on the kit's ObjectScreen, including a real
// Document Flow section -- getSalesOrderDocumentFlow() (SAP VBFA "Display
// Document Flow" equivalent: quotation -> this order -> invoice(s) ->
// payments/credit notes/returns) has existed as a complete, working v1
// route since it was built, but had ZERO PROJEXA-facing proxy until this
// conversion -- a fully-built real feature that was simply unreachable.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone, DocumentFlowData } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type SalesOrderItem = { id: string; description: string; quantity: string; rate: string; amount: string; deliveredQuantity: string };
type SalesOrder = {
  id: string; soNumber: number; customerName: string | null; orderDate: string; deliveryDate: string | null;
  status: string; currencyId: string | null; grandTotal: string; items: SalesOrderItem[];
};
type FlowNode = { docType: string; docId: string; docNumber: string; amount: number; status: string; parentDocId: string | null };

const STATUS_OPTIONS = ["draft", "confirmed", "partially_fulfilled", "fulfilled", "cancelled"];
const STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral", confirmed: "waiting", partially_fulfilled: "waiting", fulfilled: "done", cancelled: "late",
};

// Real page for each doc type this session has already built (quotations
// module #25, invoices/credit-notes module #13) -- anything without a real
// PROJEXA screen (payment entries, sales returns) gets a stable, non-fake
// anchor rather than a link to a page that doesn't exist.
function hrefFor(node: FlowNode): string {
  switch (node.docType) {
    case "quotation": return `/quotations/${node.docId}`;
    case "sales_invoice": return `/invoices/${node.docId}`;
    case "credit_note": return `/invoices/credit-notes/${node.docId}`;
    default: return `#${node.docType}-${node.docId}`;
  }
}
function labelFor(node: FlowNode): string {
  return `${node.docNumber} (${node.status})`;
}

export default function SalesOrderObjectClient({ salesOrderId }: { salesOrderId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  async function load() {
    try {
      const [data, flowData] = await Promise.all([
        fetchJson<SalesOrder>(`/api/sales-orders/${salesOrderId}`),
        fetchJson<FlowNode[]>(`/api/sales-order-document-flow/${salesOrderId}`).catch(() => []),
      ]);
      setOrder(data);
      setFlowNodes(Array.isArray(flowData) ? flowData : []);
      setLoadError(null);
    } catch (err) {
      setOrder(null);
      setLoadError(errorMessage(err, "Couldn't load this sales order"));
    }
  }
  useEffect(() => { load(); }, [salesOrderId]);

  async function updateStatus(status: string) {
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/sales-orders/${salesOrderId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update sales order");
      toast.success(`Order → ${status}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update sales order");
    } finally {
      setStatusBusy(false);
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
  if (!order) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const label = currencyLabel(order.currencyId, currencies);
  const thisNode = flowNodes.find((n) => n.docId === salesOrderId);
  const documentFlow: DocumentFlowData = {
    from: thisNode?.parentDocId
      ? flowNodes.filter((n) => n.docId === thisNode.parentDocId).map((n) => ({ label: labelFor(n), href: hrefFor(n) }))
      : [],
    to: flowNodes.filter((n) => n.parentDocId && n.docId !== salesOrderId && n.docType !== "quotation").map((n) => ({ label: labelFor(n), href: hrefFor(n) })),
  };

  return (
    <ObjectScreen
      breadcrumb="Sales Orders / Order"
      title={`SO-${order.soNumber}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[order.status] ?? "neutral", label: order.status.replace(/_/g, " ") }}
      facets={[
        { label: "Customer", value: order.customerName ?? "—" },
        { label: "Order Date", value: formatDate(order.orderDate) },
        { label: "Delivery Date", value: order.deliveryDate ? formatDate(order.deliveryDate) : "—" },
        { label: "Grand Total", value: `${label}${Number(order.grandTotal).toLocaleString()}` },
      ]}
      documentFlow={documentFlow}
      onBack={() => router.push("/sales-orders")}
      messages={[]}
    >
      <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
        <Select value={order.status} onValueChange={updateStatus}>
          <SelectTrigger className="h-8 w-44" disabled={statusBusy}><SelectValue /></SelectTrigger>
          <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Delivered</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>
          {order.items.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.description}</TableCell>
              <TableCell className="text-right">{Number(i.quantity).toLocaleString()}</TableCell>
              <TableCell className="text-right">{Number(i.deliveredQuantity ?? 0).toLocaleString()}</TableCell>
              <TableCell className="text-right">{label}{Number(i.rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right">{label}{Number(i.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ObjectScreen>
  );
}
