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
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import { PageHeading, type PageHeadingAction } from "@/components/PageHeading";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Pencil, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDateNumeric } from "@/lib/format-date";
import { formatMoney, formatQty, resolveCurrencyCode } from "@/lib/format-money";
import { useCurrencies, type Currency } from "@/lib/currency";
import { csvFilename, downloadCsv, toCsv } from "@/lib/csv-export";

type Material = { id: string; name: string; spec: string | null; unit: string; unitCost: string; isActive: boolean };
type Receipt = {
  id: string; materialId: string; receivedDate: string; quantity: string; unitCost: string | null;
  vendorId: string | null;
  // R67 D-36
  reference: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};
type Vendor = { id: string; vendorName: string };
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
      // R55_MATERIALS_UNITCOST_NO_AED_01: was a bare `m.unitCost`, so the
      // column rendered unlabelled numbers with no currency anywhere on the
      // page. Materials carry no per-item currencyId (unlike quotations/
      // orders), so this is always the org base currency. R67: through the
      // shared formatter, so "AED 420.00" reads identically here, on the
      // receipts tab and on the Cost Report.
      return formatMoney(m.unitCost, currencies);
    default:
      return String((m as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

// R67 D-35: the two fields a QS changes weekly. Everything else on the master
// still goes through the object page's own Edit.
const INLINE_EDITABLE_FIELDS = new Set(["unit", "unitCost"]);

export default function MaterialsClient({
  projectId,
  projectName,
  registryColumns,
  initialTab,
  initialMaterialId,
}: {
  projectId: string;
  projectName: string;
  registryColumns?: RegistryColumn[] | null;
  initialTab?: string;
  /** From ?materialId= -- set when the Cost Report drills into one material's receipts. */
  initialMaterialId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : MASTER_COLUMNS;
  const currencies = useCurrencies();
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "master");
  const [materialFilter, setMaterialFilter] = useState(initialMaterialId ?? "");
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  // R67 D-35: no click may be silent. The row that was clicked shows
  // "Opening…" until the route actually changes.
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: "unit" | "unitCost" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [footerMessage, setFooterMessage] = useState<string | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [report, setReport] = useState<CostReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<{ materials?: string; receipts?: string; report?: string }>({});

  async function load() {
    setLoading(true);
    const [matR, recR, repR, venR] = await Promise.allSettled([
      fetchJson<{ materials?: Material[] }>(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ receipts?: Receipt[] }>(`/api/materials?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ report?: CostReportRow[] }>(`/api/construction-materials/cost-report?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ vendors?: Vendor[] }>(`/api/vendors`),
    ]);

    const errors: { materials?: string; receipts?: string; report?: string } = {};
    if (matR.status === "fulfilled") setMaterials(matR.value.materials ?? []);
    else { setMaterials([]); errors.materials = errorMessage(matR.reason, "Material master"); }

    if (recR.status === "fulfilled") setReceipts(recR.value.receipts ?? []);
    else { setReceipts([]); errors.receipts = errorMessage(recR.reason, "Inbound receipts"); }

    if (repR.status === "fulfilled") setReport(repR.value.report ?? []);
    else { setReport([]); errors.report = errorMessage(repR.reason, "Cost report"); }

    // R67 D-36: the vendor list is a display-only lookup for the Inbound
    // tab's new Vendor column -- its failure degrades to an en-dash, never to
    // an alert, the same posture LabourClient takes.
    setVendors(venR.status === "fulfilled" ? venR.value.vendors ?? [] : []);

    setLoadErrors(errors);
    setLoading(false);
  }

  useEffect(() => { load(); }, [projectId]);

  // Cleared when the route actually changes, so an "Opening…" row can never
  // outlive the navigation it was announcing.
  useEffect(() => { setOpeningId(null); }, [pathname]);

  const materialName = (id: string) => materials.find((m) => m.id === id)?.name ?? id;
  const vendorName = (id: string | null) => (id && vendors.find((v) => v.id === id)?.vendorName) || "—";

  const visibleMaterials = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return materials;
    return materials.filter((m) => `${m.name} ${m.spec ?? ""} ${m.unit}`.toLowerCase().includes(needle));
  }, [materials, query]);

  // R67 D-36/D-35: the Cost Report drills into one material's transactions,
  // so the Inbound tab has to be able to show just that material's rows.
  const visibleReceipts = useMemo(
    () => (materialFilter ? receipts.filter((r) => r.materialId === materialFilter) : receipts),
    [receipts, materialFilter]
  );

  // The Unit select's options are the units this project's own master already
  // uses, plus whatever the row currently holds. There is no org-level unit
  // master in this product to read from, and inventing one here would be a
  // second source of truth for something the data already answers.
  const knownUnits = useMemo(
    () => [...new Set(materials.map((m) => m.unit).filter((u) => !!u && u.trim().length > 0))].sort(),
    [materials]
  );

  const writeParams = useCallback((next: { tab?: string; materialId?: string | null }) => {
    const params = new URLSearchParams(window.location.search);
    if (next.tab) params.set("tab", next.tab);
    if (next.materialId === null) params.delete("materialId");
    else if (next.materialId) params.set("materialId", next.materialId);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, []);

  function goToTab(tab: string) {
    setActiveTab(tab);
    writeParams({ tab });
  }

  function openMaterialReceipts(materialId: string) {
    setActiveTab("receipts");
    setMaterialFilter(materialId);
    writeParams({ tab: "receipts", materialId });
  }

  function openMaterial(materialId: string) {
    setOpeningId(materialId);
    router.push(`/materials/${materialId}`);
  }

  function startInlineEdit(material: Material, field: "unit" | "unitCost") {
    setEditing({ id: material.id, field });
    setEditValue(field === "unit" ? material.unit : material.unitCost);
    setFooterMessage(null);
  }

  // Enter commits ONE field. The cell updates optimistically and reverts on
  // failure, with the backend's own sentence in the footer message area --
  // never a toast that has gone by the time the QS looks up.
  async function commitInlineEdit(material: Material, field: "unit" | "unitCost", raw: string) {
    const previous = field === "unit" ? material.unit : material.unitCost;
    const value = raw.trim();
    setEditing(null);
    if (!value || value === previous) return;
    if (field === "unitCost" && !Number.isFinite(Number(value))) {
      setFooterMessage("Unit Cost must be a number.");
      return;
    }

    const optimistic = field === "unit" ? { unit: value } : { unitCost: value };
    setMaterials((prev) => prev.map((m) => (m.id === material.id ? { ...m, ...optimistic } : m)));
    try {
      await fetchJson(`/api/materials/master/${material.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(field === "unit" ? { unit: value } : { unitCost: Number(value) }),
      });
      setFooterMessage(null);
    } catch (err) {
      setMaterials((prev) => prev.map((m) => (m.id === material.id ? { ...m, [field]: previous } as Material : m)));
      setFooterMessage(errorMessage(err, `Couldn't save ${field === "unit" ? "Unit" : "Unit Cost"}`));
    }
  }

  function exportMaster() {
    const code = resolveCurrencyCode(currencies);
    const rows = visibleMaterials.map((m, i) => [i + 1, m.name, m.spec ?? "", m.unit, m.unitCost, m.isActive ? "active" : "inactive"]);
    const csv = toCsv(["S.No", "Name", "Spec", "Unit", code ? `Unit Cost (${code})` : "Unit Cost", "Status"], rows);
    downloadCsv(csvFilename("materials", projectName, new Date().toISOString().slice(0, 10)), csv);
  }

  const headerActions: PageHeadingAction[] = [
    {
      label: filterOpen ? "Hide filter" : "Filter",
      disabledReason: loading ? "Loading…" : materials.length === 0 ? "No materials to filter" : undefined,
      onClick: () => setFilterOpen((open) => !open),
    },
    {
      label: "Export",
      disabledReason: loading ? "Loading…" : visibleMaterials.length === 0 ? "No rows" : undefined,
      onClick: exportMaster,
    },
    {
      label: "+ New Material",
      variant: "default",
      disabledReason: loading ? "Loading…" : undefined,
      onClick: () => router.push(`/materials/new?projectId=${projectId}`),
      testId: "materials-new",
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeading
        title="Materials"
        breadcrumb={`${projectName} / Materials`}
        project={projectName}
        actions={headerActions}
      />

      {filterOpen && (
        <Card className="shadow-card">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="materials-filter-q" className="text-[12px] text-px-muted">Name, spec or unit contains</Label>
              <Input id="materials-filter-q" className="h-9 w-64" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <Button variant="outline" size="sm" onClick={() => setQuery("")}>Clear filter</Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="master">Material Master</TabsTrigger>
        <TabsTrigger value="receipts">Inbound Receipts</TabsTrigger>
        <TabsTrigger value="cost-report">Cost Report</TabsTrigger>
      </TabsList>

      <TabsContent value="master" className="space-y-4">
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : loadErrors.materials ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.materials]} onRetry={load} /></div>
            ) : materials.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No materials in the master yet.</p>
            ) : visibleMaterials.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No materials match this filter.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead key={col.field} className={col.field === "unitCost" ? "text-right" : undefined}>{col.label}</TableHead>
                    ))}
                    {/* R67 D-35: a row click produced NO visible change, even
                        though the object page existed. The affordance is a
                        word, not an icon, and it is reachable by keyboard. */}
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleMaterials.map((m) => (
                    <TableRow
                      key={m.id}
                      className="group cursor-pointer hover:bg-px-cloud/40"
                      // Prefetching on hover is what turns "Opening…" into a
                      // flicker rather than a wait.
                      onMouseEnter={() => router.prefetch(`/materials/${m.id}`)}
                      onClick={() => openMaterial(m.id)}
                    >
                      {columns.map((col) => {
                        const isEditing = editing?.id === m.id && editing.field === col.field;
                        const editable = INLINE_EDITABLE_FIELDS.has(col.field);
                        return (
                          <TableCell
                            key={col.field}
                            className={col.field === "unitCost" ? "text-right tabular-nums" : undefined}
                            onClick={editable ? (event) => { event.stopPropagation(); if (!isEditing) startInlineEdit(m, col.field as "unit" | "unitCost"); } : undefined}
                          >
                            {isEditing && col.field === "unit" ? (
                              <select
                                autoFocus
                                aria-label={`Unit for ${m.name}`}
                                className="h-8 rounded-md border border-ct-border2 bg-background px-2 text-sm"
                                value={editValue}
                                onChange={(event) => { setEditValue(event.target.value); void commitInlineEdit(m, "unit", event.target.value); }}
                                onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditing(null); } }}
                                onBlur={() => setEditing(null)}
                              >
                                {[...new Set([m.unit, ...knownUnits])].filter(Boolean).map((unit) => (
                                  <option key={unit} value={unit}>{unit}</option>
                                ))}
                              </select>
                            ) : isEditing && col.field === "unitCost" ? (
                              <span className="inline-flex items-center justify-end gap-1">
                                <span className="text-px-muted">{resolveCurrencyCode(currencies)}</span>
                                <Input
                                  autoFocus
                                  type="number"
                                  step="0.01"
                                  aria-label={`Unit Cost for ${m.name}`}
                                  className="h-8 w-28 text-right"
                                  value={editValue}
                                  onChange={(event) => setEditValue(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") { event.preventDefault(); void commitInlineEdit(m, "unitCost", (event.target as HTMLInputElement).value); }
                                    if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
                                  }}
                                  onBlur={() => setEditing(null)}
                                />
                              </span>
                            ) : (
                              <span className={editable ? "inline-flex items-center gap-1" : undefined}>
                                {renderMaterialCell(col.field, m, currencies)}
                                {editable && (
                                  <Pencil
                                    className="size-3 opacity-0 transition-opacity group-hover:opacity-60"
                                    aria-label={`Edit ${col.label}`}
                                  />
                                )}
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right">
                        {openingId === m.id ? (
                          <span className="text-[13px] text-px-muted">Opening…</span>
                        ) : (
                          <button
                            type="button"
                            className="text-[13px] text-[color:var(--color-veri-status-context)] underline underline-offset-2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100"
                            onClick={(event) => { event.stopPropagation(); openMaterial(m.id); }}
                          >
                            Open
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {footerMessage && (
          <p role="alert" className="text-[13px] text-px-error">{footerMessage}</p>
        )}
      </TabsContent>

      <TabsContent value="receipts" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* R67 D-35: when the Cost Report drills into one material, the
              Inbound tab says WHICH material it is showing and offers the way
              back out -- a silently filtered list that looks like the whole
              ledger is worse than no drill-down at all. */}
          {materialFilter ? (
            <p className="text-[13px] text-px-muted">
              Showing receipts for{" "}
              <span className="font-medium text-[color:var(--color-veri-status-context)]">{materialName(materialFilter)}</span>{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => { setMaterialFilter(""); writeParams({ tab: "receipts", materialId: null }); }}
              >
                Show all materials
              </button>
            </p>
          ) : <span />}
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
            ) : visibleReceipts.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">
                {materialFilter
                  ? `No receipts recorded for ${materialName(materialFilter)} yet.`
                  : "No material movements recorded yet."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleReceipts.map((r) => {
                    const voided = !!r.voidedAt;
                    return (
                      <TableRow
                        key={r.id}
                        // R67 D-36: a voided receipt stays in the list, struck
                        // through, with its reason on hover -- it is excluded
                        // from the totals, not from the record.
                        className={`cursor-pointer hover:bg-px-cloud/40 ${voided ? "line-through opacity-70" : ""}`}
                        title={voided ? `Voided — ${r.voidReason ?? "no reason recorded"}` : undefined}
                        onClick={() => router.push(`/materials/receipts/${r.id}`)}
                      >
                        <TableCell className="text-px-muted">{formatDateNumeric(r.receivedDate)}</TableCell>
                        <TableCell className="font-medium">{materialName(r.materialId)}</TableCell>
                        <TableCell className="text-px-muted">{vendorName(r.vendorId)}</TableCell>
                        <TableCell className="text-px-muted">{r.reference ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatQty(r.quantity)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(r.unitCost, currencies)}</TableCell>
                      </TableRow>
                    );
                  })}
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
              <div className="p-4"><DataLoadError messages={[loadErrors.report]} onRetry={load} /></div>
            ) : report.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No receipts to report yet.</p>
            ) : (
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
                      <TableCell className="font-medium">
                        {/* R67 D-35: every reported number can be opened down
                            to the transactions behind it. */}
                        <button
                          type="button"
                          className="text-[color:var(--color-veri-status-context)] underline underline-offset-2"
                          onClick={() => openMaterialReceipts(r.materialId)}
                        >
                          {r.name}
                        </button>
                        {r.spec ? <span className="text-px-muted"> ({r.spec})</span> : null}
                      </TableCell>
                      <TableCell>{r.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(r.totalQuantityReceived)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.totalCost, currencies)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.averageUnitCost, currencies)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
      </Tabs>
    </div>
  );
}
