import Link from "next/link";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, TrendingUp, Receipt, Building2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
// R67 C-06: every KPI value and every project row is a DOOR -- a real link
// that also fills the control strip. Correction C-14 recorded these four
// tiles as "do not navigate at all"; they were plain cards.
import { ChainDoor } from "@/components/shell/ChainDoor";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { HomeGreeting } from "@fchecklist/veridian-ui-kit/shell";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { dashboardSummary, mayAssertEmpty } from "@/lib/read-outcome";
import { MONEY_CELL_CLASS, currencyUnitSuffix, formatMoney, hasCurrency } from "@/lib/format-money";

/** Money column headers align with their cells. */
const MONEY_HEAD_CLASS = "text-right";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";

// R46 P8 seq123: presentational body extracted out of (app)/dashboard/page.tsx
// so that route file could stay a thin server resolver (same split as every
// other registry-driven screen this session -- PermitsListClient,
// DocumentsClient, ScopeClient). Nothing about data-fetching, values, or
// structure moved here changed -- this is a 1:1 lift of the original JSX.
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
  projects: { id: string; name: string; revenue: number; expenses: number; taskCount: number; delayedTaskCount: number; value: number | null; earnedValue: number | null; percentByValue: number | null }[];
};
// Local, server-safe copy (not imported from @/lib/currency, which is a
// "use client" module -- this page is a Server Component and fetches its
// own currencies list directly via callVeridian, same as /api/currencies'
// own backing call). Priority 17 re-sweep fix: was
// Intl.NumberFormat(..., { currency: "INR" }), forcing both symbol and
// grouping to India regardless of the org's real base currency.
export type CurrencyRow = { id: string; code: string; name: string; symbol: string | null; isBaseCurrency: boolean };
// R51 (R-62): the fallback was the literal "₹". This component IS the
// landing screen, so that constant was the single most visible instance of
// the bug -- a UAE buyer's first view of the product showed rupees whenever
// the currencies list was empty, which for an org with no erp_currencies
// base row (4 of 5 real orgs, measured 2026-08-26) is permanently. Same
// rule as @/lib/currency: never render a currency token we cannot source.
// The value is duplicated rather than imported because that module is
// "use client" and this is a Server Component -- see the note above; the
// two must be kept in step.
// R67 G-05 (R-260): this file's own local formatCurrency() is gone. It was
// the third independent copy of the same logic in this app, and it disagreed
// with the other two in two ways that showed on screen: 0 decimals here
// against 2 elsewhere, so one amount read "AED 1,200" on the home page and
// "AED 1,200.00" one click away; and a null value fell through to the same
// rendering as zero. src/lib/format-money.ts is now the only copy. It has no
// "use client" and no React, precisely so this Server Component can use it.
//
// NEXT_PUBLIC_DEFAULT_CURRENCY_CODE is deliberately NOT consulted: it is a
// deployment-wide guess, and R-260's rule is that a screen with no per-org
// currency renders the number behind a warning glyph and says so once,
// rather than labelling an amount with a code nobody confirmed. The
// CurrencyNotSetNotice at the foot of the page is that sentence.
function orgCurrency(currencies: CurrencyRow[]): string | null {
  return currencies.find((c) => c.isBaseCurrency)?.code ?? null;
}
/** KPI tiles show whole units -- the fraction is noise at that size. Every table cell keeps two decimals. */
function formatKpi(n: number | null, currencies: CurrencyRow[]) {
  return formatMoney(n, { currency: orgCurrency(currencies), fractionDigits: 0 });
}
function formatCurrency(n: number | null, currencies: CurrencyRow[]) {
  return formatMoney(n, { currency: orgCurrency(currencies) });
}

// R46 P8 seq123 (M28 registry-model, DASHBOARD archetype -- function_id
// "dashboard.dashboard"): intentionally the same fields as ScreenColumn so a
// registry row can be passed straight in with no reshaping, same pattern as
// PermitsListClient/ScopeClient's RegistryColumn.
export type RegistryColumn = ScreenColumn;

