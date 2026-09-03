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
// not a second list screen) and stays exactly as it was. MASTER_COLUMNS is
// the fallback used when materials/page.tsx's server-side resolve of the
// material.list screen_definitions row returns null (404/error).
//
// Real-screen conversion (2026-08-30): the "Add Material"/"Record Receipt"
// Dialog popups are gone -- Add Material routes to a real create screen
// (MaterialCreateClient.tsx), master rows route to a real Object Page
// (MaterialObjectClient.tsx). Record Receipt routes to a real create screen
// (MaterialReceiptCreateClient.tsx). Same conversion folded in module #31
// (Site Materials): /site-materials redirects here, and this file gained Cost
// Report, backed by a real getMaterialCostReport() aggregation.
//
// R67 F-18: the MATERIAL MASTER arrives as a prop, fetched by
// materials/page.tsx on the server inside its Suspense boundary.
//
// R67 F-25 (audit recommendation R-241) -- ONE TAB, ONE LOAD. This screen used
// to fire all THREE reads on landing -- master, inbound receipts and the cost
// report -- under ONE shared `loading` flag, although only Material Master is
// open and the other two answer questions nobody has asked yet. Two of those
// three were pure waste on every landing, and one shared flag meant a failure
// in any of them looked like a failure in all of them.
//
// Now each tab is its own pane (src/lib/pane-state.ts) with its own status,
// rows, as-of time and error. The tab the user LANDS ON loads -- which, on a
// ?tab= deep link, is that tab and no other. The remaining panes are then
// prefetched on the first idle callback, so switching still feels instant
// without putting their cost on the first paint. A tab that has already
// answered is never re-fetched by a click.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { MATERIAL_LIST_COLUMNS } from "@/lib/module-list-columns";
import { isAbortError, type ModuleListInitial } from "@/lib/module-list-state";
import {
  errorPane,
  idlePane,
  loadingPane,
  needsLoad,
  paneAsOf,
  paneIsBusy,
  readyPane,
  seededPane,
  type Pane,
} from "@/lib/pane-state";
import { AsOfStamp } from "@/components/AsOfStamp";
import DataLoadError from "@/components/DataLoadError";
import ListScreenFrame from "@/components/ListScreenFrame";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { EMPTY_VALUE, MONEY_CELL_CLASS } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { materialUnitLabel } from "@/lib/material-units";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";

// Exported so materials/page.tsx can type the rows it fetches server-side.
export type Material = { id: string; name: string; spec: string | null; unit: string; unitCost: string; isActive: boolean };
type Receipt = { id: string; materialId: string; receivedDate: string; quantity: string; unitCost: string | null; vendorId: string | null };
type CostReportRow = { materialId: string; name: string; spec: string | null; unit: string; totalQuantityReceived: number; totalCost: number; averageUnitCost: number };

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const TAB_IDS = ["master", "receipts", "cost-report"] as const;
type TabId = (typeof TAB_IDS)[number];
const VALID_TABS = new Set<string>(TAB_IDS);

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

/** Each tab's own endpoint, in one place, so a pane can never be loaded from
 *  another tab's URL. */
function paneUrl(tab: TabId, projectId: string): string {
  const p = encodeURIComponent(projectId);
  if (tab === "master") return `/api/materials/master?projectId=${p}`;
  if (tab === "receipts") return `/api/materials?projectId=${p}`;
  return `/api/construction-materials/cost-report?projectId=${p}`;
}

