import Link from "next/link";
import { DashboardCard } from "@/components/ui/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, TrendingUp, Receipt, Building2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { HomeGreeting } from "@fchecklist/veridian-ui-kit/shell";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { dashboardSummary, mayAssertEmpty } from "@/lib/read-outcome";

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
const CURRENCY_FALLBACK_LABEL = (() => {
  const code = (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY_CODE ?? "").trim();
  return code ? `${code} ` : "";
})();
function currencyLabel(currencies: CurrencyRow[]): string {
  const c = currencies.find((c) => c.isBaseCurrency);
  return c ? `${c.code} ` : CURRENCY_FALLBACK_LABEL;
}
function formatCurrency(n: number, currencies: CurrencyRow[]) {
  return `${currencyLabel(currencies)}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
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

        {/* R67 D-01 / correction C-01: this was the one popup left in
            PROJEXA (CreateProjectDialog). It is now a real route --
            /projects/new -- with its own breadcrumb, Back control and a
            Save that names the fields still missing, the same create
            archetype /labour/new already uses. The dialog component is
            deleted rather than left behind, so the two forms cannot drift. */}
        <div className="flex justify-end">
          <Button size="sm" asChild>
            <Link href="/projects/new"><Plus className="size-4" /> Create Project</Link>
          </Button>
        </div>

        {data && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardCard title={columnLabel(columns, "totalProjects", "Active Projects")} value={data.totalProjects} icon={Building2} variant="total" />
              <DashboardCard title={columnLabel(columns, "totalBudget", "Total Budget")} value={formatCurrency(data.totalBudget, currencies)} icon={Wallet} variant="total" />
              <DashboardCard title={columnLabel(columns, "totalRevenue", "Total Revenue")} value={formatCurrency(data.totalRevenue, currencies)} icon={TrendingUp} variant="completed" />
              <DashboardCard title={columnLabel(columns, "totalExpenses", "Total Expenses")} value={formatCurrency(data.totalExpenses, currencies)} icon={Receipt} variant="pending" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-px-muted">
                {data.totalRevenue === 0
                  ? `Total Revenue shows ${formatCurrency(0, currencies)} because no VERIDIAN ERP sales invoices exist yet for this org — create one below.`
                  : "Revenue reflects VERIDIAN ERP sales invoices for this org. Create another one below."}
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
                        <TableHead>{columnLabel(columns, "value", "Value")}</TableHead>
                        <TableHead>{columnLabel(columns, "earnedValue", "Earned Value")}</TableHead>
                        <TableHead>{columnLabel(columns, "revenue", "Revenue")}</TableHead>
                        <TableHead>{columnLabel(columns, "expenses", "Expenses")}</TableHead>
                        <TableHead>{columnLabel(columns, "tasks", "Tasks")}</TableHead>
                        <TableHead>{columnLabel(columns, "delayed", "Delayed")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.projects.map((p) => (
                        <TableRow key={p.id}>
                          {/* R42 seq24: the real per-project DASHBOARD.PROJECT screen this org table had no link to before -- was a dead end otherwise. */}
                          <TableCell className="font-medium">
                            <Link href={`/dashboard/project?projectId=${p.id}`} className="text-px-ink hover:underline">{p.name}</Link>
                          </TableCell>
                          <TableCell>{p.value === null ? <span className="text-px-muted">No scope yet</span> : formatCurrency(p.value, currencies)}</TableCell>
                          <TableCell>
                            {p.earnedValue === null ? (
                              <span className="text-px-muted">No progress yet</span>
                            ) : (
                              <>
                                {formatCurrency(p.earnedValue, currencies)}
                                <span className="text-px-muted"> ({p.percentByValue}%)</span>
                              </>
                            )}
                          </TableCell>
                          <TableCell>{formatCurrency(p.revenue, currencies)}</TableCell>
                          <TableCell>{formatCurrency(p.expenses, currencies)}</TableCell>
                          <TableCell>{p.taskCount}</TableCell>
                          <TableCell>
                            {p.delayedTaskCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-px-error">
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
          </>
        )}
      </div>
    </>
  );
}
