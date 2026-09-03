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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import SkeletonTable from "@/components/SkeletonTable";
import { PageHeading, type PageHeadingAction } from "@/components/PageHeading";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Pencil, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDateNumeric } from "@/lib/format-date";
import { formatMoney, formatQty, resolveCurrencyCode } from "@/lib/format-money";
import { useCurrencies, type Currency } from "@/lib/currency";
import { csvFilename, downloadCsv, toCsv } from "@/lib/csv-export";

type Material = {
  id: string; name: string; spec: string | null; unit: string; unitCost: string; isActive: boolean;
  // R67 D-40: computed by the master GET, never stored -- see listMaterials()
  // in construction-materials-service.ts. Optional on this type only because a
  // cached older response can still be in flight during a deploy.
  reorderLevel?: string | null;
  receivedToDate?: number;
  issuedToDate?: number;
  // R67 D-57: explicitly nullable. An item with no stock ledger of its own has
  // NO on-hand figure, which is not the same as an on-hand figure of zero.
  onHand?: number | null;
};
type Issue = {
  id: string; materialId: string; issuedDate: string; quantity: string;
  boqLineItemId: string | null; issuedTo: string | null; note: string | null;
};
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

// R67 D-40: the master finally carries a quantity. Sumeet's item 8 is
// "material database -- spec, cost, qty" and until now the module answered two
// of those three.
const QUANTITY_COLUMNS: ScreenColumn[] = [
  { label: "Received to date", field: "receivedToDate", type: "number", importance: "High" },
  { label: "On hand", field: "onHand", type: "number", importance: "High" },
];

const MASTER_COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Spec", field: "spec", type: "text", importance: "Medium" },
  { label: "Unit", field: "unit", type: "text", importance: "High" },
  { label: "Unit Cost", field: "unitCost", type: "number", importance: "High" },
  ...QUANTITY_COLUMNS,
];

const RIGHT_ALIGNED_FIELDS = new Set(["unitCost", "receivedToDate", "onHand"]);

