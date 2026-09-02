"use client";

// R42 seq24 (M28 DASHBOARD archetype, DASHBOARD.PROJECT row): "the first
// screen a PM opens every morning." Registry-driven -- zero bespoke
// components, per DASHBOARD.PROJECT's own components_used list. Every KPI
// is clickable and carries its own filters through (GLOBAL: "EVERY NUMBER
// IS A DOOR" / "A KPI WITH NO DESTINATION MUST NOT SHIP") -- see each
// onClick below for exactly where it lands and why that's a real screen.
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

// R67 F-01 (R-006/R-011) -- the D-04 request budget, applied per panel.
//
// THE BUG. This screen had ONE `loading` flag over six calls and rendered the
// word "Loading" on an otherwise empty page until every one of them came back.
// The sixth, the category-progress report, was not even in the Promise.all: it
// was awaited AFTERWARDS, serially, so the whole dashboard waited on a chart
// nobody had asked for yet. If any single call hung, the screen showed
// "Loading" until the browser gave up, with nothing to retry.
//
// THE BUDGET. Every call now carries its own AbortSignal with an 8 s budget,
// and each panel owns its own state: at 3 s a still-pending panel says
// "Still loading…" -- so a slow screen admits it is slow instead of looking
// frozen -- and on failure or timeout it becomes "Couldn't load" with a Retry
// for that panel alone, while the rest of the screen stays usable. No numeric
// placeholder is rendered in between: a zero on a financial card is a figure
// the reader may act on.
const PANEL_BUDGET_MS = 8_000;
const PANEL_SLOW_MS = 3_000;

type PanelState<T> = { status: "loading" | "ready" | "error"; data: T };

/** Fetches one panel's data within the shared budget. Never throws: a panel
 *  that fails is an error IN THAT PANEL, not a broken screen. */
async function loadPanel<T>(url: string, pick: (body: Record<string, unknown>) => T, fallback: T): Promise<PanelState<T>> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PANEL_BUDGET_MS) });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { status: "error", data: fallback };
    return { status: "ready", data: pick((body ?? {}) as Record<string, unknown>) };
  } catch {
    return { status: "error", data: fallback };
  }
}

