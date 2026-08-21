import { DashboardCard } from "@/components/ui/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, TrendingUp, Receipt, Building2, AlertTriangle } from "lucide-react";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { CreateInvoiceDialog } from "@/components/CreateInvoiceDialog";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { HomeGreeting } from "@fchecklist/veridian-ui-kit/shell";

type OrgDashboard = {
  totalProjects: number;
  totalBudget: number;
  totalRevenue: number;
  totalExpenses: number;
  projects: { id: string; name: string; revenue: number; expenses: number; taskCount: number; delayedTaskCount: number }[];
};
// Local, server-safe copy (not imported from @/lib/currency, which is a
// "use client" module -- this page is a Server Component and fetches its
// own currencies list directly via callVeridian, same as /api/currencies'
// own backing call). Priority 17 re-sweep fix: was
// Intl.NumberFormat(..., { currency: "INR" }), forcing both symbol and
// grouping to India regardless of the org's real base currency.
type CurrencyRow = { id: string; code: string; name: string; symbol: string | null; isBaseCurrency: boolean };
function currencyLabel(currencies: CurrencyRow[]): string {
  const c = currencies.find((c) => c.isBaseCurrency);
  return c ? `${c.code} ` : "₹";
}
function formatCurrency(n: number, currencies: CurrencyRow[]) {
  return `${currencyLabel(currencies)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default async function DashboardPage() {
  let data: OrgDashboard | null = null;
  let errorMessage: string | null = null;
  let currencies: CurrencyRow[] = [];

  // Perf fix (2026-08-17, see scripts/measure-perf.mjs + this task's
  // progress log for the real-browser measurement that found this):
  // real /dashboard TTFB against the live site measured ~2.8-3.5s on every
  // single load (x-vercel-cache: MISS every time, cache-control: no-store --
  // this route is never cached, so this cost is paid on every real visit,
  // not just a cold start). Root cause was this Server Component awaiting
  // four independent network round trips one at a time: the org lookup,
  // the VERIDIAN /dashboard fetch, the VERIDIAN /currencies fetch, and a
  // *second*, fully redundant live call to Supabase Auth's /user endpoint
  // for a value (the user's email) requireAuth() below already resolves
  // for free from the JWT it already verified -- the exact anti-pattern
  // auth-guard.ts's requireAuth()/getClaimsWithRetry() comment already
  // documented and fixed everywhere else in this app except here.
  // Fix: resolve auth once, and run the two independent VERIDIAN calls
  // concurrently instead of one-after-another (the /currencies call does
  // not depend on organizationId or on the /dashboard response).
  const authCtx = await requireAuth();
  const organizationId = authCtx.organizationId;
  const userName = authCtx.user?.email?.split("@")[0] ?? "there";

  const [dashboardResult, currencyResult] = await Promise.allSettled([
    callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined }),
    callVeridian<{ currencies: CurrencyRow[] }>("/currencies", { organizationId: organizationId ?? undefined }),
  ]);

  if (dashboardResult.status === "fulfilled") {
    data = dashboardResult.value;
  } else {
    const err = dashboardResult.reason;
    errorMessage = err instanceof VeridianApiError ? err.message : "Failed to load dashboard from VERIDIAN";
  }
  if (currencyResult.status === "fulfilled") {
    currencies = currencyResult.value.currencies ?? [];
  }
  // else: non-fatal -- formatCurrency() falls back to "₹" if this list is empty.

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
      <HomeGreeting
        userName={userName}
        summary={
          data && data.totalProjects > 0
            ? `You have ${data.totalProjects} active project${data.totalProjects === 1 ? "" : "s"}. ${delayedProjectCount > 0 ? `${delayedProjectCount} of them ${delayedProjectCount === 1 ? "has" : "have"} delayed tasks needing attention.` : "None of them have delayed tasks right now."}`
            : "No active projects yet — use VERI Chat below to get started."
        }
        stats={[
          ...(delayedProjectCount > 0 ? [{ label: `${delayedProjectCount} delayed`, tone: "attention" as const }] : []),
          ...(onTrackProjectCount > 0 ? [{ label: `${onTrackProjectCount} on track`, tone: "onTrack" as const }] : []),
        ]}
      />
      <main className="flex-1 space-y-6 p-6">
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
              <DashboardCard title="Active Projects" value={data.totalProjects} icon={Building2} variant="total" />
              <DashboardCard title="Total Budget" value={formatCurrency(data.totalBudget, currencies)} icon={Wallet} variant="total" />
              <DashboardCard title="Total Revenue" value={formatCurrency(data.totalRevenue, currencies)} icon={TrendingUp} variant="completed" />
              <DashboardCard title="Total Expenses" value={formatCurrency(data.totalExpenses, currencies)} icon={Receipt} variant="pending" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-px-muted">
                {data.totalRevenue === 0
                  ? `Total Revenue shows ${formatCurrency(0, currencies)} because no VERIDIAN ERP sales invoices exist yet for this org — create one below.`
                  : "Revenue reflects VERIDIAN ERP sales invoices for this org. Create another one below."}
              </p>
              <CreateInvoiceDialog />
            </div>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-heading text-base">Projects</CardTitle>
              </CardHeader>
              <CardContent>
                {data.projects.length === 0 ? (
                  <p className="py-8 text-center text-sm text-px-muted">No active projects yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Revenue</TableHead>
                        <TableHead>Expenses</TableHead>
                        <TableHead>Tasks</TableHead>
                        <TableHead>Delayed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.projects.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.name}</TableCell>
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
      </main>
    </>
  );
}
