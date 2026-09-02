"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusPill, StatusPillTone, type SemanticStatus } from "@/components/ui/status-pill";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, GitCompare, GitBranchPlus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { EMPTY_VALUE, MONEY_CELL_CLASS } from "@/lib/format-money";
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import { TableLoadingRows } from "@/components/TableLoadingRows";

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

// R67 F-04: the labels scope/page.tsx paints in its Suspense fallback (the
// five data columns plus the always-present Actions column), so the header row
// on screen while the server resolves is the header row that stays.
export const SCOPE_FALLBACK_COLUMN_LABELS = [...DEFAULT_LIST_COLUMNS.map((c) => c.label), "Actions"];

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
  // R67 F-04: both figures now arrive ON THE ROW, computed server-side inside
  // the one transaction that read the BOQs (construction-boq-service.ts's
  // listBoqs -> buildBoqListRows). null (never 0) when there is no baseline to
  // differ from -- "nothing to compare against" is not "no change".
  totalVariation: number | null;
  totalVariationVsOriginal: number | null;
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

// R67 F-04: a real BOQ register can run to dozens of revisions; showing all
// of them at once is a wall of rows nobody reads. 25 at a time, with the full
// count named on the button so "Show more" is never a mystery.
const PAGE_SIZE = 25;

// R67 G-05: formatVariation() lived here and passed `undefined` as the locale
// -- the exact hydration bug src/lib/format-date.ts exists to prevent, since
// the server formats in ITS locale and the browser in the visitor's. It also
// carried its meaning in colour (green for up, red for down). Both are gone:
// the figure now comes from the one money formatter, and its DIRECTION is a
// glyph plus an explicit sign ("▲ AED +2,025"), rendered in ink.

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
  const [shownRows, setShownRows] = useState(PAGE_SIZE);

  // R67 F-04: the currency is a LABEL, not a precondition. useOrgMoney() has
  // no code until /api/currencies answers (and that answer is now shared and
  // session-cached, so on every navigation after the first it is already
  // there); the number renders immediately either way, and the code appears
  // beside it when it arrives. The per-revision `variationByBoqId` state this
  // replaced is gone with the compare loop below.
  const orgMoney = useOrgMoney();

  // R67 F-04. This used to fire GET /api/scope/{id}/compare once PER REVISION
  // after the list arrived -- eight calls at 0.58-1.44 s each on an
  // eight-revision project, 22 requests and 7.7 s to network idle, on a screen
  // the backend itself answers in 652-781 ms. The variation figures now come
  // back ON the list rows (compliance-tracker computes both inside the single
  // transaction that reads the BOQs, reusing the same diffLineItems/
  // computeTotalVariation pair /compare uses, so the numbers cannot disagree).
  // /compare still backs the Compare screen, which needs the added/removed/
  // changed detail a list row does not.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setShownRows(PAGE_SIZE);
    try {
      const data = await fetchJson(`/api/scope?projectId=${encodeURIComponent(projectId)}`, {
        signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
      });
      setBoqs(data.boqs ?? []);
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
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // R67 F-04: warm the create route so "+ New BOQ" opens instantly.
  useEffect(() => { router.prefetch(`/scope/new?projectId=${projectId}`); }, [router, projectId]);

  // Every row action lands on /scope/{id} or one of its children, so warming
  // the object route on row hover covers View, Compare and New Revision.
  const prefetchBoq = useCallback((boqId: string) => { router.prefetch(`/scope/${boqId}`); }, [router]);

  // The header labels the skeleton and the real table share, so the words on
  // screen while loading are the words that stay.
  const HEADER_LABELS = [
    columnLabel(boqListColumns, "title", "Title"),
    columnLabel(boqListColumns, "version", "Version"),
    columnLabel(boqListColumns, "status", "Status"),
    columnLabel(boqListColumns, "variation", "Variation vs. prior"),
    columnLabel(boqListColumns, "createdAt", "Created"),
    "Actions",
  ];

  // Paginated only once the register is genuinely long: a project with a
  // handful of revisions should never see a "Show more" it does not need.
  const paginated = boqs.length > 50;
  const visibleBoqs = paginated ? boqs.slice(0, shownRows) : boqs;
  const hiddenCount = boqs.length - visibleBoqs.length;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New BOQ"
            Dialog popup with a real create route. */}
        <Button onMouseEnter={() => router.prefetch(`/scope/new?projectId=${projectId}`)} onClick={() => router.push(`/scope/new?projectId=${projectId}`)}><Plus className="size-4" /> New BOQ</Button>
      </div>

      {/* R67 F-04: the bare spinner is replaced by the real column headers plus
          six grey rows, so the table's shape is on screen from the first frame
          and nothing reflows when the rows land. */}
      {loading ? (
        <TableLoadingRows headers={HEADER_LABELS} rows={6} caption="Loading BOQs..." />
      ) : (
      <Card className="shadow-card">
        <CardContent className="p-0">
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
                  {/* R67 G-05: the unit lives in the column header, not
                      repeated down every row. */}
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
                {visibleBoqs.map((b) => {
                  const variation = b.totalVariation;
                  return (
                    <TableRow key={b.id} onMouseEnter={() => prefetchBoq(b.id)} onFocus={() => prefetchBoq(b.id)}>
                      <TableCell className="font-medium">{b.title}</TableCell>
                      <TableCell className="text-px-muted">v{b.version}</TableCell>
                      <TableCell>
                        {BOQ_STATUS[b.status] ? (
                          <StatusPill status={BOQ_STATUS[b.status]} label={b.status} />
                        ) : (
                          <StatusPillTone tone="neutral" label={b.status} />
                        )}
                      </TableCell>
                      <TableCell className={MONEY_CELL_CLASS}>
                        {!b.parentBoqId ? (
                          <span className="text-px-muted">Baseline (Rev0)</span>
                        ) : variation === null || variation === undefined ? (
                          // R67 F-04: null means the server had no baseline to
                          // compare against -- honestly the empty marker, never
                          // a fabricated 0.
                          <span className="text-px-muted">{EMPTY_VALUE}</span>
                        ) : (
                          // In ink, with the direction in the glyph and the
                          // sign -- not in the colour.
                          <span className="text-ct-navy">{orgMoney.signedMoney(variation)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-px-muted">{formatDate(b.createdAt)}</TableCell>
                      <TableCell className="w-[300px] min-w-[300px] whitespace-nowrap text-right space-x-1">
                        {/* Real screen navigation (2026-08-30) -- replaces the old
                            "View" Dialog popup with a real Object Page route,
                            same as PermitObjectClient's proven pattern. */}
                        <Button variant="ghost" size="sm" onMouseEnter={() => prefetchBoq(b.id)} onClick={() => router.push(`/scope/${b.id}`)}>View</Button>
                        <Button variant="ghost" size="sm" onMouseEnter={() => router.prefetch(`/scope/${b.id}/compare`)} onClick={() => router.push(`/scope/${b.id}/compare`)}><GitCompare className="size-3.5" /> Compare</Button>
                        <Button variant="ghost" size="sm" onMouseEnter={() => router.prefetch(`/scope/${b.id}/revise`)} onClick={() => router.push(`/scope/${b.id}/revise`)}><GitBranchPlus className="size-3.5" /> New Revision</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {hiddenCount > 0 && (
            <div className="border-t border-px-border p-3 text-center">
              <Button variant="outline" size="sm" onClick={() => setShownRows((n) => n + PAGE_SIZE)}>
                Show more ({hiddenCount} more)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      )}
      {/* R67 G-05: said once, at the foot of the screen -- it explains the
          warning glyph beside every unlabelled figure above, and renders
          nothing at all when the org has a currency. */}
      <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </div>
  );
}