// Fallback when no registry row is seeded yet (or the resolve call errors) --
// mirrors the registry seed 1:1, so there is no visible difference between
// "resolved from the DB" and this hardcoded default. Only LABEL text is
// registry-driven here: the KPI cards and Projects table below stay the
// fully hand-built layout that already shipped (not the kit's generic
// DashboardScreen composition -- this is PROJEXA's HOME_ROUTE with its own
// HomeGreeting hero and a real 4-card + full project-table layout; swapping
// to DashboardScreen's oneNumber/trend/breakdown shape would be a much
// larger visual rewrite of a live production landing page for label-only
// registry gain, same minimal-risk call R46 P8 seq121 made for boq.custom).
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
  const unitSuffix = currencyUnitSuffix({ currency: orgCurrency(currencies) }) ?? "";

  // Merged-Home-page greeting (Owner directive 2026-07-18, agreed reference
  // mockup): /dashboard is PROJEXA's designated home route (see
  // (app)/layout.tsx's HOME_ROUTE). Real counts only -- delayedProjectCount
  // reuses the same per-project delayedTaskCount this page already fetches
  // above, never a fabricated number.
  const delayedProjectCount = data?.projects.filter((p) => p.delayedTaskCount > 0).length ?? 0;
  const onTrackProjectCount = (data?.totalProjects ?? 0) - delayedProjectCount;

  return (
    <>
      {/* No PageHeading here -- this is PROJEXA's designated home route
          (see (app)/layout.tsx's HOME_ROUTE), and HomeGreeting below
          already renders a real "Good morning, {name}." heading; a second
          "Dashboard" label above it would be redundant. */}
      {/* R46S11_01: this sentence used to fall through to "No active
          projects yet" whenever `data` was null -- INCLUDING when data was
          null because the read had FAILED. On the primary owner-facing
          screen, for an org with 5 real active projects, a 504 rendered as a
          confident "you have none", directly above an error card saying the
          load failed. Same shape the sibling screen /dashboard/overview was
          fixed for below; this one is the higher-blast-radius instance,
          because it is the first page an owner lands on after login.
          dashboardSummary() (src/lib/read-outcome.ts) will not state a count
          the read could not produce. */}
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

        <div className="flex justify-end">
          <CreateProjectDialog />
        </div>

        {data && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* R67 C-06: "EVERY NUMBER IS A DOOR". Each tile carries its
                  own chain sentence and its own destination, both from the
                  DOORS table, and a tile with nothing behind it says so in
                  words instead of rendering a dead zero. */}
              <ChainDoor
                doorId="dashboard.active_projects"
                disabledReason={data.totalProjects === 0 ? "No active projects yet" : undefined}
              >
                <DashboardCard title={columnLabel(columns, "totalProjects", "Active Projects")} value={data.totalProjects} icon={Building2} variant="total" />
              </ChainDoor>
              <ChainDoor
                doorId="dashboard.total_budget"
                disabledReason={data.totalBudget === 0 ? "No budgets set up yet" : undefined}
              >
                <DashboardCard title={columnLabel(columns, "totalBudget", "Total Budget")} value={formatKpi(data.totalBudget, currencies)} icon={Wallet} variant="total" />
              </ChainDoor>
              <ChainDoor
                doorId="dashboard.total_revenue"
                disabledReason={data.totalRevenue === 0 ? "No sales invoices yet" : undefined}
              >
                <DashboardCard title={columnLabel(columns, "totalRevenue", "Total Revenue")} value={formatKpi(data.totalRevenue, currencies)} icon={TrendingUp} variant="completed" />
              </ChainDoor>
              <ChainDoor
                doorId="dashboard.total_expenses"
                disabledReason={data.totalExpenses === 0 ? "No expenses recorded yet" : undefined}
              >
                <DashboardCard title={columnLabel(columns, "totalExpenses", "Total Expenses")} value={formatKpi(data.totalExpenses, currencies)} icon={Receipt} variant="pending" />
              </ChainDoor>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-px-muted">
                {/* R67 G-04 (R-231): the second branch used to end "Create
                    another one below.", which referred to nothing -- the
                    only create control is the button to the RIGHT of this
                    sentence, not below it, and the first branch's "create one
                    below" had the same fault. Both now point at the control
                    that actually exists, by its own label. */}
                {data.totalRevenue === 0
                  ? `Total Revenue shows ${formatKpi(0, currencies)} because no VERIDIAN ERP sales invoices exist yet for this org.`
                  : "Revenue reflects VERIDIAN ERP sales invoices for this org."}
              </p>
              {/* Real-screen conversion (2026-08-30) -- was a separate,
                  duplicate "Create / Link Invoice" Dialog popup
                  (CreateInvoiceDialog.tsx) with its own copy of the same
                  create-invoice logic InvoicesClient.tsx had; now routes to
                  the one real Invoice create screen instead of maintaining
                  two forms that could drift apart. */}
              <Button variant="outline" size="sm" asChild>
                <Link href="/invoices/new"><Receipt className="size-4" /> Create / Link Invoice</Link>
              </Button>
            </div>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-heading text-base">Projects</CardTitle>
              </CardHeader>
              <CardContent>
                {data.projects.length === 0 ? (
                  // Same rule as the greeting above: only a read that
                  // succeeded may report "none". Today `data` and
                  // `errorMessage` are mutually exclusive (dashboard/page.tsx
                  // sets one or the other), so this guard costs nothing --
                  // it is here so the honest branch cannot be lost if that
                  // ever changes.
                  <p className="py-8 text-center text-sm text-px-muted">
                    {mayAssertEmpty(errorMessage) ? "No active projects yet." : "Couldn't load the project list — see the error above."}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{columnLabel(columns, "project", "Project")}</TableHead>
                        {/* R67 G-05: the unit is stated once, in the header. */}
                        <TableHead className={MONEY_HEAD_CLASS}>{columnLabel(columns, "value", "Value")}{unitSuffix}</TableHead>
                        <TableHead className={MONEY_HEAD_CLASS}>{columnLabel(columns, "earnedValue", "Earned Value")}{unitSuffix}</TableHead>
                        <TableHead className={MONEY_HEAD_CLASS}>{columnLabel(columns, "revenue", "Revenue")}{unitSuffix}</TableHead>
                        <TableHead className={MONEY_HEAD_CLASS}>{columnLabel(columns, "expenses", "Expenses")}{unitSuffix}</TableHead>
                        <TableHead className="text-right">{columnLabel(columns, "tasks", "Tasks")}</TableHead>
                        <TableHead className="text-right">{columnLabel(columns, "delayed", "Delayed")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.projects.map((p) => (
                        <TableRow key={p.id}>
                          {/* R42 seq24: the real per-project DASHBOARD.PROJECT screen this org table had no link to before -- was a dead end otherwise. */}
                          <TableCell className="font-medium">
                            {/* R67 C-06: still a real link -- it now also
                                fills the strip with
                                "<project> > Dashboard > Project". */}
                            <ChainDoor doorId="dashboard.project" projectId={p.id} className="text-px-ink hover:underline">
                              {p.name}
                            </ChainDoor>
                          </TableCell>
                          <TableCell className={MONEY_CELL_CLASS}>{p.value === null ? <span className="text-px-muted">No scope yet</span> : formatCurrency(p.value, currencies)}</TableCell>
                          <TableCell className={MONEY_CELL_CLASS}>
                            {p.earnedValue === null ? (
                              <span className="text-px-muted">No progress yet</span>
                            ) : (
                              <>
                                {formatCurrency(p.earnedValue, currencies)}
                                <span className="text-px-muted"> ({p.percentByValue}%)</span>
                              </>
                            )}
                          </TableCell>
                          <TableCell className={MONEY_CELL_CLASS}>{formatCurrency(p.revenue, currencies)}</TableCell>
                          <TableCell className={MONEY_CELL_CLASS}>{formatCurrency(p.expenses, currencies)}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.taskCount}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.delayedTaskCount > 0 ? (
                              // R67 WS-G: the glyph and the number both carry
                              // it; the tone is the readable rose text token,
                              // not the raw error red.
                              <span className="inline-flex items-center gap-1" style={{ color: "var(--status-late-text)" }}>
                                <AlertTriangle className="size-3.5" /> {p.delayedTaskCount}
                              </span>
                            ) : (
                              <span className="text-px-muted">0</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
