"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Plus } from "lucide-react";

// Point 33: was a 73-line empty-state-only stock ledger listing (no master,
// no create form). His words: "material database. material inbound, spec,
// cost, qty." -- a master (spec/unit/cost) and inbound receipts against it.
// No outbound/consumption/stock-on-hand -- not requested, not built.
type Material = { id: string; name: string; spec: string | null; unit: string; unitCost: string; isActive: boolean };
type Receipt = { id: string; materialId: string; receivedDate: string; quantity: string; unitCost: string | null; vendorId: string | null };

export default function MaterialsClient({ projectId }: { projectId: string }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  const [masterOpen, setMasterOpen] = useState(false);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [masterSubmitting, setMasterSubmitting] = useState(false);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [materialId, setMaterialId] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [receiptUnitCost, setReceiptUnitCost] = useState("");
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [materialsRes, receiptsRes] = await Promise.all([
        fetch(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`),
        fetch(`/api/materials?projectId=${encodeURIComponent(projectId)}`),
      ]);
      const materialsData = await materialsRes.json();
      const receiptsData = await receiptsRes.json();
      setMaterials(materialsData.materials ?? []);
      setReceipts(receiptsData.receipts ?? []);
    } catch {
      toast.error("Couldn't load materials");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  const materialName = (id: string) => materials.find((m) => m.id === id)?.name ?? id;

  async function createMaterial() {
    if (!name.trim() || !unit.trim()) return;
    setMasterSubmitting(true);
    try {
      const res = await fetch("/api/materials/master", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, spec: spec || undefined, unit, unitCost: unitCost ? Number(unitCost) : undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Material added");
      setName(""); setSpec(""); setUnit(""); setUnitCost(""); setMasterOpen(false);
      load();
    } catch {
      toast.error("Couldn't add material");
    } finally {
      setMasterSubmitting(false);
    }
  }

  async function createReceipt() {
    if (!materialId || !receivedDate || !quantity) return;
    setReceiptSubmitting(true);
    try {
      const res = await fetch("/api/materials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, materialId, receivedDate, quantity: Number(quantity),
          unitCost: receiptUnitCost ? Number(receiptUnitCost) : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success("Receipt recorded");
      setQuantity(""); setReceiptUnitCost(""); setReceiptOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't record receipt");
    } finally {
      setReceiptSubmitting(false);
    }
  }

  return (
    <Tabs defaultValue="master" className="space-y-4">
      <TabsList>
        <TabsTrigger value="master">Material Master</TabsTrigger>
        <TabsTrigger value="receipts">Inbound Receipts</TabsTrigger>
      </TabsList>

      <TabsContent value="master" className="space-y-4">
        <div className="flex justify-end">
          <Dialog open={masterOpen} onOpenChange={setMasterOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> Add Material</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Material</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Spec (optional)</Label><Input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="e.g. 43-grade OPC" /></div>
                <div className="space-y-1.5"><Label>Unit</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. bag, cum, kg" /></div>
                <div className="space-y-1.5"><Label>Unit Cost</Label><Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></div>
              </div>
              <DialogFooter><Button onClick={createMaterial} disabled={masterSubmitting}>{masterSubmitting ? "Adding…" : "Add Material"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : materials.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No materials in the master yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Spec</TableHead><TableHead>Unit</TableHead><TableHead>Unit Cost</TableHead></TableRow></TableHeader>
                <TableBody>
                  {materials.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="text-px-muted">{m.spec ?? "—"}</TableCell>
                      <TableCell>{m.unit}</TableCell>
                      <TableCell>{m.unitCost}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="receipts" className="space-y-4">
        <div className="flex justify-end">
          <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
            <DialogTrigger asChild><Button disabled={materials.length === 0}><Plus className="size-4" /> Record Receipt</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Record Inbound Receipt</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Material</Label>
                  <Select value={materialId} onValueChange={setMaterialId}>
                    <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                    <SelectContent>{materials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Received Date</Label><Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Unit Cost (optional — defaults to the master cost)</Label><Input type="number" value={receiptUnitCost} onChange={(e) => setReceiptUnitCost(e.target.value)} /></div>
              </div>
              <DialogFooter><Button onClick={createReceipt} disabled={receiptSubmitting}>{receiptSubmitting ? "Saving…" : "Record"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : receipts.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No material movements recorded yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Material</TableHead><TableHead>Quantity</TableHead><TableHead>Unit Cost</TableHead></TableRow></TableHeader>
                <TableBody>
                  {receipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-px-muted">{new Date(r.receivedDate).toLocaleDateString()}</TableCell>
                      <TableCell className="font-medium">{materialName(r.materialId)}</TableCell>
                      <TableCell>{r.quantity}</TableCell>
                      <TableCell>{r.unitCost ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
