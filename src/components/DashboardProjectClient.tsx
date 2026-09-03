"use client";

// R42 seq24 (M28 DASHBOARD archetype, DASHBOARD.PROJECT row): "the first
// screen a PM opens every morning." Registry-driven -- zero bespoke
// components, per DASHBOARD.PROJECT's own components_used list. Every KPI
// is clickable and carries its own filters through (GLOBAL: "EVERY NUMBER
// IS A DOOR" / "A KPI WITH NO DESTINATION MUST NOT SHIP") -- see each
// onClick below for exactly where it lands and why that's a real screen.
//
// R67 F-27 (audit recommendation R-243) -- PER-CARD RENDERING, AND TWO FEWER
// CALLS.
//
// WHAT THIS FILE USED TO DO. It held the WHOLE page behind
// `if (loading || !dashboard) return <p>Loading…</p>` -- a Promise.all over
// five requests, and then a SIXTH (/api/reports/category-progress) fired
// SERIALLY after that batch resolved. LCP 5.3 s warm, with the bare word
// "Loading…" on screen for all of it.
//
//   - No shared gate. Each figure is its own pane, and each tile renders the
//     moment its own answer lands (DashboardKpiTile: skeleton bar, then the
//     value, then an error that says why). A project whose figure has not
//     arrived shows a skeleton, NEVER "0%".
//   - category-progress moved INTO the batch. It was a serial tail purely
//     because it was written later.
//   - The permits call is GONE: VERIDIAN's dashboard payload now carries
//     permitsExpiringCount / permitsExpiredCount, computed in the same
//     statement as everything else, so one tile no longer costs one request.
//   - The activities call is GONE: work-progress entries now carry
//     activityName (R67 F-24), so the "Recent progress entries" list no longer
//     fetches a second list to translate a column.
//
// Six requests, one of them serial, became four independent ones.
//
// R67 MERGE (lane D0 x lane F2). Lane D0 (item D-65) fixed the two faults this
// screen carried and BOTH fixes are kept:
//
//   * A 500 on the dashboard call used to assign the ERROR BODY to
//     `dashboard`, after which money(dashboard.expenses) called
//     .toLocaleString on an undefined. There is no error.tsx under
//     /dashboard/project, so that throw took the whole route down. readJson()
//     below reads the STATUS before the body, and a failed dashboard read now
//     renders D0's PaneErrorCard -- one sentence from the shared dictionary,
//     with the Retry that re-issues the read.
//   * A failed permits read rendered "Permits Expiring: 0" in the SAGE done
//     tone with the words "none due soon" -- a confident all-clear on the one
//     tile whose entire purpose is to warn. That figure no longer comes from a
//     permits call at all (see below); it comes from the dashboard payload, so
//     the same rule now holds through the same guard: no number, percentage or
//     tone is minted from a call that did not answer.
//
// What is F2's and stays: the per-card rendering. D0's version still held the
// whole screen behind one `loading` flag; here only a FAILED dashboard read is
// a whole-screen state, because there is genuinely nothing to draw without it.
// Every other figure paints the moment its own answer lands.
import { useCallback, useEffect, useState } from "react";
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
import { DashboardKpiTile, type KpiTileState } from "@/components/DashboardKpiTile";
import { PaneErrorCard } from "@/components/PaneState";

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
  // R67 F-27: computed in the same statement as every other figure, so the
  // "Permits Expiring" tile no longer costs its own request.
  permitsExpiringCount: number;
  permitsExpiredCount: number;
};
type Currency = { code: string; isBaseCurrency: boolean };
type CategoryRow = { categoryId: string; name: string; percentComplete: number };
// R67 F-24: activityName now arrives ON the entry.
type RecentEntry = {
  id: string;
  activityId: string;
  activityName?: string | null;
  entryDate: string;
  quantityDone: string;
  percentComplete: string;
};

/** One independently-loaded figure: pending, ready, or failed with a reason. */
type Pane<T> = { state: KpiTileState; data: T | null; error: string | null };
const PENDING: Pane<never> = { state: "pending", data: null, error: null };

