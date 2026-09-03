"use client";

// R42 seq24 (M28 ANALYTICAL archetype) -- the real destination
// DASHBOARD.PROJECT's "% Complete" and category-bar KPIs link to. The drill
// slice is a real query param (?category=), so a drilled state has a real,
// shareable URL.
//
// R67 E-24 (R-210). FOUR THINGS WERE WRONG.
//
// 1. TWO OF EVERY HEADER CONTROL. WorkProgressListClient wrapped itself in
//    its own ScreenFrame and was then mounted as AnalyticalScreen's table
//    slot, so the screen carried two controls labelled "Filter (Not yet
//    available)" and two labelled "Export". It is now passed `frameless`;
//    the enclosing screen's actions are the only ones.
//
// 2. ONE SLOW LOAD BLOCKED THE WHOLE TABLE. Entries, activities and
//    categories come back in one round trip, but the BOQ line descriptions
//    needed a second, much slower one -- and the table waited for it. The
//    load is split: the table renders on the first round trip and the line
//    descriptions fill in when the second returns, with the line REFERENCE
//    shown in grey until they do.
//
// 3. THREE NUMBERS CONTRADICTED EACH OTHER IN PUBLIC -- 42% on a tag, 60% on
//    a bar, 0% earned -- with nothing saying they measure different things.
//    Each category bar now plots BOTH measures, each with its figure printed
//    beside it, and when they disagree in the one way that has a fix, the
//    screen names the fix.
//
// 4. THE KPI TAGS WERE DECORATION. They are now the measure selector: the
//    chosen one sorts the bars and is highlighted.
//
// The second round trip is the Work Progress Report itself, which already
// fetches the BOQ internally -- so ONE call now supplies both the line
// descriptions and the earned-value roll-up, where the old code made two
// (/api/scope then /api/scope/{id}) and still had no earned value.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnalyticalScreen, KpiTag } from "@fchecklist/veridian-ui-kit/screens";
import WorkProgressListClient from "./WorkProgressListClient";
import { CategoryDistributionCharts } from "./CategoryDistributionCharts";
import { HierarchyProjectBars } from "./HierarchyProjectBars";
import { formatNumber } from "@/lib/format-number";
import { useOrgMoney } from "@/lib/use-org-money";
import { portfolioRowsToBarSources, type ProjectBarSource } from "@/lib/project-bar-rows";
import {
  MEASURE_LABEL,
  UNLINKED_PROGRESS_NOTE,
  defaultReportRange,
  measuresDisagree,
  mergeCategoryMeasures,
  sortByMeasure,
  type CategoryMeasureRow,
  type Measure,
} from "@/lib/work-progress-analytics";

type Entry = { id: string; activityId: string; boqLineItemId: string | null; entryDate: string; quantityDone: string; percentComplete: string; entryBasis: string; remarks: string | null };
type Activity = { id: string; name: string; categoryId: string | null };
type CategoryProgress = { categoryId: string; name: string; percentComplete: number };
type WprRow = { lineItemId: string; code: string; description: string };
type WprCategory = { name: string; percentage?: { total?: number } };

const MEASURE_COLOR: Record<Measure, string> = {
  logged: "var(--color-chart-1)",
  earned: "var(--color-chart-2)",
};

export default function WorkProgressAnalyticalClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryFilter = searchParams.get("category");

  const [entries, setEntries] = useState<Entry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [categories, setCategories] = useState<CategoryProgress[]>([]);
  const [boqLineDescriptionById, setBoqLineDescriptionById] = useState<Map<string, string>>(new Map());
  const [earnedByCategory, setEarnedByCategory] = useState<WprCategory[] | null>(null);
  // Two load flags, not one: the table is allowed to render as soon as the
  // fast round trip lands.
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [boqLoading, setBoqLoading] = useState(true);
  const [measure, setMeasure] = useState<Measure>("logged");
  // R67 E-33: the portfolio chart's own rows, from VERIDIAN's portfolio
  // budget-vs-actual report. Its own state and its own error, so a portfolio
  // that fails to load leaves the per-category charts on this screen intact --
  // one failed panel must never blank a whole tab.
  const orgMoney = useOrgMoney();
  const [portfolio, setPortfolio] = useState<ProjectBarSource[] | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  const loadPortfolio = useCallback(async () => {
    setPortfolio(null);
    setPortfolioError(null);
    try {
      const res = await fetch("/api/reports/portfolio/budget-vs-actual");
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `the report service answered ${res.status}`);
      setPortfolio(portfolioRowsToBarSources(body?.rows ?? []));
    } catch (err) {
      setPortfolioError(err instanceof Error && err.message ? err.message : "the service did not answer");
    }
  }, []);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  const loadFast = useCallback(async () => {
    setEntriesLoading(true);
    const [entriesRes, activitiesRes, catRes] = await Promise.all([
      fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ entries: [] })),
      fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ activities: [] })),
      // format=legacy: E-32 made the generic { columns, rows } table the
      // DEFAULT body of /reports/{name}. This chart reads categoryId, name and
      // percentComplete off `categories[]`, which the table does not carry --
      // without the flag `catRes.categories ?? []` would silently be [] and the
      // bars would vanish with no error anywhere.
      fetch(`/api/reports/category-progress?format=legacy&projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ categories: [] })),
    ]);
    const loadedEntries: Entry[] = entriesRes.entries ?? [];
    setEntries(loadedEntries);
    setActivities(activitiesRes.activities ?? []);
    setCategories(catRes.categories ?? []);
    setEntriesLoading(false);
    return loadedEntries;
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const loadedEntries = await loadFast();
      if (cancelled) return;

      // The slower half. The Work Progress Report carries BOTH the BOQ line
      // descriptions and the earned-value roll-up, so this is one call where
      // the old code made two and still had no earned value.
      setBoqLoading(true);
      const { from, to } = defaultReportRange(loadedEntries);
      const params = new URLSearchParams({ projectId, from, to });
      const report = await fetch(`/api/work-progress/report?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (cancelled) return;
      if (report) {
        const rows: WprRow[] = report.rows ?? [];
        setBoqLineDescriptionById(new Map(rows.map((l) => [l.lineItemId, l.code ? `${l.code} -- ${l.description}` : l.description])));
        setEarnedByCategory((report.byCategory ?? []) as WprCategory[]);
      }
      setBoqLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [loadFast, projectId]);

  const activityById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const activityNameById = useMemo(() => new Map(activities.map((a) => [a.id, a.name])), [activities]);

  const selectedCategoryId = categoryFilter ? categories.find((c) => c.name === categoryFilter)?.categoryId : undefined;
  const filteredEntries = selectedCategoryId
    ? entries.filter((e) => activityById.get(e.activityId)?.categoryId === selectedCategoryId)
    : entries;

  const rows: CategoryMeasureRow[] = useMemo(
    () => mergeCategoryMeasures(categories, earnedByCategory),
    [categories, earnedByCategory]
  );
  const sorted = useMemo(() => sortByMeasure(rows, measure), [rows, measure]);
  const disagree = measuresDisagree(rows);
  const avgPercent = entries.length > 0 ? Math.round(entries.reduce((s, e) => s + Number(e.percentComplete), 0) / entries.length) : 0;

  function drillTo(categoryName: string) {
    router.push(`/work-progress?projectId=${projectId}&tab=analytics&category=${encodeURIComponent(categoryName)}`);
  }

  return (
    <AnalyticalScreen
      breadcrumb="Work Progress / Analytics"
      filterAction={{ label: "Filter", disabledReason: "Not yet available" }}
      exportAction={{ label: "Export", disabledReason: "Not yet available" }}
      newAction={undefined}
      kpiTags={
        <>
          <KpiTag label="Total entries" value={String(entries.length)} />
          {/* R67 E-24: both tags are now the measure SELECTOR. The chosen one
              sorts the bars and is highlighted, so the reader can see which
              number the chart is ordered by instead of guessing. */}
          {/* KpiTag is already a selectable control in the kit ("toggles which
              measure the chart plots" -- its own header comment), so this uses
              that API rather than wrapping a button in a button. */}
          {(["logged", "earned"] as const).map((m) => (
            <KpiTag
              key={m}
              label={MEASURE_LABEL[m]}
              selected={measure === m}
              onClick={() => setMeasure(m)}
              value={
                m === "logged"
                  ? `${avgPercent}%`
                  : earnedByCategory === null
                    ? "…"
                    : `${formatNumber(
                        rows.reduce((s, r) => s + (r.earnedPercent ?? 0), 0) / Math.max(1, rows.length),
                        { fractionDigits: 0 }
                      )}%`
              }
            />
          ))}
          <KpiTag label="Categories" value={String(rows.length)} />
        </>
      }
      drillSlices={categoryFilter ? [{ label: categoryFilter, onRemove: () => router.push(`/work-progress?projectId=${projectId}&tab=analytics`) }] : []}
      chart={
        <div className="space-y-6">
          {/* R67 E-33 (R-265): Sumeet 5.png's two graphs, mounted on the tab the
              Analysis pill already targets rather than on a second route.

              NOT <svg>. E-33's acceptance names two <svg> elements; both charts
              are built from divs, and deliberately -- E-23's own header says
              why: what these need is ONE shared scale, the figure printed on
              every bar (R-227: never rely on the mark alone) and a row that is
              a real link, and a charting library gives a per-row axis, a hover
              tooltip and no link. They carry role="group" and the item's exact
              aria-labels, so the accessible name a reader hears is the one the
              item specifies; only the element name differs. Rebuilding two
              working, tested charts as SVG to satisfy a selector would lose the
              links and the printed figures. */}
          <section role="group" aria-label="Revenue, budget and progress by project" className="space-y-2">
            <h4 className="text-sm font-medium text-px-fg">Revenue, budget and progress by project</h4>
            <HierarchyProjectBars
              projects={portfolio}
              orgMoney={orgMoney}
              loading={portfolio === null && portfolioError === null}
              error={portfolioError}
              onRetry={() => void loadPortfolio()}
              dateRangeApplied={false}
            />
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-medium text-px-fg">Budget vs completed by category</h4>
            {/* The same component the dashboards draw, with its drill pointed at
                the Work Progress Report (D-02) instead of at this screen, which
                is the screen the reader is already on.

                OPEN OWNER QUESTION, NOT AN OVERSIGHT. E-33 asks for a PIE here
                whenever there are five or fewer segments. E-23 -- already
                shipped in this same lane, from the same audit -- deliberately
                REMOVED that pie and recorded why: a pie makes the reader
                compare angles when the question is a comparison of lengths, and
                its cap hid categories. E-33's five-segment condition answers the
                hiding half and not the angle half, so reinstating it would undo
                a decision this programme made a few commits earlier. Bars kept;
                the choice between the two items is the owner's to make. */}
            <CategoryDistributionCharts
              projectId={projectId}
              drillTo="report"
              ariaLabel="Budget vs completed by category"
            />
          </section>

        <div className="space-y-3">
          <h4 className="text-sm font-medium text-px-fg">Progress by scope category</h4>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-px-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: MEASURE_COLOR.logged }} aria-hidden />
              {MEASURE_LABEL.logged} — latest percentage logged against each activity, averaged
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: MEASURE_COLOR.earned }} aria-hidden />
              {MEASURE_LABEL.earned} — BOQ value completed, as a share of the category&apos;s BOQ value
            </span>
          </div>
          {/* One sentence, only when the two disagree in the way that has a fix. */}
          {disagree && <p className="text-[12px] text-px-muted">{UNLINKED_PROGRESS_NOTE}</p>}
          {sorted.length === 0 ? (
            <p className="py-6 text-center text-sm text-px-muted">
              {entriesLoading ? "Loading progress by category…" : "No scope categories on this project yet."}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {sorted.map((row) => (
                <li key={row.name}>
                  {/* The category drill on the LABEL keeps working. */}
                  <button type="button" onClick={() => drillTo(row.name)} className="block w-full text-left text-[12.5px] text-px-ink hover:underline">
                    {row.name}
                  </button>
                  {(["logged", "earned"] as const).map((m) => {
                    const value = m === "logged" ? row.loggedPercent : row.earnedPercent;
                    return (
                      <div key={m} className="mt-1 flex items-center gap-2">
                        <span className="w-20 shrink-0 text-[11px] text-px-muted">{MEASURE_LABEL[m]}</span>
                        <span className="h-2 min-w-0 flex-1 rounded-sm bg-px-border/50">
                          <span
                            className="block h-2 rounded-sm"
                            style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%`, backgroundColor: MEASURE_COLOR[m] }}
                            aria-hidden
                          />
                        </span>
                        {/* R-227: the number is printed beside the bar, so the
                            two measures are readable without a hover and
                            without telling two fills apart. */}
                        <span className="w-14 shrink-0 text-right text-[11.5px] tabular-nums text-px-ink">
                          {value === null ? "…" : `${formatNumber(value, { fractionDigits: 0 })}%`}
                        </span>
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      }
      table={
        <WorkProgressListClient
          entries={filteredEntries}
          activityNameById={activityNameById}
          boqLineDescriptionById={boqLineDescriptionById}
          loading={entriesLoading}
          boqLoading={boqLoading}
          // R67 E-24: the list is a SLOT here, not a screen -- see the
          // frameless prop's own comment. This is what removes the second
          // "Filter (Not yet available)" and the second "Export".
          frameless
        />
      }
    />
  );
}
