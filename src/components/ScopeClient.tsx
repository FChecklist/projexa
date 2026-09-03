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
//
// R67 MERGE (lane D0 x lane F2). Both lanes rewrote this screen's waiting
// behaviour. Under decision D-11 the version on main is canonical, so the
// PRESENTATION is lane D0's: PaneState, the four-state vocabulary, the
// project-named empty sentence, "as of 14:32" over rows kept through a failed
// refresh, and recordCountLabel's en-dash for a count nobody has. The DATA
// PATH is lane F2's: seeded from the server, one list call with
// ?include=variation, and no per-row fan-out. F-31's machine-readable
// data-state is not lost either -- it was folded into PaneState itself, so it
// now covers every screen rather than the thirteen F2 had converted.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusPill, StatusPillTone, type SemanticStatus } from "@/components/ui/status-pill";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
// Loader2 is gone with G-05's spinner: F-31/D-65 replaced that bare spinner
// with PaneState, which says WHAT is loading and for how long. useCurrencies
// is gone too -- G-05's useOrgMoney() resolves the org's currency itself, and
// this file no longer formats any money by hand.
import { Plus, GitCompare, GitBranchPlus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
// R67 D-74 keeps the ORG date form; R67 G-05 owns the money.
import { formatDate } from "@/lib/format";
import { EMPTY_VALUE, MONEY_CELL_CLASS } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import { BOQ_LIST_COLUMNS } from "@/lib/module-list-columns";
import { type ModuleListInitial } from "@/lib/module-list-state";
import PaneState from "@/components/PaneState";
import { recordCountLabel, type PaneStatus } from "@/lib/pane-state";

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
  // R67 F-29: the compare summary, from the same upstream statement. Absent
  // only if an older backend answered without ?include=compare, which renders
  // exactly as "we don't know" rather than as a zero.
  compare?: {
    lineCount: number;
    total: number;
    /** total(this) - total(parent); null on a baseline. */
    deltaAmount: number | null;
    /** That delta as a percent of the parent's total; null on a baseline or a zero-total parent. */
    deltaPct: number | null;
  };
};

// R67 G-05 (R-260). This was shadcn Badge variants, and the worst of them was
// `superseded: "destructive"` -- a BRIGHT RED badge on every superseded BOQ
// revision. Rose is reserved for late and error; a superseded revision is not
// a fault, it is history, and painting it red made every project with a
// revision look like it had a problem. `submitted: "default"` was the saffron
// primary fill, which made a passive state look like the screen's one action.
// Both now come from the single status map in ui/status-pill.tsx.
const BOQ_STATUS: Record<string, SemanticStatus> = {
  draft: "draft",
  submitted: "running",
  approved: "current",
  superseded: "superseded",
};

// R66 visual QA (2026-09-02): reproduced live on a real project's BOQ list --
// the loading spinner never resolved to either real rows or the empty state
// below, across multiple reloads. Root cause: every fetch() in load() had NO
// timeout of its own. The Next.js routes it calls ARE already bounded
// (veridian-client.ts's fetchWithTimeout), but this component had no way to
// enforce that assumption -- if it ever breaks (a network-layer hang between
// browser and the server, a slow edge hop), the pane had no way back out of
// `loading` and the UI spun forever with no retry affordance.
const LOAD_TIMEOUT_MS = 50_000;

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

// R67 G-05 / D-74: formatVariation() lived here and passed `undefined` as the
// locale -- the exact hydration bug src/lib/format-date.ts exists to prevent,
// since the server formats in ITS locale and the browser in the visitor's. It
// also carried its meaning in colour (green for up, red for down). Both are
// gone: the figure now comes from the one money formatter, and its DIRECTION
// is a glyph plus an explicit sign ("▲ AED +2,025"), rendered in ink.
//
// F-23's and F-29's own formatVariation()/formatMoney() went the same way and
// for the same reason -- they hardcoded "en-US" and prepended a bare currency
// code -- so this file now formats no money by hand at all. What F-29 keeps is
// the PERCENTAGE, which is not money and which G-05's formatter has no notion
// of.