export default function DashboardProjectClient({ projectId, labels }: { projectId: string; labels?: RegistryColumn[] | null }) {
  const router = useRouter();
  const dashboardLabels = labels && labels.length > 0 ? labels : DEFAULT_LABELS;
  const [dashboardPanel, setDashboardPanel] = useState<PanelState<ProjectDashboard | null>>({ status: "loading", data: null });
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [categoriesPanel, setCategoriesPanel] = useState<PanelState<CategoryRow[]>>({ status: "loading", data: [] });
  const [recentPanel, setRecentPanel] = useState<PanelState<RecentEntry[]>>({ status: "loading", data: [] });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [permitsPanel, setPermitsPanel] = useState<PanelState<Permit[]>>({ status: "loading", data: [] });
  const [slow, setSlow] = useState(false);

  const load = useCallback(async () => {
    setDashboardPanel({ status: "loading", data: null });
    setCategoriesPanel({ status: "loading", data: [] });
    setRecentPanel({ status: "loading", data: [] });
    setPermitsPanel({ status: "loading", data: [] });
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), PANEL_SLOW_MS);

    // All six in ONE parallel wave -- the category-progress report included.
    // It used to be awaited after the other five had ALL resolved, which made
    // the slowest of them and the chart's own call additive, not concurrent.
    const [dash, cur, permits, acts, entries, cats] = await Promise.all([
      loadPanel<ProjectDashboard | null>(`/api/dashboard/project/${encodeURIComponent(projectId)}`, (b) => b as unknown as ProjectDashboard, null),
      loadPanel<Currency[]>("/api/currencies", (b) => (b.currencies as Currency[]) ?? [], []),
      loadPanel<Permit[]>(`/api/permits?projectId=${encodeURIComponent(projectId)}&withinDays=30`, (b) => (b.permits as Permit[]) ?? [], []),
      loadPanel<Activity[]>(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`, (b) => (b.activities as Activity[]) ?? [], []),
      loadPanel<RecentEntry[]>(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`, (b) => ((b.entries as RecentEntry[]) ?? []).slice(0, 5), []),
      // Category breakdown (RIGHT COLUMN, sorted horizontal bar) reuses the
      // ALREADY-REGISTERED "category-progress" report (REPORT_REGISTRY,
      // construction-reports-service.ts) computed server-side (D-4: never
      // summed in the browser).
      loadPanel<CategoryRow[]>(`/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`, (b) => (b.categories as CategoryRow[]) ?? [], []),
    ]);

    clearTimeout(slowTimer);
    setDashboardPanel(dash);
    setCurrency(cur.data.find((c) => c.isBaseCurrency));
    setPermitsPanel(permits);
    setActivities(acts.data);
    setRecentPanel(entries);
    setCategoriesPanel(cats);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const dashboard = dashboardPanel.data;
  const permitsExpiring = permitsPanel.data;
  const categories = categoriesPanel.data;
  const recent = recentPanel.data;

  // The frame, the breadcrumb and every card LABEL paint on the first render.
  // Only the values wait, and each one says what it is waiting for.
  function panelText(panel: PanelState<unknown>, resolved: () => string): string {
    if (panel.status === "error") return "Couldn't load";
    if (panel.status === "loading") return slow ? "Still loading…" : "";
    return resolved();
  }

  function retryVisual(panel: PanelState<unknown>) {
    if (panel.status !== "error") return undefined;
    return (
      <button type="button" onClick={() => void load()} className="text-[12.5px] text-ct-teal underline">
        Retry
      </button>
    );
  }

  // A card whose data failed must not also be a link: KpiCard renders as a
  // <button> when onClick is set, and a Retry button inside it would be
  // invalid nested-interactive markup.
  function panelClick(panel: PanelState<unknown>, onClick: () => void) {
    return panel.status === "ready" ? onClick : undefined;
  }

  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));
  const hasEv = !!dashboard && dashboard.earnedValue !== null && dashboard.contractValue !== null;
  const expiringCount = permitsExpiring.length;
  const expiredCount = permitsExpiring.filter((p) => (p.daysToExpiry ?? 0) < 0).length;

  const categoryBars: BarChartDatum[] = categories.map((c) => ({ label: c.name, value: c.percentComplete }));

  return (
    <DashboardScreen
      // The breadcrumb is on screen from the first render: the project's name
      // once it is known, the neutral heading until then -- never a blank bar.
      breadcrumb={dashboard ? `Dashboard / ${dashboard.projectName}` : "Dashboard"}
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
          value={panelText(dashboardPanel, () => (hasEv ? `${dashboard!.percentByValue}%` : "No BOQ yet"))}
          trend={{ direction: "flat", tone: "context", label: hasEv ? `Earned ${money(dashboard!.earnedValue!, currency)}` : dashboardPanel.status === "ready" ? "Import a BOQ to see this" : "" }}
          baseline={hasEv ? `of ${money(dashboard!.contractValue!, currency)} contract value` : ""}
          visual={hasEv ? <BulletChart value={dashboard!.earnedValue!} target={dashboard!.contractValue!} unit="" /> : retryVisual(dashboardPanel)}
          // % complete -> ANALYTICAL work-progress, filtered to this project (DASHBOARD.PROJECT's own row)
          onClick={panelClick(dashboardPanel, () => router.push(`/work-progress?projectId=${projectId}&tab=analytics`))}
        />
      }
      secondaryKpis={
        <>
          <KpiCard
            label={labelFor(dashboardLabels, "contractValue", "Contract Value")}
            value={panelText(dashboardPanel, () => (hasEv ? money(dashboard!.contractValue!, currency) : "—"))}
            trend={{ direction: "flat", tone: "context", label: "parent BOQ lines only" }}
            baseline="latest BOQ revision"
            visual={retryVisual(dashboardPanel)}
            // Contract value -> BOQ (ScopeClient is the CUSTOM screen for the latest revision -- seq22 finding)
            onClick={panelClick(dashboardPanel, () => router.push(`/scope?projectId=${projectId}`))}
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
            value={panelText(dashboardPanel, () => (dashboard!.projectValue !== null ? money(dashboard!.projectValue, currency) : "Not set"))}
            trend={{ direction: "flat", tone: "context", label: "manual entry, or linked POs" }}
            baseline="overridable per project"
            visual={retryVisual(dashboardPanel)}
            onClick={panelClick(dashboardPanel, () => router.push(`/scope?projectId=${projectId}`))}
          />
          <KpiCard
            label={labelFor(dashboardLabels, "budgetVsActual", "Budget vs Actual")}
            value={panelText(dashboardPanel, () => money(dashboard!.expenses, currency))}
            trend={{
              direction: dashboard && dashboard.expenses > dashboard.budget ? "up" : "down",
              tone: dashboard && dashboard.expenses > dashboard.budget ? "late" : "done",
              label: dashboard ? (dashboard.expenses > dashboard.budget ? "over budget" : "within budget") : "",
            }}
            baseline={dashboard ? `budget ${money(dashboard.budget, currency)}` : ""}
            visual={dashboard ? <BulletChart value={dashboard.expenses} target={dashboard.budget} lowerIsBetter unit="" /> : retryVisual(dashboardPanel)}
            // Budget vs actual -> ANALYTICAL cost variance, filtered (DASHBOARD.PROJECT's own row)
            onClick={panelClick(dashboardPanel, () => router.push(`/scope?projectId=${projectId}&tab=variance`))}
          />
          <KpiCard
            label={labelFor(dashboardLabels, "permitsExpiring", "Permits Expiring")}
            value={panelText(permitsPanel, () => String(expiringCount))}
            trend={{
              direction: expiredCount > 0 ? "up" : expiringCount > 0 ? "flat" : "down",
              tone: expiredCount > 0 ? "late" : expiringCount > 0 ? "needs-you" : "done",
              // Only a read that SUCCEEDED may say "none due soon".
              label: permitsPanel.status !== "ready" ? "" : expiredCount > 0 ? `${expiredCount} already expired` : expiringCount > 0 ? "within 30 days" : "none due soon",
            }}
            baseline="next 30 days"
            visual={retryVisual(permitsPanel)}
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
          ) : categoriesPanel.status === "error" ? (
            <p className="text-[12.5px] text-ct-muted">
              Couldn&apos;t load progress by scope category.{" "}
              <button type="button" onClick={() => void load()} className="text-ct-teal underline">Retry</button>
            </p>
          ) : categoriesPanel.status === "loading" ? (
            <p className="text-[12.5px] text-ct-muted">{slow ? "Still loading…" : ""}</p>
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
          {recentPanel.status === "error" ? (
            <p className="text-[12.5px] text-ct-muted">
              Couldn&apos;t load recent progress entries.{" "}
              <button type="button" onClick={() => void load()} className="text-ct-teal underline">Retry</button>
            </p>
          ) : recentPanel.status === "loading" ? (
            <p className="text-[12.5px] text-ct-muted">{slow ? "Still loading…" : ""}</p>
          ) : recent.length === 0 ? (
            // Only a read that SUCCEEDED may report "none".
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
