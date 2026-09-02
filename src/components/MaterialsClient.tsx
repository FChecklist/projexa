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
// Real screen navigation (2026-08-30): the "Add Material"/"Record Receipt"
// Dialog popups are gone -- Add Material routes to a real create screen
// (MaterialCreateClient.tsx), master rows route to a real Object Page
// (MaterialObjectClient.tsx, which gained real Edit/Deactivate this
// conversion -- updateMaterial() didn't exist before). Record Receipt
// routes to a real create screen (MaterialReceiptCreateClient.tsx) -- no
// Object Page for receipt rows, a write-once transaction log.
//
// Same conversion also folds in module #31 (Site Materials, the duplicate
// module found at /site-materials): its Catalog tab was this same
// constructionMaterials table under a different label, and its Inbound tab
// called a VERIDIAN path (/construction/materials/inbound) that never
// existed -- always a dead request. Rather than duplicate the real Materials
// screen, /site-materials now redirects here (see site-materials/page.tsx)
// and this file gains its one genuinely new capability, Cost Report, backed
// by a real getMaterialCostReport() aggregation added this same conversion
// (construction-materials-service.ts).
//
// R67 F-07 (R-100/R-106) -- THREE CALLS ON LANDING BECAME ONE. Warm /materials
// measured TTFB 2006 ms and LCP 3244 ms for a TWO-ROW table, and the client's
// share of that was three requests fired together behind a single `loading`
// flag: the master, the receipts ledger, and the server cost report. Only the
// first is on screen when the page opens.
//
//   * the master is the only thing fetched on mount;
//   * the receipts ledger is fetched on first activation of the Inbound tab,
//     and warmed on hover of that tab or the Cost Report tab;
//   * the Cost Report is DERIVED from those same receipts
//     (src/lib/material-cost-report.ts, arithmetic identical to the server's
//     so the on-screen figure and the exportable one cannot disagree) -- the
//     server endpoint stays for the export, which has no loaded page to
//     derive from.
//
// Each panel also has its own state now, so a failing receipts ledger cannot
// blank a working master table, and a wait crossing 3 s says so.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { buildMaterialCostReport } from "@/lib/material-cost-report";
import { EMPTY_VALUE, MONEY_CELL_CLASS } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { materialUnitLabel } from "@/lib/material-units";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";

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

// Exported so materials/page.tsx's <Suspense> fallback shows the SAME headers
// the real table will show -- nothing on screen moves when the data lands.
export const MATERIALS_FALLBACK_COLUMN_LABELS = MASTER_COLUMNS.map((c) => c.label);
const RECEIPT_COLUMN_LABELS = ["Date", "Material", "Quantity", "Unit Cost"];
const COST_REPORT_COLUMN_LABELS = ["Material", "Unit", "Total Qty Received", "Total Cost", "Avg Unit Cost"];

const VALID_TABS = new Set(["master", "receipts", "cost-report"]);

/** Money columns: the header carries the currency, the cell is right-aligned. */
const MONEY_FIELDS = new Set(["unitCost"]);

// Per-field cell renderer for the Material Master table -- same reasoning
// as ChangeOrdersClient.tsx's renderChangeOrderCell: a registry row can
// still reorder/relabel these 4 columns live (the hard-stop test), looked
// up by field name so reordering doesn't change what renders. `default`
// covers any field a future registry row names that this component doesn't
// know about yet.
function renderMaterialCell(field: string, m: Material, money: (v: number | string | null | undefined) => string) {
  switch (field) {
    case "name":
      return <span className="font-medium">{m.name}</span>;
    case "spec":
      return <span className="text-px-muted">{m.spec ?? EMPTY_VALUE}</span>;
    case "unit":
      // R67 G-05: the stored value is now one of the closed vocabulary, and
      // this expands it for display ("cum" -> "cum (cubic metre)"). A legacy
      // row outside the vocabulary shows verbatim rather than blank.
      return materialUnitLabel(m.unit);
    case "unitCost":
      // R55_MATERIALS_UNITCOST_NO_AED_01: was a bare `m.unitCost`, same
      // defect class as R55_LABOUR_RATE_NO_AED_01 -- the column rendered
      // unlabelled numbers with no currency anywhere on the page. Materials
      // carry no per-item currencyId (unlike quotations/orders), so this is
      // always the org base currency -- currencyLabel(undefined, ...) is
      // exactly the "org base currency" lookup per its own doc comment.
      // R67 G-05: was the currency label glued to the RAW drizzle numeric
      // string, so one column mixed "AED 1200" and "AED 1200.5". The one
      // money formatter gives it two decimals, tabular figures, and an
      // en-dash when there is genuinely no cost recorded.
      return money(m.unitCost);
    default:
      return String((m as unknown as Record<string, unknown>)[field] ?? EMPTY_VALUE);
  }
}

