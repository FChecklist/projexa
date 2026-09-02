"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { useCurrencies } from "@/lib/currency";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDayMonthYear } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import {
  boqStatusChip, buildLineageRows, columnDecimals, variationCell,
  type LineageBoq,
} from "@/lib/boq-lineage";

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
//
// R67 D-23: "variation" is now explicitly "Variation vs prior" and a SECOND
// signed column, "variationVsOriginal", joins it -- both registered here so
// their labels stay editable from the boq.custom registry row with no
// redeploy, exactly like every other column on this screen.
const DEFAULT_LIST_COLUMNS: ScreenColumn[] = [
  { field: "title", label: "Title", type: "text", importance: "High" },
  { field: "version", label: "Version", type: "text", importance: "High" },
  { field: "status", label: "Status", type: "text", importance: "High" },
  { field: "variationVsOriginal", label: "Variation vs original", type: "text", importance: "High" },
  { field: "variation", label: "Variation vs prior", type: "text", importance: "High" },
  { field: "createdAt", label: "Created", type: "date", importance: "High" },
];

function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

// R67 D-23: the list row shape. totalVariation / totalVariationVsOriginal are
// OPTIONAL because they are what WS-F's C02-14 adds to the /scope list payload;
// until that lands this component derives the same two figures itself from the
// compare endpoint (loadVariations below), so the columns are populated either
// way and neither half has to wait for the other.
type Boq = LineageBoq;

