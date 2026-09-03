// R67 F-18 / decision D-04 option A.
//
// This route is the fallback destination of every module page that cannot
// establish a project, so it is the screen most often waited on -- and it
// awaited requireAuth() plus two VERIDIAN calls before emitting anything. The
// greeting, the KPI tiles and the projects table now stream as a frame
// (loading.tsx and the boundary below share it) while those calls run, and the
// screen-definitions lookup is served from an hour-long per-org cache rather
// than re-requested on every visit.
//
// The two VERIDIAN calls stay concurrent (perf fix 2026-08-17, see
// scripts/measure-perf.mjs): neither depends on the other's response.
//
// R67 MERGE (lane D0 x lane F2). Lane D0's D-66 -- "HOME follows the project
// context" -- is kept in full and moves INSIDE the boundary with everything
// else that needs the network:
//
//   /dashboard renders the portfolio when the context is All and the PROJECT
//   dashboard when a project is set; /dashboard/project stays a deep link that
//   sets the context. Until D-66, /dashboard always rendered the org
//   portfolio, whatever the rail said -- so a user who picked Cedar Heights in
//   the top bar and then clicked HOME landed on a screen about every project,
//   with the rail still naming one. That is the same split-brain R-253
//   recorded in the breadcrumb, in the one place a user returns to most often.
//
// The order of sources is the WS-A root rule's: the URL wins, then the cookie
// the rail writes. There is deliberately NO projects[0] fallback -- that is
// the fault D-20 removed, and the home screen is the loudest possible place to
// re-introduce it. The scope is decided from the org's REAL project list, so a
// stale cookie naming a project this org can no longer see is discarded rather
// than followed into a blank screen; that is why the decision sits after the
// dashboard read rather than before it, and therefore inside the boundary.
import { Suspense } from "react";
import { cookies } from "next/headers";
import { callVeridian, VeridianApiError, createCachedVeridianGet } from "@/lib/veridian-client";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { listUserCompanies } from "@/lib/company-scope";
import { getScreenColumns } from "@/lib/module-list-source";
import { dashboardScope, PROJECT_COOKIE } from "@/lib/project-selection";
import DashboardHomeView, { type OrgDashboard, type CurrencyRow } from "@/components/DashboardHomeView";
import DashboardProjectClient from "@/components/DashboardProjectClient";
import ModuleDirectory from "@/components/shell/ModuleDirectory";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6" data-state="loading" aria-busy="true">
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-4 w-96" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="shadow-card">
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// R67 F-01 (integration, lane F1 onto main). The currency master list is not a
// live figure -- it is a lookup table that changes when someone adds a currency,
// not between two page views -- and the home screen re-requested it on every
// visit. It now comes from a 5-minute per-org server cache, so the only
// uncached call left in the block below is the one that carries real numbers.
//
// The wrapper is created ONCE at module scope, not per request: see
// createCachedVeridianGet's own comment. The org id is both an explicit key
// part and the fetcher's sole argument, so one org's currency list can never be
// served to another (AR-04 / E-45).
const DASHBOARD_LOOKUP_TTL_SECONDS = 300;
const readCachedCurrencies = createCachedVeridianGet<{ currencies: CurrencyRow[] }>(
  "dashboard-currencies",
  "/currencies",
  DASHBOARD_LOOKUP_TTL_SECONDS
);

/**
 * R67 E-02 (R-012): /dashboard/hierarchy is retired as a destination and its
 * Company selector now lives in this screen's Filter drawer, as ?companyId.
 *
 * "Company" here means a PROJEXA organization the signed-in user is a member
 * of -- see src/lib/company-scope.ts for why that is a different concept from
 * VERIDIAN's erp_companies. Membership is VERIFIED before the id is used to
 * scope the payload: an unverified companyId in a URL would be a tenant-
 * boundary hole, so an id the user is not a member of falls back to their own
 * org rather than being trusted.
 */
async function resolveScopedOrganizationId(userId: string | undefined, defaultOrgId: string | null, companyId: string | null): Promise<string | null> {
  if (!companyId || !userId) return defaultOrgId;
  const companies = await listUserCompanies(userId);
  return companies.some((c) => c.id === companyId) ? companyId : defaultOrgId;
}

