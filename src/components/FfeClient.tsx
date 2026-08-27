"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import DataLoadError from "@/components/DataLoadError";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type FfeItem = {
  id: string; itemName: string; roomOrArea: string | null; category: string; quantity: number;
  unitCost: string; unitPrice: string; status: string;
};
type MarginSummary = { totalCost: number; totalPrice: number; totalMargin: number; marginPercent: number };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  specified: "outline", ordered: "secondary", received: "secondary", installed: "default",
};
const CATEGORIES = ["furniture", "fixture", "equipment", "finish", "textile", "lighting", "other"];
const STATUSES = ["specified", "ordered", "received", "installed"];

export default function FfeClient({ projectId }: { projectId: string }) {
  const currencies = useCurrencies();
  // Priority 17 re-sweep fix: was Intl.NumberFormat(..., { currency: "INR" })
  // -- forced both symbol and grouping to India regardless of the org's real
  // base currency. Closure over `currencies` so every existing
  // formatCurrency(...) call site below is unchanged.
  const formatCurrency = (n: number) => `${currencyLabel(undefined, currencies)}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const [items, setItems] = useState<FfeItem[]>([]);
  const [margin, setMargin] = useState<MarginSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<{ items?: string; margin?: string }>({});
  const [open, setOpen] = useState(false);
  const [itemName, setItemName] = useState("");
  const [roomOrArea, setRoomOrArea] = useState("");
  const [category, setCategory] = useState("furniture");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [depthCm, setDepthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    // Salvaged from PR #179 (R52 Gate 2 follow-up, same defect class as
    // R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01): allSettled, not all -- a
    // failing margin-summary read must not blank an already-successful items
    // read, and vice versa. Each failure is reported in the backend's OWN
    // words rather than collapsed into one generic message for two sources.
    const [itemsR, marginR] = await Promise.allSettled([
      fetchJson<{ items?: FfeItem[] }>(`/api/ffe?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<MarginSummary>(`/api/ffe/margin-summary?projectId=${encodeURIComponent(projectId)}`),
    ]);

    const errors: { items?: string; margin?: string } = {};
    if (itemsR.status === "fulfilled") setItems(itemsR.value.items ?? []);
    else { setItems([]); errors.items = errorMessage(itemsR.reason, "FF&E items"); }

    if (marginR.status === "fulfilled") setMargin(marginR.value);
    else { setMargin(null); errors.margin = errorMessage(marginR.reason, "Margin summary"); }

    setLoadErrors(errors);
    setLoading(false);
  }

  useEffect(() => { load(); }, [projectId]);

  async function createItem() {
    if (!itemName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/ffe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, itemName, roomOrArea: roomOrArea || undefined, category,
          quantity: Number(quantity) || 1, unitCost: Number(unitCost) || 0, unitPrice: Number(unitPrice) || 0,
          widthCm: widthCm ? Number(widthCm) : undefined, depthCm: depthCm ? Number(depthCm) : undefined, heightCm: heightCm ? Number(heightCm) : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("FF&E item added");
      setItemName(""); setRoomOrArea(""); setCategory("furniture"); setQuantity("1"); setUnitCost(""); setUnitPrice("");
      setWidthCm(""); setDepthCm(""); setHeightCm(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't add item");
    } finally {
      setSubmitting(false);
    }
  }

  async function advanceStatus(item: FfeItem) {
    const next = STATUSES[STATUSES.indexOf(item.status) + 1];
    if (!next) return;
    try {
      const res = await fetch(`/api/ffe/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Couldn't update status");
    }
  }

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-px-muted">Total Cost</p><p className="text-2xl font-heading text-px-ink">{formatCurrency(margin?.totalCost ?? 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-px-muted">Total Client Price</p><p className="text-2xl font-heading text-px-ink">{formatCurrency(margin?.totalPrice ?? 0)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-px-muted">Margin</p><p className="text-2xl font-heading text-px-success">{formatCurrency(margin?.totalMargin ?? 0)} <span className="text-sm text-px-muted">({(margin?.marginPercent ?? 0).toFixed(1)}%)</span></p></CardContent></Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Item</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New FF&E Item</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Item Name</Label><Input value={itemName} onChange={(e) => setItemName(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Room / Area</Label><Input value={roomOrArea} onChange={(e) => setRoomOrArea(e.target.value)} /></div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label>Qty</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Cost ({currencyLabel(undefined, currencies).trim()})</Label><Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Client Price ({currencyLabel(undefined, currencies).trim()})</Label><Input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label>Width (cm)</Label><Input type="number" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} placeholder="for 3D" /></div>
                <div className="space-y-1.5"><Label>Depth (cm)</Label><Input type="number" value={depthCm} onChange={(e) => setDepthCm(e.target.value)} placeholder="for 3D" /></div>
                <div className="space-y-1.5"><Label>Height (cm)</Label><Input type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="for 3D" /></div>
              </div>
            </div>
            <DialogFooter><Button onClick={createItem} disabled={submitting}>{submitting ? "Adding…" : "Add Item"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Rendered BELOW the New Item button on purpose: an alert above it
          would push the button down after load, the layout-reflow defect
          R48_LAYOUT_REFLOW_01 tracks. Combines both sources' errors -- items
          and margin are fetched independently, so this can report one, the
          other, both, or neither. */}
      <DataLoadError messages={Object.values(loadErrors).filter(Boolean) as string[]} onRetry={load} />

      <Card className="shadow-card">
        <CardHeader><CardTitle className="font-heading text-base">FF&E Schedule</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loadErrors.items ? null : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No FF&E items yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead><TableHead>Room</TableHead><TableHead>Category</TableHead><TableHead>Qty</TableHead>
                  <TableHead>Cost</TableHead><TableHead>Price</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.itemName}</TableCell>
                    <TableCell className="text-px-muted">{i.roomOrArea ?? "—"}</TableCell>
                    <TableCell className="capitalize text-px-muted">{i.category}</TableCell>
                    <TableCell>{i.quantity}</TableCell>
                    <TableCell>{formatCurrency(Number(i.unitCost))}</TableCell>
                    <TableCell>{formatCurrency(Number(i.unitPrice))}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[i.status]}>{i.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {i.status !== "installed" && <Button size="sm" variant="outline" onClick={() => advanceStatus(i)}>Advance</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