const VALID_TABS = new Set(["master", "receipts", "issues", "cost-report"]);

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
    // R67 D-40. Quantities are not money: no currency token, and an absent
    // figure is an en-dash, never a confident "0".
    case "receivedToDate":
      return formatQty(m.receivedToDate);
    case "onHand": {
      const onHand = m.onHand;
      // R67 D-57: "a null onHand renders an en-dash with the title 'No stock
      // ledger for this item'". Absent and zero are different facts: zero means
      // the store is empty, absent means nothing has ever tracked this item.
      if (onHand === null || onHand === undefined) {
        return <span className="text-px-muted" title="No stock ledger for this item">—</span>;
      }
      const reorderLevel = m.reorderLevel === null || m.reorderLevel === undefined ? null : Number(m.reorderLevel);
      const low = reorderLevel !== null && Number.isFinite(reorderLevel) && onHand < reorderLevel;
      return (
        <span className="inline-flex items-center justify-end gap-1">
          {formatQty(onHand)}
          {low && (
            // Never colour alone: the needs-you glyph AND the word.
            <span
              className="text-[11px] font-medium"
              style={{ color: "var(--color-veri-status-needs-you)" }}
              title={`Below the reorder level of ${formatQty(reorderLevel)} ${m.unit}`}
            >
              ▲ Low
            </span>
          )}
        </span>
      );
    }
    default:
      return String((m as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

// R67 D-35: the two fields a QS changes weekly. Everything else on the master
// still goes through the object page's own Edit.
const INLINE_EDITABLE_FIELDS = new Set(["unit", "unitCost"]);

// R67 D-37: how long an "Opening…" state is allowed to stand before the screen
// admits the navigation is not arriving. A prefetched route lands in tens of
// milliseconds; a cold one on a slow site connection can take seconds. Eight is
// long enough not to fire on a genuinely slow-but-working push, short enough
// that a user is not left staring at a word that will never change.
const NAVIGATION_TIMEOUT_MS = 8000;
const NAVIGATION_FAILED_MESSAGE = "Could not open — try again";

// R67 D-37 (audit R-099): the Cost Report showed "Avg Unit Cost 435" beside a
// master that says 420 and never explained the disagreement, so it read as one
// of the two numbers being wrong. They are different facts, and the report now
// says so in one line and shows the difference as its own column.
const COST_REPORT_NOTE =
  "Avg Unit Cost is the average price actually received; the master's Unit Cost is the planned price";

/**
 * R67 D-57. A receipt's own money: quantity x unit cost. Exported so the column
 * and the totals row can never be two different sums of the same rows, and so
 * the rule is testable without the DOM.
 *
 * A receipt with no unit cost has NO line total -- null, rendered as the
 * en-dash. Treating a missing price as zero would quietly understate a ledger
 * that people reconcile invoices against.
 */
export function lineTotal(receipt: { quantity: string; unitCost: string | null }): number | null {
  if (receipt.unitCost === null || receipt.unitCost === "") return null;
  const quantity = Number(receipt.quantity);
  const unitCost = Number(receipt.unitCost);
  if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) return null;
  return Math.round(quantity * unitCost * 100) / 100;
}

/** Voided receipts are excluded from every total, exactly as VERIDIAN's own aggregate excludes them. */
export function receiptsTotal(receipts: readonly { quantity: string; unitCost: string | null; voidedAt: string | null }[]): number {
  return Math.round(
    receipts.reduce((sum, r) => (r.voidedAt ? sum : sum + (lineTotal(r) ?? 0)), 0) * 100
  ) / 100;
}

/**
 * R67 D-57: the Cost Report's default window is "the whole project so far".
 *
 * The project's own start date is NOT available to this screen -- the
 * /dashboard DTO that materials/page.tsx resolves its project from carries
 * {id, name} only -- so the earliest receipt in the ledger is used instead. For
 * a Cost Report the two windows show the same rows by construction: there can
 * be no receipt before the first receipt. An empty ledger has no window at all
 * and the field is left blank rather than defaulted to today, which would read
 * as "nothing was received today".
 */
export function defaultReportFrom(receipts: readonly { receivedDate: string }[]): string {
  return receipts.reduce<string>((earliest, r) => (!earliest || r.receivedDate < earliest ? r.receivedDate : earliest), "");
}

export default function MaterialsClient({
  projectId,
  projectName,
  registryColumns,
  initialTab,
  initialMaterialId,
  readOnlyReason,
}: {
  projectId: string;
  projectName: string;
  registryColumns?: RegistryColumn[] | null;
  initialTab?: string;
  /** From ?materialId= -- set when the Cost Report drills into one material's receipts. */
  initialMaterialId?: string;
  /**
   * R67 D-38: set when this project can be READ but not written -- today, a
   * project that is no longer active. Every write on the screen is disabled
   * with this exact sentence beside it, and it is stated once at the top in the
   * rose tone, so the user is told before they try rather than after.
   */
  readOnlyReason?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // R67 D-40: a seeded screen_definitions row still drives the ORDER and LABELS
  // of the stored columns, but it predates the quantity columns, so a registry
  // row that has not been updated must not silently hide the one thing this
  // item exists to add. The two quantity columns are appended when the resolved
  // set does not already name them -- when the registry row gains them, this
  // appends nothing.
  const columns = useMemo(() => {
    const resolved = registryColumns && registryColumns.length > 0 ? registryColumns : MASTER_COLUMNS;
    const present = new Set(resolved.map((col) => col.field));
    return [...resolved, ...QUANTITY_COLUMNS.filter((col) => !present.has(col.field))];
  }, [registryColumns]);
  const currencies = useCurrencies();
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "master");
  const [materialFilter, setMaterialFilter] = useState(initialMaterialId ?? "");
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  // R67 D-35/D-37: no click may be silent. The row that was clicked shows
  // "Opening…" until the route actually changes; so does the header button.
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openingNew, setOpeningNew] = useState(false);
  const [editing, setEditing] = useState<{ id: string; field: "unit" | "unitCost" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [footerMessage, setFooterMessage] = useState<string | null>(null);
  // R67 D-57: the Cost Report's From/To window. Empty means "everything", and
  // the From field is seeded from the ledger's own earliest receipt once the
  // receipts arrive -- see defaultReportFrom() for why that is the project's
  // start for this purpose.
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportWindowSeeded, setReportWindowSeeded] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [report, setReport] = useState<CostReportRow[]>([]);
  // R67 D-37: ONE loading flag used to gate all three tabs, so the Material
  // Master -- the tab the user is looking at -- waited for the receipts ledger
  // and the cost-report aggregate, two tabs they had not opened. Three flags,
  // each cleared by its own promise, so the master paints as soon as the master
  // arrives.
  const [loadingMaterials, setLoadingMaterials] = useState(true);
  const [loadingReceipts, setLoadingReceipts] = useState(true);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [loadingReport, setLoadingReport] = useState(true);
  const [loadErrors, setLoadErrors] = useState<{ materials?: string; receipts?: string; issues?: string; report?: string }>({});

  const loadMaterials = useCallback(async () => {
    setLoadingMaterials(true);
    try {
      const data = await fetchJson<{ materials?: Material[] }>(`/api/materials/master?projectId=${encodeURIComponent(projectId)}`);
      setMaterials(data.materials ?? []);
      setLoadErrors((prev) => ({ ...prev, materials: undefined }));
    } catch (err) {
      setMaterials([]);
      setLoadErrors((prev) => ({ ...prev, materials: errorMessage(err, "Material master") }));
    } finally {
      setLoadingMaterials(false);
    }
  }, [projectId]);

  const loadReceipts = useCallback(async () => {
    setLoadingReceipts(true);
    try {
      const data = await fetchJson<{ receipts?: Receipt[] }>(`/api/materials?projectId=${encodeURIComponent(projectId)}`);
      setReceipts(data.receipts ?? []);
      setLoadErrors((prev) => ({ ...prev, receipts: undefined }));
    } catch (err) {
      setReceipts([]);
      setLoadErrors((prev) => ({ ...prev, receipts: errorMessage(err, "Inbound receipts") }));
    } finally {
      setLoadingReceipts(false);
    }
  }, [projectId]);

  // R67 D-40
  const loadIssues = useCallback(async () => {
    setLoadingIssues(true);
    try {
      const data = await fetchJson<{ issues?: Issue[] }>(`/api/materials/issues?projectId=${encodeURIComponent(projectId)}`);
      setIssues(data.issues ?? []);
      setLoadErrors((prev) => ({ ...prev, issues: undefined }));
    } catch (err) {
      setIssues([]);
      setLoadErrors((prev) => ({ ...prev, issues: errorMessage(err, "Material issues") }));
    } finally {
      setLoadingIssues(false);
    }
  }, [projectId]);

  const loadReport = useCallback(async (window?: { from: string; to: string }) => {
    setLoadingReport(true);
    const params = new URLSearchParams({ projectId });
    if (window?.from) params.set("from", window.from);
    if (window?.to) params.set("to", window.to);
    try {
      const data = await fetchJson<{ report?: CostReportRow[] }>(`/api/construction-materials/cost-report?${params.toString()}`);
      setReport(data.report ?? []);
      setLoadErrors((prev) => ({ ...prev, report: undefined }));
    } catch (err) {
      setReport([]);
      setLoadErrors((prev) => ({ ...prev, report: errorMessage(err, "Cost report") }));
    } finally {
      setLoadingReport(false);
    }
  }, [projectId]);

  // R67 D-36: the vendor list is a display-only lookup for the Inbound
  // tab's new Vendor column -- its failure degrades to an en-dash, never to
  // an alert, the same posture LabourClient takes.
  const loadVendors = useCallback(async () => {
    try {
      const data = await fetchJson<{ vendors?: Vendor[] }>(`/api/vendors`);
      setVendors(data.vendors ?? []);
    } catch {
      setVendors([]);
    }
  }, []);

  useEffect(() => {
    void loadMaterials();
    void loadReceipts();
    void loadIssues();
    void loadReport();
    void loadVendors();
  }, [loadMaterials, loadReceipts, loadIssues, loadReport, loadVendors]);

  // R67 D-57: seed the window ONCE, from the ledger itself, and never again --
  // re-seeding on every receipts refresh would silently throw away a window the
  // user had chosen.
  useEffect(() => {
    if (reportWindowSeeded || loadingReceipts) return;
    setReportWindowSeeded(true);
    const from = defaultReportFrom(receipts);
    if (from) setReportFrom(from);
    setReportTo(new Date().toISOString().slice(0, 10));
  }, [loadingReceipts, receipts, reportWindowSeeded]);

  // R67 D-37: an "Opening…" that never resolves is worse than no feedback at
  // all -- it tells the user the click landed when it did not. The timer is
  // cleared by the route change below; if the route never changes, it says so.
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearNavigationState = useCallback(() => {
    if (navigationTimer.current) {
      clearTimeout(navigationTimer.current);
      navigationTimer.current = null;
    }
    setOpeningId(null);
    setOpeningNew(false);
  }, []);

  // Cleared when the route actually changes, so an "Opening…" row can never
  // outlive the navigation it was announcing.
  useEffect(() => { clearNavigationState(); }, [pathname, clearNavigationState]);
  useEffect(() => () => { if (navigationTimer.current) clearTimeout(navigationTimer.current); }, []);

  const navigate = useCallback((href: string) => {
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    navigationTimer.current = setTimeout(() => {
      navigationTimer.current = null;
      setOpeningId(null);
      setOpeningNew(false);
      setFooterMessage(NAVIGATION_FAILED_MESSAGE);
    }, NAVIGATION_TIMEOUT_MS);
    router.push(href);
  }, [router]);

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
    setFooterMessage(null);
    setOpeningId(materialId);
    navigate(`/materials/${materialId}`);
  }

  function openNewMaterial() {
    setFooterMessage(null);
    setOpeningNew(true);
    navigate(`/materials/new?projectId=${projectId}`);
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
    const rows = visibleMaterials.map((m, i) => [
      i + 1, m.name, m.spec ?? "", m.unit, m.unitCost,
      // R67 D-40: the export carries the same quantities the table shows -- an
      // export that disagrees with the screen is worse than no export.
      m.receivedToDate ?? "", m.issuedToDate ?? "", m.onHand ?? "",
      m.isActive ? "active" : "inactive",
    ]);
    const csv = toCsv(
      ["S.No", "Name", "Spec", "Unit", code ? `Unit Cost (${code})` : "Unit Cost", "Received to date", "Issued to date", "On hand", "Status"],
      rows
    );
    downloadCsv(csvFilename("materials", projectName, new Date().toISOString().slice(0, 10)), csv);
  }

  // R67 D-57: the Cost Report exports what it is SHOWING, window and all --
  // an export that silently covers a different period than the screen is worse
  // than no export. Relayed through this repo's own RFC-4180 CSV writer; no
  // XLSX/PDF library may exist in projexa.
  function exportCostReport() {
    const code = resolveCurrencyCode(currencies);
    const rows: unknown[][] = report.map((r, i) => [
      i + 1, r.name, r.spec ?? "", r.unit, r.totalQuantityReceived, r.totalCost, r.averageUnitCost,
    ]);
    rows.push([
      "Total", "", "", "",
      report.reduce((sum, r) => sum + r.totalQuantityReceived, 0),
      Math.round(report.reduce((sum, r) => sum + r.totalCost, 0) * 100) / 100,
      "",
    ]);
    const money = (label: string) => (code ? `${label} (${code})` : label);
    const csv = toCsv(
      ["S.No", "Material", "Spec", "Unit", "Total Qty Received", money("Total Cost"), money("Avg Unit Cost")],
      rows
    );
    downloadCsv(
      csvFilename(`cost-report-${reportFrom || "start"}-to-${reportTo || "today"}`, projectName, new Date().toISOString().slice(0, 10)),
      csv
    );
  }

  const headerActions: PageHeadingAction[] = [
    {
      label: filterOpen ? "Hide filter" : "Filter",
      disabledReason: loadingMaterials ? "Loading…" : materials.length === 0 ? "No materials to filter" : undefined,
      onClick: () => setFilterOpen((open) => !open),
    },
    {
      label: "Export",
      disabledReason: loadingMaterials ? "Loading…" : visibleMaterials.length === 0 ? "No rows" : undefined,
      onClick: exportMaster,
    },
    {
      // R67 D-37: the label itself carries the in-flight state, so the click is
      // never silent while the route resolves.
      label: openingNew ? "Opening…" : "+ New Material",
      variant: "default",
      disabledReason: readOnlyReason ?? (loadingMaterials ? "Loading…" : undefined),
      disabled: openingNew,
      onClick: openNewMaterial,
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

      {/* R67 D-38: rose is this product's only loud colour and it is used here
          for the one thing the user must know before they try to type: this
          project's ledger is history now. */}
      {readOnlyReason && (
        <p
          role="status"
          className="rounded-md border px-3 py-2 text-[13px]"
          style={{ borderColor: "var(--color-veri-status-late)", color: "var(--color-veri-status-late)" }}
        >
          {readOnlyReason}
        </p>
      )}

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
        {/* R67 D-40: the OUT side of the same ledger. Without it "On hand" on
            the master would be a number nobody could ever move. */}
        <TabsTrigger value="issues">Issues</TabsTrigger>
        <TabsTrigger value="cost-report">Cost Report</TabsTrigger>
      </TabsList>

      <TabsContent value="master" className="space-y-4">
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadingMaterials ? (
              <SkeletonTable
                headers={[...columns.map((col) => col.label), "Open"]}
                rows={3}
                caption={`Loading materials for ${projectName}…`}
              />
            ) : loadErrors.materials ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.materials]} onRetry={loadMaterials} /></div>
            ) : materials.length === 0 ? (
              // R67 D-37: an empty state that only says "nothing here" leaves
              // the user to find the way in themselves. Every empty tab now
              // carries its own next step.
              <p className="flex flex-wrap items-center justify-center gap-1 py-10 text-center text-sm text-px-muted">
                <span>No materials in the master yet —</span>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  disabled={!!readOnlyReason}
                  title={readOnlyReason}
                  onClick={openNewMaterial}
                >
                  {openingNew ? "Opening…" : "+ New Material"}
                </Button>
              </p>
            ) : visibleMaterials.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No materials match this filter.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead key={col.field} className={RIGHT_ALIGNED_FIELDS.has(col.field) ? "text-right" : undefined}>{col.label}</TableHead>
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
                        // R67 D-38: inline editing is a write, so it is off on a
                        // read-only project like every other write here.
                        const editable = !readOnlyReason && INLINE_EDITABLE_FIELDS.has(col.field);
                        return (
                          <TableCell
                            key={col.field}
                            className={RIGHT_ALIGNED_FIELDS.has(col.field) ? "text-right tabular-nums" : undefined}
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
              "Record Receipt" Dialog popup with a real create route.
              R67 D-37: the button stays VISIBLE when the master is empty --
              hiding it makes the module look like it has no receipts feature at
              all -- and says what has to happen first, as a link to the place
              it happens. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              data-testid="materials-record-receipt"
              disabled={!!readOnlyReason || loadingMaterials || materials.length === 0}
              title={readOnlyReason}
              onClick={() => { setFooterMessage(null); navigate(`/materials/receipts/new?projectId=${projectId}`); }}
            >
              <Plus className="size-4" /> {readOnlyReason ? `Record Receipt (${readOnlyReason})` : "Record Receipt"}
            </Button>
            {!readOnlyReason && !loadingMaterials && materials.length === 0 && (
              <Button variant="link" size="sm" className="h-auto px-0" onClick={openNewMaterial}>
                Add a material first
              </Button>
            )}
          </div>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadingReceipts ? (
              <SkeletonTable
                headers={["Date", "Material", "Vendor", "Reference", "Quantity", "Unit Cost"]}
                rows={3}
                caption={`Loading receipts for ${projectName}…`}
              />
            ) : loadErrors.receipts ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.receipts]} onRetry={loadReceipts} /></div>
            ) : visibleReceipts.length === 0 ? (
              materialFilter ? (
                <p className="py-10 text-center text-sm text-px-muted">
                  {`No receipts recorded for ${materialName(materialFilter)} yet.`}
                </p>
              ) : (
                <p className="flex flex-wrap items-center justify-center gap-1 py-10 text-center text-sm text-px-muted">
                  <span>No receipts recorded yet —</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    disabled={materials.length === 0}
                    onClick={() => { setFooterMessage(null); navigate(`/materials/receipts/new?projectId=${projectId}`); }}
                  >
                    Record Receipt
                  </Button>
                </p>
              )
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
                    {/* R67 D-57: qty x unit cost. Without it the ledger asks the
                        reader to multiply in their head on every row, and the
                        tab's own totals row would have nothing to total. */}
                    <TableHead className="text-right">Line total</TableHead>
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
                        onClick={() => { setFooterMessage(null); navigate(`/materials/receipts/${r.id}`); }}
                      >
                        <TableCell className="text-px-muted">{formatDateNumeric(r.receivedDate)}</TableCell>
                        <TableCell className="font-medium">{materialName(r.materialId)}</TableCell>
                        <TableCell className="text-px-muted">{vendorName(r.vendorId)}</TableCell>
                        <TableCell className="text-px-muted">{r.reference ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatQty(r.quantity)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(r.unitCost, currencies)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(lineTotal(r), currencies)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="issues" className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            data-testid="materials-record-issue"
            disabled={!!readOnlyReason || loadingMaterials || materials.length === 0}
            title={readOnlyReason}
            onClick={() => { setFooterMessage(null); navigate(`/materials/issues/new?projectId=${projectId}`); }}
          >
            <Plus className="size-4" /> {readOnlyReason ? `Record Issue (${readOnlyReason})` : "Record Issue"}
          </Button>
          {!readOnlyReason && !loadingMaterials && materials.length === 0 && (
            <Button variant="link" size="sm" className="h-auto px-0" onClick={openNewMaterial}>
              Add a material first
            </Button>
          )}
        </div>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadingIssues ? (
              <SkeletonTable
                headers={["Date", "Material", "Issued to", "BOQ item", "Quantity"]}
                rows={3}
                caption={`Loading issues for ${projectName}…`}
              />
            ) : loadErrors.issues ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.issues]} onRetry={loadIssues} /></div>
            ) : issues.length === 0 ? (
              <p className="flex flex-wrap items-center justify-center gap-1 py-10 text-center text-sm text-px-muted">
                <span>Nothing issued to site yet —</span>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  disabled={!!readOnlyReason || materials.length === 0}
                  onClick={() => { setFooterMessage(null); navigate(`/materials/issues/new?projectId=${projectId}`); }}
                >
                  Record Issue
                </Button>
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Issued to</TableHead>
                    <TableHead>BOQ item</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((issue) => (
                    <TableRow key={issue.id}>
                      <TableCell className="text-px-muted">{formatDateNumeric(issue.issuedDate)}</TableCell>
                      <TableCell className="font-medium">{materialName(issue.materialId)}</TableCell>
                      <TableCell className="text-px-muted">{issue.issuedTo ?? "—"}</TableCell>
                      <TableCell className="text-px-muted">{issue.boqLineItemId ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(issue.quantity)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="cost-report" className="space-y-4">
        <p className="text-[13px] text-px-muted">{COST_REPORT_NOTE}</p>

        {/* R67 D-57: the parameter bar. The window is applied SERVER-side (the
            aggregate is grouped with the same predicate that excludes voided
            receipts), so a month's report does not get slower as the project's
            history grows. */}
        <Card className="shadow-card">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="cost-report-from" className="text-[12px] text-px-muted">From</Label>
              <Input
                id="cost-report-from"
                type="date"
                className="h-9 w-44"
                value={reportFrom}
                onChange={(event) => setReportFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost-report-to" className="text-[12px] text-px-muted">To</Label>
              <Input
                id="cost-report-to"
                type="date"
                className="h-9 w-44"
                value={reportTo}
                onChange={(event) => setReportTo(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={loadingReport}
              data-testid="cost-report-apply"
              onClick={() => void loadReport({ from: reportFrom, to: reportTo })}
            >
              {loadingReport ? "Running…" : "Apply"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loadingReport}
              onClick={() => {
                const from = defaultReportFrom(receipts);
                setReportFrom(from);
                setReportTo(new Date().toISOString().slice(0, 10));
                void loadReport({ from, to: new Date().toISOString().slice(0, 10) });
              }}
            >
              Whole project
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loadingReport || report.length === 0}
              title={report.length === 0 ? "Nothing to export" : undefined}
              data-testid="cost-report-export"
              onClick={exportCostReport}
            >
              {report.length === 0 ? "Export (Nothing to export)" : "Export"}
            </Button>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadingReport ? (
              <SkeletonTable
                headers={["Material", "Unit", "Total Qty Received", "Total Cost", "Avg Unit Cost", "Master Unit Cost", "Variance vs master"]}
                rows={3}
                caption={`Loading the cost report for ${projectName}…`}
              />
            ) : loadErrors.report ? (
              <div className="p-4"><DataLoadError messages={[loadErrors.report]} onRetry={() => void loadReport({ from: reportFrom, to: reportTo })} /></div>
            ) : report.length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">
                No receipts to report yet — the Cost Report fills in as receipts are recorded
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Total Qty Received</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead className="text-right">Avg Unit Cost</TableHead>
                    <TableHead className="text-right">Master Unit Cost</TableHead>
                    <TableHead className="text-right">Variance vs master</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.map((r) => {
                    const master = materials.find((m) => m.id === r.materialId);
                    const masterCost = master ? Number(master.unitCost) : NaN;
                    const variance = Number.isFinite(masterCost) ? r.averageUnitCost - masterCost : null;
                    return (
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
                        <TableCell className="text-right tabular-nums">
                          {master ? formatMoney(master.unitCost, currencies) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {variance === null ? (
                            "—"
                          ) : variance > 0 ? (
                            // Never colour alone: the clay glyph AND the word.
                            <span className="text-[color:var(--color-veri-status-needs-you)]">
                              ▲ over {formatMoney(variance, currencies)}
                            </span>
                          ) : variance < 0 ? (
                            <span className="text-px-muted">▼ under {formatMoney(Math.abs(variance), currencies)}</span>
                          ) : (
                            <span className="text-px-muted">on plan</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* R67 D-57: a report with no total is a list, not a report. */}
                  <TableRow className="font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">
                      {formatQty(report.reduce((sum, r) => sum + r.totalQuantityReceived, 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Math.round(report.reduce((sum, r) => sum + r.totalCost, 0) * 100) / 100, currencies)}
                    </TableCell>
                    {/* Averages do not add up, and a sum of averages is a number
                        that means nothing -- so these three stay blank. */}
                    <TableCell />
                    <TableCell />
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
      </Tabs>

      {/* R67 D-35/D-37: the persistent footer message area. An inline-edit
          failure or a navigation that never arrived is reported HERE, where it
          stays until the next action, rather than in a toast that has gone by
          the time the user looks up. It sits outside the Tabs so a message
          raised on one tab is not hidden by switching to another. */}
      {footerMessage && (
        <p role="alert" className="text-[13px] text-px-error">{footerMessage}</p>
      )}
    </div>
  );
}
