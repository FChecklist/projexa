import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { HomeGreeting } from "@fchecklist/veridian-ui-kit/shell";
import { KpiCard, Sparkline, type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { mayAssertEmpty } from "@/lib/read-outcome";
import { MONEY_CELL_CLASS, formatMoney, hasCurrency } from "@/lib/format-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import DashboardRowRetry from "@/components/DashboardRowRetry";
import {
  budgetVerdict,
  needsYouProjects,
  onTrackProjects,
  portfolioProgress,
  projectVerdict,
  rowContractValue,
  rowDataArrived,
  rowPercentByValue,
  sanitizeScreenLabel,
  type LaunchpadProject,
} from "@/lib/dashboard-launchpad";

// R46 P8 seq123: presentational body extracted out of (app)/dashboard/page.tsx
// so that route file could stay a thin server resolver.
//
// R67 E-21 (R-195 / R-204 / R-205 / R-222, correction C-14) -- THE LAUNCHPAD.
// What this screen used to be: a greeting, four DashboardCard tiles (one of
// which read "ACTIVE PROJECTS (HARD-STOP TEST) 5" on the live product, and
// three of which navigated nowhere while the fourth navigated to the wrong
// screen), and a seven-column table below the fold. What it is now: ONE
// dominant number, at most three KPI cards that are each a real link with a
// baseline, and one row per project carrying a bullet bar of earned value
// against contract value.
//
// Every figure comes from the SINGLE getOrgDashboard call this page already
// made. The sibling /dashboard/overview page used to fetch GET /dashboard/{id}
// once per project from the browser purely to read progressPercent; that
// figure is now on this payload, that fan-out is deleted, and the route
// redirects here.
//
// STATES, and why each is worded the way it is: a null figure reads "Not set"
// (the org has no BOQ / no budget rows, or the caller's role is not allowed
// the number), a zero reads 0 because zero is a real figure, and a row whose
// figures never arrived says so and offers Retry instead of drawing a bar for
// data it did not receive. See src/lib/dashboard-launchpad.ts.
export type OrgDashboard = {
  totalProjects: number;
  totalBudget: number | null;
  totalRevenue: number | null;
  totalExpenses: number | null;
  projects: LaunchpadProject[];
};

// Local, server-safe copy (not imported from @/lib/currency, which is a
// "use client" module -- this page is a Server Component and fetches its
// own currencies list directly via callVeridian, same as /api/currencies'
// own backing call).
export type CurrencyRow = { id: string; code: string; name: string; symbol: string | null; isBaseCurrency: boolean };

// R67 G-05 (R-260): this file's own local formatCurrency() is gone. It was
// the third independent copy of the same logic in this app.
// src/lib/format-money.ts is now the only copy. It has no "use client" and no
// React, precisely so this Server Component can use it.
//
// NEXT_PUBLIC_DEFAULT_CURRENCY_CODE is deliberately NOT consulted: it is a
// deployment-wide guess, and R-260's rule is that a screen with no per-org
// currency renders the number behind a warning glyph and says so once.
function orgCurrency(currencies: CurrencyRow[]): string | null {
  return currencies.find((c) => c.isBaseCurrency)?.code ?? null;
}
/** KPI tiles show whole units -- the fraction is noise at that size. */
function formatKpi(n: number | null | undefined, currencies: CurrencyRow[]) {
  return formatMoney(n ?? null, { currency: orgCurrency(currencies), fractionDigits: 0 });
}
function formatCurrency(n: number | null | undefined, currencies: CurrencyRow[]) {
  return formatMoney(n ?? null, { currency: orgCurrency(currencies) });
}
/** A figure the org does not have. "Not set" is the word, everywhere on this screen. */
const NOT_SET = "Not set";

export type RegistryColumn = ScreenColumn;

// Fallback when no registry row is seeded yet (or the resolve call errors).
// Only LABEL text is registry-driven; every value, destination and state on
// this screen is computed from the payload.
const DEFAULT_COLUMNS: ScreenColumn[] = [
  { field: "portfolioProgress", label: "% complete by value", type: "text", importance: "High" },
  { field: "needsYou", label: "Projects needing you", type: "number", importance: "High" },
  { field: "budgetVsSpend", label: "Budget vs spend", type: "number", importance: "High" },
  { field: "totalRevenue", label: "Revenue invoiced", type: "number", importance: "High" },
  { field: "project", label: "Project", type: "text", importance: "High" },
];

// R67 E-21 (R-222): the registry row for this screen really does read
// "ACTIVE PROJECTS (HARD-STOP TEST)" in the platform database, and it really
// was rendered on the product's landing page. The row is platform data that
// lives only in Supabase, so the SCREEN refuses it too -- a label carrying a
// test marker never reaches a customer, whatever the row says.
function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return sanitizeScreenLabel(columns.find((c) => c.field === field)?.label, fallback);
}

