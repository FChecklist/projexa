"use client";

// R42 seq24 (M28 DASHBOARD archetype, DASHBOARD.PROJECT row): "the first
// screen a PM opens every morning." Registry-driven -- zero bespoke
// components, per DASHBOARD.PROJECT's own components_used list. Every KPI
// is clickable and carries its own filters through (GLOBAL: "EVERY NUMBER
// IS A DOOR" / "A KPI WITH NO DESTINATION MUST NOT SHIP") -- see each
// onClick below for exactly where it lands and why that's a real screen.
// R67 E-25 (R-211). THREE CHART/CARD DEFECTS, all fixed here rather than in
// the kit -- D-09 forbids a kit change, and every one of them is a decision
// this client is the right place to make.
//
// 1. "Progress logged over time" was built from the LAST FIVE ROWS of the
//    entries list with a running total taken over that window: it dropped
//    every earlier entry, plotted one point per ROW rather than per DAY, and
//    started its cumulative total from wherever the window happened to begin.
//    It is now every entry, grouped by day, accumulated across days -- and
//    with fewer than two distinct days it renders a SENTENCE instead of an
//    empty chart frame, because an axis with the same date at both ends is
//    not a trend.
//
// 2. "Budget vs Actual" drew a full orange bullet bar against a target of
//    ZERO, with an up arrow and the words "over budget", for every project
//    with no ERP cost-centre budget -- which is most of them, since a PROJEXA
//    org need not run VERIDIAN's ERP budgets at all. A zero target is not a
//    target and a bar against it is a false alarm. The BOQ-derived budget is
//    used as the target when there is no cost-centre one, and the baseline
//    says WHICH budget the verdict is against.
//
// 3. A failed /api/permits read was swallowed into an empty array, so the
//    Permits Expiring card confidently read "0 / none due soon" when the
//    truth was that nobody knew. It now tracks the failure and says so, with
//    a Retry that refetches just that card.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DashboardScreen,
  KpiCard,
  BulletChart,
  BarChart,
  LineChart,
  LinkListCard,
  type BarChartDatum,
  type ScreenColumn,
} from "@fchecklist/veridian-ui-kit/screens";
import {
  NO_PROGRESS_CAPTION,
  budgetCardModel,
  cumulativeProgressSeries,
  oneDayCaption,
  primaryTrendLabel,
} from "@/lib/project-dashboard-charts";

// R46 P8 seq125 (M28 registry-model, DASHBOARD archetype -- function_id
// "dashboard.dashboard", first DASHBOARD conversion this session):
// intentionally the same fields as ScreenColumn, same as every prior LIST/
// CUSTOM conversion's RegistryColumn -- but unlike a LIST screen (one row =
// one table column), a DASHBOARD row's `columns` are {field, label} pairs
// naming each KPI/section heading on this page. Every KPI's value, click
// destination, trend direction, and every chart's data stay exactly as
// hand-built below -- only the label TEXT is registry-driven.
export type RegistryColumn = ScreenColumn;

// Fallback when no registry row is seeded yet (or the resolve call errors) --
// mirrors the registry seed 1:1, so there is no visible difference between
// "resolved from the DB" and "resolved from this hardcoded default" (M28:
// keep the hardcoded version behind a flag until verified).
const DEFAULT_LABELS: ScreenColumn[] = [
  { field: "percentByValue", label: "% Complete by BOQ Value", type: "text" },
  { field: "contractValue", label: "Contract Value", type: "text" },
  { field: "budgetVsActual", label: "Budget vs Actual", type: "text" },
  { field: "permitsExpiring", label: "Permits Expiring", type: "text" },
  { field: "progressOverTimeHeading", label: "Progress logged over time", type: "text" },
  { field: "progressByCategoryHeading", label: "Progress by scope category", type: "text" },
  { field: "quickActionsTitle", label: "Quick actions", type: "text" },
  { field: "recentActivityHeading", label: "Recent progress entries", type: "text" },
];

function labelFor(labels: ScreenColumn[], field: string, fallback: string): string {
  return labels.find((c) => c.field === field)?.label || fallback;
}

type ProjectDashboard = {
  projectId: string;
  projectName: string;
  budget: number;
  revenue: number;
  expenses: number;
  progressPercent: number;
  delayedTaskCount: number;
  taskCount: number;
  projectValue: number | null;
  earnedValue: number | null;
  percentByValue: number | null;
  contractValue: number | null;
};
type Currency = { code: string; isBaseCurrency: boolean };
type CategoryRow = { categoryId: string; name: string; percentComplete: number };
type RecentEntry = { id: string; activityId: string; entryDate: string; quantityDone: string; percentComplete: string };
type Activity = { id: string; name: string };
type Permit = { id: string; daysToExpiry: number | null };

