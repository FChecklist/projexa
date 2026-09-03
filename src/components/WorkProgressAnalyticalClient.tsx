"use client";

// R67 MERGE (lane D0 x lane F2, item F-24 / audit R-240). The entries table on
// this tab used to sit on "Loading..." indefinitely, because the read only
// settled after a SERIAL tail of /api/scope plus one /api/scope/{id}, fetched
// purely to translate the BOQ column. Those two calls are gone: VERIDIAN sends
// activityName / boqItemCode / boqDescription with each entry now
// (compliance-tracker #1579), so the table renders as soon as the entries do.
// Lane D0's own work here -- the tested reads module, metricLabel()'s en-dash
// over a failed read, and the chart and the table each owning their own
// failure -- is untouched.

// R42 seq24 (M28 ANALYTICAL archetype) -- the real destination
// DASHBOARD.PROJECT's "% Complete by Value" and category-bar KPIs link to
// (GLOBAL: "a KPI with no destination MUST NOT SHIP"). Chart above,
// <ListScreen> (WorkProgressListClient, seq22, reused wholesale per
// ANALYTICAL.GLOBAL) below. The drill slice is a real query param
// (?category=), so a drilled state has a real, shareable URL (the part of
// D-5 this pass delivers without full saved-view persistence -- see
// AnalyticalScreen.tsx's own scope note).
//
// R67 D-55 / D-65 -- THE FAULT THIS SCREEN CARRIED. Its load() read four
// endpoints with `fetch(...).then((r) => r.json())` and never looked at a
// single status. On a 500 the three KPI tiles rendered
//
//     Total entries  0        Avg % Complete (Activity Log)  0%
//     Categories     0
//
// which is R-002/R-019 exactly: a failed GET rendered as a number. A tile is
// worse than a false empty list, because a figure carries no hint that
// anything was ever asked for -- and this is the tile a project manager
// reads to decide whether the site is behind. There was also no catch on the
// batch at all, so a THROWN read left `loading` true forever and the pane
// spun with no error and no way out.
//
// Now: the reads come from src/lib/work-progress-reads.ts, every figure goes
// through metricLabel() (an en-dash unless a 200 established it), and the
// chart and the table each say what happened to their own read.
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnalyticalScreen, BarChart, KpiTag, type BarChartDatum } from "@fchecklist/veridian-ui-kit/screens";
import WorkProgressListClient from "./WorkProgressListClient";
import { PaneErrorCard, PaneWaitingCaption } from "@/components/PaneState";
import { metricLabel, type PaneStatus } from "@/lib/pane-state";
import {
  averagePercentComplete,
  readCategoryProgress,
  readWorkProgress,
  type CategoryProgress,
  type ProgressActivity,
  type ProgressEntry,
} from "@/lib/work-progress-reads";

type ReadError = { status: number | null; message: string | null } | null;

export default function WorkProgressAnalyticalClient({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryFilter = searchParams.get("category");

  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [activities, setActivities] = useState<ProgressActivity[]>([]);
  const [categories, setCategories] = useState<CategoryProgress[]>([]);

  const [status, setStatus] = useState<PaneStatus>("loading");
  const [error, setError] = useState<ReadError>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  // The chart's read is tracked separately from the table's, because they
  // are separate endpoints and one failing tells you nothing about the
  // other. Folding them into one flag is how a working table ends up hidden
  // behind a chart's error.
  const [chartStatus, setChartStatus] = useState<PaneStatus>("loading");
  const [chartError, setChartError] = useState<ReadError>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setChartStatus("loading");
    setStartedAt(Date.now());
    setError(null);
    setChartError(null);

    const [main, chart] = await Promise.all([
      readWorkProgress(projectId),
      readCategoryProgress(projectId),
    ]);

    setActivities(main.activities);
    if (main.entries.status === "error") {
      setError({ status: main.entries.httpStatus, message: main.entries.message });
      setStatus("error");
    } else {
      setEntries(main.entries.status === "ready" ? main.entries.rows : []);
      setLoadedAt(new Date());
      setStatus("ready");
    }

    if (chart.status === "error") {
      setChartError({ status: chart.httpStatus, message: chart.message });
      setChartStatus("error");
    } else {
      setCategories(chart.status === "ready" ? chart.rows : []);
      setChartStatus("ready");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activityById = new Map(activities.map((a) => [a.id, a]));
  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));

  const selectedCategoryId = categoryFilter ? categories.find((c) => c.name === categoryFilter)?.categoryId : undefined;
  const filteredEntries = selectedCategoryId
    ? entries.filter((e) => activityById.get(e.activityId)?.categoryId === selectedCategoryId)
    : entries;

  const avgPercent = averagePercentComplete(entries);
  const bars: BarChartDatum[] = categories.map((c) => ({ label: c.name, value: c.percentComplete }));

  return (
    <AnalyticalScreen
      breadcrumb="Work Progress / Analytics"
      // R67 E-18 (R-178): a reason, not a stub -- and the reason names the tab
      // one click away that really does export, rather than leaving a reader
      // to conclude this product cannot produce a file.
      filterAction={{ label: "Filter", disabledReason: "Filter on the Report tab — this view summarises every entry ever logged" }}
      exportAction={{ label: "Export", disabledReason: "Export from the Report tab — PDF, XLSX and CSV of the table these figures summarise" }}
      newAction={undefined}
      kpiTags={
        <>
          {/* Every figure below is metricLabel()'d: an en-dash unless the
              read that would establish it actually returned 200. */}
          <KpiTag label="Total entries" value={metricLabel(status, entries.length)} />
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
          <KpiTag label="Avg % Complete (Activity Log)" value={metricLabel(status, avgPercent, "%")} />
          <KpiTag label="Categories" value={metricLabel(chartStatus, categories.length)} />
        </>
      }
      drillSlices={categoryFilter ? [{ label: categoryFilter, onRemove: () => router.push(`/work-progress?projectId=${projectId}&tab=analytics`) }] : []}
      chart={
        chartStatus === "error" ? (
          <PaneErrorCard entity="the category breakdown" error={chartError} onRetry={() => void load()} />
        ) : chartStatus === "loading" && categories.length === 0 ? (
          <PaneWaitingCaption
            startedAt={startedAt}
            entity="the category breakdown"
            projectName={projectName}
            onRetry={() => void load()}
          />
        ) : (
          <BarChart data={bars} unit="%" onBarClick={(d) => router.push(`/work-progress?projectId=${projectId}&tab=analytics&category=${encodeURIComponent(d.label)}`)} />
        )
      }
      table={
        <WorkProgressListClient
          projectId={projectId}
          projectName={projectName}
          entries={filteredEntries}
          activityNameById={activityNameById}
          status={status}
          error={error}
          onRetry={() => void load()}
          loadedAt={loadedAt}
          startedAt={startedAt}
        />
      }
    />
  );
}
