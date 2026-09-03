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
//
// ─── R67 MERGE (lane D1's MONEY MODEL, folded onto that per-card rewrite) ────
//
// This screen is the direct consumer of the compliance-tracker change shipped
// in the same lane (PR #1581: resolveProjectMoney() is now the single
// implementation of Point 121, and the batched dashboard SQL returns
// budget_lines). Its payload therefore changed shape, and the four things
// below are what that costs on this side. None of them is a preference; each
// is a field the backend now sends differently.
//
//   * D-02 -- `budget` IS NULLABLE NOW. getProjectDashboard() returns null,
//     never 0, when this project's scope has no erp_budget_line_items row at
//     all. "No budget set" and "a budget of zero" are different facts, and
//     this tile rendered the first as the second: on a project nobody had
//     budgeted, the FIRST expense made it say "over budget" in the late tone,
//     against a target of 0, over a full red bullet bar. With no budget there
//     is nothing to be over -- so the card states the spend, says the budget
//     is missing, drops the bullet chart, and its click goes to the one screen
//     that fixes it rather than to a variance view with nothing to vary
//     against. The wording is budgetBaseline()/spendTone() from
//     src/lib/dashboard-kpi.ts, shared with the home dashboard and unit-tested
//     there, rather than restated here.
//   * D-62 -- `projectValueSource` IS NEW. The card used to caption every
//     project "manual entry, or linked POs", which is a description of the
//     RULE and not of this project: a figure summed from purchase orders and a
//     figure a director typed were indistinguishable. The backend now says
//     which one it was.
//   * D-61 -- MONEY GOES THROUGH formatMoney(). The local money() helper
//     called n.toLocaleString directly, which is what eslint-rules/
//     money-format.mjs bans under src/components and what
//     src/lib/money-format-rule.test.ts asserts about THIS FILE BY NAME (it is
//     on that suite's SWEPT list, so it may never be re-exempted). Keeping
//     main's version here would have failed both the lint gate and that test.
//     The visible change is the decimals: this screen rendered whole units
//     while /scope and the reports rendered two, so one project's contract
//     value read "AED 21,750" here and "AED 21,750.00" on the screen this tile
//     links to.
//   * D-62 -- the Cost Variance tab is the Budget module now, so a tile that
//     HAS a budget lands on ?tab=budget.
//
// NOT folded in: lane D1's whole-screen `if (loading) return` structure and
// its own error card. F-27's per-pane rendering supersedes both, and D-65's
// PaneErrorCard is the shared dictionary's sentence rather than this screen's
// own. Lane D1's forked KpiCard import is folded in ONE level down instead --
// DashboardKpiTile now wraps the fork, so the per-tile states and D-61's
// typography both survive without this file importing two card components.
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
// R67 D-61: one money format for the whole product.
import { formatMoney } from "@/lib/format-money";
// R67 D-62 / D-02: one project-money model. The same wording the home
// dashboard uses for the same facts, so a project reads the same on both.
import {
  budgetBaseline,
  formatProjectValue,
  projectValueCaption,
  spendTone,
  type ProjectValueSource,
} from "@/lib/dashboard-kpi";

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
  // erp_budget_line_items row at all. See the merge note at the top.
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
  // R67 F-27: computed in the same statement as every other figure, so the
  // "Permits Expiring" tile no longer costs its own request.
  permitsExpiringCount: number;
  permitsExpiredCount: number;
  // R67 F-14/F-27 (lane F1): the two PANELS this screen used to fetch for
  // itself, computed in the same statement -- and the same transaction -- as
  // every figure above. Both optional because a VERIDIAN that predates the
  // fields simply omits them, and this screen must keep working against one:
  // see the fallbacks in load().
  categories?: CategoryRow[];
  // The five newest progress entries, with each activity's name already
  // resolved, so the screen no longer reads the whole progress log for five rows.
  recentEntries?: RecentEntry[];
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

