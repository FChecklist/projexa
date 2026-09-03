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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { EMPTY_VALUE, MONEY_CELL_CLASS } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { materialUnitLabel } from "@/lib/material-units";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
// R67 E-05 (R-103): the Cost Report tab becomes a real parameterised report.
// The arithmetic is compliance-tracker's; these are the rules the SCREEN owes
// the reader -- the tie check that gates Export, the CSV of the rows on
// screen, and the empty-range sentence.
import {
  buildMaterialCostCsv,
  checkMaterialCostTies,
  costReportTitle,
  defaultCostReportRange,
  emptyRangeMessage,
  type MaterialCostReport,
  type MaterialCostReportGroupBy,
} from "@/lib/material-cost-report";
import { ExportShareActions } from "@/components/ExportShareActions";

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

export default function MaterialsClient({
  projectId,
  registryColumns,
  initialTab,
  initialFrom,
  initialTo,
}: {
  projectId: string;
  registryColumns?: RegistryColumn[] | null;
  initialTab?: string;
  /** R67 E-05: the Cost Report's period comes from the URL, so Reports > "Material Consumption" lands on the same run. */
  initialFrom?: string;
  initialTo?: string;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MASTER_COLUMNS;
  const orgMoney = useOrgMoney();
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "master");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [report, setReport] = useState<MaterialCostReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<{ materials?: string; receipts?: string; report?: string }>({});

  // R67 E-05: the report's own parameters. Defaulted so the tab runs by
  // pressing nothing -- see defaultCostReportRange for why the lower bound is
  // open rather than month-to-date.
  const fallbackRange = defaultCostReportRange();
  const [from, setFrom] = useState(initialFrom ?? fallbackRange.from);
  const [to, setTo] = useState(initialTo ?? fallbackRange.to);
  const [groupBy, setGroupBy] = useState<MaterialCostReportGroupBy>("material");
  const [sharing, setSharing] = useState(false);

  function costReportQuery(extra: Record<string, string> = {}) {
    const qs = new URLSearchParams({ projectId, groupBy, ...extra });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return qs.toString();
  }

  async function load() {
    setLoading(true);
    const [matR, recR, repR] = await Promise.allSettled([
      fetchJson<{ materials?: Material[] }>(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ receipts?: Receipt[] }>(`/api/materials?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ report?: MaterialCostReport }>(`/api/construction-materials/cost-report?${costReportQuery()}`),
    ]);

    const errors: { materials?: string; receipts?: string; report?: string } = {};
    if (matR.status === "fulfilled") setMaterials(matR.value.materials ?? []);
    else { setMaterials([]); errors.materials = errorMessage(matR.reason, "Material master"); }

    if (recR.status === "fulfilled") setReceipts(recR.value.receipts ?? []);
    else { setReceipts([]); errors.receipts = errorMessage(recR.reason, "Inbound receipts"); }

    if (repR.status === "fulfilled") setReport(repR.value.report ?? null);
    else { setReport(null); errors.report = errorMessage(repR.reason, "Cost report"); }

    setLoadErrors(errors);
    setLoading(false);
  }

  useEffect(() => { load(); }, [projectId]);

  // The tie check gates Export: a file that does not add up outlives the screen
  // that produced it.
  const tieError = report ? checkMaterialCostTies(report, orgMoney.money) : null;
  const exportReason = !report ? "Run the report first" : tieError;

  function exportCsv() {
    if (!report) return;
    const blob = new Blob([buildMaterialCostCsv(report)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `material-cost-report-${projectId}${from ? `-${from}` : ""}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * R67 E-18 (R-178): ONE link, whether the reader copies it or sends it to
   * WhatsApp -- the shared control mints it once through this factory rather
   * than each action building its own. This report has no public renderer, so
   * the link is the in-app URL carrying these exact parameters: it opens this
   * run for a colleague already signed in, which is what it says it does.
   */
  async function shareUrlFactory(): Promise<string | null> {
    setSharing(true);
    try {
      return `${window.location.origin}/materials?tab=cost-report&${costReportQuery()}`;
    } finally {
      setSharing(false);
    }
  }

  const materialName = (id: string) => materials.find((m) => m.id === id)?.name ?? id;

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <>
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
              <div className="p-4"><DataLoadError messages={[loadErrors.materials]} onRetry={load} /></div>
            ) : materials.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No materials in the master yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow>{columns.map((col) => <TableHead key={col.field} className={MONEY_FIELDS.has(col.field) ? "text-right" : undefined}>{col.label}{MONEY_FIELDS.has(col.field) ? orgMoney.unitSuffix : ""}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {/* Real screen navigation (2026-08-30) -- rows open the
                      real Object Page, where Edit/Deactivate now live. */}
                  {materials.map((m) => (
                    <TableRow key={m.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/materials/${m.id}`)}>
                      {columns.map((col) => <TableCell key={col.field} className={MONEY_FIELDS.has(col.field) ? MONEY_CELL_CLASS : undefined}>{renderMaterialCell(col.field, m, orgMoney.money)}</TableCell>)}
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
              <div className="p-4"><DataLoadError messages={[loadErrors.receipts]} onRetry={load} /></div>
            ) : receipts.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No material movements recorded yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Material</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Unit Cost{orgMoney.unitSuffix}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {receipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-px-muted">{formatDate(r.receivedDate)}</TableCell>
                      <TableCell className="font-medium">{materialName(r.materialId)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                      <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.unitCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* R67 E-05 (R-103): this was "a summary card wearing the word report" --
          no parameters, no total, no export, and it counted receipts that had
          been voided. It is a report now: a parameter bar that makes it run by
          pressing nothing, a grouping, real header actions, the vendor and
          variance columns the data always had, and a Grand Total that ties. */}
      <TabsContent value="cost-report" className="space-y-4">
        <Card className="shadow-card">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="cost-report-from" />
              {!from && <p className="text-[11px] text-px-muted">Blank = every receipt on record</p>}
            </div>
            <div className="space-y-1.5"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="cost-report-to" /></div>

            <div className="space-y-1.5">
              <Label id="cost-report-groupby-label">Group by</Label>
              {/* A segmented control, not a dropdown: two options, both worth
                  seeing, and the current one readable without opening anything. */}
              <div role="group" aria-labelledby="cost-report-groupby-label" className="flex rounded-md border border-px-border p-0.5" data-testid="cost-report-groupby">
                {(["material", "vendor"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={groupBy === g}
                    onClick={() => setGroupBy(g)}
                    className={`rounded px-3 py-1 text-xs capitalize ${groupBy === g ? "bg-px-ink text-white" : "text-px-muted hover:bg-muted/50"}`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={load} disabled={loading} data-testid="cost-report-run">
              {loading ? <Loader2 className="size-4 animate-spin" /> : null} Apply
            </Button>

            {/* R67 E-18 (R-178): the SAME Export / Share control as the Work
                Progress Report, the Reports frame, the Budget screen, the
                Manpower Daily Summary, the MoM object page and Design Studio.
                Four buttons in a row became two word-buttons with menus.
                PDF and XLSX stay SERVER-rendered and relayed -- projexa gains
                no PDF or XLSX library -- and the CSV is still built here from
                the rows on screen, which is the trust feature it always was. */}
            <ExportShareActions
              canExport={!exportReason}
              exportReason={exportReason}
              title={costReportTitle(from || null, to || null)}
              pdfHref={`/api/construction-materials/cost-report/export?${costReportQuery({ format: "pdf" })}`}
              xlsxHref={`/api/construction-materials/cost-report/export?${costReportQuery({ format: "xlsx" })}`}
              onCsv={exportCsv}
              shareUrlFactory={shareUrlFactory}
              shareReason={sharing ? "Creating the link…" : null}
              onMessage={(message) => toast.success(message)}
            />
            {exportReason && <span className="text-xs text-px-muted" data-testid="cost-report-export-reason">{exportReason}</span>}
          </CardContent>
        </Card>

        {/* If the rows do not sum to the total the report is WRONG and says so
            loudly -- the table still renders, because a reader needs the rows
            to find the discrepancy; only Export is blocked. */}
        {tieError && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error" role="alert" data-testid="cost-report-tie-error">{tieError}</CardContent>
          </Card>
        )}

        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : loadErrors.report ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.report]} onRetry={load} /></div>
            ) : !report || report.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted" data-testid="cost-report-empty">{emptyRangeMessage(from || null, to || null)}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead>Spec</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Qty Received</TableHead>
                      <TableHead className="text-right">Total Cost{orgMoney.unitSuffix}</TableHead>
                      <TableHead className="text-right">Avg Unit Cost{orgMoney.unitSuffix}</TableHead>
                      <TableHead className="text-right">Master Unit Cost{orgMoney.unitSuffix}</TableHead>
                      <TableHead className="text-right">Variance{orgMoney.unitSuffix}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-px-muted">{r.spec ?? EMPTY_VALUE}</TableCell>
                        <TableCell>{r.vendorName ?? EMPTY_VALUE}</TableCell>
                        <TableCell>{r.unit ? materialUnitLabel(r.unit) : EMPTY_VALUE}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.totalQuantityReceived}</TableCell>
                        <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.totalCost)}</TableCell>
                        <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.averageUnitCost)}</TableCell>
                        <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.masterUnitCost)}</TableCell>
                        <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.variance)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-px-border font-semibold" data-testid="cost-report-grand-total">
                      <TableCell colSpan={4}>Grand Total</TableCell>
                      <TableCell className="text-right tabular-nums">{report.totals.quantity}</TableCell>
                      <TableCell className={MONEY_CELL_CLASS} data-testid="cost-report-grand-total-cost">{orgMoney.money(report.totals.cost)}</TableCell>
                      <TableCell /><TableCell /><TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
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
