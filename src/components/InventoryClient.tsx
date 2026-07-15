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
    try {
      const [whRes, itemRes, balRes] = await Promise.all([
        fetch("/api/inventory/warehouses"),
        fetch("/api/inventory/items"),
        fetch("/api/inventory/stock-balance"),
      ]);
      const [whData, itemData, balData] = await Promise.all([whRes.json(), itemRes.json(), balRes.json()]);
      setWarehouses(whData.warehouses ?? []);
      setItems(itemData.items ?? []);
      setBalances(balData.balances ?? []);
    } catch {
      toast.error("Couldn't load inventory data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createWarehouse() {
    if (!whName.trim()) return;
    setWhSubmitting(true);
    try {
      const res = await fetch("/api/inventory/warehouses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseName: whName }),
      });
      if (!res.ok) throw new Error();
      toast.success("Warehouse added");
      setWhName(""); setWhOpen(false);
      load();
    } catch {
      toast.error("Couldn't add warehouse");
    } finally {
      setWhSubmitting(false);
    }
  }

  async function createItem() {
    if (!itemCode.trim() || !itemName.trim()) return;
    setItemSubmitting(true);
    try {
      const res = await fetch("/api/inventory/items", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemCode, itemName, uom: itemUom || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Item added");
      setItemCode(""); setItemName(""); setItemUom(""); setItemOpen(false);
      load();
    } catch {
      toast.error("Couldn't add item");
    } finally {
      setItemSubmitting(false);
    }
  }

  async function recordEntry() {
    if (!entryItemId || !entryWarehouseId || !entryQty) {
      toast.error("Item, warehouse, and quantity are required");
      return;
    }
    setEntrySubmitting(true);
    try {
      const res = await fetch("/api/inventory/stock-entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: entryType, itemId: entryItemId, warehouseId: entryWarehouseId,
          quantity: Number(entryQty), rate: entryRate ? Number(entryRate) : undefined,
          postingDate: new Date().toISOString().slice(0, 10),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed");
      }
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
            <DialogFooter><Button onClick={createWarehouse} disabled={whSubmitting}>{whSubmitting ? "Adding…" : "Add Warehouse"}</Button></DialogFooter>
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
            <DialogFooter><Button onClick={createItem} disabled={itemSubmitting}>{itemSubmitting ? "Adding…" : "Add Item"}</Button></DialogFooter>
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
            <DialogFooter><Button onClick={recordEntry} disabled={entrySubmitting}>{entrySubmitting ? "Recording…" : "Record Movement"}</Button></DialogFooter>
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

          <TabsContent value="balances">
            <Card className="shadow-card">
              <CardContent className="p-0">
                {balances.length === 0 ? (
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
                {warehouses.length === 0 ? (
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
                {items.length === 0 ? (
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
