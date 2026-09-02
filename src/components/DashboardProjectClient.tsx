"use client";

// R42 seq24 (M28 DASHBOARD archetype, DASHBOARD.PROJECT row): "the first
// screen a PM opens every morning." Registry-driven -- zero bespoke
// components, per DASHBOARD.PROJECT's own components_used list. Every KPI
// is clickable and carries its own filters through (GLOBAL: "EVERY NUMBER
// IS A DOOR" / "A KPI WITH NO DESTINATION MUST NOT SHIP") -- see each
// onClick below for exactly where it lands and why that's a real screen.
//
// --- R67 D-65: this screen was one thrown TypeError away from a blank page --
//
// Every read here was `fetch(...).then(r => r.json())` with the status never
// checked, and four of the six ended in `.catch(() => ({ x: [] }))`. Two
// consequences, both on the project's primary screen:
//
//   * A 500 on the dashboard call assigned the ERROR BODY to `dashboard`,
//     after which money(dashboard.expenses) called .toLocaleString on an
//     undefined. There is no error.tsx under /dashboard/project, so that
//     throw took the whole route down.
//   * A failed permits call rendered "Permits Expiring: 0" in the SAGE done
//     tone with the words "none due soon" -- a confident all-clear on the
//     one tile whose entire purpose is to warn.
//
// Both are now the shared rule: a read that failed says so, and no number,
// percentage or tone is minted from a call that did not answer.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, fetchJson } from "@/lib/fetch-json";
import { PaneErrorCard, PaneWaitingCaption } from "@/components/PaneState";
import { Skeleton } from "@/components/ui/skeleton";
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

type PaneError = { status: number | null; message: string | null } | null;

