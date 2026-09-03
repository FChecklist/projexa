"use client";

// R67 D-01: this view became a client component when the Projects table's
// rows became real, clickable rows (a server component cannot carry an
// onClick). Every prop it receives is still plain JSON resolved server-side
// in dashboard/page.tsx -- no data fetching moved into the browser.
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { Wallet, TrendingUp, Receipt, Building2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { HomeGreeting } from "@fchecklist/veridian-ui-kit/shell";
import { type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
// R67 G-05 / D-61: one money format for the whole product. Imported from the
// server-safe module, not from @/lib/currency ("use client"), so the same
// helper serves this view and the Server Components around it. D-61 shipped a
// second copy of this module before lane G merged; G-05's is the one that
// survived (it is a superset -- pending state, unknown-currency glyph, signed
// money) and D-61's copy is gone.
import { MONEY_CELL_CLASS, currencyUnitSuffix, formatMoney, hasCurrency } from "@/lib/format-money";
import { dashboardSummary, mayAssertEmpty } from "@/lib/read-outcome";
// R67 F-xx: the home screen speculates the next navigation, so opening a
// project is instant. Kept from main -- it is orthogonal to what E-01/E-19
// changed about what this screen SAYS.
import { DashboardSpeculation } from "@/components/DashboardSpeculation";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { ProjectRowList, ProjectRowSkeleton } from "@/components/dashboard/ProjectRow";
import { dashboardKpis, type DashboardKpi, type KpiDirection } from "@/lib/dashboard-kpis";
import { GroupedBarChart, type GroupedBarGroup, type GroupedBarSeries } from "@/components/charts/GroupedBarChart";
import { DashboardFilterDrawer, dateRangeCaption } from "@/components/dashboard/DashboardFilterDrawer";
import { needsYouSummary, sortProjectRows, type DashboardProject } from "@/lib/dashboard-rows";

// R46 P8 seq123: presentational body extracted out of (app)/dashboard/page.tsx
// so that route file could stay a thin server resolver (same split as every
// other registry-driven screen this session -- PermitsListClient,
// DocumentsClient, ScopeClient).
//
// R67 E-01 (R-007) + E-02 (R-012). WHAT THIS SCREEN IS NOW, and why:
//
// It was a four-KPI grid over a seven-column project TABLE. Sumeet's home is a
// project LIST -- one row per project, a bar filled to % complete, the contract
// and the spend, and a status word -- and the requirement was written against
// /dashboard/overview, a route almost nobody lands on. So the rows moved onto
// the route users actually land on, /dashboard/overview redirects here, and
// there is now exactly ONE project row in the product rather than two that
// could drift.
//
// The order of the page is the order of the questions: the ONE number
// (earned value against contract value), then the portfolio chart, then the
// rows, then the supporting KPIs. The four KPI cards did not disappear -- they
// moved BELOW the rows, as secondary, because "how much revenue in total" is a
// question you ask after "which project needs me today", not before.
export type OrgDashboard = {
  totalProjects: number;
  // R67 E-06 (R-108): the BOQ-derived budget across the portfolio -- the same
  // figure the Project Status report and Cost Variance now print, because all
  // three read construction-reports-service.ts#sumRootLineBudgets. null (never
  // 0) when no project has a BOQ, and null ALSO when the reader's role had the
  // financial figures redacted, which is what financialsRedacted tells apart.
  // R67 D-02 (second-merge note): this is also the SAME null-not-zero widening
  // D-02 asked for on compliance-tracker's own getOrgDashboard() -- E-06 and
  // D-02 arrived at the identical rule independently; nothing further to fold.
  totalBudget: number | null;
  /** The ERP annual ledger budget this tile used to show, under its own name. */
  totalLedgerBudget?: number | null;
  /** True when the API redacted the financial figures for this reader's role. */
  financialsRedacted?: boolean;
  totalRevenue: number;
  totalExpenses: number;
  // R38 (R-50/TC-40): contractValue is the project's active BOQ root-total,
  // null (not 0) when the project has no BOQ at all yet -- see
  // construction-dashboard-service.ts#getOrgDashboard's own comment.
  // R39 (R-51): earnedValue/percentByValue reuse that SAME service's
  // earnedValueReport() (D-3, single source of truth with the WPR report) --
  // null (not 0) when construction isn't enabled or there's no BOQ yet.
  //
  // R67 D-62 (audit R-202): the row now ALSO carries contractValue/
  // projectValue/projectValueSource from getOrgDashboard's resolveProjectMoney()
  // -- the same helper /dashboard/project reads -- alongside E-01's own row
  // facts. DashboardProject (lib/dashboard-rows.ts) carries both sets; `value`
  // is contractValue's own deprecated alias, kept for this row list's own
  // "no BOQ" rendering.
  // R67 E-01: percentByActivity / spendOverValue / permitsExpiring30d are the
  // three facts the project ROW needs; spendOverValue is null (not false) when
  // the reader's role had it redacted along with revenue/expenses.
  projects: DashboardProject[];
  /** R67 E-02: true when the Filter drawer's date range narrowed revenue and spend. */
  dateRangeApplied?: boolean;
};
// The currencies list this screen is handed. Still resolved server-side in
// dashboard/page.tsx via callVeridian (same backing call as /api/currencies),
// still passed down as a plain prop -- only the formatting moved.
export type CurrencyRow = { id: string; code: string; name: string; symbol: string | null; isBaseCurrency: boolean };

// R51 (R-62): the fallback was the literal "₹". This component IS the
// landing screen, so that constant was the single most visible instance of
// the bug. Same rule as @/lib/currency: never render a currency token we
// cannot source. NEXT_PUBLIC_DEFAULT_CURRENCY_CODE is deliberately NOT
// consulted -- see src/lib/format-money.ts's header.
function orgCurrency(currencies: CurrencyRow[]): string | null {
  return currencies.find((c) => c.isBaseCurrency)?.code ?? null;
}
/** KPI tiles show whole units -- the fraction is noise at that size. Every row and table keeps two decimals. */
function formatKpi(n: number | null, currencies: CurrencyRow[]) {
  return formatMoney(n, { currency: orgCurrency(currencies), fractionDigits: 0 });
}

/**
 * R67 E-19 (R-180): the line under a KPI tile's figure -- its baseline, with
 * the DIRECTION as a word and an arrow glyph. Both carriers, always: the word
 * survives a greyscale print, a projector and a colour-blind reader, and the
 * glyph is the one that is read at a glance. A tile with nothing real to
 * compare against carries no arrow at all rather than a decorative one.
 *
 * (This replaces E-06's budgetSubtitle, which stated the same thing for one
 * tile only. The ERP ANNUAL LEDGER budget still keeps its own name inside the
 * budget baseline -- the bug E-06 fixed was one silently standing in for the
 * other, and that stays fixed.)
 */
export const DIRECTION_GLYPH: Record<KpiDirection, string> = { over: "▲", under: "▼", level: "▬" };

export function kpiSubtitle(kpi: DashboardKpi): string {
  if (!kpi.direction) return kpi.baseline;
  return `${DIRECTION_GLYPH[kpi.direction]} ${kpi.direction} · ${kpi.baseline}`;
}

/** Which registry column supplies each tile's label -- the registry owns the WORDS, this module owns the rest. */
const KPI_REGISTRY_FIELD: Record<DashboardKpi["key"], string> = {
  projects: "totalProjects",
  budget: "totalBudget",
  revenue: "totalRevenue",
  expenses: "totalExpenses",
};

const KPI_ICON = { projects: Building2, budget: Wallet, revenue: TrendingUp, expenses: Receipt } as const;
const KPI_VARIANT = { projects: "total", budget: "total", revenue: "completed", expenses: "pending" } as const;

/**
 * R67 E-19: the Retry destination -- this same screen, carrying the filter the
 * reader had applied, so retrying does not silently drop their date range and
 * hand back a different portfolio.
 */
export function retryHref(from: string | null | undefined, to: string | null | undefined): string {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  return qs.size > 0 ? `/dashboard?${qs.toString()}` : "/dashboard";
}

export type RegistryColumn = ScreenColumn;

// Fallback when no registry row is seeded yet (or the resolve call errors) --
// mirrors the registry seed 1:1, so there is no visible difference between
// "resolved from the DB" and this hardcoded default. Only LABEL text is
// registry-driven here (this is PROJEXA's HOME_ROUTE, not the kit's generic
// DashboardScreen composition -- E-01/E-19 kept that same minimal-risk call).
const DEFAULT_COLUMNS: ScreenColumn[] = [
  { field: "totalRevenue", label: "Revenue", type: "number", importance: "High" },
  { field: "totalExpenses", label: "Spend", type: "number", importance: "High" },
  { field: "project", label: "Project", type: "text", importance: "High" },
  // R67 D-62: "Value" named neither of the two money facts it might have been.
  // The registry field key is unchanged (an org that has renamed this column
  // keeps its label); only the fallback wording now says which figure it is.
  { field: "value", label: "Contract value", type: "number", importance: "High" },
  { field: "projectValue", label: "Project value", type: "number", importance: "High" },
  { field: "earnedValue", label: "Earned Value", type: "number", importance: "High" },
  { field: "revenue", label: "Revenue", type: "number", importance: "High" },
  { field: "expenses", label: "Expenses", type: "number", importance: "High" },
  { field: "tasks", label: "Tasks", type: "number", importance: "High" },
  { field: "delayed", label: "Delayed", type: "number", importance: "High" },
];

function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

/**
 * R67 E-02 chart 1 -- one group per project. E-19 (R-180) adds BUDGET as a
 * fourth bar, because "Revenue / Budget / ... by project" is what that item
 * asks the portfolio chart to compare and budget was the one figure missing.
 *
 * PROGRESS IS DELIBERATELY NOT A BAR HERE. The item words the chart as
 * "Revenue / Budget / Progress by project", but progress is a PERCENTAGE and
 * these are money: drawing 46 % on an axis scaled to AED 2,120,500 renders it
 * as an invisible sliver, and scaling it separately would put two units under
 * one axis -- a chart that lies about magnitude, which is the class of defect
 * this whole workstream is closing. Every project's progress is already a
 * labelled bar on its own row, which is where a per-project percentage belongs.
 */
const PORTFOLIO_SERIES: GroupedBarSeries[] = [
  { key: "contract", label: "Contract value", color: "var(--color-chart-1)" },
  { key: "budget", label: "Budget", color: "var(--color-chart-4)" },
  { key: "earned", label: "Earned value", color: "var(--color-chart-2)" },
  { key: "spend", label: "Spend", color: "var(--color-chart-3)" },
];

/**
 * The chart is HIDDEN below two projects, per the item: a "portfolio
 * comparison" of one project compares nothing, and a single lonely group is
 * chart furniture around a number the row above already states.
 */
export const PORTFOLIO_CHART_MIN_PROJECTS = 2;

export function portfolioChartGroups(projects: DashboardProject[]): GroupedBarGroup[] {
  return projects.map((p) => ({
    key: p.id,
    label: p.name,
    // null, never 0: a project with no BOQ has no contract value and no earned
    // value, and the chart draws that as a hatch labelled "No BOQ". Spend is
    // null too for a reader whose role had it redacted -- drawing a redacted
    // figure as a zero bar would state a number they were not allowed to see,
    // and state it wrongly.
    values: { contract: p.value, budget: p.budget ?? null, earned: p.earnedValue, spend: p.expenses },
  }));
}

export default function DashboardHomeView({
  userName,
  data,
  currencies,
  errorMessage,
  registryColumns,
  from = null,
  to = null,
  today,
  permitsExpiring = null,
}: {
  userName: string;
  data: OrgDashboard | null;
  currencies: CurrencyRow[];
  errorMessage: string | null;
  registryColumns?: RegistryColumn[] | null;
  /** The Filter drawer's date range, so the figures it narrowed can be captioned. */
  from?: string | null;
  to?: string | null;
  /**
   * R67 E-19 (R-180): today, as YYYY-MM-DD, resolved ONCE here on the server
   * and passed down. The "no progress in 30 days" signal is a date comparison,
   * and a component that reads the clock itself renders one answer on the
   * server pass and a different one on the client's -- the hydration-mismatch
   * class src/lib/format-date.ts's own header documents at length. Defaulted
   * rather than required so a test can pin the day.
   */
  today?: string;
  /**
   * R67 D-02: count of permits expiring in the next 30 days across the org,
   * resolved server-side in dashboard/page.tsx. null means THAT read failed OR
   * (second-merge default) an older caller that does not pass it at all --
   * rendered as words, never as a zero, because "no permits are expiring" and
   * "we could not find out" must not look the same.
   */
  permitsExpiring?: number | null;
}) {
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : DEFAULT_COLUMNS;
  const currency = orgCurrency(currencies);
  const currencySet = hasCurrency({ currency });
  const unitSuffix = currencyUnitSuffix({ currency }) ?? "";
  const money = (v: number | string | null | undefined) => formatMoney(v, { currency });

  const projects = data ? sortProjectRows(data.projects, today) : [];
  // The four tiles, decided by the tested rules rather than assembled below.
  const kpis: DashboardKpi[] = data
    ? dashboardKpis(
        {
          totalProjects: data.totalProjects,
          totalBudget: data.totalBudget,
          totalLedgerBudget: data.totalLedgerBudget,
          totalRevenue: data.totalRevenue,
          totalExpenses: data.totalExpenses,
          financialsRedacted: data.financialsRedacted,
        },
        data.projects,
        (v) => formatKpi(v, currencies)
      )
    : [];
  const delayedProjectCount = data?.projects.filter((p) => p.delayedTaskCount > 0).length ?? 0;
  const onTrackProjectCount = (data?.totalProjects ?? 0) - delayedProjectCount;

  // The ONE number, at twice the type size: earned value against contract
  // value across the portfolio. Summed over the projects that HAVE a BOQ --
  // a project with none contributes nothing rather than a zero, so the ratio
  // describes the work that has actually been scoped.
  const scoped = projects.filter((p) => p.value !== null && p.earnedValue !== null);
  const totalContract = scoped.reduce((s, p) => s + (p.value ?? 0), 0);
  const totalEarned = scoped.reduce((s, p) => s + (p.earnedValue ?? 0), 0);
  const portfolioPercent = totalContract > 0 ? Math.round((totalEarned / totalContract) * 100) : null;

  const attention = data ? needsYouSummary(data.projects, today) : null;
  const rangeCaption = dateRangeCaption(from, to);

  return (
    <>
      {/* R67 F-22: renders nothing. It spends the seconds the user spends
          READING this screen prefetching the two lists they are most likely
          to open next (Scope, Work Progress), so that click lands on data
          instead of on a spinner. Every guard lives in prefetch-store.ts. */}
      <DashboardSpeculation fallbackProjectId={data?.projects?.[0]?.id ?? null} />
      {/* No PageHeading here -- this is PROJEXA's designated home route
          (see (app)/layout.tsx's HOME_ROUTE), and HomeGreeting below
          already renders a real "Good morning, {name}." heading. */}
      {/* R46S11_01: dashboardSummary() will not state a count the read could
          not produce -- a 504 must never render as a confident "you have
          none" on the first screen after login. */}
      <HomeGreeting
        userName={userName}
        summary={dashboardSummary(
          data ? { totalProjects: data.totalProjects, delayedProjectCount } : null,
          errorMessage
        )}
        stats={[
          ...(delayedProjectCount > 0 ? [{ label: `${delayedProjectCount} delayed`, tone: "attention" as const }] : []),
          ...(onTrackProjectCount > 0 ? [{ label: `${onTrackProjectCount} on track`, tone: "onTrack" as const }] : []),
          // R67 D-02 (second-merge fold-in): the org-wide permits-expiring
          // count D-02 added its own KPI card for on the old KPI-band layout
          // this screen no longer has. Folded in here instead, next to the
          // other two attention stats -- null (that read failed) says nothing,
          // same as the other two chips only appearing when there is something
          // to say.
          ...(permitsExpiring !== null && permitsExpiring > 0
            ? [{ label: `${permitsExpiring} permit${permitsExpiring === 1 ? "" : "s"} expiring`, tone: "attention" as const }]
            : []),
        ]}
      />
      <div className="flex-1 space-y-6 p-6">
        {errorMessage && (
          <Card className="border-px-error-border bg-px-error-light">
            <CardContent className="p-4 text-sm text-px-error">
              Could not load live data: {errorMessage}
            </CardContent>
          </Card>
        )}

        {/* R67 E-02: the retired /dashboard/hierarchy screen's Company and
            Department selects live here now, with the date range. */}
        <DashboardFilterDrawer />

        {/* R67 E-19 (R-180): "a failure renders 'Could not load projects —
            Retry' rather than an empty list." A read that failed used to leave
            this screen with a red strip at the top and NOTHING where the
            projects go, which reads exactly like an org that has no projects.
            The panel is still here, it says what happened, and it offers the
            one action that can fix it. */}
        {!data && (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-heading text-base">Projects</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p role="alert" className="text-sm text-px-error" data-testid="dashboard-projects-error">
                Could not load projects
              </p>
              {errorMessage && <p className="text-[12.5px] text-px-muted">{errorMessage}</p>}
              {/* A plain link back to this same URL: a Retry that really
                  re-runs the server read, with no client state to get stuck in. */}
              <Button variant="outline" size="sm" asChild>
                <Link href={retryHref(from, to)} prefetch={false} data-testid="dashboard-projects-retry">
                  <RotateCcw className="size-4" /> Retry
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
        {/* R67 D-01 / correction C-01: this was the one popup left in
            PROJEXA (CreateProjectDialog). It is now a real route --
            /projects/new -- with its own breadcrumb, Back control and a
            Save that names the fields still missing, the same create
            archetype /labour/new already uses. The dialog component is
            deleted rather than left behind, so the two forms cannot drift.
            Both lanes shipped this control; the merged wording is the one
            already on main ("Create Project"), because the home screen is
            where a bare "+ New" says least about what it creates. */}
        <div className="flex justify-end">
          <Button size="sm" asChild>
            <Link href="/projects/new"><Plus className="size-4" /> Create Project</Link>
          </Button>
        </div>

        {data && (
          <>
            {/* THE ONE NUMBER. Twice the type size of everything below it, with
                a real baseline beside it -- a value with no comparison is a
                failed card by the dashboard rule this product follows. */}
            <Card className="shadow-card">
              <CardContent className="space-y-1 p-5">
                <p className="text-[12.5px] text-px-muted">Earned value across the portfolio</p>
                <p className="font-heading text-4xl text-px-ink" data-testid="dashboard-one-number">
                  {portfolioPercent === null ? "No BOQ yet" : `${formatKpi(totalEarned, currencies)} of ${formatKpi(totalContract, currencies)} (${portfolioPercent}%)`}
                </p>
                <p className="text-[12.5px] text-px-muted">
                  {portfolioPercent === null
                    ? "Import a BOQ on a project to see earned value."
                    : `Across ${scoped.length} of ${data.totalProjects} ${data.totalProjects === 1 ? "project" : "projects"} with a BOQ.`}
                </p>
                {attention && <p className="text-[12.5px]" style={{ color: "var(--status-late-text)" }}>{attention}</p>}
              </CardContent>
            </Card>

            {/* Chart 1 (sumeet 5.png), between the one number and the rows.
                Hidden below two projects -- see PORTFOLIO_CHART_MIN_PROJECTS. */}
            {projects.length >= PORTFOLIO_CHART_MIN_PROJECTS && (
              <Card className="shadow-card">
                <CardContent className="p-5">
                  <GroupedBarChart
                    title="Contract, earned and spend by project"
                    groups={portfolioChartGroups(projects)}
                    series={PORTFOLIO_SERIES}
                    moneyPrefix={currency ? `${currency} ` : ""}
                  />
                </CardContent>
              </Card>
            )}

            <Card className="shadow-card">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle className="font-heading text-base">Projects</CardTitle>
                {/* R67 D-01 / correction C-01: the last popup in PROJEXA
                    became a real route, so this header links to it rather
                    than opening a dialog the product no longer has. */}
                <Button size="sm" asChild>
                  <Link href="/projects/new"><Plus className="size-4" /> New project</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {rangeCaption && <p className="text-[11.5px] text-px-muted">{rangeCaption}</p>}
                {data.projects.length === 0 && !mayAssertEmpty(errorMessage) ? (
                  // Only a read that SUCCEEDED may report "none" -- the same
                  // rule the greeting above follows.
                  <p className="py-8 text-center text-sm text-px-muted">Couldn&apos;t load the project list — see the error above.</p>
                ) : (
                  <ProjectRowList projects={projects} money={money} today={today} />
                )}
              </CardContent>
            </Card>

            {/* The four original KPI cards, now SECONDARY and below the rows:
                a portfolio total answers a question you ask after "which
                project needs me today", not before it.

                R67 E-19 (R-180): each of them now carries the three things
                R-180 found missing -- a value, a BASELINE it is compared
                against with the direction as a WORD, and a real destination
                named in words. What each tile is allowed to say is decided
                once in src/lib/dashboard-kpis.ts, tested there, rather than
                assembled here where nothing could assert it. The budget tile
                in particular can no longer print "AED 0": where nobody has
                entered a budget it reads an en dash over "Budget — not
                entered", and says which kind of "not entered" it is. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.map((kpi) => (
                <DashboardCard
                  key={kpi.key}
                  title={`${columnLabel(columns, KPI_REGISTRY_FIELD[kpi.key], kpi.title)}${kpi.key === "projects" ? "" : unitSuffix}`}
                  value={kpi.value}
                  subtitle={kpiSubtitle(kpi)}
                  icon={KPI_ICON[kpi.key]}
                  variant={KPI_VARIANT[kpi.key]}
                  href={kpi.href}
                  hrefLabel={kpi.hrefLabel}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-px-muted">
                {/* R67 G-04 (R-231): both branches point at the control that
                    actually exists, by its own label. */}
                {data.totalRevenue === 0
                  ? `Total Revenue shows ${formatKpi(0, currencies)} because no VERIDIAN ERP sales invoices exist yet for this org.`
                  : "Revenue reflects VERIDIAN ERP sales invoices for this org."}
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/invoices/new"><Receipt className="size-4" /> Create / Link Invoice</Link>
              </Button>
            </div>

            {/* R67 G-05: said once, at the foot of the page. */}
            <CurrencyNotSetNotice currencySet={currencySet} />
          </>
        )}
      </div>
    </>
  );
}
