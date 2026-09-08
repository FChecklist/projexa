"use client";

// Real-screen conversion (2026-08-30): replaces ProcurementClient.tsx's old
// "Record Quotation" Dialog popup with a real create screen. No Object
// Page -- no getSupplierQuotation() exists (only listSupplierQuotations),
// matching Expenses' own "create-only" precedent. "Convert to PO" stays a
// real inline action on the list, unchanged.
//
// R80 GAP-7 (2026-09-08): the screen held ONE description/quantity/rate
// triple in three scalar useStates and posted `items: [{ … }]` -- a literal
// one-element array -- so a supplier's quotation could only ever be
// recorded against a single line, which makes the RFQ comparison it feeds
// (rfqs/[id]/comparison) compare one item per vendor no matter how many
// were quoted. The API has always taken an array of any length (VERIDIAN
// erp-procurement-workflow-service.ts createSupplierQuotation:
// `if (!input.items?.length) throw new ServiceError("At least one line item
// is required", 400)` -- a MINIMUM of one -- then `input.items.map(…)` into
// a bulk insert; the list's own total is
// `q.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.rate), 0)`,
// already written for N lines). Converted to the same repeatable line
// editor PurchaseOrderCreateClient.tsx uses, with the running total that
// same reduce will show back on the list.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { useOrgMoney } from "@/lib/use-org-money";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Rfq = { id: string; rfqNumber: number };
type Vendor = { id: string; vendorName: string };
type Line = { description: string; quantity: string; rate: string };

// R80 (2026-09-08): ONE parse, used by BOTH the quoted total the user reads
// and the payload that gets posted. They used to disagree -- the total read an
// empty Qty as 0 while the payload sent `Number(l.quantity) || 1`, and nothing
// required a quantity -- so clearing a Qty box showed a total that was not the
// quotation about to be recorded (and not the one the RFQ comparison would
// then show back). The quantity is now REQUIRED (below) and posted exactly as
// parsed, with no `|| 1` fallback.
function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function QuotationCreateClient() {
  const router = useRouter();
  const orgMoney = useOrgMoney();
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rfqId, setRfqId] = useState("none");
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", rate: "" }]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ rfqs?: Rfq[] }>("/api/procurement/rfqs").then((d) => setRfqs(d.rfqs ?? [])).catch(() => {});
    fetchJson<{ vendors?: Vendor[] }>("/api/vendors").then((d) => setVendors(d.vendors ?? [])).catch(() => {});
  }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const quotedTotal = lines.reduce((sum, l) => sum + num(l.quantity) * num(l.rate), 0);

  const missing = [
    ...(supplierId ? [] : ["Vendor"]),
    ...(lines.every((l) => l.description.trim()) ? [] : ["A description on every line"]),
    ...(lines.every((l) => l.quantity) ? [] : ["A quantity on every line"]),
  ];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      await fetchJson("/api/procurement/quotations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rfqId: rfqId !== "none" ? rfqId : undefined, supplierId,
          postingDate: new Date().toISOString().slice(0, 10),
          items: lines.map((l) => ({ description: l.description, quantity: num(l.quantity), rate: num(l.rate) })),
        }),
      });
      toast.success("Quotation recorded");
      router.push("/procurement?tab=quotations");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't record quotation"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Procurement / Record Quotation"
      title="Record Supplier Quotation"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/procurement?tab=quotations")}
      onBack={() => router.push("/procurement?tab=quotations")}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Recording…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>RFQ (optional)</Label>
          <Select value={rfqId} onValueChange={setRfqId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {rfqs.map((r) => <SelectItem key={r.id} value={r.id}>RFQ-{r.rfqNumber}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Vendor</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
            <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Line Items</Label>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
              <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-16" />
              <Input placeholder="Rate" type="number" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-24" />
              <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}>
            <Plus className="size-3.5" /> Add Line
          </Button>
        </div>
        <div className="rounded-md border border-px-border p-2 text-sm">
          Quoted total ({lines.length} {lines.length === 1 ? "line" : "lines"}) — {orgMoney.money(quotedTotal)}
        </div>
      </div>
    </ObjectScreen>
  );
}
