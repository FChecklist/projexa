"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormField, type FieldErrors, hasErrors } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";

// Point 33: was a 73-line empty-state-only stock ledger listing (no master,
// no create form). His words: "material database. material inbound, spec,
// cost, qty." -- a master (spec/unit/cost) and inbound receipts against it.
// No outbound/consumption/stock-on-hand -- not requested, not built.
//
// R46 P8 seq131: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list (see PermitsListClient.tsx's header comment
// for the full history). Only the Material Master table (4 real data
// columns: Name/Spec/Unit/Unit Cost) is registry-driven -- Inbound Receipts
// has no registry equivalent (it's a movements ledger against the master,
// not a second list screen) and stays exactly as it was, same "one table
// only" contract Documents/ChangeOrders used for their own non-registry
// pieces. MASTER_COLUMNS is now the fallback used when materials/page.tsx's
// server-side resolve of the material.list screen_definitions row returns
// null (404/error), same "keep the hardcoded version behind a flag until
// verified" contract as permits/documents/change-orders.
type Material = { id: string; name: string; spec: string | null; unit: string; unitCost: string; isActive: boolean };
type Receipt = { id: string; materialId: string; receivedDate: string; quantity: string; unitCost: string | null; vendorId: string | null };

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const MASTER_COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Spec", field: "spec", type: "text", importance: "Medium" },
  { label: "Unit", field: "unit", type: "text", importance: "High" },
  { label: "Unit Cost", field: "unitCost", type: "number", importance: "High" },
];

// Per-field cell renderer for the Material Master table -- same reasoning
// as ChangeOrdersClient.tsx's renderChangeOrderCell: a registry row can
// still reorder/relabel these 4 columns live (the hard-stop test), looked
// up by field name so reordering doesn't change what renders. `default`
// covers any field a future registry row names that this component doesn't
// know about yet.
function renderMaterialCell(field: string, m: Material) {
  switch (field) {
    case "name":
      return <span className="font-medium">{m.name}</span>;
    case "spec":
      return <span className="text-px-muted">{m.spec ?? "—"}</span>;
    case "unit":
      return m.unit;
    case "unitCost":
      return m.unitCost;
    default:
      return String((m as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function MaterialsClient({ projectId, registryColumns }: { projectId: string; registryColumns?: RegistryColumn[] | null }) {
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MASTER_COLUMNS;
  const [materials, setMaterials] = useState<Material[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  const [masterOpen, setMasterOpen] = useState(false);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [masterSubmitting, setMasterSubmitting] = useState(false);
  // R52 F_002: replaces the bare `return` below -- see createMaterial().
  const [masterErrors, setMasterErrors] = useState<FieldErrors<"name" | "unit" | "unitCost">>({});

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
    // R52 fix for F_002. The recorded symptom: clicking "Add Material" with the
    // fields blank produced no error text, no aria-invalid, no HTML `required`
    // attribute and no network request -- the user got nothing at all. The
    // cause was this one line, verbatim as it stood:
    //     if (!name.trim() || !unit.trim()) return;
    // CORRECTION TO THE RECORDED DESCRIPTION: the fault row lists "Name/Unit/
    // Unit Cost" as the required trio, but Unit Cost was never in that guard --
    // POST /api/materials/master takes unitCost as optional and the field is
    // genuinely optional. Only Name and Unit are required, and only those two
    // are marked required here; inventing a third requirement to match the
    // description would have been a fabricated fix.
    const errors: FieldErrors<"name" | "unit" | "unitCost"> = {};
    if (!name.trim()) errors.name = "Name is required.";
    if (!unit.trim()) errors.unit = "Unit is required (e.g. bag, cum, kg).";
    if (unitCost.trim() && Number.isNaN(Number(unitCost))) errors.unitCost = "Unit cost must be a number.";
    setMasterErrors(errors);
    if (hasErrors(errors)) return;

    setMasterSubmitting(true);
    try {
      const res = await fetch("/api/materials/master", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, spec: spec || undefined, unit, unitCost: unitCost ? Number(unitCost) : undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Material added");
      setName(""); setSpec(""); setUnit(""); setUnitCost(""); setMasterErrors({}); setMasterOpen(false);
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
                <FormField label="Name" required error={masterErrors.name}>
                  {(f) => <Input {...f} value={name} onChange={(e) => setName(e.target.value)} />}
                </FormField>
                <FormField label="Spec (optional)">
                  {(f) => <Input {...f} value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="e.g. 43-grade OPC" />}
                </FormField>
                <FormField label="Unit" required error={masterErrors.unit}>
                  {(f) => <Input {...f} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. bag, cum, kg" />}
                </FormField>
                <FormField label="Unit Cost (optional)" error={masterErrors.unitCost}>
                  {(f) => <Input {...f} type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />}
                </FormField>
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
                <TableHeader><TableRow>{columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {materials.map((m) => (
                    <TableRow key={m.id}>
                      {columns.map((col) => <TableCell key={col.field}>{renderMaterialCell(col.field, m)}</TableCell>)}
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
                      <TableCell className="text-px-muted">{formatDate(r.receivedDate)}</TableCell>
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