// R67 MERGE (D-11, lane E2's E-25 / R-211). One point per DAY, not per row --
// several entries logged the same day used to draw several points and (with
// the old reverse-and-reduce) could even restart the running total mid-window.
// Days with no entry are simply absent from the axis, same as before; the
// cumulative total still only ever grows.
function cumulativeByDay(entries: RecentEntry[]): { label: string; value: number }[] {
  const byDay = new Map<string, number>();
  for (const e of entries) {
    byDay.set(e.entryDate, (byDay.get(e.entryDate) ?? 0) + Number(e.quantityDone));
  }
  const days = Array.from(byDay.keys()).sort();
  let running = 0;
  return days.map((day) => {
    running += byDay.get(day) ?? 0;
    return { label: day, value: running };
  });
}

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

// TC-90: AED with NO rupee sign and NO lakh/crore grouping -- deliberately not
// "en-IN" (lakh grouping) and never a hardcoded "₹" fallback.
//
// R67 D-61: that rule is now formatMoney()'s, shared with every other money
// surface. What changes here is the decimals: this screen rendered whole units
// (maximumFractionDigits: 0) while /scope and the reports rendered two, so the
// same project's contract value read "AED 21,750" on the project dashboard and
// "AED 21,750.00" on the screen the tile links to. A null renders the en-dash,
// which is why every call site below can stop guarding for one.
function money(n: number | null | undefined, currency: Currency | undefined) {
  return formatMoney(n, { currency: currency?.code ?? null });
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
      // TWO INDEPENDENT PROMISES, not one Promise.all with a serial tail.
      // Neither awaits the other: each setState fires on its own answer, so the
      // fastest tile is on screen while the slower is still in flight. (It was
      // four until R67 F-14/F-27 folded the two panels into the dashboard
      // payload; their old reads survive as legacy fallbacks, chained off that
      // payload rather than raced, so they cost nothing on a current backend.)
      void readJson<ProjectDashboard>(
        `/api/dashboard/project/${encodeURIComponent(projectId)}`,
        signal,
        "Couldn't load the project dashboard"
      )
        .then((data) => {
          setDashboard({ state: "ready", data, error: null });
          setDashboardStatus(null);
          // R67 F-27 (lane F1) -- THE PANEL COMES WITH THE PAYLOAD. The recent
          // progress entries used to be their own /api/work-progress round
          // trip, which pulled the project's whole progress log to show five
          // rows. VERIDIAN now computes those five in the same statement as
          // every figure above, with each activity's name already resolved, so
          // in the normal case this screen makes one request fewer.
          //
          // The old read survives as a FALLBACK, not as a second opinion: it
          // fires only when the payload does not carry the field, which is what
          // a VERIDIAN older than F-27 looks like. Chaining it here rather than
          // racing it is deliberate -- racing would re-introduce exactly the
          // request this item removes, on every load, to serve the rare case.
          if (data.categories) {
            setCategories({ state: "ready", data: data.categories, error: null });
          } else {
            // Legacy VERIDIAN only. The category breakdown is still computed
            // server-side either way (D-4: never summed in the browser); this
            // path just asks the already-registered "category-progress" report
            // for it separately.
            void readJson<{ categories?: CategoryRow[] }>(
              `/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`,
              signal,
              "Couldn't load the category breakdown"
            )
              .then((cat) => setCategories({ state: "ready", data: cat.categories ?? [], error: null }))
              .catch((err) => {
                if (signal.aborted) return;
                setCategories({ state: "error", data: null, error: reasonText(err, "Couldn't load the category breakdown.") });
              });
          }

          if (data.recentEntries) {
            setRecent({ state: "ready", data: data.recentEntries.slice(0, 5), error: null });
          } else {
            void readJson<{ entries?: RecentEntry[] }>(
              `/api/work-progress?projectId=${encodeURIComponent(projectId)}`,
              signal,
              "Couldn't load recent progress"
            )
              .then((wp) => setRecent({ state: "ready", data: (wp.entries ?? []).slice(0, 5), error: null }))
              .catch((err) => {
                if (signal.aborted) return;
                setRecent({ state: "error", data: null, error: reasonText(err, "Couldn't load recent progress.") });
              });
          }
        })
        .catch((err) => {
          if (signal.aborted) return;
          setDashboardStatus(err instanceof ReadFailed ? err.status : null);
          setDashboard({ state: "error", data: null, error: reasonText(err, "Couldn't load the project dashboard.") });
          // Neither panel can arrive on a payload that never came, and neither
          // has an unconditional reader of its own any more, so they say so
          // rather than spinning for ever.
          setCategories({ state: "error", data: null, error: reasonText(err, "Couldn't load the category breakdown.") });
          setRecent({ state: "error", data: null, error: reasonText(err, "Couldn't load recent progress.") });
        });

      // The currency is a label, not a figure: if it never answers, the money
      // tiles render unprefixed rather than waiting.
      void readJson<{ currencies?: Currency[] }>("/api/currencies", signal, "Couldn't load currencies")
        .then((data) => setCurrency((data.currencies ?? []).find((c) => c.isBaseCurrency)))
        .catch(() => {});

      // (The category breakdown and the recent-entries read used to be two more
      // independent promises here. R67 F-14/F-27 moved both PANELS onto the
      // dashboard payload -- one transaction upstream instead of three -- so on
      // a current VERIDIAN this screen makes two requests, not four. Each keeps
      // its old read as a legacy fallback; see the branches above.)
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
            value={d ? formatProjectValue(d.projectValue, (n) => money(n, currency)) : "Not set"}
            // R67 D-62: THIS project's source, not a restatement of the rule.
            trend={{ direction: "flat", tone: "context", label: projectValueCaption(d?.projectValueSource ?? null) }}
            baseline="overridable per project"
            onClick={() => router.push(`/scope?projectId=${projectId}`)}
          />
          <DashboardKpiTile
            state={dashboard.state}
            error={dashboard.error}
            label={labelFor(dashboardLabels, "budgetVsActual", "Budget vs Actual")}
            value={d ? money(d.expenses, currency) : ""}
            /* R67 D-02: with no budget set there is nothing to be over, so the
               card states the spend, says the budget is missing, drops the
               bullet chart (a target of 0 rendered a full red bar) and sends
               the user to the budget create screen for THIS project instead of
               to a variance view with nothing to vary against. */
            trend={
              d && d.budget !== null
                ? {
                    direction: d.expenses > d.budget ? "up" : "down",
                    tone: spendTone(d.budget, d.expenses) === "late" ? "late" : "done",
                    label: d.expenses > d.budget ? "over budget" : "within budget",
                  }
                : { direction: "flat", tone: "context", label: "no budget set" }
            }
            baseline={d ? budgetBaseline(d.budget, (n) => money(n, currency)) : ""}
            visual={
              d && d.budget !== null ? (
                <BulletChart value={d.expenses} target={d.budget} lowerIsBetter unit="" />
              ) : undefined
            }
            // Budget vs actual -> the Budget module, filtered (DASHBOARD.PROJECT's
            // own row). R67 D-62: the Cost Variance tab IS the Budget tab now.
            onClick={() =>
              router.push(
                d && d.budget === null
                  ? `/finance/budgets/new?projectId=${projectId}`
                  : `/scope?projectId=${projectId}&tab=budget`
              )
            }
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
            // R67 MERGE (D-11, lane E2's E-25 / R-211 folded onto F-27's
            // payload). E2 found the real defect this line used to have: it
            // plotted one point per ROW rather than per DAY, and its running
            // total started wherever the (then five-row) window happened to
            // begin -- not from zero. Grouping by day and accumulating across
            // days fixes both within whatever `recentEntries` the F-27
            // payload actually carries.
            <LineChart series={cumulativeByDay(recentEntries)} />
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
            // R67 MERGE (D-11, lane E2's E-38 / R-296): "came here to type"
            // deserves the form's caret, not a screen the reader has to find
            // and click into themselves -- E2's own fix, now expressed through
            // the one focus convention this app actually wires end to end
            // (module-catalogue.ts's own "Record progress" card, MoMObjectClient),
            // which WorkProgressPageClient's formRef effect already reads.
            { label: "Record progress", onClick: () => router.push(`/work-progress?projectId=${projectId}&tab=entry&focus=activity`) },
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