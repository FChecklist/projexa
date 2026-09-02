"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Loader2, Plus, GitCompare, GitBranchPlus, Upload, ArrowDown, ArrowUp, Check, Archive, Clock, AlertTriangle, MoreHorizontal } from "lucide-react";
import { useCurrencies } from "@/lib/currency";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
// R67 lane D22 (item D-76, rec R-288): order and colour, both pure and tested.
import {
  DEFAULT_BOQ_SORT, boqStatusPill, boqVariation, nextBoqSort, sortBoqs,
  type BoqSort, type BoqSortField,
} from "@/lib/boq-list";

// R44 seq3 (M28 registry-model proof, same pattern as PermitsListClient's
// RegistryColumn): intentionally the same fields as ScreenColumn so a
// registry row (compliance.screen_definitions, function_id "boq.compare")
// can be passed straight in with no reshaping.
export type RegistryColumn = ScreenColumn;

// R46 P8 seq121 (M28 registry-model, CUSTOM archetype -- function_id
// "boq.custom"): the main BOQ table below stays a fully hand-rolled <Table>
// (not the kit's generic ListScreen -- revisions/variation/hierarchy don't
// fit a plain LIST renderer), but its column LABELS are now registry-driven
// the same way every other converted screen's are. Only label text reads
// from the registry row; the "Actions" column has no backing field and
// always stays hardcoded.
const DEFAULT_LIST_COLUMNS: ScreenColumn[] = [
  { field: "title", label: "Title", type: "text", importance: "High" },
  { field: "version", label: "Version", type: "text", importance: "High" },
  { field: "status", label: "Status", type: "text", importance: "High" },
  { field: "variation", label: "Variation vs. prior", type: "text", importance: "High" },
  { field: "createdAt", label: "Created", type: "date", importance: "High" },
];

function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

type Boq = {
  id: string;
  version: number;
  title: string;
  status: string;
  parentBoqId: string | null;
  createdAt: string;
  // R67 D-76: DE-15 widens GET /api/scope to carry each revision's own
  // variation. Optional here because that payload is not on this branch yet --
  // boqVariation() reads it when it appears and falls back to the per-row
  // /compare call until then. See its comment in src/lib/boq-list.ts.
  totalVariation?: number | null;
  variation?: number | null;
};

type BoqLineItemRow = {
  id: string; itemCode: string | null; description: string; unit: string;
  quantity: string; rate: string; amount: string; activityId: string | null;
  parentLineItemId?: string | null; breakdownPercentage?: string | null;
  // R39/R-C09: Point 154's budget overlay -- computedBudget is derived
  // server-side (amount * budgetPercentage / 100, construction-boq-
  // service.ts#computedBudget), never sent back independently editable.
  budgetPercentage?: string | null;
  computedBudget?: number | null;
  vendorId?: string | null;
  vendorAmount?: string | null;
};

type ChangedLineItem = {
  key: string; previous: BoqLineItemRow; current: BoqLineItemRow;
  // Sumeet audit fix (2026-08-30, requirement #18: "Percentage-only change
  // detected as a variation"). The real backend (construction-boq-
  // service.ts's compareBoq) has always sent this field on every changed
  // row -- this type just never declared it, so toCompareResult() below
  // could never read it even though it was already on the wire.
  quantityChange: number; rateChange: number; breakdownPercentageChange: number; netVariation: number;
};

type BoqComparison = {
  added: BoqLineItemRow[]; removed: BoqLineItemRow[]; changed: ChangedLineItem[];
  warnings: string[]; totalVariation: number;
};

// R67 lane D22 (item D-76, rec R-288). The old map lived here:
//   { draft: "secondary", submitted: "default", approved: "outline",
//     superseded: "destructive" }
// -- which painted a superseded revision in the DESTRUCTIVE (rose) variant.
// Rose in this system means rejected or late. A superseded revision is the
// ordinary consequence of raising the next one, and colouring it as a failure
// teaches a reader to stop trusting the colour on the rows where it matters.
// The tones now come from boq-list.ts, where the WS-G rule is unit-asserted.
const PILL_GLYPH = { tick: Check, archive: Archive, clock: Clock, alert: AlertTriangle } as const;

