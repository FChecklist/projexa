"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Warehouse, ArrowDownToLine } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import PrimarySubmit from "@/components/PrimarySubmit";

type WarehouseRow = { id: string; warehouseName: string; parentWarehouseId: string | null };
type ItemRow = { id: string; itemCode: string; itemName: string; uom: string | null; hasBatchNo: boolean };
type Balance = {
  itemId: string; warehouseId: string; qty: number; value: number; averageCost: number;
  itemCode: string | null; itemName: string | null; uom: string | null; warehouseName: string | null;
};

export default function InventoryClient() {
  const currencies = useCurrencies();
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  // Keyed by dataset, not a flat list: each tab panel has to be able to tell
  // "this is genuinely empty" from "this call failed", so no panel can render
  // an empty state where an error belongs.
  const [loadErrors, setLoadErrors] = useState<{ warehouses?: string; items?: string; balances?: string }>({});

  const [whOpen, setWhOpen] = useState(false);
  const [whName, setWhName] = useState("");
  const [whSubmitting, setWhSubmitting] = useState(false);

  const [itemOpen, setItemOpen] = useState(false);
  const [itemCode, setItemCode] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemUom, setItemUom] = useState("");
  const [itemSubmitting, setItemSubmitting] = useState(false);

  const [entryOpen, setEntryOpen] = useState(false);
  const [entryType, setEntryType] = useState<"receipt" | "issue">("receipt");
  const [entryItemId, setEntryItemId] = useState("");
  const [entryWarehouseId, setEntryWarehouseId] = useState("");
  const [entryQty, setEntryQty] = useState("");
  const [entryRate, setEntryRate] = useState("");
  const [entrySubmitting, setEntrySubmitting] = useState(false);

  async function load() {
    setLoading(true);
    // allSettled, not all: one failing endpoint must not blank the other two.
    // Each failure is reported in the backend's OWN words rather than being
    // collapsed into a single generic toast that the user cannot act on.
    const [wh, item, bal] = await Promise.allSettled([
      fetchJson<{ warehouses?: WarehouseRow[] }>("/api/inventory/warehouses"),
      fetchJson<{ items?: ItemRow[] }>("/api/inventory/items"),
      fetchJson<{ balances?: Balance[] }>("/api/inventory/stock-balance"),
    ]);

    const errors: { warehouses?: string; items?: string; balances?: string } = {};
    // Previously each of these read `await res.json()` with the status never
    // checked, so a 5xx body parsed fine, `?? []` produced an empty array, and
    // the page rendered "No stock on hand yet" / "No warehouses yet." -- the
    // confident empty state recorded on A4S14_08. Reset on failure so stale
    // rows can never be mistaken for fresh ones.
    if (wh.status === "fulfilled") setWarehouses(wh.value.warehouses ?? []);
    else { setWarehouses([]); errors.warehouses = errorMessage(wh.reason, "Warehouses"); }

    if (item.status === "fulfilled") setItems(item.value.items ?? []);
    else { setItems([]); errors.items = errorMessage(item.reason, "Items"); }

    if (bal.status === "fulfilled") setBalances(bal.value.balances ?? []);
    else { setBalances([]); errors.balances = errorMessage(bal.reason, "Stock balance"); }

    setLoadErrors(errors);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // What still blocks each primary action. PrimarySubmit disables the button on
  // these and names the count, so the silent `return` guards below become
  // unreachable by clicking -- which is what made these buttons look dead.
  const whMissing = whName.trim() ? [] : ["Warehouse Name"];
  const itemMissing = [
    ...(itemCode.trim() ? [] : ["Item Code"]),
    ...(itemName.trim() ? [] : ["Item Name"]),
  ];
  const entryMissing = [
    ...(entryItemId ? [] : ["Item"]),
    ...(entryWarehouseId ? [] : ["Warehouse"]),
    ...(entryQty ? [] : ["Quantity"]),
  ];

  async function createWarehouse() {
    if (!whName.trim()) return;
    setWhSubmitting(true);
    try {
      await fetchJson("/api/inventory/warehouses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseName: whName }),
      });
      toast.success("Warehouse added");
      setWhName(""); setWhOpen(false);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add warehouse"));
    } finally {
      setWhSubmitting(false);
    }
  }

  async function createItem() {
    if (!itemCode.trim() || !itemName.trim()) return;
    setItemSubmitting(true);
    try {
      await fetchJson("/api/inventory/items", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemCode, itemName, uom: itemUom || undefined }),
      });
      toast.success("Item added");
      setItemCode(""); setItemName(""); setItemUom(""); setItemOpen(false);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add item"));
    } finally {
      setItemSubmitting(false);
    }
  }

  async function recordEntry() {
    if (!entryItemId || !entryWarehouseId || !entryQty) return;
    setEntrySubmitting(true);
    try {
      await fetchJson("/api/inventory/stock-entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: entryType, itemId: entryItemId, warehouseId: entryWarehouseId,
          quantity: Number(entryQty), rate: entryRate ? Number(entryRate) : undefined,
          postingDate: new Date().toISOString().slice(0, 10),
        }),
      });
      toast.success(entryType === "receipt" ? "Stock receipt recorded" : "Stock issue recorded");
      setEntryQty(""); setEntryRate(""); setEntryOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record stock entry");
    } finally {
      setEntrySubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Dialog open={whOpen} onOpenChange={setWhOpen}>
          <DialogTrigger asChild><Button variant="outline"><Warehouse className="size-4" /> New Warehouse</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Warehouse</DialogTitle></DialogHeader>
            <div className="space-y-1.5"><Label>Warehouse Name</Label><Input value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="e.g. Site Store - Block A" /></div>
            <DialogFooter>
              <PrimarySubmit missing={whMissing} submitting={whSubmitting} submittingLabel="Adding…" onClick={createWarehouse}>
                Add Warehouse
              </PrimarySubmit>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={itemOpen} onOpenChange={setItemOpen}>
          <DialogTrigger asChild><Button variant="outline"><Plus className="size-4" /> New Item</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Stock Item</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Item Code</Label><Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="e.g. CEM-OPC53" /></div>
              <div className="space-y-1.5"><Label>Item Name</Label><Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. OPC 53 Grade Cement" /></div>
              <div className="space-y-1.5"><Label>Unit of Measure (optional)</Label><Input value={itemUom} onChange={(e) => setItemUom(e.target.value)} placeholder="e.g. Bag, Kg, Nos" /></div>
            </div>
            <DialogFooter>
              <PrimarySubmit missing={itemMissing} submitting={itemSubmitting} submittingLabel="Adding…" onClick={createItem}>
                Add Item
              </PrimarySubmit>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
          <DialogTrigger asChild><Button><ArrowDownToLine className="size-4" /> Record Stock Movement</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Record Stock Movement</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Movement Type</Label>
                <Select value={entryType} onValueChange={(v) => setEntryType(v as "receipt" | "issue")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receipt">Receipt (stock in)</SelectItem>
                    <SelectItem value="issue">Issue (stock out)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Item</Label>
                <Select value={entryItemId} onValueChange={setEntryItemId}>
                  <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                  <SelectContent>
                    {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.itemName} ({i.itemCode})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Warehouse</Label>
                <Select value={entryWarehouseId} onValueChange={setEntryWarehouseId}>
                  <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.warehouseName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" value={entryQty} onChange={(e) => setEntryQty(e.target.value)} /></div>
                {entryType === "receipt" && (
                  <div className="space-y-1.5"><Label>Rate (optional)</Label><Input type="number" value={entryRate} onChange={(e) => setEntryRate(e.target.value)} /></div>
                )}
              </div>
            </div>
            <DialogFooter>
              <PrimarySubmit missing={entryMissing} submitting={entrySubmitting} submittingLabel="Recording…" onClick={recordEntry}>
                Record Movement
              </PrimarySubmit>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
      ) : (
        <Tabs defaultValue="balances">
          <TabsList>
            <TabsTrigger value="balances">Stock Balance</TabsTrigger>
            <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
            <TabsTrigger value="items">Items</TabsTrigger>
          </TabsList>

          {/* Rendered BELOW the tab strip on purpose: an alert above it would
              push every tab down after load, which is the very defect
              R48_LAYOUT_REFLOW_01 tracks. */}
          <DataLoadError messages={Object.values(loadErrors).filter(Boolean) as string[]} onRetry={load} />

          <TabsContent value="balances">
            <Card className="shadow-card">
              <CardContent className="p-0">
                {loadErrors.balances ? null : balances.length === 0 ? (
                  <p className="py-10 text-center text-sm text-px-muted">No stock on hand yet. Record a receipt to get started.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Item</TableHead><TableHead>Warehouse</TableHead><TableHead>Qty</TableHead><TableHead>Avg. Cost</TableHead><TableHead>Value</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {balances.map((b) => (
                        <TableRow key={`${b.itemId}-${b.warehouseId}`}>
                          <TableCell className="font-medium">{b.itemName ?? b.itemId} {b.itemCode ? <span className="text-px-muted">({b.itemCode})</span> : null}</TableCell>
                          <TableCell>{b.warehouseName ?? b.warehouseId}</TableCell>
                          <TableCell>{b.qty.toLocaleString()} {b.uom ?? ""}</TableCell>
                          <TableCell>{currencyLabel(undefined, currencies)}{b.averageCost.toFixed(2)}</TableCell>
                          <TableCell>{currencyLabel(undefined, currencies)}{b.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="warehouses">
            <Card className="shadow-card">
              <CardContent className="p-0">
                {loadErrors.warehouses ? null : warehouses.length === 0 ? (
                  <p className="py-10 text-center text-sm text-px-muted">No warehouses yet.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Warehouse Name</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {warehouses.map((w) => (
                        <TableRow key={w.id}><TableCell className="font-medium">{w.warehouseName}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="items">
            <Card className="shadow-card">
              <CardContent className="p-0">
                {loadErrors.items ? null : items.length === 0 ? (
                  <p className="py-10 text-center text-sm text-px-muted">No items yet.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>UOM</TableHead><TableHead>Batch Tracked</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {items.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className="font-medium">{i.itemCode}</TableCell>
                          <TableCell>{i.itemName}</TableCell>
                          <TableCell className="text-px-muted">{i.uom ?? "—"}</TableCell>
                          <TableCell><Badge variant={i.hasBatchNo ? "default" : "outline"}>{i.hasBatchNo ? "yes" : "no"}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
