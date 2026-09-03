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
// R67 MERGE (lane D0 x lane F2). Both lanes rebuilt this screen's reads.
//
//   * Lane F2 (item F-25, audit R-241) made each TAB its own read. The screen
//     used to fetch the material master, the inbound receipts AND the cost
//     report on landing, under one shared flag, although only Material Master
//     is open -- so the tab the user is looking at waited on two answers they
//     had not asked for, and a failure in any of them looked like a failure in
//     all three. That is the defect this file existed to fix and it is kept:
//     the landing tab is the only request on arrival, the others fill on the
//     first idle callback, and a ?tab= deep link costs ONE request.
//   * Lane D0 (item D-65) gave every pane the shared PaneState presentation --
//     the named waiting caption, the empty sentence that needs a 200, rows
//     kept and dated through a failed refresh -- plus D-79's tab-aware header
//     actions. Under decision D-11 that presentation is canonical.
//
// So: F2's per-tab state machine PRODUCES the state (src/lib/pane-state.ts's
// Pane<T>), and D0's PaneState DECIDES WHAT THE SCREEN SAYS about it. That is
// exactly the union D-11's addendum describes for these two modules.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import PaneState from "@/components/PaneState";
import { MATERIAL_LIST_COLUMNS } from "@/lib/module-list-columns";
import { isAbortError, type ModuleListInitial } from "@/lib/module-list-state";
import {
  errorPane,
  idlePane,
  loadingPane,
  needsLoad,
  readyPane,
  seededPane,
  type Pane,
} from "@/lib/pane-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import { ListHeaderActions } from "@/components/ListHeaderActions";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
// R67 D-74 keeps the ORG's date form here (dd-MM-yyyy for a UAE org);
// R67 G-05 owns the money, through the one formatter in format-money.ts.
import { formatDate } from "@/lib/format";
import { EMPTY_VALUE, MONEY_CELL_CLASS, formatQty } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { materialUnitLabel } from "@/lib/material-units";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";

// Exported so materials/page.tsx can type the master it fetches server-side (F-18).
export type Material = { id: string; name: string; spec: string | null; unit: string; unitCost: string; isActive: boolean };
type Receipt = { id: string; materialId: string; receivedDate: string; quantity: string; unitCost: string | null; vendorId: string | null };
type CostReportRow = { materialId: string; name: string; spec: string | null; unit: string; totalQuantityReceived: number; totalCost: number; averageUnitCost: number };

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / ChangeOrdersClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

// R67 F-18: MASTER_COLUMNS moved to src/lib/module-list-columns.ts as
// MATERIAL_LIST_COLUMNS, so this table and the page's loading skeleton draw
// the same fallback heads and cannot disagree.

const TAB_IDS = ["master", "receipts", "cost-report"] as const;
type TabId = (typeof TAB_IDS)[number];
const VALID_TABS = new Set<string>(TAB_IDS);

// R67 D-74/G-05: money columns, named by FIELD -- the master's columns come
// from the registry and can be reordered live. The header carries the
// currency, the cell is right-aligned with tabular figures.
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

// R67 D-65 asked for per-tab state; R67 F-25 built it as a state machine with
// no React in it, in src/lib/pane-state.ts, where the rules are unit tests.
// This is the small amount left over: where each tab reads from, and what it
// is called when a wait has to be narrated.

/** Each tab's own endpoint, in one place, so a pane can never be loaded from
 *  another tab's URL. */
function paneUrl(tab: TabId, projectId: string): string {
  const p = encodeURIComponent(projectId);
  if (tab === "master") return `/api/materials/master?projectId=${p}`;
  if (tab === "receipts") return `/api/materials?projectId=${p}`;
  return `/api/construction-materials/cost-report?projectId=${p}`;
}

/** The plural noun each pane names itself with while it waits. */
const PANE_ENTITY: Record<TabId, string> = {
  master: "the material master",
  receipts: "inbound receipts",
  "cost-report": "the cost report",
};

/** The key each endpoint returns its rows under. */
const PANE_ROWS_KEY: Record<TabId, string> = {
  master: "materials",
  receipts: "receipts",
  "cost-report": "report",
};

/** PaneState wants the transport's own status and message; Pane keeps one
 *  sentence, which is all any of these three endpoints gives us. */
function paneReadError(pane: Pane<unknown>): { status: number | null; message: string | null } | null {
  return pane.error ? { status: null, message: pane.error } : null;
}

