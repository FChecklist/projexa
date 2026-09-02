"use client";

//
// R67 F-18: the revision list now normally arrives as a prop, fetched by
// scope/page.tsx on the server inside its Suspense boundary, so the table
// paints filled on first render.
//
// R67 F-23 (audit recommendation R-239): the per-revision compare fan-out that
// used to live here is GONE. This screen made one `/api/scope/{id}/compare`
// request per revision -- each of which opened its own tenant transaction
// upstream -- purely to fill the "Variation vs. prior" cell, and /scope reached
// idle at 7.6 s over 22 calls as a result. VERIDIAN now returns
// `variationVsPrior` (and `lineDelta`) with the list itself, computed in one
// grouped statement over construction_boq_line_items. The Compare BUTTON still
// fetches the full diff on demand -- that is the detail view, and it is one
// deliberate click, not a page-load cost.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, GitCompare, GitBranchPlus } from "lucide-react";
import { useCurrencies } from "@/lib/currency";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { BOQ_LIST_COLUMNS } from "@/lib/module-list-columns";
import { type ModuleListInitial } from "@/lib/module-list-state";
import DataLoadError from "@/components/DataLoadError";
import ListScreenFrame from "@/components/ListScreenFrame";

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
// R67 F-18: the fallback labels moved to src/lib/module-list-columns.ts so
// this screen's loading skeleton draws the same column heads this table does.

function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

// Exported so scope/page.tsx can type the rows it fetches server-side.
export type Boq = {
  id: string;
  version: number;
  title: string;
  status: string;
  parentBoqId: string | null;
  createdAt: string;
  // R67 F-23: sum(quantity x rate) on this revision minus the same on its
  // parent, computed by VERIDIAN in the list query. null on a baseline (there
  // is no prior to vary from); undefined only if an older backend answered
  // without ?include=variation, which renders exactly as null does.
  variationVsPrior?: number | null;
  /** line-item count difference vs the parent revision; null on a baseline. */
  lineDelta?: number | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary", submitted: "default", approved: "outline", superseded: "destructive",
};

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

// R67 F-23: an explicit sign on both directions -- a variation is a change, and
// "1,005" beside "-1,005" reads as a total unless the increase says so too.
// Grouped with the same "en-US" plain-thousands convention every other money
// cell in this app uses (TC-90: no lakh/crore grouping, no hardcoded symbol).
function formatVariation(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

// Real-screen conversion (2026-08-30): this list's own line-item-level
// helpers (create/revise line drafting, budget/vendor overlay, derived
// sub-task qty/rate) moved to src/lib/boq-helpers.ts, shared by the new
// ScopeObjectClient/ScopeCreateClient/ScopeReviseClient/ScopeCompareClient
// screens -- the "View"/"New BOQ"/"New Revision"/"Compare" Dialogs that used
// to live in this file are gone, replaced by real routes. This List Report
// only needs the list-row shape and the per-row variation figure.

export default function ScopeClient({
  projectId,
  listColumns,
  initial = null,
}: {
  projectId: string;
  listColumns?: RegistryColumn[] | null;
  initial?: ModuleListInitial<Boq>;
}) {
  const router = useRouter();
  const boqListColumns = listColumns && listColumns.length > 0 ? listColumns : BOQ_LIST_COLUMNS;
  const [boqs, setBoqs] = useState<Boq[]>(initial?.rows ?? []);
  const [loading, setLoading] = useState(initial === null);
  const [loadError, setLoadError] = useState<string | null>(initial?.errorMessage ?? null);
  // The list the server sent answers THIS project; a switch still fetches.
  const listFromServerFor = useRef(initial ? projectId : null);

  // R67 F-23: variation vs. the immediate parent is no longer a piece of
  // per-row client state at all -- it arrives on the row (b.variationVsPrior),
  // computed at read time by VERIDIAN in the same statement that grouped the
  // line items. Still derived, never denormalized: this codebase computes
  // diffs at read time, and that has not changed -- only WHERE.

  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  const load = useCallback(async (signal?: AbortSignal) => {
    const listAlreadyLoaded = listFromServerFor.current === projectId;
    if (!listAlreadyLoaded) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      if (listAlreadyLoaded) {
        // The server already fetched this exact list, variation included --
        // there is nothing left to go to the network for.
        listFromServerFor.current = null;
        return;
      }
      const data = await fetchJson(`/api/scope?projectId=${encodeURIComponent(projectId)}&include=variation`, {
        signal: signal ?? AbortSignal.timeout(LOAD_TIMEOUT_MS),
      });
      if (signal?.aborted) return;
      setBoqs(data.boqs ?? []);
    } catch (err) {
      // A cancelled read is not a failure and must not reach a screen the
      // user has already left.
      if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) return;
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
      if (!signal?.aborted) setLoading(false);
    }
    // `initial` is intentionally not a dependency: it is a server payload
    // object, read only on the seeded first run, and listing it would re-run
    // the whole load on every server re-render.
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New BOQ"
            Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/scope/new?projectId=${projectId}`)}><Plus className="size-4" /> New BOQ</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {/* R67 F-31: data-state / aria-busy on the region, and after 3 s the
              wait says "Still loading BOQ revisions… <n> s" -- this is the
              screen R66 caught spinning forever with nothing to read and no
              way to retry. */}
          <ListScreenFrame
            label="BOQ revisions"
            loading={loading}
            error={loadError}
            rowCount={boqs.length}
            onRetry={() => void load()}
          >
          {loadError ? (
            <DataLoadError messages={[loadError]} onRetry={load} />
          ) : boqs.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No BOQs yet for this project.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{columnLabel(boqListColumns, "title", "Title")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "version", "Version")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "status", "Status")}</TableHead>
                  <TableHead className="text-right">{columnLabel(boqListColumns, "variation", "Variation vs. prior")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "createdAt", "Created")}</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boqs.map((b) => {
                  const variation = b.variationVsPrior;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.title}</TableCell>
                      <TableCell className="text-px-muted">v{b.version}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge></TableCell>
                      {/* R67 F-23: right-aligned (it is money), signed, in the
                          org's own currency; an en-dash for a revision with no
                          prior to vary from. */}
                      <TableCell className="text-right tabular-nums">
                        {!b.parentBoqId ? (
                          <span className="text-px-muted">Baseline (Rev0)</span>
                        ) : variation === undefined || variation === null ? (
                          <span className="text-px-muted">–</span>
                        ) : (
                          <span className={variation > 0 ? "text-px-success" : variation < 0 ? "text-px-error" : "text-px-muted"}>{currencyCode ? `${currencyCode} ` : ""}{formatVariation(variation)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-px-muted">{formatDate(b.createdAt)}</TableCell>
                      <TableCell className="text-right space-x-1">
                        {/* Real screen navigation (2026-08-30) -- replaces the old
                            "View" Dialog popup with a real Object Page route,
                            same as PermitObjectClient's proven pattern. */}
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/scope/${b.id}`)}>View</Button>
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/scope/${b.id}/compare`)}><GitCompare className="size-3.5" /> Compare</Button>
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/scope/${b.id}/revise`)}><GitBranchPlus className="size-3.5" /> New Revision</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          </ListScreenFrame>
        </CardContent>
      </Card>
    </div>
  );
}