/**
 * The bullet bar on a project row: earned value filled against contract
 * value. Deliberately NOT the kit's BulletChart, which prints its own
 * `value.toLocaleString()` end labels -- a bare number with no currency token
 * is exactly what R-260 forbids, and this row states its money once, through
 * the one formatter, in the cells beside the bar.
 */
function EarnedValueBar({ earned, contract }: { earned: number; contract: number }) {
  const pct = contract > 0 ? Math.min(100, Math.max(0, (earned / contract) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-sm bg-px-border/60" aria-hidden>
      <div className="h-2 rounded-sm" style={{ width: `${pct}%`, backgroundColor: "var(--color-chart-1)" }} />
    </div>
  );
}

export default function DashboardHomeView({
  userName,
  data,
  currencies,
  errorMessage,
  registryColumns,
}: {
  userName: string;
  data: OrgDashboard | null;
  currencies: CurrencyRow[];
  errorMessage: string | null;
  registryColumns?: RegistryColumn[] | null;
}) {
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : DEFAULT_COLUMNS;
  const currencySet = hasCurrency({ currency: orgCurrency(currencies) });

  const projects = data?.projects ?? [];
  const portfolio = portfolioProgress(projects);
  const budget = budgetVerdict(projects);
  const needsYou = needsYouProjects(projects);
  const onTrack = onTrackProjects(projects);

  // R67 E-21 (R-222): "on track" is counted from the SAME verdict the rows
  // render, and that verdict refuses to say it for a project with no
  // schedule. The old greeting derived "on track" as
  // totalProjects - delayedProjectCount, which called five unplanned
  // projects on track because none of them had a late task to be late on.
  const summary =
    data === null
      ? mayAssertEmpty(errorMessage)
        ? "No active projects yet — use VERI Chat below to get started."
        : "Couldn't load your projects just now, so this screen can't show how many you have. The error below has the details."
      : projects.length === 0
        ? mayAssertEmpty(errorMessage)
          ? "No active projects yet — use VERI Chat below to get started."
          : "Couldn't load your projects just now, so this screen can't show how many you have. The error below has the details."
        : `You have ${projects.length} active project${projects.length === 1 ? "" : "s"}. ` +
          (needsYou.length > 0
            ? `${needsYou.length} need${needsYou.length === 1 ? "s" : ""} you.`
            : onTrack.length > 0
              ? `${onTrack.length} on track against a schedule.`
              : "None of them has a schedule yet, so none can be called on track.");

  return (
    <>
      <HomeGreeting
        userName={userName}
        summary={summary}
        stats={[
          ...(needsYou.length > 0 ? [{ label: `${needsYou.length} needs you`, tone: "attention" as const }] : []),
          ...(onTrack.length > 0 ? [{ label: `${onTrack.length} on track`, tone: "onTrack" as const }] : []),
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

        <div className="flex justify-end">
          {/* D-01 (WS-D) moves this to a real /projects/new route. Left as it
              is here on purpose so the two changes do not collide. */}
          <CreateProjectDialog />
        </div>

        {data && (
          <>
            {/* THE ONE NUMBER, then at most three KPIs. Every one of the four
                is a link with a real destination and a baseline line --
                correction C-14 recorded that three of the old tiles had no
                destination at all and the fourth had the wrong one. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <Link href="/work-progress?tab=analytics" className="block">
                  <KpiCard
                    size="primary"
                    label={columnLabel(columns, "portfolioProgress", "% complete by value")}
                    value={portfolio.percent === null ? NOT_SET : `${portfolio.percent}%`}
                    trend={{
                      direction:
                        portfolio.deltaPercentagePoints === null || portfolio.deltaPercentagePoints === 0
                          ? "flat"
                          : portfolio.deltaPercentagePoints > 0
                            ? "up"
                            : "down",
                      tone: "context",
                      label:
                        portfolio.deltaPercentagePoints === null
                          ? "no BOQ to measure against yet"
                          : `${portfolio.deltaPercentagePoints > 0 ? "+" : ""}${portfolio.deltaPercentagePoints} points vs last week`,
                    }}
                    baseline={
                      portfolio.percent === null
                        ? "Import a BOQ to see earned value"
                        : `${formatKpi(portfolio.earned, currencies)} earned of ${formatKpi(portfolio.contract, currencies)} across ${portfolio.projectsCounted} project${portfolio.projectsCounted === 1 ? "" : "s"}`
                    }
                    visual={
                      portfolio.percent !== null && portfolio.percentPrevWeek !== null ? (
                        <Sparkline values={[portfolio.percentPrevWeek, portfolio.percent]} />
                      ) : undefined
                    }
                  />
                </Link>
              </div>

              <Link href="/schedule" className="block">
                <KpiCard
                  label={columnLabel(columns, "needsYou", "Projects needing you")}
                  value={String(needsYou.length)}
                  trend={{
                    direction: needsYou.length > 0 ? "up" : "flat",
                    tone: needsYou.length > 0 ? "needs-you" : "done",
                    label: needsYou.length > 0 ? "late tasks or spend past contract" : "nothing late or overspent",
                  }}
                  baseline={`of ${projects.length} active project${projects.length === 1 ? "" : "s"}`}
                />
              </Link>

              <Link href="/budgets" className="block">
                <KpiCard
                  label={columnLabel(columns, "budgetVsSpend", "Budget vs spend")}
                  value={formatKpi(budget.spent, currencies)}
                  trend={{ direction: budget.direction, tone: budget.tone, label: budget.word }}
                  baseline={budget.budget === null ? `Budget ${NOT_SET} → Budgets` : `budget ${formatKpi(budget.budget, currencies)}`}
                />
              </Link>

              <Link href="/invoices" className="block">
                <KpiCard
                  label={columnLabel(columns, "totalRevenue", "Revenue invoiced")}
                  value={formatKpi(data.totalRevenue, currencies)}
                  trend={{
                    direction: "flat",
                    tone: "context",
                    label: data.totalRevenue === null ? "not available on your role" : "VERIDIAN ERP sales invoices",
                  }}
                  baseline={`across ${projects.length} project${projects.length === 1 ? "" : "s"}`}
                />
              </Link>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-px-muted">
                {data.totalRevenue === 0
                  ? `Revenue invoiced shows ${formatKpi(0, currencies)} because no VERIDIAN ERP sales invoices exist yet for this org.`
                  : "Revenue reflects VERIDIAN ERP sales invoices for this org."}
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/invoices/new"><Receipt className="size-4" /> Create / Link Invoice</Link>
              </Button>
            </div>

            {/* ONE ROW PER PROJECT. The whole row is the door (R-205); the
                bar is earned value against contract value; the percentage is
                right-aligned and tabular so a column of them reads down. */}
            <Card className="shadow-card">
              <CardContent className="p-0">
                {projects.length === 0 ? (
                  <p className="py-8 text-center text-sm text-px-muted">
                    {mayAssertEmpty(errorMessage) ? "No active projects yet." : "Couldn't load the project list — see the error above."}
                  </p>
                ) : (
                  <ul className="divide-y divide-px-border">
                    {projects.map((p) => {
                      const arrived = rowDataArrived(p);
                      const contract = rowContractValue(p);
                      const percent = rowPercentByValue(p);
                      const verdict = projectVerdict(p);
                      const spent = typeof p.spent === "number" ? p.spent : p.expenses;
                      return (
                        <li key={p.id}>
                          <Link
                            href={`/dashboard/project?projectId=${p.id}`}
                            className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 hover:bg-muted/40 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]"
                          >
                            <span className="min-w-0 truncate font-medium text-px-ink">{p.name}</span>

                            {!arrived ? (
                              // Never a bar for data we did not receive.
                              <span className="text-sm text-px-error">
                                Couldn&apos;t load — <DashboardRowRetry />
                              </span>
                            ) : contract === null || typeof p.earnedValue !== "number" ? (
                              <span className="text-sm text-px-muted">No scope yet — {NOT_SET}</span>
                            ) : (
                              <span className="flex min-w-0 flex-col justify-center gap-1">
                                <EarnedValueBar earned={p.earnedValue} contract={contract} />
                                <span className="text-[11.5px] text-px-muted">
                                  {formatCurrency(p.earnedValue, currencies)} earned of {formatCurrency(contract, currencies)} · spend {formatCurrency(spent, currencies)}
                                </span>
                              </span>
                            )}

                            <span className="flex items-center justify-end gap-3">
                              <span className={`${MONEY_CELL_CLASS} w-16 text-px-ink`}>
                                {percent === null ? NOT_SET : `${percent}%`}
                              </span>
                              <span
                                className="w-32 text-right text-[12.5px]"
                                style={{ color: `var(--color-veri-status-${verdict.tone})` }}
                              >
                                <span aria-hidden>{verdict.glyph}</span> {verdict.word}
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
            {/* R67 G-05: said once, at the foot of the page. */}
            <CurrencyNotSetNotice currencySet={currencySet} />
          </>
        )}
      </div>
    </>
  );
}
