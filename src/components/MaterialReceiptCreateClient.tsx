"use client";

// Real-screen conversion (2026-08-30): replaces MaterialsClient.tsx's old
// "Record Receipt" Dialog popup with a real create screen.
//
// R67 D-36 (audit R-105). Two fields were missing and the omission had a
// real cost: without a VENDOR a delivery cannot be matched to the invoice
// that arrives for it a month later, and without a REFERENCE (the delivery
// note or PO number written on the paper the driver hands over) there is
// nothing to match it BY. Both are now on the form and both reach the
// receipts table. Vendor stays optional -- site staff genuinely record
// deliveries before the vendor is set up -- but says what it is for instead
// of being silently skippable, and the Save label keeps counting only the
// true mandatories.
//
// A receipt is no longer write-once either: /materials/receipts/[id] can void
// it with a reason (C03-09/D-36), so a mis-keyed quantity is recoverable.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KitObjectScreen } from "@/components/screens/KitObjectScreen";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import EntityCombobox from "@/components/EntityCombobox";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { getLastChoice, setLastChoice } from "@/lib/last-choice";

// R67 D-80: the picker whose memory this screen keeps. One constant, so the
// read and the write cannot drift onto two different keys.
const MATERIAL_PICKER = "material";

type Material = { id: string; name: string; spec?: string | null; unit?: string; isActive: boolean };
type Vendor = { id: string; vendorName: string };

export default function MaterialReceiptCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsFailed, setVendorsFailed] = useState(false);
  const [materialId, setMaterialId] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingMaterials, setLoadingMaterials] = useState(true);
  const [rememberedMaterial, setRememberedMaterial] = useState<string | null>(null);

  useEffect(() => {
    setRememberedMaterial(getLastChoice(MATERIAL_PICKER, projectId));
  }, [projectId]);

  useEffect(() => {
    setLoadingMaterials(true);
    fetchJson<{ materials?: Material[] }>(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`)
      .then((d) => setMaterials((d.materials ?? []).filter((m) => m.isActive)))
      .catch((err) => toast.error(errorMessage(err, "Couldn't load material master")))
      .finally(() => setLoadingMaterials(false));
  }, [projectId]);

  // The spec is the hint, so "OPC" finds "Cement OPC 53" and two cements are
  // distinguishable without opening either.
  const materialOptions = useMemo(
    () => materials.map((m) => ({
      value: m.id,
      label: m.name,
      hint: [m.spec, m.unit].filter(Boolean).join(" · ") || undefined,
    })),
    [materials]
  );

  useEffect(() => {
    fetchJson<{ vendors?: Vendor[] }>("/api/vendors")
      .then((d) => { setVendors(d.vendors ?? []); setVendorsFailed(false); })
      .catch(() => setVendorsFailed(true));
  }, []);

  // Only the true mandatories are counted -- Vendor and Reference are
  // deliberately absent from this list.
  const missing = [...(materialId ? [] : ["Material"]), ...(receivedDate ? [] : ["Received Date"]), ...(quantity ? [] : ["Quantity"])];

  async function createReceipt() {
    if (missing.length) return;
    setSubmitting(true);
    try {
      await fetchJson("/api/materials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, materialId, receivedDate, quantity: Number(quantity),
          unitCost: unitCost ? Number(unitCost) : undefined,
          vendorId: vendorId || undefined,
          reference: reference.trim() || undefined,
        }),
      });
      // Remembered only after the write succeeded.
      setLastChoice(MATERIAL_PICKER, projectId, materialId);
      toast.success("Receipt recorded");
      router.push(`/materials?projectId=${projectId}&tab=receipts`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't record receipt"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KitObjectScreen
      breadcrumb="Materials / Record Receipt"
      title="Record Inbound Receipt"
      mode="create"
      hasDraft={false}
      onSave={createReceipt}
      onCancel={() => router.push(`/materials?projectId=${projectId}&tab=receipts`)}
      onBack={() => router.push(`/materials?projectId=${projectId}&tab=receipts`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Saving…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="receipt-material">Material</Label>
          <EntityCombobox
            id="receipt-material"
            aria-label="Material"
            options={materialOptions}
            value={materialId}
            onChange={setMaterialId}
            loading={loadingMaterials}
            storedValue={rememberedMaterial}
            placeholder="Type a material name or spec"
            emptyMessage={materials.length === 0 ? "No materials in the master yet" : "No material matches"}
          />
        </div>
        <div className="space-y-1.5"><Label>Received Date</Label><Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Unit Cost (optional — defaults to the master cost)</Label><Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="receipt-vendor">Vendor</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger id="receipt-vendor" className="min-w-56"><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" variant="link" size="sm" className="px-0" onClick={() => router.push("/vendors/new")}>
              Add vendor…
            </Button>
          </div>
          <p className="text-[12px] text-px-muted">Needed to match this delivery to an invoice</p>
          {vendorsFailed && (
            <p role="alert" className="text-[12px] text-px-error">
              The vendor list could not be loaded — the receipt still saves without one.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="receipt-reference">Reference (delivery note / PO no.)</Label>
          <Input id="receipt-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
    </KitObjectScreen>
  );
}