// R67 F-29: "+1,005" alone says nothing about whether that is a rounding error
// or a doubling of the contract, so the percentage rides beside it. null is
// rendered by the caller as an en-dash -- never as "0%", which would state
// that nothing changed when in fact nothing is KNOWN to have changed.
export function formatDeltaPct(pct: number | null | undefined): string | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
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
  projectName,
  listColumns,
  initial = null,
}: {
  projectId: string;
  projectName?: string | null;
  listColumns?: RegistryColumn[] | null;
  initial?: ModuleListInitial<Boq>;
}) {
  const router = useRouter();
  const boqListColumns = listColumns && listColumns.length > 0 ? listColumns : BOQ_LIST_COLUMNS;
  const [boqs, setBoqs] = useState<Boq[]>(initial?.rows ?? []);
  // R67 D-65: a boolean plus a message string could not express "the rows on
  // screen are from an earlier read", which is the state this pane is in
  // most often -- /scope is the slowest read in the product (the N+1
  // transactions the repo map records). R67 F-18: a payload the SERVER
  // already fetched starts ANSWERED, never loading -- and a server-side
  // failure starts as `error`, so the screen says why rather than sitting on
  // a spinner that will never resolve.
  const [status, setStatus] = useState<PaneStatus>(
    initial ? (initial.errorMessage ? "error" : "ready") : "loading"
  );
  const [readError, setReadError] = useState<{ status: number | null; message: string | null } | null>(
    initial?.errorMessage ? { status: null, message: initial.errorMessage } : null
  );
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(initial && !initial.errorMessage ? new Date() : null);
  // The list the server sent answers THIS project; a switch still fetches.
  const listFromServerFor = useRef(initial ? projectId : null);

  // R67 F-23: variation vs. the immediate parent is no longer a piece of
  // per-row client state at all -- it arrives on the row (b.variationVsPrior),
  // computed at read time by VERIDIAN in the same statement that grouped the
  // line items. Still derived, never denormalized: this codebase computes
  // diffs at read time, and that has not changed -- only WHERE.

  const orgMoney = useOrgMoney();

  const load = useCallback(async (signal?: AbortSignal) => {
    if (listFromServerFor.current === projectId) {
      // The server already fetched this exact list, variation included --
      // there is nothing left to go to the network for.
      listFromServerFor.current = null;
      return;
    }
    setStatus("loading");
    setStartedAt(Date.now());
    setReadError(null);
    try {
      const data = await fetchJson(`/api/scope?projectId=${encodeURIComponent(projectId)}&include=variation`, {
        signal: signal ?? AbortSignal.timeout(LOAD_TIMEOUT_MS),
      });
      if (signal?.aborted) return;
      setBoqs(data.boqs ?? []);
      setLoadedAt(new Date());
      setStatus("ready");
    } catch (err) {
      // A cancelled read is not a failure and must not reach a screen the
      // user has already left.
      if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) return;
      // A timed-out AbortSignal surfaces as a bare "TimeoutError"/"AbortError"
      // with no useful .message. The shared dictionary
      // (src/lib/task-errors.ts) classifies that as UPSTREAM_TIMEOUT and
      // writes the sentence, so the special case here is only about handing
      // it words it can classify -- the copy itself is no longer this
      // screen's to invent (C19 ERROR_TRUTHFUL, one vocabulary per D-65).
      setReadError({
        status: err instanceof ApiError ? err.status : null,
        message: isTimeoutError(err)
          ? "The construction data service timed out."
          : err instanceof Error && err.message
            ? err.message
            : null,
      });
      setStatus("error");
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

      <p className="px-1 text-[12px] text-px-muted">{recordCountLabel(status, boqs.length)}</p>

      <Card className="shadow-card">
        <CardContent className="p-4">
          <PaneState
            status={status}
            entity="the scope of work"
            projectName={projectName}
            startedAt={startedAt}
            error={readError}
            rowCount={boqs.length}
            skeletonColumns={[...boqListColumns.map((c) => c.label), "Actions"]}
            emptyMessage={`No BOQs yet for ${projectName ?? "this project"}.`}
            emptyAction={
              <Button size="sm" onClick={() => router.push(`/scope/new?projectId=${projectId}`)}>
                <Plus className="size-4" /> New BOQ
              </Button>
            }
            lastLoadedAt={loadedAt}
            onRetry={() => void load()}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{columnLabel(boqListColumns, "title", "Title")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "version", "Version")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "status", "Status")}</TableHead>
                  {/* R67 F-29: both of these arrive on the list row now.
                      R67 G-05: the unit lives in the column header, not
                      repeated down every row -- so both money columns carry it
                      and neither cell does. */}
                  <TableHead className="text-right">{columnLabel(boqListColumns, "lineCount", "Lines")}</TableHead>
                  <TableHead className="text-right">
                    {columnLabel(boqListColumns, "total", "Total")}
                    {orgMoney.unitSuffix}
                  </TableHead>
                  <TableHead className="text-right">
                    {columnLabel(boqListColumns, "variation", "Variation vs. prior")}
                    {orgMoney.unitSuffix}
                  </TableHead>
                  <TableHead>{columnLabel(boqListColumns, "createdAt", "Created")}</TableHead>
                  {/* R67 G-04: a minimum width, so the three action labels
                      never truncate to "Ne...". The TABLE scrolls; the
                      actions do not. */}
                  <TableHead className="w-[300px] min-w-[300px] whitespace-nowrap text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boqs.map((b) => {
                  // R67 F-29: deltaAmount and variationVsPrior are the same
                  // number from the same upstream aggregate; prefer the
                  // compare object and fall back for an older payload.
                  const variation = b.compare?.deltaAmount ?? b.variationVsPrior;
                  const deltaPct = formatDeltaPct(b.compare?.deltaPct);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.title}</TableCell>
                      <TableCell className="text-px-muted">v{b.version}</TableCell>
                      <TableCell>
                        {BOQ_STATUS[b.status] ? (
                          <StatusPill status={BOQ_STATUS[b.status]} label={b.status} />
                        ) : (
                          <StatusPillTone tone="neutral" label={b.status} />
                        )}
                      </TableCell>
                      {/* R67 F-29: the line count arrives on the list row now.
                          Not money, so it gets the plain numeric alignment. */}
                      <TableCell className="text-right tabular-nums text-px-muted">
                        {b.compare ? b.compare.lineCount : <span className="text-px-muted">{EMPTY_VALUE}</span>}
                      </TableCell>
                      {/* R67 F-29 x G-05: a total is a magnitude, so it uses the
                          unsigned org formatter -- not the signed one, which
                          would put a "+" in front of every contract value. */}
                      <TableCell className={MONEY_CELL_CLASS}>
                        {b.compare ? orgMoney.money(b.compare.total) : <span className="text-px-muted">{EMPTY_VALUE}</span>}
                      </TableCell>
                      {/* R67 F-23: right-aligned (it is money) and signed, with
                          an en-dash for a revision that has no prior to vary
                          from. R67 G-05 owns the FORMATTING: the org's own
                          currency and locale, and the direction carried by the
                          glyph and the sign rather than by colour. */}
                      <TableCell className={MONEY_CELL_CLASS}>
                        {!b.parentBoqId ? (
                          <span className="text-px-muted">Baseline (Rev0)</span>
                        ) : variation === undefined || variation === null ? (
                          <span className="text-px-muted">{EMPTY_VALUE}</span>
                        ) : (
                          // In ink, with the direction in the glyph and the
                          // sign -- not in the colour.
                          <span className="text-ct-navy">
                            {orgMoney.signedMoney(variation)}
                            {/* R67 F-29: the percentage beside the amount. An
                                unknowable percentage (a parent that totalled
                                nothing) is simply absent, never "0%". */}
                            {deltaPct ? <span className="ml-1 text-px-muted">({deltaPct})</span> : null}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-px-muted">{formatDate(b.createdAt)}</TableCell>
                      <TableCell className="w-[300px] min-w-[300px] whitespace-nowrap text-right space-x-1">
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
          </PaneState>
        </CardContent>
      </Card>
      {/* R67 G-05: said once, at the foot of the screen -- it explains the
          warning glyph beside every unlabelled figure above, and renders
          nothing at all when the org has a currency. */}
      <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </div>
  );
}