const PANE_LABEL: Record<TabId, string> = {
  master: "Material master",
  receipts: "Inbound receipts",
  "cost-report": "Cost report",
};

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
  // F-18 moved MASTER_COLUMNS to module-list-columns.ts as
  // MATERIAL_LIST_COLUMNS, so the loading skeleton and this table read the same
  // fallback heads. G-05's useOrgMoney() replaces the raw useCurrencies() hook:
  // this file no longer formats a figure itself.
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MATERIAL_LIST_COLUMNS;
  const orgMoney = useOrgMoney();
  const [activeTab, setActiveTab] = useState<TabId>(
    initialTab && VALID_TABS.has(initialTab) ? (initialTab as TabId) : "master"
  );
  // F-25: the five shared useState hooks that used to live here (materials,
  // receipts, report, one `loading` flag and one `loadErrors` bag) are gone --
  // each tab is now its own Pane with its own rows, status, as-of time and
  // error, so a failure in the cost report can no longer read as a failure in
  // the material master.

  const [master, setMaster] = useState<Pane<Material>>(() =>
    initialMaster ? seededPane(initialMaster.rows, initialMaster.errorMessage, Date.now()) : idlePane<Material>()
  );
  const [receipts, setReceipts] = useState<Pane<Receipt>>(idlePane<Receipt>);
  const [report, setReport] = useState<Pane<CostReportRow>>(idlePane<CostReportRow>);

  const panes: Record<TabId, Pane<unknown>> = { master, receipts, "cost-report": report };
  // Synced in an effect, never during render: loadPane() reads this to decide
  // whether a tab has already answered, and an effect runs before any click
  // that could ask.
  const panesRef = useRef(panes);
  useEffect(() => {
    panesRef.current = panes;
  });

  // One update path for all three panes, so loadPane() below is one function
  // rather than three near-identical ones. The casts are safe because each
  // branch only ever receives the transition applied to its own pane.
  const applyPane = useCallback((tab: TabId, update: (prev: Pane<unknown>) => Pane<unknown>) => {
    if (tab === "master") setMaster((prev) => update(prev) as Pane<Material>);
    else if (tab === "receipts") setReceipts((prev) => update(prev) as Pane<Receipt>);
    else setReport((prev) => update(prev) as Pane<CostReportRow>);
  }, []);

  // One controller for the whole component: every in-flight pane is dropped on
  // unmount and on a project switch, and a cancellation is never an error.
  const abortRef = useRef<AbortController | null>(null);

  const loadPane = useCallback(
    async (tab: TabId, force = false) => {
      // A tab that has already answered is never re-read by a click. `force` is
      // the Retry beside a failed pane, which is the user asking explicitly.
      if (!force && !needsLoad(panesRef.current[tab])) return;
      const controller = abortRef.current;
      applyPane(tab, loadingPane);
      try {
        const payload = await fetchJson<Record<string, unknown>>(paneUrl(tab, projectId), {
          signal: controller?.signal,
        });
        if (controller?.signal.aborted) return;
        const key = tab === "master" ? "materials" : tab === "receipts" ? "receipts" : "report";
        applyPane(tab, () => readyPane((payload[key] as unknown[]) ?? [], Date.now()));
      } catch (err) {
        if (isAbortError(err, controller?.signal)) return;
        applyPane(tab, (prev) => errorPane(prev, errorMessage(err, PANE_LABEL[tab])));
      }
    },
    [projectId, applyPane]
  );

  // Landing: only the tab the user is actually on. A ?tab=receipts deep link
  // therefore costs one request, not three.
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    void loadPane(activeTab);
    return () => {
      controller.abort();
      abortRef.current = null;
    };
    // activeTab is handled by goToTab (which loads on demand); re-running this
    // on every tab change would abort the pane that is already in flight.
  }, [loadPane]);

  // A project switch invalidates every pane -- the rows on screen belong to the
  // project the user just left.
  const projectRef = useRef(projectId);
  useEffect(() => {
    if (projectRef.current === projectId) return;
    projectRef.current = projectId;
    setMaster(idlePane<Material>());
    setReceipts(idlePane<Receipt>());
    setReport(idlePane<CostReportRow>());
  }, [projectId]);

  // Once the landing tab has answered, fill the others on the first IDLE
  // callback, so switching feels instant without any of it landing on the
  // first paint. requestIdleCallback is not in Safari, hence the timeout
  // fallback -- which still yields a frame, which is the point.
  const activePaneStatus = panes[activeTab].status;
  useEffect(() => {
    if (activePaneStatus !== "ready") return;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const prefetch = () => {
      for (const tab of TAB_IDS) if (tab !== activeTab) void loadPane(tab);
    };
    if (typeof win.requestIdleCallback === "function") {
      const handle = win.requestIdleCallback(prefetch, { timeout: 3000 });
      return () => win.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(prefetch, 300);
    return () => clearTimeout(timer);
  }, [activePaneStatus, activeTab, loadPane]);

  const materialName = (id: string) => master.rows.find((m) => m.id === id)?.name ?? id;

  function goToTab(tab: string) {
    if (!VALID_TABS.has(tab)) return;
    setActiveTab(tab as TabId);
    void loadPane(tab as TabId);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  /** One tab's body: spinner ONLY when there is genuinely nothing to show,
   *  then the backend's own reason, then the rows.
   *
   *  R67 F-31: each tab is its own list region -- data-state / aria-busy, and
   *  a wait that acquires words at 3 s and a Retry at 8 s. `label` is that
   *  tab's own noun, so the sentence names what the user actually clicked. */
  function PaneBody<T>({ pane, tab, empty, label, children }: { pane: Pane<T>; tab: TabId; empty: string; label: string; children: React.ReactNode }) {
    return (
      <ListScreenFrame
        label={label}
        loading={paneIsBusy(pane)}
        error={pane.error}
        rowCount={pane.rows.length}
        onRetry={() => void loadPane(tab, true)}
      >
        {pane.error ? (
          <div className="p-4"><DataLoadError messages={[pane.error]} onRetry={() => loadPane(tab, true)} /></div>
        ) : pane.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-px-muted">{empty}</p>
        ) : (
          children
        )}
      </ListScreenFrame>
    );
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
        <div className="flex items-center justify-end gap-3">
          <AsOfStamp at={paneAsOf(master, Date.now())} />
          {/* Real screen navigation (2026-08-30) -- replaces the old "Add
              Material" Dialog popup with a real create route. */}
          <Button onClick={() => router.push(`/materials/new?projectId=${projectId}`)}><Plus className="size-4" /> Add Material</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            <PaneBody pane={master} tab="master" label="materials" empty="No materials in the master yet.">
              <Table>
                <TableHeader><TableRow>{columns.map((col) => <TableHead key={col.field} className={MONEY_FIELDS.has(col.field) ? "text-right" : undefined}>{col.label}{MONEY_FIELDS.has(col.field) ? orgMoney.unitSuffix : ""}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {/* Real screen navigation (2026-08-30) -- rows open the
                      real Object Page, where Edit/Deactivate now live. */}
                  {master.rows.map((m) => (
                    <TableRow key={m.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/materials/${m.id}`)}>
                      {columns.map((col) => <TableCell key={col.field} className={MONEY_FIELDS.has(col.field) ? MONEY_CELL_CLASS : undefined}>{renderMaterialCell(col.field, m, orgMoney.money)}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PaneBody>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="receipts" className="space-y-4">
        <div className="flex items-center justify-end gap-3">
          <AsOfStamp at={paneAsOf(receipts, Date.now())} />
          {/* Real screen navigation (2026-08-30) -- replaces the old
              "Record Receipt" Dialog popup with a real create route. */}
          <Button disabled={master.rows.length === 0} onClick={() => router.push(`/materials/receipts/new?projectId=${projectId}`)}><Plus className="size-4" /> Record Receipt</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            <PaneBody pane={receipts} tab="receipts" label="inbound receipts" empty="No material movements recorded yet.">
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Material</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Unit Cost{orgMoney.unitSuffix}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {receipts.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-px-muted">{formatDate(r.receivedDate)}</TableCell>
                      <TableCell className="font-medium">{materialName(r.materialId)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                      <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.unitCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PaneBody>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="cost-report" className="space-y-4">
        <div className="flex items-center justify-end gap-3">
          <AsOfStamp at={paneAsOf(report, Date.now())} />
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            <PaneBody pane={report} tab="cost-report" label="the cost report" empty="No receipts to report yet.">
              <Table>
                <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Total Qty Received</TableHead><TableHead className="text-right">Total Cost{orgMoney.unitSuffix}</TableHead><TableHead className="text-right">Avg Unit Cost{orgMoney.unitSuffix}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
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
            </PaneBody>
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