async function DashboardHome({
  requestedProjectId,
  filters,
}: {
  requestedProjectId?: string;
  /** R67 E-02 (R-012): the Filter drawer's state, read from the URL by the page. */
  filters: { companyId: string | null; departmentId: string | null; from: string | null; to: string | null };
}) {
  const authCtx = await requireAuth();
  const userName = authCtx.user?.email?.split("@")[0] ?? "there";

  // R67 E-02: the Filter drawer's four fields arrive here, in the URL, so the
  // filtered view is shareable and Back undoes it.
  const companyId = filters.companyId;
  const departmentId = filters.departmentId;
  const from = filters.from;
  const to = filters.to;

  // Membership is VERIFIED before the id scopes anything: an unverified
  // companyId in a URL would be a tenant-boundary hole.
  const organizationId = await resolveScopedOrganizationId(authCtx.user?.id, authCtx.organizationId, companyId);

  const dashboardQuery = new URLSearchParams();
  if (departmentId) dashboardQuery.set("departmentId", departmentId);
  if (from) dashboardQuery.set("from", from);
  if (to) dashboardQuery.set("to", to);
  const dashboardPath = dashboardQuery.size > 0 ? `/dashboard?${dashboardQuery.toString()}` : "/dashboard";

  // R46 P8 seq123: DASHBOARD archetype ("dashboard.dashboard"). A missing or
  // errored registry row is NOT fatal -- DashboardHomeView falls back to its
  // own hardcoded labels when this is null.
  //
  // Perf fix (2026-08-17): the two VERIDIAN calls below run concurrently --
  // neither depends on the other -- and the registry lookup is kicked off
  // before the awaited block so it is not a third serial round trip.
  const columnsPromise = getScreenColumns("dashboard.dashboard", organizationId); // never rejects
  const [dashboardResult, currencyResult] = await Promise.allSettled([
    callVeridian<OrgDashboard>(dashboardPath, { organizationId: organizationId ?? undefined }),
    // R67 F-01: the currency master is a lookup table, not a live figure. The
    // filtered dashboard path above is the only call here carrying real
    // numbers. Cached only when the read is unfiltered-by-company, because the
    // cache is keyed per org.
    organizationId
      ? readCachedCurrencies(organizationId)
      : callVeridian<{ currencies: CurrencyRow[] }>("/currencies"),
  ]);
  const registryColumns = await columnsPromise;

  let data: OrgDashboard | null = null;
  let errorMessage: string | null = null;
  let currencies: CurrencyRow[] = [];

  if (dashboardResult.status === "fulfilled") {
    data = dashboardResult.value;
  } else {
    const err = dashboardResult.reason;
    errorMessage = err instanceof VeridianApiError ? err.message : "Failed to load dashboard from VERIDIAN";
  }
  if (currencyResult.status === "fulfilled") {
    currencies = currencyResult.value.currencies ?? [];
  }
  // else: non-fatal. NOTE, corrected R52: formatCurrency() does NOT fall back
  // to a rupee -- PR #156 removed that because it was the DEFAULT RENDER, not
  // a rare degradation path, and a UAE buyer saw rupees on the landing screen.
  // An empty list now renders the deployment default
  // (NEXT_PUBLIC_DEFAULT_CURRENCY_CODE=AED in production) or a bare number.

  const remembered = (await cookies()).get(PROJECT_COOKIE)?.value ?? null;
  const scope = dashboardScope(data?.projects ?? [], requestedProjectId, remembered);

  if (scope.project) {
    // The project dashboard renders its own "Dashboard / <project name>"
    // breadcrumb from the payload it fetches, so the rail and the breadcrumb
    // are naming the same project by construction.
    return <DashboardProjectClient projectId={scope.project.id} labels={registryColumns} />;
  }

  return (
    <DashboardHomeView
      userName={userName}
      data={data}
      currencies={currencies}
      errorMessage={errorMessage}
      registryColumns={registryColumns}
      from={from}
      to={to}
      // R67 E-19 (R-180): the day is resolved ONCE, here on the server, and
      // handed down. The "no progress in 30 days" signal is a date comparison,
      // and a component that reads the clock during render produces one answer
      // on the server pass and another on the client's -- the hydration-
      // mismatch class src/lib/format-date.ts documents. UTC for the same
      // reason every timestamp in this codebase is stored in it.
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // R67 E-02: the Filter drawer's fields, collapsed from Next's
  // string | string[] to the single value each of them always carries.
  const params = await searchParams;
  const one = (key: string): string | null => {
    const v = params[key];
    return (Array.isArray(v) ? v[0] : v) ?? null;
  };
  const projectId = one("projectId") ?? undefined;
  const filters = {
    companyId: one("companyId"),
    departmentId: one("departmentId"),
    from: one("from"),
    to: one("to"),
  };

  // M24: HOME is the grouped module directory, and it is what REPLACES the
  // deleted left rail. It needs no network at all, so it renders OUTSIDE the
  // boundary -- a new user with a slow backend still sees every module the
  // product has while the numbers are still arriving.
  return (
    <div className="space-y-8 pb-4">
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardHome requestedProjectId={projectId} filters={filters} />
      </Suspense>
      <div className="px-6">
        <ModuleDirectory />
      </div>
    </div>
  );
}