/** The backend's OWN sentence when it gave one. */
function reasonText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Reads a JSON endpoint, treating a non-2xx as a failure rather than as data --
 *  an error body parses perfectly well, and reading it as data is how a failed
 *  request becomes a confident 0 on a dashboard. */
class ReadFailed extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ReadFailed";
    this.status = status;
  }
}

async function readJson<T>(url: string, signal: AbortSignal, fallbackMessage: string): Promise<T> {
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => null);
  // R67 D-65: the STATUS is read before the body. An error body parses
  // perfectly well, and reading it as data is how a failed request becomes a
  // confident 0 on a dashboard -- and, on this screen, a thrown TypeError.
  // The status travels with the message because the shared dictionary uses it
  // to decide whether a Retry could help at all.
  if (!res.ok) {
    throw new ReadFailed((body?.error as string | undefined) ?? `${fallbackMessage} (HTTP ${res.status})`, res.status);
  }
  return body as T;
}

// TC-90: AED with NO rupee sign and NO lakh/crore grouping -- "en-US" gives
// plain thousands-comma grouping regardless of locale; deliberately not
// "en-IN" (lakh grouping) and never a hardcoded "â‚¹" fallback.
function money(n: number, currency: Currency | undefined) {
  return `${currency ? currency.code + " " : ""}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function DashboardProjectClient({ projectId, labels }: { projectId: string; labels?: RegistryColumn[] | null }) {
  const router = useRouter();
  const dashboardLabels = labels && labels.length > 0 ? labels : DEFAULT_LABELS;

  const [dashboard, setDashboard] = useState<Pane<ProjectDashboard>>(PENDING);
  // The transport's own status for the dashboard read, kept beside the
  // sentence so PaneErrorCard can decide whether Retry is offered at all.
  const [dashboardStatus, setDashboardStatus] = useState<number | null>(null);
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [categories, setCategories] = useState<Pane<CategoryRow[]>>(PENDING);
  const [recent, setRecent] = useState<Pane<RecentEntry[]>>(PENDING);

  const load = useCallback(
    (signal: AbortSignal) => {
      // FOUR INDEPENDENT PROMISES, not one Promise.all with a serial tail.
      // Nothing here awaits anything else: each setState fires on its own
      // answer, so the fastest tile is on screen while the slowest is still in
      // flight.
      void readJson<ProjectDashboard>(
        `/api/dashboard/project/${encodeURIComponent(projectId)}`,
        signal,
        "Couldn't load the project dashboard"
      )
        .then((data) => {
          setDashboard({ state: "ready", data, error: null });
          setDashboardStatus(null);
        })
        .catch((err) => {
          if (signal.aborted) return;
          setDashboardStatus(err instanceof ReadFailed ? err.status : null);
          setDashboard({ state: "error", data: null, error: reasonText(err, "Couldn't load the project dashboard.") });
        });

      // The currency is a label, not a figure: if it never answers, the money
      // tiles render unprefixed rather than waiting.
      void readJson<{ currencies?: Currency[] }>("/api/currencies", signal, "Couldn't load currencies")
        .then((data) => setCurrency((data.currencies ?? []).find((c) => c.isBaseCurrency)))
        .catch(() => {});

      // Category breakdown (RIGHT COLUMN, sorted horizontal bar) reuses the
      // ALREADY-REGISTERED "category-progress" report (REPORT_REGISTRY,
      // construction-reports-service.ts) computed server-side (D-4: never
      // summed in the browser). R67 F-27 moved it into this batch -- it used to
      // run only after the other five had all resolved.
      void readJson<{ categories?: CategoryRow[] }>(
        `/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`,
        signal,
        "Couldn't load the category breakdown"
      )
        .then((data) => setCategories({ state: "ready", data: data.categories ?? [], error: null }))
        .catch((err) => {
          if (signal.aborted) return;
          setCategories({ state: "error", data: null, error: reasonText(err, "Couldn't load the category breakdown.") });
        });

      void readJson<{ entries?: RecentEntry[] }>(
        `/api/work-progress?projectId=${encodeURIComponent(projectId)}`,
        signal,
        "Couldn't load recent progress"
      )
        .then((data) => setRecent({ state: "ready", data: (data.entries ?? []).slice(0, 5), error: null }))
        .catch((err) => {
          if (signal.aborted) return;
          setRecent({ state: "error", data: null, error: reasonText(err, "Couldn't load recent progress.") });
        });
    },
    [projectId]
  );

  useEffect(() => {
    setDashboard(PENDING);
    setCategories(PENDING);
    setRecent(PENDING);
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // R67 D-65: the ONE whole-screen state. Every other figure is its own pane
  // and paints when its own answer lands, but with no dashboard payload there
  // is no project name, no budget and no permit count to draw -- so this says
  // what failed, in the shared dictionary's words, with the Retry that
  // re-issues the read. Four tiles each repeating the same sentence would be
  // the same information four times.
  if (dashboard.state === "error") {
    return (
      <div className="flex-1 p-6">
        <PaneErrorCard
          entity="this project's dashboard"
          error={{ status: dashboardStatus, message: dashboard.error }}
          onRetry={() => {
            const controller = new AbortController();
            setDashboard(PENDING);
            load(controller.signal);
          }}
        />
      </div>
    );
  }

  const d = dashboard.data;
  const hasEv = d !== null && d.earnedValue !== null && d.contractValue !== null;
  const expiringCount = d?.permitsExpiringCount ?? 0;
  const expiredCount = d?.permitsExpiredCount ?? 0;
  const recentEntries = recent.data ?? [];
  const categoryBars: BarChartDatum[] = (categories.data ?? []).map((c) => ({ label: c.name, value: c.percentComplete }));

  return (
    <DashboardScreen
      // The breadcrumb is the frame, and the frame paints first: the project's
      // name fills in when it arrives rather than holding the page.
      breadcrumb={d ? `Dashboard / ${d.projectName}` : "Dashboard"}
      // DASHBOARD.PROJECT: "+ New suppressed" -- documented override, this
      // screen answers a question, it doesn't create records.
      newAction={undefined}
      filterAction={{ label: "Filter", disabledReason: "Not yet available" }}
      exportAction={{ label: "Export", disabledReason: "Not yet available" }}
      oneNumber={
        <DashboardKpiTile
          state={dashboard.state}
          error={dashboard.error}
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
          value={hasEv ? `${d!.percentByValue}%` : "No BOQ yet"}
          trend={{ direction: "flat", tone: "context", label: hasEv ? `Earned ${money(d!.earnedValue!, currency)}` : "Import a BOQ to see this" }}
          baseline={hasEv ? `of ${money(d!.contractValue!, currency)} contract value` : ""}
          visual={hasEv ? <BulletChart value={d!.earnedValue!} target={d!.contractValue!} unit="" /> : undefined}
          // % complete -> ANALYTICAL work-progress, filtered to this project (DASHBOARD.PROJECT's own row)
          onClick={() => router.push(`/work-progress?projectId=${projectId}&tab=analytics`)}
        />
      }
      secondaryKpis={
        <>
          <DashboardKpiTile
            state={dashboard.state}
            error={dashboard.error}
            label={labelFor(dashboardLabels, "contractValue", "Contract Value")}
            value={hasEv ? money(d!.contractValue!, currency) : "—"}
            trend={{ direction: "flat", tone: "context", label: "parent BOQ lines only" }}
            baseline="latest BOQ revision"
            // Contract value -> BOQ (ScopeClient is the CUSTOM screen for the latest revision -- seq22 finding)
            onClick={() => router.push(`/scope?projectId=${projectId}`)}
          />
          {/* Sumeet audit fix (2026-08-30, requirement #10: "Project value
              matches BOQ total"). Distinguished explicitly from Contract
              Value, since they are two genuinely different figures by design
              (project value = COALESCE(user-entered, linked-PO-sum); contract
              value = latest BOQ's parent-lines-only total). Null (not 0) is
              the honest "neither a manual value nor any linked PO exists yet"
              state, matching every other null-safe KPI on this screen. */}
          <DashboardKpiTile
            state={dashboard.state}
            error={dashboard.error}
            label={labelFor(dashboardLabels, "projectValue", "Project Value")}
            value={d && d.projectValue !== null ? money(d.projectValue, currency) : "Not set"}
            trend={{ direction: "flat", tone: "context", label: "manual entry, or linked POs" }}
            baseline="overridable per project"
            onClick={() => router.push(`/scope?projectId=${projectId}`)}
          />
          <DashboardKpiTile
            state={dashboard.state}
            error={dashboard.error}
            label={labelFor(dashboardLabels, "budgetVsActual", "Budget vs Actual")}
            value={d ? money(d.expenses, currency) : ""}
            trend={{
              direction: d && d.expenses > d.budget ? "up" : "down",
              tone: d && d.expenses > d.budget ? "late" : "done",
              label: d && d.expenses > d.budget ? "over budget" : "within budget",
            }}
            baseline={d ? `budget ${money(d.budget, currency)}` : ""}
            visual={d ? <BulletChart value={d.expenses} target={d.budget} lowerIsBetter unit="" /> : undefined}
            // Budget vs actual -> ANALYTICAL cost variance, filtered (DASHBOARD.PROJECT's own row)
            onClick={() => router.push(`/scope?projectId=${projectId}&tab=variance`)}
          />
          <DashboardKpiTile
            state={dashboard.state}
            error={dashboard.error}
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
          {recent.state === "pending" ? (
            <div className="h-24 animate-pulse rounded bg-ct-cloud" role="presentation" aria-label="Loading progress trend" />
          ) : recent.state === "error" ? (
            <p role="alert" className="text-[12.5px]" style={{ color: "var(--color-veri-status-late)" }}>{recent.error}</p>
          ) : (
            <LineChart series={recentEntries.slice().reverse().map((e, i) => ({ label: e.entryDate, value: recentEntries.slice(0, i + 1).reduce((s, r) => s + Number(r.quantityDone), 0) }))} />
          )}
        </>
      }
      breakdownColumn={
        <>
          <h3 className="text-[13px] font-medium text-ct-navy mb-2">{labelFor(dashboardLabels, "progressByCategoryHeading", "Progress by scope category")}</h3>
          {categories.state === "pending" ? (
            <div className="h-24 animate-pulse rounded bg-ct-cloud" role="presentation" aria-label="Loading category breakdown" />
          ) : categories.state === "error" ? (
            <p role="alert" className="text-[12.5px]" style={{ color: "var(--color-veri-status-late)" }}>{categories.error}</p>
          ) : categoryBars.length > 0 ? (
            <BarChart data={categoryBars} unit="%" onBarClick={(d2) => router.push(`/work-progress?projectId=${projectId}&tab=analytics&category=${encodeURIComponent(d2.label)}`)} />
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
          {recent.state === "pending" ? (
            <div className="space-y-1.5" role="presentation" aria-label="Loading recent progress entries">
              {[0, 1, 2].map((i) => <div key={i} className="h-3 w-3/4 animate-pulse rounded bg-ct-cloud" />)}
            </div>
          ) : recent.state === "error" ? (
            <p role="alert" className="text-[12.5px]" style={{ color: "var(--color-veri-status-late)" }}>{recent.error}</p>
          ) : recentEntries.length === 0 ? (
            <p className="text-[12.5px] text-ct-muted">No entries logged yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {recentEntries.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => router.push(`/work-progress?projectId=${projectId}&tab=analytics`)} className="text-[12.5px] text-ct-teal hover:underline">
                    {/* R67 F-24: the activity's NAME comes with the entry -- this
                        list used to fetch the whole activity list to translate
                        it, and rendered a raw id when that missed. */}
                    {e.entryDate} — {e.activityName ?? "—"} ({e.percentComplete}%)
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
