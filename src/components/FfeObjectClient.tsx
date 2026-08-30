"use client";

// Real-screen conversion (2026-08-30): the FF&E schedule never had a detail
// view -- description/vendor/SKU/lead-time were never shown anywhere, and
// dimensions (widthCm/depthCm/heightCm, needed once an item is placed into
// a floor plan) had a real backend function but no UI at all. Real Object
// Page on the kit's ObjectScreen.
//
// No Delete: no deleteFfeItem() exists in interior-design-service.ts.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type FfeItem = {
  id: string; projectId: string; itemName: string; roomOrArea: string | null; category: string; description: string | null;
  sku: string | null; quantity: number; unitCost: string; unitPrice: string; leadTimeDays: number | null;
  status: string; widthCm: string | null; depthCm: string | null; heightCm: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  specified: "outline", ordered: "secondary", received: "secondary", installed: "default",
};
const STATUSES = ["specified", "ordered", "received", "installed"];

export default function FfeObjectClient({ itemId }: { itemId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const formatCurrency = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const [item, setItem] = useState<FfeItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [widthCm, setWidthCm] = useState("");
  const [depthCm, setDepthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [saving, setSaving] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  function seedForm(i: FfeItem) {
    setWidthCm(i.widthCm ?? ""); setDepthCm(i.depthCm ?? ""); setHeightCm(i.heightCm ?? "");
  }

  async function load() {
    try {
      const data = await fetchJson<FfeItem>(`/api/ffe/${itemId}`);
      setItem(data);
      seedForm(data);
      setLoadError(null);
    } catch (err) {
      setItem(null);
      setLoadError(errorMessage(err, "Couldn't load this FF&E item"));
    }
  }

  useEffect(() => { load(); }, [itemId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/ffe/${itemId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dimensions",
          widthCm: widthCm ? Number(widthCm) : undefined, depthCm: depthCm ? Number(depthCm) : undefined, heightCm: heightCm ? Number(heightCm) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save dimensions");
      toast.success("Dimensions saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save dimensions");
    } finally {
      setSaving(false);
    }
  }

  async function advanceStatus() {
    if (!item) return;
    const next = STATUSES[STATUSES.indexOf(item.status) + 1];
    if (!next) return;
    setAdvancing(true);
    try {
      const res = await fetch(`/api/ffe/${itemId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update status");
      toast.success(`Marked as ${next}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update status");
    } finally {
      setAdvancing(false);
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
  if (!item) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="FF&E / Item"
      title={item.itemName}
      subtitle={item.roomOrArea ?? undefined}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: item.status === "installed" ? "done" : item.status === "specified" ? "neutral" : "running", label: item.status }}
      facets={[
        { label: "Category", value: item.category },
        { label: "Qty", value: String(item.quantity) },
        { label: "Cost", value: formatCurrency(Number(item.unitCost)) },
        { label: "Client Price", value: formatCurrency(Number(item.unitPrice)) },
      ]}
      onEdit={mode === "display" ? () => { seedForm(item); setMode("edit"); } : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => { seedForm(item); setMode("display"); } : undefined}
      onBack={() => router.push(`/ffe?projectId=${item.projectId}`)}
      saveDisabled={saving}
      saveDisabledReason={saving ? "Saving…" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {mode === "display" && item.status !== "installed" && (
          <div className="border-b border-ct-border pb-3">
            <Button size="sm" disabled={advancing} onClick={advanceStatus}>
              {advancing ? "Updating…" : `Advance to ${STATUSES[STATUSES.indexOf(item.status) + 1]}`}
            </Button>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          <div><dt className="text-ct-muted">Description</dt><dd className="text-ct-navy">{item.description ?? "—"}</dd></div>
          <div><dt className="text-ct-muted">SKU</dt><dd className="text-ct-navy">{item.sku ?? "—"}</dd></div>
          <div><dt className="text-ct-muted">Lead Time</dt><dd className="text-ct-navy">{item.leadTimeDays != null ? `${item.leadTimeDays} days` : "—"}</dd></div>
          <div><dt className="text-ct-muted">Status</dt><dd><Badge variant={STATUS_VARIANT[item.status] ?? "outline"}>{item.status}</Badge></dd></div>
        </dl>
        <div className="border-t border-ct-border pt-3">
          <p className="mb-1 text-xs font-semibold text-ct-muted">Dimensions (for 3D floor plan placement)</p>
          {mode === "edit" ? (
            <div className="grid grid-cols-3 gap-2 max-w-md">
              <div className="space-y-1.5"><Label>Width (cm)</Label><Input type="number" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Depth (cm)</Label><Input type="number" value={depthCm} onChange={(e) => setDepthCm(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Height (cm)</Label><Input type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} /></div>
            </div>
          ) : (
            <p className="text-[13px] text-ct-navy">
              {item.widthCm && item.depthCm && item.heightCm ? `${item.widthCm} × ${item.depthCm} × ${item.heightCm} cm` : "Not set"}
            </p>
          )}
        </div>
      </div>
    </ObjectScreen>
  );
}
