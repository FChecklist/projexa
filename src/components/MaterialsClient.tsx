"use client";

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
//
// Real-screen conversion (2026-08-30): the "Add Material"/"Record Receipt"
// Dialog popups are gone -- Add Material routes to a real create screen
// (MaterialCreateClient.tsx), master rows route to a real Object Page
// (MaterialObjectClient.tsx, which gained real Edit/Deactivate this
// conversion -- updateMaterial() didn't exist before). Record Receipt
// routes to a real create screen (MaterialReceiptCreateClient.tsx) -- no
// Object Page for receipt rows, a write-once transaction log. Also fixes
// the same uncontrolled-Tabs-no-URL-sync bug found and fixed repeatedly
// this session.
//
// Same conversion also folds in module #31 (Site Materials, the duplicate
// module found at /site-materials): its Catalog tab was this same
// constructionMaterials table under a different label, and its Inbound tab
// called a VERIDIAN path (/construction/materials/inbound) that never
// existed -- always a dead request. Rather than duplicate the real Materials
// screen, /site-materials now redirects here (see site-materials/page.tsx)
// and this file gains its one genuinely new capability, Cost Report, backed
// by a real getMaterialCostReport() aggregation added this same conversion
// (construction-materials-service.ts) -- the proxy it calls
// (api/construction-materials/cost-report/route.ts) had been calling a
// VERIDIAN path that 502'd for the same reason as Inbound: nothing
// implemented it on the other side either, until now.
//
// R67 F-18: the MATERIAL MASTER now normally arrives as a prop, fetched by
// materials/page.tsx on the server inside its Suspense boundary, so the tab
// this screen opens on paints filled on first render. Receipts and the cost
// report are still fetched here; moving them onto their own tabs is F-25.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { MATERIAL_LIST_COLUMNS } from "@/lib/module-list-columns";
import { isAbortError, type ModuleListInitial } from "@/lib/module-list-state";
import DataLoadError from "@/components/DataLoadError";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { currencyLabel, useCurrencies, type Currency } from "@/lib/currency";

// Exported so materials/page.tsx can type the rows it fetches server-side.
export type Material = { id: string; name: string; spec: string | null; unit: string; unitCost: string; isActive: boolean };
type Receipt = { id: string; materialId: string; receivedDate: string; quantity: string; unitCost: string | null; vendorId: string | null };
type CostReportRow = { materialId: string; name: string; spec: string | null; unit: string; totalQuantityReceived: number; totalCost: number; averageUnitCost: number };

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

// R67 F-18: the fallback labels moved to src/lib/module-list-columns.ts so
// this screen's loading skeleton draws the same column heads this table does.

const VALID_TABS = new Set(["master", "receipts", "cost-report"]);

