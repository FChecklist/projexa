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
//
// R67 E-29 (R-255): the "Progress by scope category" panel was a percent-only
// bar chart, which ranked a 100%-complete AED 4,000 category above a
// 40%-complete AED 4,000,000 one. It now mounts CategoryDistributionCharts --
// the same component and the same server-side arithmetic the company
// hierarchy uses -- so category SIZE and category PROGRESS are read together.
// R67 E-38 (R-270 / R-296): EVERY TILE IS A REAL LINK WITH ONE ASSERTED
// DESTINATION. The five KPI tiles were <button>s calling router.push(), and
// R-270 recorded one of them resolving to a NEIGHBOUR's destination -- a class
// of bug an href cannot have. They are now single Next <Link>s
// (ProjectKpiTile, the D-09 fork of the kit's KpiCard), each carrying
// projectId, except the Permits tile in its FAILED state, whose job is to
// retry its own read rather than to navigate.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DashboardScreen,
  BulletChart,
  LineChart,
  LinkListCard,
  type ScreenColumn,
} from "@fchecklist/veridian-ui-kit/screens";
import { ProjectKpiTile } from "@/components/screens/ProjectKpiTile";
import { CategoryDistributionCharts } from "@/components/CategoryDistributionCharts";
import { formatDateTimeDMY } from "@/lib/format-date";
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
  // R67 E-39 (R-297): two different progress figures reach this screen and both
  // were called "progress". Each is now named by the base it is measured
  // against, here and on the chart heading below.
  { field: "percentByValue", label: "% complete by BOQ value", type: "text" },
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
  // R67 E-39 (R-271): null (never 0) when this project has no ERP cost-centre
  // budget at all. The server stopped coalescing it; this type stopped lying
  // about it.
  budget: number | null;
  revenue: number;
  expenses: number;
  progressPercent: number;
  /** R67 E-39: the same two numbers under names that say what they measure. */
  progressByActivityLogPct?: number;
  progressByBoqValuePct?: number | null;
  delayedTaskCount: number;
  taskCount: number;
  projectValue: number | null;
  earnedValue: number | null;
  percentByValue: number | null;
  contractValue: number | null;
  /** R67 E-39 (R-293): when the server computed these figures, ISO 8601. */
  generatedAt?: string;
};
type Currency = { code: string; isBaseCurrency: boolean };
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
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [permitsExpiring, setPermitsExpiring] = useState<Permit[]>([]);
  // R67 E-25: the permits read's failure is STATE, not something swallowed
  // into an empty array. "0 permits expiring" and "we could not find out" are
  // different facts and the card must not print the first when it means the
  // second.
  const [permitsError, setPermitsError] = useState(false);
  // R67 E-39 (R-293): the SAME rule for the tiles the project-dashboard call
  // feeds. It used to hand a failed response straight into setDashboard, so a
  // 500 rendered four tiles of undefined figures rather than saying nothing
  // could be read.
  const [dashboardError, setDashboardError] = useState(false);
  // And for the BOQ-derived budget: a failed variance read used to look exactly
  // like "this project has no BOQ budget", which then made the Budget tile
  // announce "No budget set" about a figure nobody had actually looked up.
  const [varianceError, setVarianceError] = useState(false);
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

  const load = useCallback(async () => {
      setLoading(true);
      setDashboardError(false);
      setVarianceError(false);
      const [dashRes, curRes, activitiesRes, entriesRes, varianceRes] = await Promise.all([
        // R67 E-39: the STATUS is read before the body. `.then(r => r.json())`
        // turned a 500's error body into a dashboard object, and four tiles
        // then rendered figures out of `undefined`.
        fetch(`/api/dashboard/project/${encodeURIComponent(projectId)}`)
          .then(async (r) => (r.ok ? ((await r.json()) as ProjectDashboard) : null))
          .catch(() => null),
        fetch("/api/currencies").then((r) => r.json()).catch(() => ({ currencies: [] })),
        fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ activities: [] })),
        fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()).catch(() => ({ entries: [] })),
        fetch(`/api/reports/budget-variance?projectId=${encodeURIComponent(projectId)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        loadPermits(),
      ]);
      setDashboard(dashRes);
      setDashboardError(dashRes === null);
      setCurrency((curRes.currencies ?? []).find((c: Currency) => c.isBaseCurrency));
      setActivities(activitiesRes.activities ?? []);
      const entries: RecentEntry[] = entriesRes.entries ?? [];
      setAllEntries(entries);
      setRecent(entries.slice(0, 5));
      setVarianceError(varianceRes === null);
      setBoqBudget(typeof varianceRes?.totalBudget === "number" ? varianceRes.totalBudget : null);

      // R67 E-29: the category breakdown used to be fetched HERE, serially,
      // after the five parallel calls above had already resolved -- so the
      // whole screen waited on it before rendering anything. It now belongs to
      // CategoryDistributionCharts, which loads itself and shows its own
      // labelled skeleton, and the rest of the dashboard paints one round trip
      // sooner.
      setLoading(false);
  }, [projectId, loadPermits]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  // R67 E-39 (R-293): the project dashboard call feeds four of the five tiles.
  // When it fails there is nothing honest to put in them, so the screen says
  // so ONCE and offers the retry -- rather than four identical dead tiles, and
  // rather than the figures-out-of-undefined it used to render.
  if (!dashboard || dashboardError) {
    return (
      <div className="space-y-2 p-6">
        <p role="alert" className="text-[13px] text-px-error">
          — could not load this project&apos;s dashboard
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-ct-border2 px-3 py-1.5 text-[13px] text-ct-navy"
        >
          Retry
        </button>
      </div>
    );
  }

  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));
  const hasEv = dashboard.earnedValue !== null && dashboard.contractValue !== null;
  const expiringCount = permitsExpiring.length;
  const expiredCount = permitsExpiring.filter((p) => (p.daysToExpiry ?? 0) < 0).length;

  // R67 E-39 (R-293): the stamp every tile carries. The server says when it
  // computed the figures; if an older VERIDIAN answers without generatedAt,
  // the tiles simply carry no stamp rather than one invented in the browser --
  // a made-up "as of" is worse than none.
  const asOf = dashboard.generatedAt ? formatDateTimeDMY(dashboard.generatedAt) : undefined;
  // R67 E-39 (R-297): the activity-log figure, under its own name. The named
  // field is preferred; progressPercent is the same number from an older
  // payload.
  const activityLogPct = dashboard.progressByActivityLogPct ?? dashboard.progressPercent;
  const boqValuePct = dashboard.progressByBoqValuePct ?? dashboard.percentByValue;

  const progress = cumulativeProgressSeries(allEntries);
  const budgetCard = budgetCardModel(
    dashboard.expenses,
    dashboard.budget,
    boqBudget,
    {
      budgets: `/budgets?projectId=${projectId}`,
      setBudget: `/budgets/new?projectId=${projectId}`,
    },
    (v) => money(v ?? 0, currency)
  );
  const primaryTrend = primaryTrendLabel(
    boqValuePct,
    activityLogPct,
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
        <ProjectKpiTile
          size="primary"
          // CONS-01 (R46 P4 consistency sweep): relabelled from "% Complete
          // by Value" to spell out "BOQ" -- this KPI's onClick below sends
          // the user straight to the Work Progress > Analytics screen,
          // which shows its own, genuinely different, "Avg % Complete
          // (Activity Log)" KPI (flat average over all logged entries, no
          // BOQ scoping). Without the distinguishing word here, a user
          // following that link sees a second unlabelled "percent complete"
          // number that disagrees with the one they just clicked.
          label={labelFor(dashboardLabels, "percentByValue", "% complete by BOQ value")}
          value={hasEv ? `${boqValuePct}%` : "No BOQ yet"}
          asOf={asOf}
          // R67 E-25: when the BOQ figure is 0 and the activity log is not,
          // the two numbers on screen disagree, and the reader gets the
          // reason and the fix instead of a bare "Earned AED 0".
          trend={{ direction: "flat", tone: primaryTrend.tone, label: primaryTrend.label }}
          baseline={hasEv ? `of ${money(dashboard.contractValue!, currency)} contract value` : ""}
          visual={hasEv ? <BulletChart value={dashboard.earnedValue!} target={dashboard.contractValue!} unit="" /> : undefined}
          // R67 E-38: the NUMBER'S BREAKDOWN, which is the Work Progress
          // Report's scope view -- this percentage is earned value over
          // contract value, and the scope view is the line-by-line table whose
          // Grand Total is exactly those two figures (D-02's one report). It
          // used to go to the Analytics tab, which shows a DIFFERENT
          // percentage (the activity-log average), so following the link
          // answered a question the reader had not asked.
          href={`/work-progress?projectId=${projectId}&tab=report&view=scope`}
        />
      }
      secondaryKpis={
        <>
          <ProjectKpiTile
            label={labelFor(dashboardLabels, "contractValue", "Contract Value")}
            value={hasEv ? money(dashboard.contractValue!, currency) : "—"}
            trend={{ direction: "flat", tone: "context", label: "parent BOQ lines only" }}
            baseline="latest BOQ revision"
            asOf={asOf}
            // Contract value -> BOQ (ScopeClient is the CUSTOM screen for the latest revision -- seq22 finding)
            href={`/scope?projectId=${projectId}`}
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
          {/* R67 E-38: "Project settings route, or /scope until that route
              exists" -- and it does not exist in this repo, so /scope it is.
              That makes this tile and Contract Value share a destination; the
              alternative was inventing a route (D-01/WS-D owns /projects/new)
              or pointing at /purchase-orders, which ignores projectId and would
              show every PO in the organisation. A shared honest destination
              beats a distinct misleading one. */}
          <ProjectKpiTile
            label={labelFor(dashboardLabels, "projectValue", "Project Value")}
            value={dashboard.projectValue !== null ? money(dashboard.projectValue, currency) : "Not set"}
            trend={{ direction: "flat", tone: "context", label: "manual entry, or linked POs" }}
            baseline="overridable per project"
            asOf={asOf}
            href={`/scope?projectId=${projectId}`}
          />
          {/* R67 E-25: no bullet bar at all when there is no budget -- a full
              orange bar against a target of zero is a false alarm, not a
              warning. With no cost-centre budget the BOQ-derived one becomes
              the target and the baseline says which is in use. */}
          {/* R67 E-39 (R-271): with no budget this reads "AED 185,000 spent",
              "No budget set — Set budget", and NOTHING else: no bar, no arrow,
              no verdict word. A failed variance read is its own state -- it
              must not be allowed to say "No budget set" about a figure nobody
              managed to look up. */}
          <ProjectKpiTile
            label={labelFor(dashboardLabels, "budgetVsActual", "Budget vs Actual")}
            value={varianceError ? "—" : budgetCard.value}
            trend={
              varianceError
                ? { direction: "flat", tone: "needs-you", label: "could not load" }
                : budgetCard.trend
                  ? { direction: budgetCard.trend.direction, tone: budgetCard.trend.tone, label: budgetCard.trend.word }
                  : null
            }
            baseline={varianceError ? "Retry" : budgetCard.baseline}
            asOf={varianceError ? undefined : asOf}
            visual={varianceError || budgetCard.target === null ? undefined : <BulletChart value={budgetCard.spend} target={budgetCard.target} lowerIsBetter unit="" />}
            // R67 E-38: /budgets is where a budget is READ; /budgets/new is
            // where one is SET, and with no budget at all that is the only
            // useful door. Deliberately ONE href either way rather than a
            // second "Set budget" link INSIDE the tile: a link inside a link is
            // invalid markup, and the observed neighbour-href bug is exactly
            // what nested interactive elements produce.
            href={varianceError ? undefined : budgetCard.href}
            onClick={varianceError ? () => void load() : undefined}
          />
          {/* R67 E-25: a failed read reads "—", never 0. "No permits expire in
              the next 30 days" is a reassurance, and printing it when the
              request failed is the worst possible thing this card can say. */}
          {/* R67 E-38: a LINK when the read succeeded, a Retry BUTTON when it
              failed. The two are different jobs and the control should be the
              one that matches: navigating away from the screen you are trying
              to fix is not what "Retry" means. */}
          <ProjectKpiTile
            label={labelFor(dashboardLabels, "permitsExpiring", "Permits Expiring")}
            value={permitsError ? "—" : String(expiringCount)}
            trend={
              permitsError
                // R67 E-39 supersedes E-25's phrasing here. E-25 shipped
                // "couldn't load"; E-39 generalises the rule to every tile and
                // spells it "could not load", and one register across the five
                // tiles beats matching the earlier item's contraction. Flagged
                // to the owner as a two-item wording conflict inside one audit.
                ? { direction: "flat", tone: "needs-you", label: "could not load" }
                : {
                    direction: expiredCount > 0 ? "up" : expiringCount > 0 ? "flat" : "down",
                    tone: expiredCount > 0 ? "late" : expiringCount > 0 ? "needs-you" : "done",
                    label: expiredCount > 0 ? `${expiredCount} already expired` : expiringCount > 0 ? "within 30 days" : "none due soon",
                  }
            }
            baseline={permitsError ? "Retry" : "next 30 days"}
            asOf={permitsError ? undefined : asOf}
            href={permitsError ? undefined : `/permits?projectId=${projectId}&withinDays=30`}
            onClick={permitsError ? () => void loadPermits() : undefined}
          />
        </>
      }
      trendColumn={
        <>
          <h3 className="text-[13px] font-medium text-ct-navy mb-1">{labelFor(dashboardLabels, "progressOverTimeHeading", "Progress logged over time")}</h3>
          {/* R67 E-39 (R-297): the OTHER progress figure, named by the base it
              is measured against, beside the chart it comes from. Deliberately
              NOT the chart's title: this panel plots cumulative QUANTITY
              logged per day, and titling it with a percentage would mislabel
              its own axis. The two measures are now "% complete by BOQ value"
              (the tile above) and "% complete by activity log" (here), and a
              reader comparing 0% with 60% can see they are different
              questions. */}
          <p className="mb-2 text-[11.5px] text-ct-muted">% complete by activity log: {activityLogPct}%</p>
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
          {/* R67 E-29 (R-255): the percent-only bar is replaced by the real
              category chart -- the one the company hierarchy already shows.
              WHY THE SWAP IS A FIX AND NOT A PREFERENCE: a bar of
              "Civil 42%, Joinery 8%" tells a PM which trade is furthest along
              but nothing about which trade MATTERS, so a 100%-complete
              AED 4,000 category out-drew a 40%-complete AED 4,000,000 one.
              This chart draws each category's BOQ amount with its completed
              value over it and prints both, so size and progress are read
              together. It is the SAME component and the same server-side
              arithmetic as /dashboard/hierarchy -- one derivation, two
              screens (src/lib/category-distribution.ts). */}
          <CategoryDistributionCharts projectId={projectId} />
        </>
      }
      linkList={
        <LinkListCard
          title={labelFor(dashboardLabels, "quickActionsTitle", "Quick actions")}
          items={[
            // R67 E-38 (R-296): the quick action lands ON the entry form with
            // its first field focused (focus=1), rather than on whichever tab
            // the Work Progress page happened to default to, leaving the
            // reader to find the form and click into it.
            { label: "Record progress", onClick: () => router.push(`/work-progress?projectId=${projectId}&tab=entry&focus=1`) },
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
