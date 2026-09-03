"use client";

// R42 seq24 (M28 DASHBOARD archetype, DASHBOARD.PROJECT row): "the first
// screen a PM opens every morning." Registry-driven -- zero bespoke
// components, per DASHBOARD.PROJECT's own components_used list. Every KPI
// is clickable and carries its own filters through (GLOBAL: "EVERY NUMBER
// IS A DOOR" / "A KPI WITH NO DESTINATION MUST NOT SHIP") -- see each
// onClick below for exactly where it lands and why that's a real screen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DashboardScreen,
  KpiCard,
  BulletChart,
  LineChart,
  LinkListCard,
  type ScreenColumn,
} from "@fchecklist/veridian-ui-kit/screens";
// R67 E-02 (R-012), chart 2: the percent-only kit BarChart in breakdownColumn
// is replaced by the real category-distribution charts. The presentational
// half is imported so this screen's own already-fetched category-progress
// response feeds it -- no second request, and the percentage and the money
// come from one read of one BOQ revision.
import { CategoryDistributionChartsView, type CategoryEntry } from "@/components/CategoryDistributionCharts";
import { useOrgMoney } from "@/lib/use-org-money";

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
// R67 E-02: the category-progress report now carries the money as well as the
// percentage (compliance-tracker categoryProgressReport). Older fields are
// unchanged; totalAmount/completedAmount/sharePercent are additive, so a
// response from a backend that predates that change still renders -- the
// figures simply read as zero money until it lands.
type CategoryRow = CategoryEntry;
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
  const orgMoney = useOrgMoney();
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [permitsExpiring, setPermitsExpiring] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [dashRes, curRes, permitsRes, activitiesRes, entriesRes] = await Promise.all([
        fetch(`/api/dashboard/project/${encodeURIComponent(projectId)}`).then((r) => r.json()),
        fetch("/api/currencies").then((r) => r.json()).catch(() => ({ currencies: [] })),
        fetch(`/api/permits?projectId=${encodeURIComponent(projectId)}&withinDays=30`).then((r) => r.json()).catch(() => ({ permits: [] })),
        fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ activities: [] })),
        fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ entries: [] })),
      ]);
      setDashboard(dashRes);
      setCurrency((curRes.currencies ?? []).find((c: Currency) => c.isBaseCurrency));
      setPermitsExpiring(permitsRes.permits ?? []);
      setActivities(activitiesRes.activities ?? []);
      setRecent((entriesRes.entries ?? []).slice(0, 5));

      // Category breakdown (RIGHT COLUMN, sorted horizontal bar) reuses the
      // ALREADY-REGISTERED "category-progress" report (REPORT_REGISTRY,
      // construction-reports-service.ts) computed server-side (D-4: never
      // summed in the browser) -- no projexa consumer of this real, working
      // report existed before this seq.
      const catRes = await fetch(`/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => null);
      setCategories(
        (catRes?.categories ?? []).map((c: Partial<CategoryRow> & { categoryId: string; name: string }) => ({
          categoryId: c.categoryId,
          name: c.name,
          percentComplete: Number(c.percentComplete ?? 0),
          totalAmount: Number(c.totalAmount ?? 0),
          completedAmount: Number(c.completedAmount ?? 0),
          sharePercent: Number(c.sharePercent ?? 0),
        }))
      );
      setLoading(false);
    }
    load();
  }, [projectId]);

  if (loading || !dashboard) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));
  const hasEv = dashboard.earnedValue !== null && dashboard.contractValue !== null;
  const expiringCount = permitsExpiring.length;
  const expiredCount = permitsExpiring.filter((p) => (p.daysToExpiry ?? 0) < 0).length;

  return (
    <DashboardScreen
      breadcrumb={`Dashboard / ${dashboard.projectName}`}
      // DASHBOARD.PROJECT: "+ New suppressed" -- documented override, this
      // screen answers a question, it doesn't create records.
      newAction={undefined}
      // R67 E-18 (R-178): both reasons name a real destination. A dashboard is
      // not a document, so its Export is genuinely elsewhere -- and saying
      // WHERE is the difference between a limitation and a dead end.
      filterAction={{ label: "Filter", disabledReason: "This screen is one project — change it in the top rail, or filter the portfolio on the home dashboard" }}
      exportAction={{ label: "Export", disabledReason: "Export from Reports — run Project Status for this project" }}
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
          <KpiCard
            label={labelFor(dashboardLabels, "permitsExpiring", "Permits Expiring")}
            value={String(expiringCount)}
            trend={{
              direction: expiredCount > 0 ? "up" : expiringCount > 0 ? "flat" : "down",
              tone: expiredCount > 0 ? "late" : expiringCount > 0 ? "needs-you" : "done",
              label: expiredCount > 0 ? `${expiredCount} already expired` : expiringCount > 0 ? "within 30 days" : "none due soon",
            }}
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
          {/* R67 E-02 (R-012): was the kit's percent-only BarChart, which told
              a reader "Civil 40%" without saying whether Civil is a tenth of
              the job or nine tenths. This is the real distribution -- share of
              the BOQ, completed against total in money, a pie only at five
              categories or fewer, and every category a link into Work Progress
              > Analytics filtered to it. Its own empty state names the next
              step ("Import a BOQ"), so the "No category breakdown yet." dead
              end is gone with it. */}
          <CategoryDistributionChartsView categories={categories} projectId={projectId} money={orgMoney.money} />
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
