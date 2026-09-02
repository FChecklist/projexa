"use client";

// R42 seq24 (M28 ANALYTICAL archetype) -- the real destination
// DASHBOARD.PROJECT's "% Complete by Value" and category-bar KPIs link to
// (GLOBAL: "a KPI with no destination MUST NOT SHIP"). Chart above,
// <ListScreen> (WorkProgressListClient, seq22, reused wholesale per
// ANALYTICAL.GLOBAL) below. The drill slice is a real query param
// (?category=), so a drilled state has a real, shareable URL (the part of
// D-5 this pass delivers without full saved-view persistence -- see
// AnalyticalScreen.tsx's own scope note).
// R67 F-05 (R-075): this tab used to repeat Daily Entry's ENTIRE chain on
// every switch -- entries, activities, then /api/scope (1.5-4.4 s), then
// /api/scope/{id} -- to rebuild label lookups the entries now carry
// themselves. It reads the shared WorkProgressDataProvider instead, so a tab
// switch inside the provider's 60 s window costs nothing, and the only call
// this tab still owns is its own category-progress report.
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnalyticalScreen, BarChart, KpiTag, type BarChartDatum } from "@fchecklist/veridian-ui-kit/screens";
import WorkProgressListClient from "./WorkProgressListClient";
import { useWorkProgressData } from "./WorkProgressDataProvider";

type CategoryProgress = { categoryId: string; name: string; percentComplete: number };

export default function WorkProgressAnalyticalClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryFilter = searchParams.get("category");

  const { entries, activities, entriesLoading, entriesError, reload } = useWorkProgressData();
  const [categories, setCategories] = useState<CategoryProgress[]>([]);

  useEffect(() => {
    let cancelled = false;
    // The chart's own data, and the only network call this tab makes. It never
    // gates the table below: a failed category report leaves the bars empty
    // and the entries perfectly readable.
    fetch(`/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setCategories(data.categories ?? []); })
      .catch(() => { if (!cancelled) setCategories([]); });
    return () => { cancelled = true; };
  }, [projectId]);

  const activityById = new Map(activities.map((a) => [a.id, a]));

  const selectedCategoryId = categoryFilter ? categories.find((c) => c.name === categoryFilter)?.categoryId : undefined;
  const filteredEntries = selectedCategoryId
    ? entries.filter((e) => activityById.get(e.activityId)?.categoryId === selectedCategoryId)
    : entries;

  const avgPercent = entries.length > 0 ? Math.round(entries.reduce((s, e) => s + Number(e.percentComplete), 0) / entries.length) : 0;
  const bars: BarChartDatum[] = categories.map((c) => ({ label: c.name, value: c.percentComplete }));

  return (
    <AnalyticalScreen
      breadcrumb="Work Progress / Analytics"
      filterAction={{ label: "Filter", disabledReason: "Not yet available" }}
      exportAction={{ label: "Export", disabledReason: "Not yet available" }}
      newAction={undefined}
      kpiTags={
        <>
          <KpiTag label="Total entries" value={String(entries.length)} />
          {/* CONS-01 (R46 P4 consistency sweep): this is a flat, BOQ-agnostic
              average of percentComplete across every raw work-progress entry
              ever logged (no value-weighting, no current-BOQ scoping) --
              genuinely a different metric than Dashboard's "% Complete by
              BOQ Value" (value-weighted against the current BOQ revision
              only), which is where this screen's own kpiTags docstring
              above says the Dashboard's KPI links to. The two are
              intentionally distinct, not a bug to reconcile into one
              number, so this label calls out exactly what it is measuring
              instead of a bare "Avg % complete" that reads as the same
              headline figure as Dashboard's when it is not. */}
          <KpiTag label="Avg % Complete (Activity Log)" value={`${avgPercent}%`} />
          <KpiTag label="Categories" value={String(categories.length)} />
        </>
      }
      drillSlices={categoryFilter ? [{ label: categoryFilter, onRemove: () => router.push(`/work-progress?projectId=${projectId}&tab=analytics`) }] : []}
      chart={<BarChart data={bars} unit="%" onBarClick={(d) => router.push(`/work-progress?projectId=${projectId}&tab=analytics&category=${encodeURIComponent(d.label)}`)} />}
      table={
        <WorkProgressListClient
          entries={filteredEntries}
          loading={entriesLoading}
          loadError={entriesError}
          onRetry={reload}
        />
      }
    />
  );
}