// TC-90: AED with NO rupee sign and NO lakh/crore grouping -- "en-US" gives
// plain thousands-comma grouping regardless of locale; deliberately not
// "en-IN" (lakh grouping) and never a hardcoded "₹" fallback.
function money(n: number, currency: Currency | undefined) {
  return `${currency ? currency.code + " " : ""}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function DashboardProjectClient({ projectId, labels }: { projectId: string; labels?: RegistryColumn[] | null }) {
  const router = useRouter();
  const dashboardLabels = labels && labels.length > 0 ? labels : DEFAULT_LABELS;
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null);
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [permitsExpiring, setPermitsExpiring] = useState<Permit[]>([]);
  // R67 E-25: the permits read's failure is STATE, not something swallowed
  // into an empty array. "0 permits expiring" and "we could not find out" are
  // different facts and the card must not print the first when it means the
  // second.
  const [permitsError, setPermitsError] = useState(false);
  // Every entry, for the cumulative day-by-day series -- `recent` stays the
  // five-row list the activity panel shows.
  const [allEntries, setAllEntries] = useState<RecentEntry[]>([]);
  // The BOQ-derived budget (SUM of line amount x budget %), the target the
  // Budget card falls back to when there is no ERP cost-centre budget. It
  // comes from the budget-variance report, which is the one endpoint that
  // already computes it -- no new arithmetic in the browser.
  const [boqBudget, setBoqBudget] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPermits = useCallback(async () => {
    setPermitsError(false);
    try {
      const res = await fetch(`/api/permits?projectId=${encodeURIComponent(projectId)}&withinDays=30`);
      if (!res.ok) throw new Error(`permits fetch failed (${res.status})`);
      const data = await res.json();
      setPermitsExpiring(data.permits ?? []);
    } catch {
      setPermitsExpiring([]);
      setPermitsError(true);
    }
  }, [projectId]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [dashRes, curRes, activitiesRes, entriesRes, varianceRes] = await Promise.all([
        fetch(`/api/dashboard/project/${encodeURIComponent(projectId)}`).then((r) => r.json()),
        fetch("/api/currencies").then((r) => r.json()).catch(() => ({ currencies: [] })),
        fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ activities: [] })),
        fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ entries: [] })),
        fetch(`/api/reports/budget-variance?projectId=${encodeURIComponent(projectId)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        loadPermits(),
      ]);
      setDashboard(dashRes);
      setCurrency((curRes.currencies ?? []).find((c: Currency) => c.isBaseCurrency));
      setActivities(activitiesRes.activities ?? []);
      const entries: RecentEntry[] = entriesRes.entries ?? [];
      setAllEntries(entries);
      setRecent(entries.slice(0, 5));
      setBoqBudget(typeof varianceRes?.totalBudget === "number" ? varianceRes.totalBudget : null);

      // Category breakdown (RIGHT COLUMN, sorted horizontal bar) reuses the
      // ALREADY-REGISTERED "category-progress" report (REPORT_REGISTRY,
      // construction-reports-service.ts) computed server-side (D-4: never
      // summed in the browser) -- no projexa consumer of this real, working
      // report existed before this seq.
      const catRes = await fetch(`/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => null);
      setCategories(catRes?.categories ?? []);
      setLoading(false);
    }
    load();
  }, [projectId, loadPermits]);

  if (loading || !dashboard) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));
  const hasEv = dashboard.earnedValue !== null && dashboard.contractValue !== null;
  const expiringCount = permitsExpiring.length;
  const expiredCount = permitsExpiring.filter((p) => (p.daysToExpiry ?? 0) < 0).length;

  const categoryBars: BarChartDatum[] = categories.map((c) => ({ label: c.name, value: c.percentComplete }));
  const progress = cumulativeProgressSeries(allEntries);
  const budgetCard = budgetCardModel(
    dashboard.expenses,
    dashboard.budget,
    boqBudget,
    `/scope?projectId=${projectId}`,
    (v) => money(v ?? 0, currency)
  );
  const primaryTrend = primaryTrendLabel(
    dashboard.percentByValue,
    dashboard.progressPercent,
    hasEv ? `Earned ${money(dashboard.earnedValue!, currency)}` : "Import a BOQ to see this"
  );

  return (
    <DashboardScreen
      breadcrumb={`Dashboard / ${dashboard.projectName}`}
      // DASHBOARD.PROJECT: "+ New suppressed" -- documented override, this
      // screen answers a question, it doesn't create records.
      newAction={undefined}
      filterAction={{ label: "Filter", disabledReason: "Not yet available" }}
      exportAction={{ label: "Export", disabledReason: "Not yet available" }}
      oneNumber={
        <KpiCard
          size="primary"
          // CONS-01 (R46 P4 consistency sweep): relabelled from "% Complete
          // by Value" to spell out "BOQ" -- this KPI's onClick below sends
          // the user straight to the Work Progress > Analytics screen,
          // which shows its own, genuinely different, "Avg % Complete
          // (Activity Log)" KPI (flat average over all logged entries, no
          // BOQ scoping). Without the distinguishing word here, a user
          // following that link sees a second unlabelled "percent complete"
          // number that disagrees with the one they just clicked.
          label={labelFor(dashboardLabels, "percentByValue", "% Complete by BOQ Value")}
          value={hasEv ? `${dashboard.percentByValue}%` : "No BOQ yet"}
          // R67 E-25: when the BOQ figure is 0 and the activity log is not,
          // the two numbers on screen disagree, and the reader gets the
          // reason and the fix instead of a bare "Earned AED 0".
          trend={{ direction: "flat", tone: primaryTrend.tone, label: primaryTrend.label }}
          baseline={hasEv ? `of ${money(dashboard.contractValue!, currency)} contract value` : ""}
          visual={hasEv ? <BulletChart value={dashboard.earnedValue!} target={dashboard.contractValue!} unit="" /> : undefined}
          // % complete -> ANALYTICAL work-progress, filtered to this project (DASHBOARD.PROJECT's own row)
          onClick={() => router.push(`/work-progress?projectId=${projectId}&tab=analytics`)}
        />
      }
      secondaryKpis={
        <>
          <KpiCard
            label={labelFor(dashboardLabels, "contractValue", "Contract Value")}
            value={hasEv ? money(dashboard.contractValue!, currency) : "—"}
            trend={{ direction: "flat", tone: "context", label: "parent BOQ lines only" }}
            baseline="latest BOQ revision"
            // Contract value -> BOQ (ScopeClient is the CUSTOM screen for the latest revision -- seq22 finding)
            onClick={() => router.push(`/scope?projectId=${projectId}`)}
          />
          {/* Sumeet audit fix (2026-08-30, requirement #10: "Project value
              matches BOQ total"). Real, confirmed gap: this screen already
              fetches dashboard.projectValue (see the ProjectDashboard type
              above) but never rendered it anywhere -- the "FIELD ABSENT"
              defect from the earlier audit round was fixed only in the
              OTHER dashboard screen (DashboardHierarchyClient.tsx), not
              here. Distinguished explicitly from Contract Value, since they
              are two genuinely different figures by design (project value =
              COALESCE(user-entered, linked-PO-sum); contract value = latest
              BOQ's parent-lines-only total) -- rendering this does not
              claim they're equal, it surfaces the real, separate value
              Point 121's own override mechanism controls. Null (not 0) is
              the honest "neither a manual value nor any linked PO exists
              yet" state, matching every other null-safe KPI on this screen. */}
          <KpiCard
            label={labelFor(dashboardLabels, "projectValue", "Project Value")}
            value={dashboard.projectValue !== null ? money(dashboard.projectValue, currency) : "Not set"}
            trend={{ direction: "flat", tone: "context", label: "manual entry, or linked POs" }}
            baseline="overridable per project"
            onClick={() => router.push(`/scope?projectId=${projectId}`)}
          />
          {/* R67 E-25: no bullet bar at all when there is no budget -- a full
              orange bar against a target of zero is a false alarm, not a
              warning. With no cost-centre budget the BOQ-derived one becomes
              the target and the baseline says which is in use. */}
          <KpiCard
            label={labelFor(dashboardLabels, "budgetVsActual", "Budget vs Actual")}
            value={money(budgetCard.spend, currency)}
            trend={{ direction: budgetCard.direction, tone: budgetCard.tone, label: budgetCard.trendWord }}
            baseline={budgetCard.baseline}
            visual={budgetCard.target === null ? undefined : <BulletChart value={budgetCard.spend} target={budgetCard.target} lowerIsBetter unit="" />}
            // With no budget the destination is the place that SETS one.
            onClick={() =>
              router.push(budgetCard.target === null ? budgetCard.href : `/scope?projectId=${projectId}&tab=variance`)
            }
          />
          {/* R67 E-25: a failed read reads "—", never 0. "No permits expire in
              the next 30 days" is a reassurance, and printing it when the
              request failed is the worst possible thing this card can say. */}
          <KpiCard
            label={labelFor(dashboardLabels, "permitsExpiring", "Permits Expiring")}
            value={permitsError ? "—" : String(expiringCount)}
            trend={
              permitsError
                ? { direction: "flat", tone: "needs-you", label: "couldn't load" }
                : {
                    direction: expiredCount > 0 ? "up" : expiringCount > 0 ? "flat" : "down",
                    tone: expiredCount > 0 ? "late" : expiringCount > 0 ? "needs-you" : "done",
                    label: expiredCount > 0 ? `${expiredCount} already expired` : expiringCount > 0 ? "within 30 days" : "none due soon",
                  }
            }
            baseline={permitsError ? "Retry" : "next 30 days"}
            // A failed card's click RETRIES rather than navigating away from
            // the screen the reader is trying to fix.
            onClick={permitsError ? () => void loadPermits() : () => router.push(`/permits?projectId=${projectId}&withinDays=30`)}
          />
        </>
      }
      trendColumn={
        <>
          <h3 className="text-[13px] font-medium text-ct-navy mb-2">{labelFor(dashboardLabels, "progressOverTimeHeading", "Progress logged over time")}</h3>
          {/* Honest scope note: a real AED-denominated "earned value over time"
              trend needs historical earned-value snapshots this codebase
              doesn't persist yet -- plotting one here would mean fabricating
              points. This is the real, current cumulative quantity logged per
              day instead (from actual work-progress entries), clearly labelled
              for what it is rather than overclaiming.
              R67 E-25: EVERY entry, grouped by day, accumulated across days --
              not the last five rows. And with fewer than two distinct days the
              panel says so rather than drawing an axis with the same date at
              both ends. The branch is here, in the client, because D-09
              forbids adding a prop to the kit's LineChart. */}
          {progress.distinctDays >= 2 ? (
            <LineChart series={progress.points} />
          ) : progress.onlyDay ? (
            <p className="text-[12.5px] text-ct-muted">{oneDayCaption(progress.onlyDay)}</p>
          ) : (
            <p className="text-[12.5px] text-ct-muted">{NO_PROGRESS_CAPTION}</p>
          )}
        </>
      }
      breakdownColumn={
        <>
          <h3 className="text-[13px] font-medium text-ct-navy mb-2">{labelFor(dashboardLabels, "progressByCategoryHeading", "Progress by scope category")}</h3>
          {categoryBars.length > 0 ? (
            <BarChart data={categoryBars} unit="%" onBarClick={(d) => router.push(`/work-progress?projectId=${projectId}&tab=analytics&category=${encodeURIComponent(d.label)}`)} />
          ) : (
            <p className="text-[12.5px] text-ct-muted">No category breakdown yet.</p>
          )}
        </>
      }
      linkList={
        <LinkListCard
          title={labelFor(dashboardLabels, "quickActionsTitle", "Quick actions")}
          items={[
            { label: "Record progress", onClick: () => router.push(`/work-progress?projectId=${projectId}`) },
            { label: "New BOQ revision", onClick: () => router.push(`/scope?projectId=${projectId}`) },
            { label: "Import BOQ", onClick: () => router.push(`/scope?projectId=${projectId}`) },
            { label: "Run WPR", onClick: () => router.push(`/work-progress?projectId=${projectId}&tab=report`) },
          ]}
        />
      }
      recentActivity={
        <div className="rounded-md border border-ct-border p-3">
          <h3 className="text-[13px] font-medium text-ct-navy mb-2">{labelFor(dashboardLabels, "recentActivityHeading", "Recent progress entries")}</h3>
          {recent.length === 0 ? (
            <p className="text-[12.5px] text-ct-muted">No entries logged yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {recent.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => router.push(`/work-progress?projectId=${projectId}&tab=analytics`)} className="text-[12.5px] text-ct-teal hover:underline">
                    {e.entryDate} — {activityNameById.get(e.activityId) ?? e.activityId} ({e.percentComplete}%)
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      }
    />
  );
}