type BoqComparison = { totalVariation: number };

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

  // Variation vs. the immediate parent AND vs. the lineage's original, per
  // revision -- fetched from VERIDIAN's compareBoq rather than stored (this
  // codebase computes diffs at read time, never denormalizes them). Only used
  // as the fallback for rows whose payload did not already carry the figure.
  const [variationByBoqId, setVariationByBoqId] = useState<Record<string, number>>({});
  const [originalVariationByBoqId, setOriginalVariationByBoqId] = useState<Record<string, number>>({});

  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<{ boqs?: Boq[] }>(`/api/scope?projectId=${encodeURIComponent(projectId)}`, {
        signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
      });
      const loaded: Boq[] = data.boqs ?? [];
      setBoqs(loaded);
      await loadVariations(loaded);
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

  /**
   * Fallback only. A row whose payload already carries totalVariation /
   * totalVariationVsOriginal costs nothing here; a row that does not is
   * compared against its own parent and against its lineage root, which is
   * exactly what those two columns mean. A failed comparison leaves the cell
   * as the honest em dash rather than a fabricated zero.
   */
  async function loadVariations(loaded: Boq[]) {
    const byId = new Map(loaded.map((b) => [b.id, b]));
    const rows = buildLineageRows(loaded);
    const prior: Record<string, number> = {};
    const original: Record<string, number> = {};

    await Promise.all(
      rows.map(async (row) => {
        const { boq, rootId } = row;
        if (!boq.parentBoqId || !byId.has(boq.parentBoqId)) return;
        const needsPrior = typeof boq.totalVariation !== "number";
        const needsOriginal = typeof boq.totalVariationVsOriginal !== "number" && rootId !== boq.parentBoqId;
        await Promise.all([
          needsPrior
            ? fetchComparison(`/api/scope/${boq.id}/compare`).then((v) => { if (v !== null) prior[boq.id] = v; })
            : Promise.resolve(),
          needsOriginal
            ? fetchComparison(`/api/scope/${boq.id}/compare?against=${encodeURIComponent(rootId)}`).then((v) => { if (v !== null) original[boq.id] = v; })
            : Promise.resolve(),
        ]);
      })
    );

    setVariationByBoqId(prior);
    setOriginalVariationByBoqId(original);
  }

  async function fetchComparison(url: string): Promise<number | null> {
    try {
      const cmp = await fetchJson<BoqComparison>(url, { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) });
      return typeof cmp.totalVariation === "number" ? cmp.totalVariation : null;
    } catch {
      // An unavailable comparison is a genuinely unknown variation -- the cell
      // renders the em dash titled "Variation unavailable". It must never fail
      // the whole list, and it must never become "AED 0".
      return null;
    }
  }

  useEffect(() => { load(); }, [projectId]);

  const rows = useMemo(() => buildLineageRows(boqs), [boqs]);

  /** vs prior: the payload's own figure when present, this component's compare fallback otherwise. */
  function priorVariation(boq: Boq): number | null | undefined {
    if (typeof boq.totalVariation === "number") return boq.totalVariation;
    return variationByBoqId[boq.id];
  }

  /**
   * vs original: the payload's own figure when present; for the FIRST revision
   * of a lineage the parent IS the original, so "vs prior" answers it exactly;
   * otherwise this component's own root comparison.
   */
  function originalVariation(boq: Boq, rootId: string): number | null | undefined {
    if (typeof boq.totalVariationVsOriginal === "number") return boq.totalVariationVsOriginal;
    if (boq.parentBoqId === rootId) return priorVariation(boq);
    return originalVariationByBoqId[boq.id];
  }

  // "the same decimals down the column" -- decided once per column, over every
  // figure actually on screen, so the digits line up under each other.
  const priorDecimals = columnDecimals(rows.map((r) => priorVariation(r.boq)));
  const originalDecimals = columnDecimals(rows.map((r) => originalVariation(r.boq, r.rootId)));

  function openBoq(id: string) {
    router.push(`/scope/${id}`);
  }

  return (
    <div className="space-y-4">
      {/* R67 D-23: the header row the audit asked for -- Filter | Export |
          Import | + New BOQ. Filter and Export are RENDERED and disabled with
          the reason beside them (the disabled-by-condition rule) rather than
          being absent, so a user can tell a not-yet-built feature from a
          broken one. Import routes to the real /scope/import screen. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled title="Not yet available">
          Filter <span className="text-[11px] font-normal">(Not yet available)</span>
        </Button>
        <Button variant="outline" size="sm" disabled title="Not yet available">
          Export <span className="text-[11px] font-normal">(Not yet available)</span>
        </Button>
        <Button variant="outline" size="sm" onClick={() => router.push(`/scope/import?projectId=${projectId}`)}>
          Import
        </Button>
        <Button onClick={() => router.push(`/scope/new?projectId=${projectId}`)}><Plus className="size-4" /> New BOQ</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <DataLoadError messages={[loadError]} onRetry={load} />
          ) : rows.length === 0 ? (
            <div className="space-y-3 py-10 text-center">
              <p className="text-sm text-px-muted">No BOQs yet for this project. Import an Excel or create one.</p>
              <div className="flex items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => router.push(`/scope/import?projectId=${projectId}`)}>Import</Button>
                <Button size="sm" onClick={() => router.push(`/scope/new?projectId=${projectId}`)}>+ New BOQ</Button>
              </div>
            </div>
          ) : (
            // The table is the only thing allowed to scroll sideways -- the
            // PAGE must never gain a horizontal scrollbar because one action
            // cell is wide.
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{columnLabel(boqListColumns, "title", "Title")}</TableHead>
                    <TableHead>{columnLabel(boqListColumns, "version", "Version")}</TableHead>
                    <TableHead>{columnLabel(boqListColumns, "status", "Status")}</TableHead>
                    <TableHead className="text-right">{columnLabel(boqListColumns, "variationVsOriginal", "Variation vs original")}</TableHead>
                    <TableHead className="text-right">{columnLabel(boqListColumns, "variation", "Variation vs prior")}</TableHead>
                    <TableHead>{columnLabel(boqListColumns, "createdAt", "Created")}</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ boq: b, depth, revLabel, isRoot, isCurrent, rootId }) => {
                    const chip = boqStatusChip(b.status);
                    const vsPrior = variationCell(priorVariation(b), currencyCode, priorDecimals);
                    const vsOriginal = variationCell(originalVariation(b, rootId), currencyCode, originalDecimals);
                    return (
                      <TableRow
                        key={b.id}
                        // The whole row is the link, and it is reachable from
                        // the keyboard: Enter or Space on the focused row opens
                        // it, exactly as clicking it does. Hovering warms the
                        // route so the object page is already fetched by the
                        // time the click lands.
                        role="link"
                        tabIndex={0}
                        aria-label={`${b.title} ${revLabel}`}
                        className="cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-px-steel"
                        onClick={() => openBoq(b.id)}
                        onMouseEnter={() => router.prefetch(`/scope/${b.id}`)}
                        onFocus={() => router.prefetch(`/scope/${b.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBoq(b.id); }
                        }}
                      >
                        <TableCell className={depth === 1 ? "pl-8" : undefined}>
                          <Link
                            href={`/scope/${b.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className={isRoot ? "font-medium text-px-ink" : "text-px-slate"}
                          >
                            {b.title}
                          </Link>
                          {isRoot && <span className="ml-2 text-[11px] text-px-muted">original</span>}
                          {isCurrent && <span className="ml-2 rounded-sm border border-px-border2 px-1 text-[10px] uppercase tracking-wide text-px-muted">Current</span>}
                        </TableCell>
                        <TableCell className="text-px-muted tabular-nums">{revLabel}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 text-[12.5px] ${chip.className}`}>
                            <span aria-hidden="true">{chip.glyph}</span>{chip.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <VariationText cell={vsOriginal} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <VariationText cell={vsPrior} />
                        </TableCell>
                        <TableCell className="text-px-muted">{formatDayMonthYear(b.createdAt)}</TableCell>
                        <TableCell className="min-w-[260px] whitespace-nowrap text-right">
                          {/* Words, never icons, and never allowed to wrap --
                              "New Revision" used to clip to "Ne". */}
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/scope/${b.id}`); }}>View</Button>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/scope/${b.id}/compare`); }}>Compare</Button>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/scope/${b.id}/revise`); }}>New Revision</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const VARIATION_TONE: Record<string, string> = {
  up: "text-px-success",
  down: "text-px-error",
  flat: "text-px-muted",
  unknown: "text-px-muted",
};

function VariationText({ cell }: { cell: ReturnType<typeof variationCell> }) {
  return (
    <span className={VARIATION_TONE[cell.kind]} title={cell.title}>
      <span aria-hidden="true">{cell.glyph}</span>
      {cell.text ? <> {cell.text}</> : null}
    </span>
  );
}
