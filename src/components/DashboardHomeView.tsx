import Link from "next/link";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, Receipt, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { HomeGreeting } from "@fchecklist/veridian-ui-kit/shell";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { dashboardSummary, mayAssertEmpty } from "@/lib/read-outcome";
import { currencyUnitSuffix, formatMoney, hasCurrency } from "@/lib/format-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { ProjectRowList } from "@/components/dashboard/ProjectRow";
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
  totalBudget: number;
  totalRevenue: number;
  totalExpenses: number;
  // R38 (R-50/TC-40): value is the project's active BOQ root-total, null
  // (not 0) when the project has no BOQ at all yet -- see
  // construction-dashboard-service.ts#getOrgDashboard's own comment.
  // R39 (R-51): earnedValue/percentByValue reuse that SAME service's
  // earnedValueReport() (D-3, single source of truth with the WPR report) --
  // null (not 0) when construction isn't enabled or there's no BOQ yet.
  // R67 E-01: percentByActivity / spendOverValue / permitsExpiring30d are the
  // three facts the project ROW needs; spendOverValue is null (not false) when
  // the reader's role had it redacted along with revenue/expenses.
  projects: DashboardProject[];
  /** R67 E-02: true when the Filter drawer's date range narrowed revenue and spend. */
  dateRangeApplied?: boolean;
};
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

export type RegistryColumn = ScreenColumn;

// Fallback when no registry row is seeded yet (or the resolve call errors) --
// mirrors the registry seed 1:1, so there is no visible difference between
// "resolved from the DB" and this hardcoded default. Only LABEL text is
// registry-driven here.
const DEFAULT_COLUMNS: ScreenColumn[] = [
  { field: "totalProjects", label: "Active Projects", type: "number", importance: "High" },
  { field: "totalBudget", label: "Total Budget", type: "number", importance: "High" },
  { field: "totalRevenue", label: "Total Revenue", type: "number", importance: "High" },
  { field: "totalExpenses", label: "Total Expenses", type: "number", importance: "High" },
  { field: "project", label: "Project", type: "text", importance: "High" },
  { field: "value", label: "Value", type: "number", importance: "High" },
  { field: "earnedValue", label: "Earned Value", type: "number", importance: "High" },
  { field: "revenue", label: "Revenue", type: "number", importance: "High" },
  { field: "expenses", label: "Expenses", type: "number", importance: "High" },
  { field: "tasks", label: "Tasks", type: "number", importance: "High" },
  { field: "delayed", label: "Delayed", type: "number", importance: "High" },
];

function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

/** R67 E-02 chart 1 -- one group per project, three bars: contract, earned, spend. */
const PORTFOLIO_SERIES: GroupedBarSeries[] = [
  { key: "contract", label: "Contract value", color: "var(--color-chart-1)" },
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
    values: { contract: p.value, earned: p.earnedValue, spend: p.expenses },
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
}: {
  userName: string;
  data: OrgDashboard | null;
  currencies: CurrencyRow[];
  errorMessage: string | null;
  registryColumns?: RegistryColumn[] | null;
  /** The Filter drawer's date range, so the figures it narrowed can be captioned. */
  from?: string | null;
  to?: string | null;
}) {
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : DEFAULT_COLUMNS;
  const currency = orgCurrency(currencies);
  const currencySet = hasCurrency({ currency });
  const unitSuffix = currencyUnitSuffix({ currency }) ?? "";
  const money = (v: number | string | null | undefined) => formatMoney(v, { currency });

  const projects = data ? sortProjectRows(data.projects) : [];
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

  const attention = data ? needsYouSummary(data.projects) : null;
  const rangeCaption = dateRangeCaption(from, to);

  return (
    <>
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
                <CreateProjectDialog />
              </CardHeader>
              <CardContent className="space-y-3">
                {rangeCaption && <p className="text-[11.5px] text-px-muted">{rangeCaption}</p>}
                {data.projects.length === 0 && !mayAssertEmpty(errorMessage) ? (
                  // Only a read that SUCCEEDED may report "none" -- the same
                  // rule the greeting above follows.
                  <p className="py-8 text-center text-sm text-px-muted">Couldn&apos;t load the project list — see the error above.</p>
                ) : (
                  <ProjectRowList projects={projects} money={money} />
                )}
              </CardContent>
            </Card>

            {/* The four original KPI cards, now SECONDARY and below the rows:
                a portfolio total answers a question you ask after "which
                project needs me today", not before it. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardCard title={columnLabel(columns, "totalProjects", "Active Projects")} value={data.totalProjects} icon={Building2} variant="total" />
              <DashboardCard title={`${columnLabel(columns, "totalBudget", "Total Budget")}${unitSuffix}`} value={formatKpi(data.totalBudget, currencies)} icon={Wallet} variant="total" />
              <DashboardCard title={`${columnLabel(columns, "totalRevenue", "Total Revenue")}${unitSuffix}`} value={formatKpi(data.totalRevenue, currencies)} icon={TrendingUp} variant="completed" />
              <DashboardCard title={`${columnLabel(columns, "totalExpenses", "Total Expenses")}${unitSuffix}`} value={formatKpi(data.totalExpenses, currencies)} icon={Receipt} variant="pending" />
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