// D-04's visible budget, client side: a wait that crosses 3 s stops being
// "fast", and the reader is told the request is still running rather than
// left to guess.
function useSlowRequestFlag(pending: boolean, afterMs = 3_000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(timer);
  }, [pending, afterMs]);
  return slow;
}

export default function MaterialsClient({ projectId, registryColumns, initialTab }: { projectId: string; registryColumns?: RegistryColumn[] | null; initialTab?: string }) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MASTER_COLUMNS;
  const orgMoney = useOrgMoney();
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "master");

  // null means "not resolved yet"; [] is a real, confirmed empty list. The
  // single `loading` boolean this replaces could not tell those apart, per
  // panel or at all.
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [receiptsLoading, setReceiptsLoading] = useState(false);

  const materialsSlow = useSlowRequestFlag(materials === null && materialsError === null);
  const receiptsSlow = useSlowRequestFlag(receiptsLoading);

  // The FIRST load shows its skeleton immediately: this component mounts
  // directly after the page's own <Suspense> fallback (which already had the
  // headers on screen), so a 150 ms anti-flash delay here would produce
  // 150 ms of nothing between the two. A later Retry does use the delay,
  // because that one can genuinely come back instantly.
  //
  // State, not a ref: this value is READ DURING RENDER, and a ref read in
  // render is exactly the "your component will not update as expected" case
  // React's own lint rule names.
  const [skeletonDelayMs, setSkeletonDelayMs] = useState(0);

  const loadMaterials = useCallback(async () => {
    setMaterials(null);
    setMaterialsError(null);
    try {
      const data = await fetchJson<{ materials?: Material[] }>(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`);
      setMaterials(data.materials ?? []);
    } catch (err) {
      setMaterials([]);
      setMaterialsError(errorMessage(err, "Material master"));
    } finally {
      setSkeletonDelayMs(150);
    }
  }, [projectId]);

  const loadReceipts = useCallback(async () => {
    setReceiptsLoading(true);
    setReceiptsError(null);
    try {
      const data = await fetchJson<{ receipts?: Receipt[] }>(`/api/materials?projectId=${encodeURIComponent(projectId)}`);
      setReceipts(data.receipts ?? []);
    } catch (err) {
      setReceipts([]);
      setReceiptsError(errorMessage(err, "Inbound receipts"));
    } finally {
      setReceiptsLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadMaterials(); }, [loadMaterials]);

  // The receipts ledger backs BOTH the Inbound tab and the derived Cost
  // Report, and is fetched the first time either is opened -- never on
  // landing, which is the third call this item removes.
  const warmReceipts = useCallback(() => {
    if (receipts !== null || receiptsLoading) return;
    void loadReceipts();
  }, [receipts, receiptsLoading, loadReceipts]);

  useEffect(() => {
    if (activeTab === "receipts" || activeTab === "cost-report") warmReceipts();
  }, [activeTab, warmReceipts]);

  const materialName = (id: string) => (materials ?? []).find((m) => m.id === id)?.name ?? id;
  const report = buildMaterialCostReport(materials ?? [], receipts ?? []);

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  const receiptsPending = receipts === null && !receiptsError;

  return (
    <>
    <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="master">Material Master</TabsTrigger>
        {/* Hovering a tab warms the one request both of these panels share, so
            the click usually lands on a filled table. */}
        <TabsTrigger value="receipts" onMouseEnter={warmReceipts} onFocus={warmReceipts}>Inbound Receipts</TabsTrigger>
        <TabsTrigger value="cost-report" onMouseEnter={warmReceipts} onFocus={warmReceipts}>Cost Report</TabsTrigger>
      </TabsList>

      <TabsContent value="master" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "Add
              Material" Dialog popup with a real create route; hover prefetches
              its chunk so the click is instant. */}
          <Button
            onMouseEnter={() => router.prefetch(`/materials/new?projectId=${projectId}`)}
            onFocus={() => router.prefetch(`/materials/new?projectId=${projectId}`)}
            onClick={() => router.push(`/materials/new?projectId=${projectId}`)}
          >
            <Plus className="size-4" /> Add Material
          </Button>
        </div>
        {materials === null && !materialsError ? (
          <TableLoadingRows
            headers={columns.map((c) => c.label)}
            rows={3}
            caption={materialsSlow ? "Still loading…" : "Loading materials…"}
            delayMs={skeletonDelayMs}
          />
        ) : (
          <Card className="shadow-card">
            <CardContent className="p-0">
              {materialsError ? (
                <div className="p-4"><DataLoadError messages={[materialsError]} onRetry={loadMaterials} /></div>
              ) : (materials ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-px-muted">No materials in the master yet.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>{columns.map((col) => <TableHead key={col.field} className={MONEY_FIELDS.has(col.field) ? "text-right" : undefined}>{col.label}{MONEY_FIELDS.has(col.field) ? orgMoney.unitSuffix : ""}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>
                    {/* Real screen navigation (2026-08-30) -- rows open the
                        real Object Page, where Edit/Deactivate now live. */}
                    {(materials ?? []).map((m) => (
                      <TableRow
                        key={m.id}
                        className="cursor-pointer hover:bg-px-cloud/40"
                        onMouseEnter={() => router.prefetch(`/materials/${m.id}`)}
                        onClick={() => router.push(`/materials/${m.id}`)}
                      >
                        {columns.map((col) => <TableCell key={col.field} className={MONEY_FIELDS.has(col.field) ? MONEY_CELL_CLASS : undefined}>{renderMaterialCell(col.field, m, orgMoney.money)}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="receipts" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old
              "Record Receipt" Dialog popup with a real create route. */}
          <Button
            disabled={(materials ?? []).length === 0}
            onMouseEnter={() => router.prefetch(`/materials/receipts/new?projectId=${projectId}`)}
            onFocus={() => router.prefetch(`/materials/receipts/new?projectId=${projectId}`)}
            onClick={() => router.push(`/materials/receipts/new?projectId=${projectId}`)}
          >
            <Plus className="size-4" /> Record Receipt
          </Button>
        </div>
        {receiptsPending ? (
          <TableLoadingRows
            headers={RECEIPT_COLUMN_LABELS}
            rows={3}
            caption={receiptsSlow ? "Still loading…" : "Loading receipts…"}
          />
        ) : (
          <Card className="shadow-card">
            <CardContent className="p-0">
              {receiptsError ? (
                <div className="p-4"><DataLoadError messages={[receiptsError]} onRetry={loadReceipts} /></div>
              ) : (receipts ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-px-muted">No material movements recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Material</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Unit Cost{orgMoney.unitSuffix}</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(receipts ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-px-muted">{formatDate(r.receivedDate)}</TableCell>
                        <TableCell className="font-medium">{materialName(r.materialId)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                        {/* R67 G-05: a receipt booked with no price is EMPTY, not
                            a formatted zero -- "we were not told" and "it cost
                            nothing" are different facts. */}
                        <TableCell className={MONEY_CELL_CLASS}>{r.unitCost === null ? EMPTY_VALUE : orgMoney.money(r.unitCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="cost-report" className="space-y-4">
        {receiptsPending ? (
          <TableLoadingRows
            headers={COST_REPORT_COLUMN_LABELS}
            rows={3}
            caption={receiptsSlow ? "Still loading…" : "Loading receipts…"}
          />
        ) : (
          <Card className="shadow-card">
            <CardContent className="p-0">
              {receiptsError ? (
                <div className="p-4"><DataLoadError messages={[receiptsError]} onRetry={loadReceipts} /></div>
              ) : report.length === 0 ? (
                <p className="py-10 text-center text-sm text-px-muted">No receipts to report yet.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Total Qty Received</TableHead><TableHead className="text-right">Total Cost{orgMoney.unitSuffix}</TableHead><TableHead className="text-right">Avg Unit Cost{orgMoney.unitSuffix}</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {report.map((r) => (
                      <TableRow key={r.materialId}>
                        <TableCell className="font-medium">{r.name}{r.spec ? <span className="text-px-muted"> ({r.spec})</span> : null}</TableCell>
                        <TableCell>{materialUnitLabel(r.unit)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.totalQuantityReceived}</TableCell>
                        <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.totalCost)}</TableCell>
                        <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.averageUnitCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
    {/* R67 G-05: all three tabs prefix their figures with the warning glyph
        when the org has no currency. The glyph is the symptom; this is the one
        sentence that says what it means and where to fix it. Rendered once for
        the whole screen, outside the tabs, so switching tab does not make the
        explanation come and go. */}
    <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </>
  );
}