// Per-field cell renderer for the Material Master table -- same reasoning
// as ChangeOrdersClient.tsx's renderChangeOrderCell: a registry row can
// still reorder/relabel these 4 columns live (the hard-stop test), looked
// up by field name so reordering doesn't change what renders. `default`
// covers any field a future registry row names that this component doesn't
// know about yet.
function renderMaterialCell(field: string, m: Material, currencies: Currency[]) {
  switch (field) {
    case "name":
      return <span className="font-medium">{m.name}</span>;
    case "spec":
      return <span className="text-px-muted">{m.spec ?? "—"}</span>;
    case "unit":
      return m.unit;
    case "unitCost":
      // R55_MATERIALS_UNITCOST_NO_AED_01: was a bare `m.unitCost`, same
      // defect class as R55_LABOUR_RATE_NO_AED_01 -- the column rendered
      // unlabelled numbers with no currency anywhere on the page. Materials
      // carry no per-item currencyId (unlike quotations/orders), so this is
      // always the org base currency -- currencyLabel(undefined, ...) is
      // exactly the "org base currency" lookup per its own doc comment.
      return `${currencyLabel(undefined, currencies)}${m.unitCost}`;
    default:
      return String((m as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function MaterialsClient({
  projectId,
  registryColumns,
  initialTab,
  initialMaster = null,
}: {
  projectId: string;
  registryColumns?: RegistryColumn[] | null;
  initialTab?: string;
  initialMaster?: ModuleListInitial<Material>;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MATERIAL_LIST_COLUMNS;
  const currencies = useCurrencies();
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "master");
  const [materials, setMaterials] = useState<Material[]>(initialMaster?.rows ?? []);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [report, setReport] = useState<CostReportRow[]>([]);
  const [loading, setLoading] = useState(initialMaster === null);
  const [loadErrors, setLoadErrors] = useState<{ materials?: string; receipts?: string; report?: string }>(
    initialMaster?.errorMessage ? { materials: initialMaster.errorMessage } : {}
  );
  // The master the server sent answers THIS project; a project switch still
  // goes to the network.
  const masterFromServerFor = useRef(initialMaster ? projectId : null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const masterAlreadyLoaded = masterFromServerFor.current === projectId;
      setLoading(true);
      const [matR, recR, repR] = await Promise.allSettled([
        masterAlreadyLoaded
          ? Promise.resolve(null)
          : fetchJson<{ materials?: Material[] }>(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`, { signal }),
        fetchJson<{ receipts?: Receipt[] }>(`/api/materials?projectId=${encodeURIComponent(projectId)}`, { signal }),
        fetchJson<{ report?: CostReportRow[] }>(`/api/construction-materials/cost-report?projectId=${encodeURIComponent(projectId)}`, { signal }),
      ]);
      // A cancelled read is not a failure and must not reach a screen the user
      // has already left.
      if (signal?.aborted) return;
      masterFromServerFor.current = null;

      const errors: { materials?: string; receipts?: string; report?: string } = {};
      if (matR.status === "fulfilled") {
        if (matR.value) setMaterials(matR.value.materials ?? []);
      } else if (!isAbortError(matR.reason, signal)) {
        setMaterials([]);
        errors.materials = errorMessage(matR.reason, "Material master");
      }

      if (recR.status === "fulfilled") setReceipts(recR.value.receipts ?? []);
      else if (!isAbortError(recR.reason, signal)) { setReceipts([]); errors.receipts = errorMessage(recR.reason, "Inbound receipts"); }

      if (repR.status === "fulfilled") setReport(repR.value.report ?? []);
      else if (!isAbortError(repR.reason, signal)) { setReport([]); errors.report = errorMessage(repR.reason, "Cost report"); }

      setLoadErrors(errors);
      setLoading(false);
    },
    [projectId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const materialName = (id: string) => materials.find((m) => m.id === id)?.name ?? id;

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="master">Material Master</TabsTrigger>
        <TabsTrigger value="receipts">Inbound Receipts</TabsTrigger>
        <TabsTrigger value="cost-report">Cost Report</TabsTrigger>
      </TabsList>

      <TabsContent value="master" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "Add
              Material" Dialog popup with a real create route. */}
          <Button onClick={() => router.push(`/materials/new?projectId=${projectId}`)}><Plus className="size-4" /> Add Material</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : loadErrors.materials ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.materials]} onRetry={() => load()} /></div>
            ) : materials.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No materials in the master yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow>{columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {/* Real screen navigation (2026-08-30) -- rows open the
                      real Object Page, where Edit/Deactivate now live. */}
                  {materials.map((m) => (
                    <TableRow key={m.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/materials/${m.id}`)}>
                      {columns.map((col) => <TableCell key={col.field}>{renderMaterialCell(col.field, m, currencies)}</TableCell>)}
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
          {/* Real screen navigation (2026-08-30) -- replaces the old
              "Record Receipt" Dialog popup with a real create route. */}
          <Button disabled={materials.length === 0} onClick={() => router.push(`/materials/receipts/new?projectId=${projectId}`)}><Plus className="size-4" /> Record Receipt</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : loadErrors.receipts ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.receipts]} onRetry={() => load()} /></div>
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

      <TabsContent value="cost-report" className="space-y-4">
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : loadErrors.report ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.report]} onRetry={() => load()} /></div>
            ) : report.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No receipts to report yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Unit</TableHead><TableHead>Total Qty Received</TableHead><TableHead>Total Cost</TableHead><TableHead>Avg Unit Cost</TableHead></TableRow></TableHeader>
                <TableBody>
                  {report.map((r) => (
                    <TableRow key={r.materialId}>
                      <TableCell className="font-medium">{r.name}{r.spec ? <span className="text-px-muted"> ({r.spec})</span> : null}</TableCell>
                      <TableCell>{r.unit}</TableCell>
                      <TableCell>{r.totalQuantityReceived}</TableCell>
                      <TableCell>{currencyLabel(undefined, currencies)}{r.totalCost.toFixed(2)}</TableCell>
                      <TableCell>{currencyLabel(undefined, currencies)}{r.averageUnitCost.toFixed(2)}</TableCell>
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
