"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Warehouse, ArrowDownToLine } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

type WarehouseRow = { id: string; warehouseName: string; parentWarehouseId: string | null };
type ItemRow = { id: string; itemCode: string; itemName: string; uom: string | null; hasBatchNo: boolean };
type Balance = {
  itemId: string; warehouseId: string; qty: number; value: number; averageCost: number;
  itemCode: string | null; itemName: string | null; uom: string | null; warehouseName: string | null;
};

const VALID_TABS = new Set(["balances", "warehouses", "items"]);

export default function InventoryClient({ initialTab }: { initialTab?: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "balances");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  // Keyed by dataset, not a flat list: each tab panel has to be able to tell
  // "this is genuinely empty" from "this call failed", so no panel can render
  // an empty state where an error belongs.
  const [loadErrors, setLoadErrors] = useState<{ warehouses?: string; items?: string; balances?: string }>({});

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

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Warehouse"/"New Item"/"Record Stock Movement" Dialog popups with
            real create routes. */}
        <Button variant="outline" onClick={() => router.push("/inventory/warehouses/new")}><Warehouse className="size-4" /> New Warehouse</Button>
        <Button variant="outline" onClick={() => router.push("/inventory/items/new")}><Plus className="size-4" /> New Item</Button>
        <Button onClick={() => router.push("/inventory/stock-entries/new")}><ArrowDownToLine className="size-4" /> Record Stock Movement</Button>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
      ) : (
        <Tabs value={activeTab} onValueChange={goToTab}>
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
                      {/* Real screen navigation (2026-08-30) -- rows now
                          open the real Object Page (buying/selling rates
                          and HSN/SAC code were never shown before this). */}
                      {items.map((i) => (
                        <TableRow key={i.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/inventory/items/${i.id}`)}>
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
