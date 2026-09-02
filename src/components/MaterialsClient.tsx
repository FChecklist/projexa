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
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import PaneState from "@/components/PaneState";
import type { PaneStatus } from "@/lib/pane-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import { ListHeaderActions } from "@/components/ListHeaderActions";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate, formatMoney } from "@/lib/format";
import { currencyLabel, useCurrencies, type Currency } from "@/lib/currency";

type Material = { id: string; name: string; spec: string | null; unit: string; unitCost: string; isActive: boolean };
type Receipt = { id: string; materialId: string; receivedDate: string; quantity: string; unitCost: string | null; vendorId: string | null };
type CostReportRow = { materialId: string; name: string; spec: string | null; unit: string; totalQuantityReceived: number; totalCost: number; averageUnitCost: number };

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

const VALID_TABS = new Set(["master", "receipts", "cost-report"]);

// R67 D-74: the money column, named by FIELD -- the master's columns come
// from the registry and can be reordered live.
const MONEY_FIELDS = new Set(["unitCost"]);

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
      return formatMoney(m.unitCost, currencyLabel(undefined, currencies));
    default:
      return String((m as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

// R67 D-65: each of the three tabs is its own read, so each gets its own
// state. Folding them into one `loading` flag and one error map worked, but
// it could not express the two things the shared pane needs: how long THIS
// tab's read has been waiting, and when the rows it is showing were true.
type PaneRead = {
  status: PaneStatus;
  error: { status: number | null; message: string | null } | null;
  loadedAt: Date | null;
};

const PENDING: PaneRead = { status: "loading", error: null, loadedAt: null };

function settled<T>(result: PromiseSettledResult<T>): PaneRead {
  if (result.status === "fulfilled") return { status: "ready", error: null, loadedAt: new Date() };
  const err: unknown = result.reason;
  return {
    status: "error",
    error: {
      status: err instanceof ApiError ? err.status : null,
      message: err instanceof Error && err.message ? err.message : null,
    },
    loadedAt: null,
  };
}

export default function MaterialsClient({ projectId, projectName, registryColumns, initialTab }: { projectId: string; projectName?: string | null; registryColumns?: RegistryColumn[] | null; initialTab?: string }) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MASTER_COLUMNS;
  const currencies = useCurrencies();
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "master");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [report, setReport] = useState<CostReportRow[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [masterRead, setMasterRead] = useState<PaneRead>(PENDING);
  const [receiptsRead, setReceiptsRead] = useState<PaneRead>(PENDING);
  const [reportRead, setReportRead] = useState<PaneRead>(PENDING);

  async function load() {
    setStartedAt(Date.now());
    setMasterRead(PENDING);
    setReceiptsRead(PENDING);
    setReportRead(PENDING);

    const [matR, recR, repR] = await Promise.allSettled([
      fetchJson<{ materials?: Material[] }>(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ receipts?: Receipt[] }>(`/api/materials?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ report?: CostReportRow[] }>(`/api/construction-materials/cost-report?projectId=${encodeURIComponent(projectId)}`),
    ]);

    // Rows are only REPLACED by a successful read. A failed one keeps what is
    // already on screen, which PaneState then labels "as of 14:32" -- better
    // than a blank table, and impossible to mistake for a fresh answer.
    if (matR.status === "fulfilled") setMaterials(matR.value.materials ?? []);
    if (recR.status === "fulfilled") setReceipts(recR.value.receipts ?? []);
    if (repR.status === "fulfilled") setReport(repR.value.report ?? []);

    setMasterRead(settled(matR));
    setReceiptsRead(settled(recR));
    setReportRead(settled(repR));
  }

  useEffect(() => { load(); }, [projectId]);

  const materialName = (id: string) => materials.find((m) => m.id === id)?.name ?? id;

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
      {/* R67 D-79: the header trio, once, ABOVE the tabs. The Cost Report tab
          had NO create action at all, and the other two each offered only
          their own object. This is tab-aware, so every tab now reaches every
          create route of the module. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="master">Material Master</TabsTrigger>
          <TabsTrigger value="receipts">Inbound Receipts</TabsTrigger>
          <TabsTrigger value="cost-report">Cost Report</TabsTrigger>
        </TabsList>
        <ListHeaderActions
          module="materials"
          tab={activeTab}
          projectId={projectId}
          filterDisabledReason="Filtering materials is not built yet"
          exportDisabledReason="Exporting materials is not built yet"
          // A receipt is written against a material master row, so the entry
          // states the precondition rather than vanishing.
          createDisabledReasons={materials.length === 0 ? { Receipt: "Add a material to the master first" } : {}}
        />
      </div>

      <TabsContent value="master" className="space-y-4">
        <Card className="shadow-card">
          <CardContent className="p-4">
            <PaneState
              status={masterRead.status}
              entity="the material master"
              projectName={projectName}
              startedAt={startedAt}
              error={masterRead.error}
              rowCount={materials.length}
              skeletonColumns={columns.map((col) => col.label)}
              emptyMessage="No materials in the master yet."
              emptyAction={
                <Button size="sm" onClick={() => router.push(`/materials/new?projectId=${projectId}`)}>
                  <Plus className="size-4" /> Add Material
                </Button>
              }
              lastLoadedAt={masterRead.loadedAt}
              onRetry={load}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead key={col.field} className={MONEY_FIELDS.has(col.field) ? "text-right" : undefined}>
                        {col.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Real screen navigation (2026-08-30) -- rows open the
                      real Object Page, where Edit/Deactivate now live. */}
                  {materials.map((m) => (
                    <TableRow key={m.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/materials/${m.id}`)}>
                      {columns.map((col) => (
                        <TableCell
                          key={col.field}
                          className={MONEY_FIELDS.has(col.field) ? "text-right tabular-nums" : undefined}
                        >
                          {renderMaterialCell(col.field, m, currencies)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PaneState>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="receipts" className="space-y-4">
        <Card className="shadow-card">
          <CardContent className="p-4">
            <PaneState
              status={receiptsRead.status}
              entity="inbound receipts"
              projectName={projectName}
              startedAt={startedAt}
              error={receiptsRead.error}
              rowCount={receipts.length}
              skeletonColumns={["Date", "Material", "Quantity", "Unit Cost"]}
              emptyMessage="No material movements recorded yet."
              emptyAction={
                <Button
                  size="sm"
                  disabled={materials.length === 0}
                  title={materials.length === 0 ? "Add a material to the master first" : undefined}
                  onClick={() => router.push(`/materials/receipts/new?projectId=${projectId}`)}
                >
                  <Plus className="size-4" /> Record Receipt
                </Button>
              }
              lastLoadedAt={receiptsRead.loadedAt}
              onRetry={load}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-px-muted">{formatDate(r.receivedDate)}</TableCell>
                      <TableCell className="font-medium">{materialName(r.materialId)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.unitCost, currencyLabel(undefined, currencies))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PaneState>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="cost-report" className="space-y-4">
        <Card className="shadow-card">
          <CardContent className="p-4">
            <PaneState
              status={reportRead.status}
              entity="the cost report"
              projectName={projectName}
              startedAt={startedAt}
              error={reportRead.error}
              rowCount={report.length}
              skeletonColumns={["Material", "Unit", "Total Qty Received", "Total Cost", "Avg Unit Cost"]}
              emptyMessage="No receipts to report yet."
              lastLoadedAt={reportRead.loadedAt}
              onRetry={load}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Total Qty Received</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead className="text-right">Avg Unit Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.map((r) => (
                    <TableRow key={r.materialId}>
                      <TableCell className="font-medium">{r.name}{r.spec ? <span className="text-px-muted"> ({r.spec})</span> : null}</TableCell>
                      <TableCell>{r.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.totalQuantityReceived}</TableCell>
                      {/* R67 D-74: was `${label}${n.toFixed(2)}` -- ungrouped,
                          so "AED 21750.00" sat two columns from "AED 420" on
                          the same module. */}
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.totalCost, currencyLabel(undefined, currencies), { decimals: 2 })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.averageUnitCost, currencyLabel(undefined, currencies), { decimals: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PaneState>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