function StatusPill({ status }: { status: string }) {
  const pill = boqStatusPill(status);
  const Glyph = pill.glyph === "none" ? null : PILL_GLYPH[pill.glyph];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${pill.className}`}>
      {Glyph && <Glyph className="size-3" aria-hidden="true" />}
      {pill.label}
    </span>
  );
}

/** A sortable column header -- the arrow says which way, the word says what. */
function SortableHead({ label, field, sort, onSort, className }: { label: string; field: BoqSortField; sort: BoqSort; onSort: (field: BoqSortField) => void; className?: string }) {
  const active = sort.field === field;
  const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-label={`Sort by ${label}`}
        className="inline-flex items-center gap-1 hover:text-px-ink"
      >
        {label}
        {active && <Arrow className="size-3" aria-hidden="true" />}
      </button>
    </TableHead>
  );
}

// R66 visual QA (2026-09-02): reproduced live on a real project's BOQ list --
// the loading spinner never resolved to either real rows or the empty state
// below, across multiple reloads. Root cause: every fetch() in load() had NO
// timeout of its own. The Next.js routes it calls ARE already bounded
// (veridian-client.ts's fetchWithTimeout: 20s x up to 2 attempts server-side),
// but this component had no way to enforce that assumption -- if it ever
// breaks (a network-layer hang between browser and the server, a slow edge
// hop), `loading` had no way back to `false` and the UI spun forever with no
// retry affordance. Set comfortably above the server's own worst case (40s)
// so this never fires under normal slow-but-succeeding conditions, and only
// catches a genuine hang.
const LOAD_TIMEOUT_MS = 50_000;

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function formatVariation(amount: number): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// Real-screen conversion (2026-08-30): this list's own line-item-level
// helpers (create/revise line drafting, budget/vendor overlay, derived
// sub-task qty/rate) moved to src/lib/boq-helpers.ts, shared by the new
// ScopeObjectClient/ScopeCreateClient/ScopeReviseClient/ScopeCompareClient
// screens -- the "View"/"New BOQ"/"New Revision"/"Compare" Dialogs that used
// to live in this file are gone, replaced by real routes. This List Report
// only needs the list-row shape and the per-row variation figure.

export default function ScopeClient({ projectId, listColumns }: { projectId: string; listColumns?: RegistryColumn[] | null }) {
  const router = useRouter();
  const boqListColumns = listColumns && listColumns.length > 0 ? listColumns : DEFAULT_LIST_COLUMNS;
  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Variation vs. immediate parent, per revision -- the "running total
  // variation value" the Owner asked for, fetched from VERIDIAN's compareBoq
  // rather than stored (this codebase computes diffs at read time, never
  // denormalizes them).
  const [variationByBoqId, setVariationByBoqId] = useState<Record<string, number>>({});

  // R67 D-76: newest first on arrival, with an explicit Version toggle.
  const [sort, setSort] = useState<BoqSort>(DEFAULT_BOQ_SORT);

  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson(`/api/scope?projectId=${encodeURIComponent(projectId)}`, {
        signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
      });
      const loaded: Boq[] = data.boqs ?? [];
      setBoqs(loaded);

      // Only the revisions whose variation the list payload did NOT already
      // carry need the per-row /compare call. The day DE-15 lands, this loop
      // has nothing left to fetch and the N+1 disappears without a code change.
      const revisions = loaded.filter((b) => b.parentBoqId && boqVariation(b, {}) === undefined);
      const entries = await Promise.all(
        revisions.map(async (b) => {
          const cmpRes = await fetch(`/api/scope/${b.id}/compare`, { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) });
          if (!cmpRes.ok) return null;
          const cmp: BoqComparison = await cmpRes.json();
          return [b.id, cmp.totalVariation] as const;
        })
      );
      setVariationByBoqId(Object.fromEntries(entries.filter((e): e is readonly [string, number] => e !== null)));
    } catch (err) {
      // A timed-out AbortSignal surfaces as a bare "TimeoutError"/"AbortError"
      // with no useful .message -- errorMessage() would render something like
      // "Couldn't load scope of work: signal timed out". Give the timeout case
      // its own honest, actionable copy instead; every other failure keeps
      // the real backend reason via errorMessage() (C19 ERROR_TRUTHFUL).
      const msg = isTimeoutError(err)
        ? "Couldn't load scope of work: the construction data service is taking too long to respond. Retry."
        : errorMessage(err, "Couldn't load scope of work");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {/* R67 lane D22 (item D-52): the shipped BOQ importer finally has a
            way in. Disabled-with-reason rather than hidden when there is no
            project -- an action that silently disappears teaches nothing,
            and /scope/import needs a project to import into. */}
        <Button
          variant="outline"
          disabled={!projectId}
          title={projectId ? undefined : "Select a project first"}
          onClick={() => router.push(`/scope/import?projectId=${projectId}`)}
        >
          <Upload className="size-4" /> Import
        </Button>
        {!projectId && <span className="text-[12.5px] text-px-muted">Select a project first</span>}
        {/* Real screen navigation (2026-08-30) -- replaces the old "New BOQ"
            Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/scope/new?projectId=${projectId}`)}><Plus className="size-4" /> New BOQ</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <DataLoadError messages={[loadError]} onRetry={load} />
          ) : boqs.length === 0 ? (
            /* R67 lane D22 (item D-68): the empty state is exactly where
               somebody holding a priced BOQ spreadsheet arrives. */
            <div className="space-y-3 py-10 text-center">
              <p className="text-sm text-px-muted">No BOQs yet for this project.</p>
              <Button variant="outline" size="sm" disabled={!projectId} title={projectId ? undefined : "Select a project first"} onClick={() => router.push(`/scope/import?projectId=${projectId}`)}>
                <Upload className="size-4" /> Import a BOQ from Excel
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{columnLabel(boqListColumns, "title", "Title")}</TableHead>
                  <SortableHead label={columnLabel(boqListColumns, "version", "Version")} field="version" sort={sort} onSort={(f) => setSort((s) => nextBoqSort(s, f))} />
                  <TableHead>{columnLabel(boqListColumns, "status", "Status")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "variation", "Variation vs. prior")}</TableHead>
                  <SortableHead label={columnLabel(boqListColumns, "createdAt", "Created")} field="createdAt" sort={sort} onSort={(f) => setSort((s) => nextBoqSort(s, f))} />
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortBoqs(boqs, sort).map((b) => {
                  const variation = boqVariation(b, variationByBoqId);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.title}</TableCell>
                      <TableCell className="text-px-muted">v{b.version}</TableCell>
                      <TableCell><StatusPill status={b.status} /></TableCell>
                      <TableCell>
                        {!b.parentBoqId ? (
                          <span className="text-px-muted">Baseline (Rev0)</span>
                        ) : variation === undefined ? (
                          <span className="text-px-muted">—</span>
                        ) : (
                          <span className={variation > 0 ? "text-px-success" : variation < 0 ? "text-px-error" : "text-px-muted"}>{currencyCode ? `${currencyCode} ` : ""}{formatVariation(variation)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-px-muted whitespace-nowrap">{formatDate(b.createdAt)}</TableCell>
                      {/* R67 D-76: three side-by-side actions clipped out of the
                          table at 1440 px -- "New Revision" is the widest and
                          the least frequent, so it moves into a More menu and
                          the two everyday ones stay as words that fit. */}
                      <TableCell className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                          {/* Real screen navigation (2026-08-30) -- replaces the old
                              "View" Dialog popup with a real Object Page route,
                              same as PermitObjectClient's proven pattern. */}
                          <Button variant="ghost" size="sm" onClick={() => router.push(`/scope/${b.id}`)}>View</Button>
                          <Button variant="ghost" size="sm" onClick={() => router.push(`/scope/${b.id}/compare`)}><GitCompare className="size-3.5" /> Compare</Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" aria-label={`More actions for ${b.title}`}>
                                <MoreHorizontal className="size-3.5" aria-hidden="true" /> More
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => router.push(`/scope/${b.id}/revise`)}>
                                <GitBranchPlus className="size-3.5" aria-hidden="true" /> New Revision
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
