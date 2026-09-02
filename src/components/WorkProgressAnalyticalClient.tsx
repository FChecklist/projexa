"use client";

// R42 seq24 (M28 ANALYTICAL archetype) -- the real destination
// DASHBOARD.PROJECT's "% Complete by Value" and category-bar KPIs link to
// (GLOBAL: "a KPI with no destination MUST NOT SHIP"). Chart above,
// <ListScreen> (WorkProgressListClient, seq22, reused wholesale per
// ANALYTICAL.GLOBAL) below. The drill slice is a real query param
// (?category=), so a drilled state has a real, shareable URL (the part of
// D-5 this pass delivers without full saved-view persistence -- see
// AnalyticalScreen.tsx's own scope note).
//
// R67 D-29 (audit R-070/R-080). Three defects, all in this file's load().
//
// 1. NO CATCH ANYWHERE. Three reads in a Promise.all, then /api/scope and
//    /api/scope/:id awaited serially, with setLoading(false) on the last line
//    of the happy path. A BOQ fetch that rejected left the table on "Loading…"
//    for the rest of the session -- no error, no retry, nothing to click.
// 2. KPI FIGURES ABOVE A LOADING TABLE. The tags rendered from the first render
//    onward, so "Total entries 0 / Avg 0% / Categories 0" was on screen as fact
//    while the reads behind them were still running -- and stayed there forever
//    in case 1. A figure may only be shown once the read behind it succeeded.
// 3. THE TABLE WAITED ON THE BOQ. Entries resolve first and are all the table
//    needs; the BOQ supplies only the "BOQ line" column's labels. It now renders
//    as soon as the entries arrive.
//
// Also: Filter and Export were passed to BOTH this AnalyticalScreen and the
// nested WorkProgressListClient's own ScreenFrame, so one screen showed two
// disabled Filter buttons and two disabled Export buttons.
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnalyticalScreen, BarChart, KpiTag, type BarChartDatum } from "@fchecklist/veridian-ui-kit/screens";
import WorkProgressListClient from "./WorkProgressListClient";
import { currentBoq } from "./WorkProgressPageClient";
import { fetchJson } from "@/lib/fetch-json";
import { SOURCE_LOADING, SOURCE_OK, errorTexts, mayShowFigure, sourceError, type SourceStatus } from "@/lib/source-status";

type Entry = { id: string; activityId: string; boqLineItemId: string | null; entryDate: string; quantityDone: string; percentComplete: string; entryBasis: string; remarks: string | null };
type Activity = { id: string; name: string; categoryId: string | null };
type CategoryProgress = { categoryId: string; name: string; percentComplete: number };
type LineItem = { id: string; itemCode: string | null; description: string };

/**
 * R67 D-29. Two different figures are shown side by side -- a flat average over
 * entries and a value-weighted bar per category -- and nothing on the screen
 * said they were measured differently. This is that caption, exported so the
 * wording is asserted rather than trusted.
 */
export const KPI_CAPTION = "Avg % is a flat average of entries; the bar is value-weighted per category";

export default function WorkProgressAnalyticalClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryFilter = searchParams.get("category");

  const [entries, setEntries] = useState<Entry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [categories, setCategories] = useState<CategoryProgress[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [entriesStatus, setEntriesStatus] = useState<SourceStatus>(SOURCE_LOADING);
  const [activitiesStatus, setActivitiesStatus] = useState<SourceStatus>(SOURCE_LOADING);
  const [categoriesStatus, setCategoriesStatus] = useState<SourceStatus>(SOURCE_LOADING);
  const [boqStatus, setBoqStatus] = useState<SourceStatus>(SOURCE_LOADING);

  const load = useCallback(async () => {
    setEntriesStatus(SOURCE_LOADING);
    setActivitiesStatus(SOURCE_LOADING);
    setCategoriesStatus(SOURCE_LOADING);
    setBoqStatus(SOURCE_LOADING);

    const [entriesRes, activitiesRes, catRes] = await Promise.allSettled([
      fetchJson<{ entries?: Entry[] }>(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ activities?: Activity[] }>(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ categories?: CategoryProgress[] }>(`/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`),
    ]);

    if (entriesRes.status === "fulfilled") {
      setEntries(entriesRes.value.entries ?? []);
      setEntriesStatus(SOURCE_OK);
    } else {
      setEntries([]);
      setEntriesStatus(sourceError(entriesRes.reason, "Could not load progress entries"));
    }

    if (activitiesRes.status === "fulfilled") {
      setActivities(activitiesRes.value.activities ?? []);
      setActivitiesStatus(SOURCE_OK);
    } else {
      setActivities([]);
      setActivitiesStatus(sourceError(activitiesRes.reason, "Could not load activities"));
    }

    if (catRes.status === "fulfilled") {
      setCategories(catRes.value.categories ?? []);
      setCategoriesStatus(SOURCE_OK);
    } else {
      setCategories([]);
      setCategoriesStatus(sourceError(catRes.reason, "Could not load category progress"));
    }

    // Last, and deliberately after the table already has what it needs: the BOQ
    // supplies the "BOQ line" column's labels and nothing else.
    try {
      const boqsRes = await fetchJson<{ boqs?: { id: string; version: number; status: string }[] }>(`/api/scope?projectId=${encodeURIComponent(projectId)}`);
      const current = currentBoq(boqsRes.boqs ?? []);
      if (current) {
        const boq = await fetchJson<{ lineItems?: LineItem[] }>(`/api/scope/${current.id}`);
        setLineItems(boq.lineItems ?? []);
      } else {
        setLineItems([]);
      }
      setBoqStatus(SOURCE_OK);
    } catch (err) {
      setLineItems([]);
      setBoqStatus(sourceError(err, "Could not load the BOQ line names"));
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const activityById = new Map(activities.map((a) => [a.id, a]));
  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));
  const boqLineDescriptionById = new Map(lineItems.map((l) => [l.id, l.itemCode ? `${l.itemCode} -- ${l.description}` : l.description]));

  const selectedCategoryId = categoryFilter ? categories.find((c) => c.name === categoryFilter)?.categoryId : undefined;
  const filteredEntries = selectedCategoryId
    ? entries.filter((e) => activityById.get(e.activityId)?.categoryId === selectedCategoryId)
    : entries;

  const avgPercent = entries.length > 0 ? Math.round(entries.reduce((s, e) => s + Number(e.percentComplete), 0) / entries.length) : 0;
  const bars: BarChartDatum[] = categories.map((c) => ({ label: c.name, value: c.percentComplete }));

  // A figure is a claim, and a claim needs a read that succeeded behind it. The
  // entry-derived tags wait on the entries; the Categories tag waits on the
  // category read. Nothing here waits on the BOQ, which none of them use.
  const showEntryFigures = mayShowFigure(entriesStatus);
  const showCategoryFigures = mayShowFigure(categoriesStatus);
  const problems = errorTexts(activitiesStatus, categoriesStatus, boqStatus);

  return (
    <AnalyticalScreen
      breadcrumb="Work Progress / Analytics"
      filterAction={{ label: "Filter", disabledReason: "Not yet available" }}
      exportAction={{ label: "Export", disabledReason: "Not yet available" }}
      newAction={undefined}
      kpiTags={
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-2">
            {showEntryFigures && <KpiTag label="Total entries" value={String(entries.length)} />}
            {/* CONS-01 (R46 P4 consistency sweep): this is a flat, BOQ-agnostic
                average of percentComplete across every raw work-progress entry
                ever logged (no value-weighting, no current-BOQ scoping) --
                genuinely a different metric than Dashboard's "% Complete by
                BOQ Value" (value-weighted against the current BOQ revision
                only). The two are intentionally distinct, not a bug to
                reconcile into one number, so this label calls out exactly what
                it is measuring. R67 D-29 adds the caption below, because the
                bar chart beside it uses the OTHER measure. */}
            {showEntryFigures && <KpiTag label="Avg % Complete (Activity Log)" value={`${avgPercent}%`} />}
            {showCategoryFigures && <KpiTag label="Categories" value={String(categories.length)} />}
            {!showEntryFigures && !showCategoryFigures && (
              <span className="text-[12.5px] text-ct-muted">
                {entriesStatus.state === "loading" ? "Working out the figures…" : "Figures unavailable — see below."}
              </span>
            )}
          </div>
          {(showEntryFigures || showCategoryFigures) && (
            <p className="text-[12.5px] text-ct-muted">{KPI_CAPTION}</p>
          )}
          {problems.length > 0 && (
            // A source that failed WITHOUT taking the table down still owes the
            // user its reason and a way to try again -- losing the BOQ costs the
            // "BOQ line" column its names, and a silently missing lookup is how
            // a line ends up rendering as a raw id.
            <p role="status" className="text-[12.5px] text-px-error">
              {problems.join(" ")}{" "}
              <button type="button" onClick={() => void load()} className="underline underline-offset-2">Retry</button>
            </p>
          )}
        </div>
      }
      drillSlices={categoryFilter ? [{ label: categoryFilter, onRemove: () => router.push(`/work-progress?projectId=${projectId}&tab=analytics`) }] : []}
      chart={<BarChart data={bars} unit="%" onBarClick={(d) => router.push(`/work-progress?projectId=${projectId}&tab=analytics&category=${encodeURIComponent(d.label)}`)} />}
      table={
        <WorkProgressListClient
          entries={filteredEntries}
          activityNameById={activityNameById}
          boqLineDescriptionById={boqLineDescriptionById}
          // The table follows the ENTRIES alone: it renders as soon as they
          // arrive rather than waiting on the BOQ that only labels one column.
          status={entriesStatus}
          onRetry={() => void load()}
          framed={false}
        />
      }
    />
  );
}
