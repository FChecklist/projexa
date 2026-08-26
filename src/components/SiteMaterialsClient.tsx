"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// qtyOnHand is optional on purpose: A4S14_11 measured that the Catalog
// response carries no stock-quantity field at all -- that number comes from
// the Inbound endpoint. Typing it as always-present was what produced a
// silently blank column.
type Material = { id: string; spec: string; unit: string; unitCost: string; qtyOnHand?: string | null };
type Inbound = { id: string; materialId: string; receivedDate: string; quantityReceived: string; unitCost: string; totalCost: string; vendorName: string | null };
type CostReportRow = { materialId: string; spec: string; unit: string; totalQuantityReceived: number; totalCost: number; averageUnitCost: number };

export default function SiteMaterialsClient({ projectId }: { projectId: string }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [inbound, setInbound] = useState<Inbound[]>([]);
  const [report, setReport] = useState<CostReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [spec, setSpec] = useState(""); const [unit, setUnit] = useState(""); const [unitCost, setUnitCost] = useState("");
  const [materialId, setMaterialId] = useState(""); const [qty, setQty] = useState(""); const [receiveCost, setReceiveCost] = useState("");
  const [vendorName, setVendorName] = useState(""); const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [inboundFailed, setInboundFailed] = useState(false);
  const [reportFailed, setReportFailed] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [inboundError, setInboundError] = useState<string | null>(null);

  // R52 / A4S14_11. The Inbound and Cost Report endpoints were both returning
  // HTTP 502, and this page turned each of those failures into "No receipts
  // recorded yet." / "No receipts to report yet." -- a confident empty state
  // where an error belonged. res.ok was never read, so { error: "..." } parsed
  // fine, `.inbound` came back undefined and `?? []` finished the job. The
  // 502s themselves are VERIDIAN-side and not fixable from this repo; what IS
  // fixable is that the user could not tell "nothing here" from "this failed".
  //
  // allSettled, not all: Catalog answered 200 in the recorded run and must
  // still render even while the other two are down.
  async function load() {
    setLoading(true);
    setLoadErrors([]);
    const [mRes, iRes, rRes] = await Promise.allSettled([
      fetchJson<{ materials?: Material[] }>(`/api/construction-materials?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ inbound?: Inbound[] }>(`/api/construction-materials/inbound?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ report?: CostReportRow[] }>(`/api/construction-materials/cost-report?projectId=${encodeURIComponent(projectId)}`),
    ]);
    const failures: string[] = [];
    function value<T>(result: PromiseSettledResult<T>, what: string): T | null {
      if (result.status === "fulfilled") return result.value;
      failures.push(errorMessage(result.reason, what));
      return null;
    }
    setMaterials(value(mRes, "Catalog")?.materials ?? []);
    setInbound(value(iRes, "Inbound")?.inbound ?? []);
    setReport(value(rRes, "Cost report")?.report ?? []);
    // Which of the three failed decides which tab may claim to be empty.
    setInboundFailed(iRes.status === "rejected");
    setReportFailed(rRes.status === "rejected");
    setLoadErrors(failures);
    if (failures.length > 0) toast.error(failures[0]);
    setLoading(false);
  }
  useEffect(() => { load(); }, [projectId]);

  // R52 / A4S14_11 -- the recorded diagnosis for this button was wrong, and
  // the real defect is a different one. "Add Material" was filed as a dead
  // no-op because no [role="dialog"] appeared on click. There is no dialog on
  // this route: Add Material submits the INLINE Spec/Unit/Unit Cost form
  // rendered beside it. The click did land and the handler did run -- it hit
  // the guard below and returned in silence with Spec and Unit still empty,
  // producing no dialog, no request and no message. Same class as F_006
  // (/change-orders), not the kit click-handler family it was grouped with.
  async function addMaterial() {
    if (!spec.trim() || !unit.trim()) {
      // Never fail after a click without saying why.
      setAddError("Spec and Unit are both required to add a material.");
      toast.error("Spec and Unit are both required to add a material.");
      return;
    }
    setAddError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/construction-materials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, spec, unit, unitCost: Number(unitCost || 0) }) });
      if (!res.ok) throw new Error();
      toast.success("Material added"); setSpec(""); setUnit(""); setUnitCost(""); setAddError(null); load();
    } catch { toast.error("Couldn't add material"); } finally { setSubmitting(false); }
  }

  async function recordInbound() {
    if (!materialId || !qty) {
      setInboundError("Pick a material and enter a quantity received.");
      toast.error("Pick a material and enter a quantity received.");
      return;
    }
    setInboundError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/construction-materials/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, materialId, receivedDate, quantityReceived: Number(qty), unitCost: Number(receiveCost || 0), vendorName: vendorName || undefined }) });
      if (!res.ok) throw new Error();
      toast.success("Receipt recorded"); setQty(""); setReceiveCost(""); setVendorName(""); load();
    } catch { toast.error("Couldn't record receipt"); } finally { setSubmitting(false); }
  }

  const specFor = (id: string) => materials.find((m) => m.id === id)?.spec ?? id;

  return (
    <Tabs defaultValue="catalog" className="space-y-4">
      {loadErrors.length > 0 && (
        <Card role="alert" className="border-px-error-border bg-px-error-light">
          <CardContent className="space-y-2 p-4 text-sm text-px-error">
            <p className="font-medium">Some site-materials data could not be loaded.</p>
            <ul className="list-disc space-y-0.5 pl-5">{loadErrors.map((m) => <li key={m}>{m}</li>)}</ul>
            <Button size="sm" variant="outline" onClick={() => load()}>Retry</Button>
          </CardContent>
        </Card>
      )}
      <TabsList>
        <TabsTrigger value="catalog">Catalog</TabsTrigger>
        <TabsTrigger value="inbound">Inbound</TabsTrigger>
        <TabsTrigger value="report">Cost Report</TabsTrigger>
      </TabsList>

      <TabsContent value="catalog" className="space-y-4">
        <Card><CardContent className="flex flex-wrap items-end gap-2 p-4">
          <div className="space-y-1.5"><Label>Spec</Label><Input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="e.g. OPC 53 Grade Cement" /></div>
          <div className="space-y-1.5"><Label>Unit</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="bag/kg/cum" /></div>
          <div className="space-y-1.5"><Label>Unit Cost</Label><Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></div>
          <Button onClick={addMaterial} disabled={submitting}><Plus className="size-4" /> Add Material</Button>
          {addError && <p role="alert" className="w-full text-sm text-px-error">{addError}</p>}
        </CardContent></Card>
        <Card className="shadow-card"><CardContent className="p-0">
          {loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          : materials.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No materials yet.</p>
          : <Table><TableHeader><TableRow><TableHead>Spec</TableHead><TableHead>Unit</TableHead><TableHead>Unit Cost</TableHead><TableHead title="Sourced from Inbound receipts">Qty on Hand</TableHead></TableRow></TableHeader>
            <TableBody>{materials.map((m) => <TableRow key={m.id}><TableCell className="font-medium">{m.spec}</TableCell><TableCell>{m.unit}</TableCell><TableCell>{m.unitCost}</TableCell><TableCell className={m.qtyOnHand == null || m.qtyOnHand === "" ? "text-px-muted" : undefined}>{m.qtyOnHand == null || m.qtyOnHand === "" ? "—" : m.qtyOnHand}</TableCell></TableRow>)}</TableBody></Table>}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="inbound" className="space-y-4">
        <Card><CardContent className="flex flex-wrap items-end gap-2 p-4">
          <div className="space-y-1.5"><Label>Material</Label>
            <Select value={materialId} onValueChange={setMaterialId}><SelectTrigger className="w-48"><SelectValue placeholder="Select material" /></SelectTrigger>
              <SelectContent>{materials.map((m) => <SelectItem key={m.id} value={m.id}>{m.spec}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Qty Received</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Unit Cost</Label><Input type="number" value={receiveCost} onChange={(e) => setReceiveCost(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Vendor (optional)</Label><Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} /></div>
          <Button onClick={recordInbound} disabled={submitting || materials.length === 0}><Plus className="size-4" /> Record Receipt</Button>
          {inboundError && <p role="alert" className="w-full text-sm text-px-error">{inboundError}</p>}
        </CardContent></Card>
        <Card className="shadow-card"><CardContent className="p-0">
          {inboundFailed ? <p role="alert" className="py-10 text-center text-sm text-px-error">Inbound receipts could not be loaded, so this list is not the answer &quot;none&quot;. Retry above.</p>
          : inbound.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No receipts recorded yet.</p>
          : <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Material</TableHead><TableHead>Qty</TableHead><TableHead>Unit Cost</TableHead><TableHead>Total</TableHead><TableHead>Vendor</TableHead></TableRow></TableHeader>
            <TableBody>{inbound.map((e) => <TableRow key={e.id}><TableCell>{formatDate(e.receivedDate)}</TableCell><TableCell>{specFor(e.materialId)}</TableCell><TableCell>{e.quantityReceived}</TableCell><TableCell>{e.unitCost}</TableCell><TableCell>{e.totalCost}</TableCell><TableCell className="text-px-muted">{e.vendorName ?? "—"}</TableCell></TableRow>)}</TableBody></Table>}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="report" className="space-y-4">
        <Card className="shadow-card"><CardContent className="p-0">
          {reportFailed ? <p role="alert" className="py-10 text-center text-sm text-px-error">The cost report could not be loaded, so this is not the answer &quot;nothing to report&quot;. Retry above.</p>
          : report.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No receipts to report yet.</p>
          : <Table><TableHeader><TableRow><TableHead>Spec</TableHead><TableHead>Unit</TableHead><TableHead>Total Qty Received</TableHead><TableHead>Total Cost</TableHead><TableHead>Avg Unit Cost</TableHead></TableRow></TableHeader>
            <TableBody>{report.map((r) => <TableRow key={r.materialId}><TableCell className="font-medium">{r.spec}</TableCell><TableCell>{r.unit}</TableCell><TableCell>{r.totalQuantityReceived}</TableCell><TableCell>{r.totalCost.toFixed(2)}</TableCell><TableCell>{r.averageUnitCost.toFixed(2)}</TableCell></TableRow>)}</TableBody></Table>}
        </CardContent></Card>
      </TabsContent>
    </Tabs>
  );
}
