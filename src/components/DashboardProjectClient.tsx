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
  BulletChart,
  BarChart,
  LineChart,
  LinkListCard,
  type BarChartDatum,
  type ScreenColumn,
} from "@fchecklist/veridian-ui-kit/screens";
// R67 D-61: the FORKED KpiCard (src/components/screens/KpiCard.tsx, decision
// D-09), the same one the home band already uses. Two reasons to move this
// screen onto it: a KPI value must not be set in DM Serif Display (the fork
// sets numbers in Inter 600 / tabular figures), and the home and the project
// dashboard must not be two different cards -- they sit one click apart.
import { KpiCard } from "@/components/screens/KpiCard";
// R67 D-61: one money format for the whole product.
import { formatMoney } from "@/lib/format-money";
// R67 D-62: one project-money model. The same wording the home dashboard uses
// for the same two facts, so a project reads the same on both screens.
import { formatProjectValue, projectValueCaption, type ProjectValueSource } from "@/lib/dashboard-kpi";

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
  // R67 D-02: widened to match compliance-tracker's getProjectDashboard(),
  // which now returns null (never 0) when this project's scope has no
  // erp_budget_line_items row at all. "No budget set" and "a budget of zero"
  // are different facts, and this tile used to render the first as the
  // second -- which made it claim "over budget" on the project's very first
  // expense, against a budget nobody had ever set.
  budget: number | null;
  revenue: number;
  expenses: number;
  progressPercent: number;
  delayedTaskCount: number;
  taskCount: number;
  projectValue: number | null;
  /**
   * R67 D-62: which of the two sources projectValue came from. The card used to
   * state "manual entry, or linked POs" for every project, which is a
   * description of the RULE, not of this project -- so a figure summed from
   * purchase orders and a figure a director typed were indistinguishable.
   */
  projectValueSource: ProjectValueSource;
  earnedValue: number | null;
  percentByValue: number | null;
  contractValue: number | null;
};
type Currency = { code: string; isBaseCurrency: boolean };
type CategoryRow = { categoryId: string; name: string; percentComplete: number };
type RecentEntry = { id: string; activityId: string; entryDate: string; quantityDone: string; percentComplete: string };
type Activity = { id: string; name: string };
type Permit = { id: string; daysToExpiry: number | null };

// TC-90: AED with NO rupee sign and NO lakh/crore grouping -- deliberately not
// "en-IN" (lakh grouping) and never a hardcoded "₹" fallback.
//
// R67 D-61: that rule is now formatMoney()'s, shared with every other money
// surface. What changes here is the decimals: this screen rendered whole units
// (maximumFractionDigits: 0) while /scope and the reports rendered two, so the
// same project's contract value read "AED 21,750" on the project dashboard and
// "AED 21,750.00" on the screen the tile links to.
function money(n: number | null | undefined, currency: Currency | undefined) {
  return formatMoney(n, { currency: currency?.code ?? null });
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
      setCategories(catRes?.categories ?? []);
      setLoading(false);
    }
    load();
  }, [projectId]);

  if (loading || !dashboard) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

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
            value={formatProjectValue(dashboard.projectValue, (n) => money(n, currency))}
            // R67 D-62: THIS project's source, not a restatement of the rule.
            trend={{ direction: "flat", tone: "context", label: projectValueCaption(dashboard.projectValueSource) }}
            baseline="overridable per project"
            onClick={() => router.push(`/scope?projectId=${projectId}`)}
          />
          {/* R67 D-02: with no budget set there is nothing to be over, so the
              card states the spend, says the budget is missing, drops the
              bullet chart (a target of 0 rendered a full red bar) and sends
              the user to the one screen that fixes it -- the budget create
              screen for THIS project -- instead of to a variance view with
              nothing to vary against. */}
          <KpiCard
            label={labelFor(dashboardLabels, "budgetVsActual", "Budget vs Actual")}
            value={money(dashboard.expenses, currency)}
            trend={
              dashboard.budget === null
                ? { direction: "flat", tone: "context", label: "no budget set" }
                : {
                    direction: dashboard.expenses > dashboard.budget ? "up" : "down",
                    tone: dashboard.expenses > dashboard.budget ? "late" : "done",
                    label: dashboard.expenses > dashboard.budget ? "over budget" : "within budget",
                  }
            }
            baseline={dashboard.budget === null ? "spend to date" : `budget ${money(dashboard.budget, currency)}`}
            visual={dashboard.budget === null ? undefined : <BulletChart value={dashboard.expenses} target={dashboard.budget} lowerIsBetter unit="" />}
            // Budget vs actual -> ANALYTICAL cost variance, filtered (DASHBOARD.PROJECT's own row)
            onClick={() =>
              router.push(
                dashboard.budget === null
                  ? `/finance/budgets/new?projectId=${projectId}`
                  // R67 D-62: the Cost Variance tab is the Budget module now.
                  : `/scope?projectId=${projectId}&tab=budget`
              )
            }
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