export default function MaterialsClient({
  projectId,
  projectName,
  registryColumns,
  initialTab,
  initialMaster = null,
}: {
  projectId: string;
  projectName?: string | null;
  registryColumns?: RegistryColumn[] | null;
  initialTab?: string;
  /** R67 F-18: the material master, already fetched by materials/page.tsx on
   *  the server. The landing tab therefore paints filled with no round trip. */
  initialMaster?: ModuleListInitial<Material>;
}) {
  const router = useRouter();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MATERIAL_LIST_COLUMNS;
  const orgMoney = useOrgMoney();
  const [activeTab, setActiveTab] = useState<TabId>(
    initialTab && VALID_TABS.has(initialTab) ? (initialTab as TabId) : "master"
  );

  // F-25: the shared `loading` flag and single error bag are gone -- each tab
  // is its own Pane with its own rows, status, as-of time and error, so a
  // failure in the cost report can no longer read as a failure in the master.
  const [master, setMaster] = useState<Pane<Material>>(() =>
    initialMaster ? seededPane(initialMaster.rows, initialMaster.errorMessage, Date.now()) : idlePane<Material>()
  );
  const [receiptsPane, setReceiptsPane] = useState<Pane<Receipt>>(idlePane<Receipt>);
  const [reportPane, setReportPane] = useState<Pane<CostReportRow>>(idlePane<CostReportRow>);
  // When each pane's CURRENT read was issued, for D-65's elapsed caption.
  const [startedAt, setStartedAt] = useState<Record<TabId, number | null>>({
    master: null,
    receipts: null,
    "cost-report": null,
  });

  const panes: Record<TabId, Pane<unknown>> = {
    master,
    receipts: receiptsPane,
    "cost-report": reportPane,
  };
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
    else if (tab === "receipts") setReceiptsPane((prev) => update(prev) as Pane<Receipt>);
    else setReportPane((prev) => update(prev) as Pane<CostReportRow>);
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
      setStartedAt((prev) => ({ ...prev, [tab]: Date.now() }));
      try {
        const payload = await fetchJson<Record<string, unknown>>(paneUrl(tab, projectId), {
          signal: controller?.signal,
        });
        if (controller?.signal.aborted) return;
        applyPane(tab, () => readyPane((payload[PANE_ROWS_KEY[tab]] as unknown[]) ?? [], Date.now()));
      } catch (err) {
        if (isAbortError(err, controller?.signal)) return;
        // The transport's own words survive: PaneState renders them under the
        // closed-vocabulary sentence (C19 ERROR_TRUTHFUL).
        const message =
          err instanceof ApiError || (err instanceof Error && err.message)
            ? (err as Error).message
            : `Couldn't load ${PANE_ENTITY[tab]}.`;
        applyPane(tab, (prev) => errorPane(prev, message));
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
    setReceiptsPane(idlePane<Receipt>());
    setReportPane(idlePane<CostReportRow>());
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

  const materials = master.rows;
  const receipts = receiptsPane.rows;
  const report = reportPane.rows;

  const materialName = (id: string) => materials.find((m) => m.id === id)?.name ?? id;

  function goToTab(tab: string) {
    if (!VALID_TABS.has(tab)) return;
    setActiveTab(tab as TabId);
    void loadPane(tab as TabId);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <>
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
              status={master.status}
              entity={PANE_ENTITY.master}
              projectName={projectName}
              startedAt={startedAt.master}
              error={paneReadError(master)}
              rowCount={materials.length}
              skeletonColumns={columns.map((col) => col.label)}
              emptyMessage="No materials in the master yet."
              emptyAction={
                <Button size="sm" onClick={() => router.push(`/materials/new?projectId=${projectId}`)}>
                  <Plus className="size-4" /> Add Material
                </Button>
              }
              lastLoadedAt={master.asOf ? new Date(master.asOf) : null}
              onRetry={() => void loadPane("master", true)}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead key={col.field} className={MONEY_FIELDS.has(col.field) ? "text-right" : undefined}>
                        {col.label}
                        {MONEY_FIELDS.has(col.field) ? orgMoney.unitSuffix : ""}
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
                          className={MONEY_FIELDS.has(col.field) ? MONEY_CELL_CLASS : undefined}
                        >
                          {renderMaterialCell(col.field, m, orgMoney.money)}
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
              status={receiptsPane.status}
              entity={PANE_ENTITY.receipts}
              projectName={projectName}
              startedAt={startedAt.receipts}
              error={paneReadError(receiptsPane)}
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
              lastLoadedAt={receiptsPane.asOf ? new Date(receiptsPane.asOf) : null}
              onRetry={() => void loadPane("receipts", true)}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit Cost{orgMoney.unitSuffix}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-px-muted">{formatDate(r.receivedDate)}</TableCell>
                      <TableCell className="font-medium">{materialName(r.materialId)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(r.quantity)}</TableCell>
                      <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.unitCost)}</TableCell>
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
              status={reportPane.status}
              entity={PANE_ENTITY["cost-report"]}
              projectName={projectName}
              startedAt={startedAt["cost-report"]}
              error={paneReadError(reportPane)}
              rowCount={report.length}
              skeletonColumns={["Material", "Unit", "Total Qty Received", "Total Cost", "Avg Unit Cost"]}
              emptyMessage="No receipts to report yet."
              lastLoadedAt={reportPane.asOf ? new Date(reportPane.asOf) : null}
              onRetry={() => void loadPane("cost-report", true)}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Total Qty Received</TableHead>
                    <TableHead className="text-right">Total Cost{orgMoney.unitSuffix}</TableHead>
                    <TableHead className="text-right">Avg Unit Cost{orgMoney.unitSuffix}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.map((r) => (
                    <TableRow key={r.materialId}>
                      <TableCell className="font-medium">{r.name}{r.spec ? <span className="text-px-muted"> ({r.spec})</span> : null}</TableCell>
                      <TableCell>{materialUnitLabel(r.unit)}</TableCell>
                      {/* R67 D-39: a quantity is not money -- up to three
                          decimals and no trailing zeros, so "50 m3" does not
                          read "50.000 m3", but still right-aligned with
                          tabular figures so the column reads as a column. */}
                      <TableCell className="text-right tabular-nums">{formatQty(r.totalQuantityReceived)}</TableCell>
                      <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.totalCost)}</TableCell>
                      <TableCell className={MONEY_CELL_CLASS}>{orgMoney.money(r.averageUnitCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PaneState>
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
