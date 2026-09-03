"use client";

// R42 seq24 (M28 ANALYTICAL archetype) -- the real destination
// DASHBOARD.PROJECT's "% Complete by Value" and category-bar KPIs link to
// (GLOBAL: "a KPI with no destination MUST NOT SHIP"). Chart above,
// <ListScreen> (WorkProgressListClient, seq22, reused wholesale per
// ANALYTICAL.GLOBAL) below. The drill slice is a real query param
// (?category=), so a drilled state has a real, shareable URL (the part of
// D-5 this pass delivers without full saved-view persistence -- see
// AnalyticalScreen.tsx's own scope note).
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnalyticalScreen, BarChart, KpiTag, type BarChartDatum } from "@fchecklist/veridian-ui-kit/screens";
import WorkProgressListClient from "./WorkProgressListClient";

type Entry = { id: string; activityId: string; boqLineItemId: string | null; entryDate: string; quantityDone: string; percentComplete: string; entryBasis: string; remarks: string | null };
type Activity = { id: string; name: string; categoryId: string | null };
type CategoryProgress = { categoryId: string; name: string; percentComplete: number };
type LineItem = { id: string; itemCode: string | null; description: string };

export default function WorkProgressAnalyticalClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryFilter = searchParams.get("category");

  const [entries, setEntries] = useState<Entry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [categories, setCategories] = useState<CategoryProgress[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [entriesRes, activitiesRes, catRes] = await Promise.all([
        fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()),
        fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()),
        fetch(`/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ categories: [] })),
      ]);
      setEntries(entriesRes.entries ?? []);
      setActivities(activitiesRes.activities ?? []);
      setCategories(catRes.categories ?? []);

      const boqsRes = await fetch(`/api/scope?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ boqs: [] }));
      const boqs: { id: string; version: number; status: string }[] = boqsRes.boqs ?? [];
      if (boqs.length > 0) {
        const current = boqs.find((b) => b.status === "approved") ?? boqs.find((b) => b.status === "submitted") ?? [...boqs].sort((a, b) => b.version - a.version)[0];
        const boq = await fetch(`/api/scope/${current.id}`).then((r) => r.json());
        setLineItems(boq.lineItems ?? []);
      }
      setLoading(false);
    }
    load();
  }, [projectId]);

  const activityById = new Map(activities.map((a) => [a.id, a]));
  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));
  const boqLineDescriptionById = new Map(lineItems.map((l) => [l.id, l.itemCode ? `${l.itemCode} -- ${l.description}` : l.description]));

  const selectedCategoryId = categoryFilter ? categories.find((c) => c.name === categoryFilter)?.categoryId : undefined;
  const filteredEntries = selectedCategoryId
    ? entries.filter((e) => activityById.get(e.activityId)?.categoryId === selectedCategoryId)
    : entries;

  const avgPercent = entries.length > 0 ? Math.round(entries.reduce((s, e) => s + Number(e.percentComplete), 0) / entries.length) : 0;
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
          activityNameById={activityNameById}
          boqLineDescriptionById={boqLineDescriptionById}
          loading={loading}
        />
      }
    />
  );
}
