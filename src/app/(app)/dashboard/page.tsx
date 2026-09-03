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

async function DashboardHome({ requestedProjectId }: { requestedProjectId?: string }) {
  const authCtx = await requireAuth();
  const organizationId = authCtx.organizationId;
  const userName = authCtx.user?.email?.split("@")[0] ?? "there";

  // R46 P8 seq123: DASHBOARD archetype ("dashboard.dashboard"). A missing or
  // errored registry row is NOT fatal -- DashboardHomeView falls back to its
  // own hardcoded labels when this is null.
  const columnsPromise = getScreenColumns("dashboard.dashboard", organizationId); // never rejects
  // R67 D-02: the "Permits expiring" KPI's own count, org-wide, read
  // concurrently with the other two. VERIDIAN's /permits treats projectId as
  // optional, so omitting it is the org-wide list -- the same withinDays=30
  // window the card's own destination (/permits?withinDays=30) then applies,
  // so the number and the screen it opens can never disagree.
  const [dashboardResult, currencyResult, permitsResult] = await Promise.allSettled([
    callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined }),
    // R67 F1: the currencies read is memoised per org now -- same value, one
    // fewer round trip on every dashboard navigation.
    organizationId
      ? readCachedCurrencies(organizationId)
      : callVeridian<{ currencies: CurrencyRow[] }>("/currencies"),
    // R67 MERGE: this third read is lane D1's, and a PREVIOUS merge had kept its
    // comment above, its destructuring below and the KPI that consumes it while
    // dropping the CALL -- so `permitsResult` was index 2 of a two-element
    // tuple. It survives this merge too: lane F1 rewrote the element ABOVE it,
    // which is exactly the shape of edit that silently truncated the tuple last
    // time. The tile it feeds is on screen and would otherwise read a permanent
    // en-dash that no failure caused.
    callVeridian<{ permits?: unknown[] }>("/permits?withinDays=30", {
      organizationId: organizationId ?? undefined,
    }),
  ]);
  const registryColumns = await columnsPromise;

  // R67 D-02: null, not 0, when that read failed -- "no permits are expiring"
  // and "we could not find out" must not render the same.
  const permitsExpiring =
    permitsResult.status === "fulfilled" && Array.isArray(permitsResult.value.permits)
      ? permitsResult.value.permits.length
      : null;

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
      permitsExpiring={permitsExpiring}
    />
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;

  // M24: HOME is the grouped module directory, and it is what REPLACES the
  // deleted left rail. It needs no network at all, so it renders OUTSIDE the
  // boundary -- a new user with a slow backend still sees every module the
  // product has while the numbers are still arriving.
  return (
    <div className="space-y-8 pb-4">
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardHome requestedProjectId={projectId} />
      </Suspense>
      <div className="px-6">
        <ModuleDirectory />
      </div>
    </div>
  );
}