/** What the transport actually said, kept whole for the dictionary to classify. */
function toPaneError(reason: unknown): PaneError {
  return {
    status: reason instanceof ApiError ? reason.status : null,
    message: reason instanceof Error ? reason.message : null,
  };
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
  const [loading, setLoading] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [dashboardError, setDashboardError] = useState<PaneError>(null);
  // R67 D-65 / D-03: a PANEL that failed is tracked separately from a panel
  // that answered with nothing, because the two KPIs read differently.
  const [permitsFailed, setPermitsFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setStartedAt(Date.now());
    setDashboardError(null);
    setPermitsFailed(false);

    const [dashR, curR, permitsR, activitiesR, entriesR, catR] = await Promise.allSettled([
      fetchJson<ProjectDashboard>(`/api/dashboard/project/${encodeURIComponent(projectId)}`),
      fetchJson<{ currencies?: Currency[] }>("/api/currencies"),
      fetchJson<{ permits?: Permit[] }>(`/api/permits?projectId=${encodeURIComponent(projectId)}&withinDays=30`),
      fetchJson<{ activities?: Activity[] }>(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ entries?: RecentEntry[] }>(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`),
      // Category breakdown (RIGHT COLUMN, sorted horizontal bar) reuses the
      // ALREADY-REGISTERED "category-progress" report (REPORT_REGISTRY,
      // construction-reports-service.ts) computed server-side (D-4: never
      // summed in the browser).
      fetchJson<{ categories?: CategoryRow[] }>(`/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`),
    ]);

    if (dashR.status === "fulfilled") setDashboard(dashR.value);
    else setDashboardError(toPaneError(dashR.reason));

    setCurrency(
      curR.status === "fulfilled" ? (curR.value.currencies ?? []).find((c) => c.isBaseCurrency) : undefined
    );

    if (permitsR.status === "fulfilled") setPermitsExpiring(permitsR.value.permits ?? []);
    else setPermitsFailed(true);

    setActivities(activitiesR.status === "fulfilled" ? (activitiesR.value.activities ?? []) : []);
    setRecent(entriesR.status === "fulfilled" ? (entriesR.value.entries ?? []).slice(0, 5) : []);
    setCategories(catR.status === "fulfilled" ? (catR.value.categories ?? []) : []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // R67 D-65: a skeleton in this screen's own shape -- one primary tile and
  // four secondaries -- rather than the words "Loading…" in the corner, and
  // the wait is narrated on the shared 2/3/8 s timeline.
  if (loading && !dashboard) {
    return (
      <div className="flex-1 space-y-4 p-6">
        <PaneWaitingCaption startedAt={startedAt} entity="this project's dashboard" onRetry={() => void load()} />
        <Skeleton className="h-32 w-full max-w-3xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // THE FAULT THIS REPLACES. Every read on this screen was
  // `fetch(...).then(r => r.json())` with the status never checked. A 500 on
  // the dashboard call therefore assigned the ERROR BODY to `dashboard`, and
  // the render below immediately called money(dashboard.expenses) on an
  // undefined -- a thrown TypeError, on the project's primary screen, with no
  // error boundary under /dashboard/project to catch it.
  if (!dashboard) {
    return (
      <div className="flex-1 p-6">
        <PaneErrorCard entity="this project's dashboard" error={dashboardError} onRetry={() => void load()} />
      </div>
    );
  }

  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));
  const hasEv = dashboard.earnedValue !== null && dashboard.contractValue !== null;
  const expiringCount = permitsExpiring.length;
  const expiredCount = permitsExpiring.filter((p) => (p.daysToExpiry ?? 0) < 0).length;

  const categoryBars: BarChartDatum[] = categories.map((c) => ({ label: c.name, value: c.percentComplete }));

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
          trend={{ direction: "flat", tone: "context", label: hasEv ? `Earned ${money(dashboard.earnedValue!, currency)}` : "Import a BOQ to see this" }}
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
          <KpiCard
            label={labelFor(dashboardLabels, "budgetVsActual", "Budget vs Actual")}
            value={money(dashboard.expenses, currency)}
            trend={{
              direction: dashboard.expenses > dashboard.budget ? "up" : "down",
              tone: dashboard.expenses > dashboard.budget ? "late" : "done",
              label: dashboard.expenses > dashboard.budget ? "over budget" : "within budget",
            }}
            baseline={`budget ${money(dashboard.budget, currency)}`}
            visual={<BulletChart value={dashboard.expenses} target={dashboard.budget} lowerIsBetter unit="" />}
            // Budget vs actual -> ANALYTICAL cost variance, filtered (DASHBOARD.PROJECT's own row)
            onClick={() => router.push(`/scope?projectId=${projectId}&tab=variance`)}
          />
          {/* R67 D-65 / D-03. This read used to end in
              `.catch(() => ({ permits: [] }))`, so a failed permits call
              rendered "0" in the SAGE done tone with the words "none due
              soon" -- a confident all-clear on the one tile whose whole
              purpose is to warn. The count is an en-dash when the read
              failed, the tone is neutral context, and the destination still
              works so the user can go and look for themselves. */}
          <KpiCard
            label={labelFor(dashboardLabels, "permitsExpiring", "Permits Expiring")}
            value={permitsFailed ? "—" : String(expiringCount)}
            trend={
              permitsFailed
                ? { direction: "flat", tone: "context", label: "could not load" }
                : {
                    direction: expiredCount > 0 ? "up" : expiringCount > 0 ? "flat" : "down",
                    tone: expiredCount > 0 ? "late" : expiringCount > 0 ? "needs-you" : "done",
                    label: expiredCount > 0 ? `${expiredCount} already expired` : expiringCount > 0 ? "within 30 days" : "none due soon",
                  }
            }
            baseline="next 30 days"
            // Permits expiring -> PERMITS.LIST pre-filtered "Expiring 30d" (DASHBOARD.PROJECT's own row, verbatim)
            onClick={() => router.push(`/permits?projectId=${projectId}&withinDays=30`)}
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
              for what it is rather than overclaiming. */}
          <LineChart series={recent.slice().reverse().map((e, i) => ({ label: e.entryDate, value: recent.slice(0, i + 1).reduce((s, r) => s + Number(r.quantityDone), 0) }))} />
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
