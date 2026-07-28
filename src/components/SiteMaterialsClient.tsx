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

type Material = { id: string; spec: string; unit: string; unitCost: string; qtyOnHand: string };
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

  async function load() {
    setLoading(true);
    try {
      const [mRes, iRes, rRes] = await Promise.all([
        fetch(`/api/construction-materials?projectId=${projectId}`),
        fetch(`/api/construction-materials/inbound?projectId=${projectId}`),
        fetch(`/api/construction-materials/cost-report?projectId=${projectId}`),
      ]);
      setMaterials((await mRes.json()).materials ?? []);
      setInbound((await iRes.json()).inbound ?? []);
      setReport((await rRes.json()).report ?? []);
    } catch {
      toast.error("Couldn't load materials");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [projectId]);

  async function addMaterial() {
    if (!spec.trim() || !unit.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/construction-materials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, spec, unit, unitCost: Number(unitCost || 0) }) });
      if (!res.ok) throw new Error();
      toast.success("Material added"); setSpec(""); setUnit(""); setUnitCost(""); load();
    } catch { toast.error("Couldn't add material"); } finally { setSubmitting(false); }
  }

  async function recordInbound() {
    if (!materialId || !qty) return;
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
        </CardContent></Card>
        <Card className="shadow-card"><CardContent className="p-0">
          {loading ? <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          : materials.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No materials yet.</p>
          : <Table><TableHeader><TableRow><TableHead>Spec</TableHead><TableHead>Unit</TableHead><TableHead>Unit Cost</TableHead><TableHead>Qty on Hand</TableHead></TableRow></TableHeader>
            <TableBody>{materials.map((m) => <TableRow key={m.id}><TableCell className="font-medium">{m.spec}</TableCell><TableCell>{m.unit}</TableCell><TableCell>{m.unitCost}</TableCell><TableCell>{m.qtyOnHand}</TableCell></TableRow>)}</TableBody></Table>}
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
        </CardContent></Card>
        <Card className="shadow-card"><CardContent className="p-0">
          {inbound.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No receipts recorded yet.</p>
          : <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Material</TableHead><TableHead>Qty</TableHead><TableHead>Unit Cost</TableHead><TableHead>Total</TableHead><TableHead>Vendor</TableHead></TableRow></TableHeader>
            <TableBody>{inbound.map((e) => <TableRow key={e.id}><TableCell>{new Date(e.receivedDate).toLocaleDateString()}</TableCell><TableCell>{specFor(e.materialId)}</TableCell><TableCell>{e.quantityReceived}</TableCell><TableCell>{e.unitCost}</TableCell><TableCell>{e.totalCost}</TableCell><TableCell className="text-px-muted">{e.vendorName ?? "—"}</TableCell></TableRow>)}</TableBody></Table>}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="report" className="space-y-4">
        <Card className="shadow-card"><CardContent className="p-0">
          {report.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No receipts to report yet.</p>
          : <Table><TableHeader><TableRow><TableHead>Spec</TableHead><TableHead>Unit</TableHead><TableHead>Total Qty Received</TableHead><TableHead>Total Cost</TableHead><TableHead>Avg Unit Cost</TableHead></TableRow></TableHeader>
            <TableBody>{report.map((r) => <TableRow key={r.materialId}><TableCell className="font-medium">{r.spec}</TableCell><TableCell>{r.unit}</TableCell><TableCell>{r.totalQuantityReceived}</TableCell><TableCell>{r.totalCost.toFixed(2)}</TableCell><TableCell>{r.averageUnitCost.toFixed(2)}</TableCell></TableRow>)}</TableBody></Table>}
        </CardContent></Card>
      </TabsContent>
    </Tabs>
  );
}
