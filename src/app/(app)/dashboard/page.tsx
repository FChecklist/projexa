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
import { Suspense } from "react";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { getScreenColumns } from "@/lib/module-list-source";
import DashboardHomeView, { type OrgDashboard, type CurrencyRow } from "@/components/DashboardHomeView";
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

async function DashboardHome() {
  const authCtx = await requireAuth();
  const organizationId = authCtx.organizationId;
  const userName = authCtx.user?.email?.split("@")[0] ?? "there";

  // R46 P8 seq123: DASHBOARD archetype ("dashboard.dashboard"). A missing or
  // errored registry row is NOT fatal -- DashboardHomeView falls back to its
  // own hardcoded labels when this is null.
  const columnsPromise = getScreenColumns("dashboard.dashboard", organizationId); // never rejects
  const [dashboardResult, currencyResult] = await Promise.allSettled([
    callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined }),
    callVeridian<{ currencies: CurrencyRow[] }>("/currencies", { organizationId: organizationId ?? undefined }),
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

  return (
    <DashboardHomeView
      userName={userName}
      data={data}
      currencies={currencies}
      errorMessage={errorMessage}
      registryColumns={registryColumns}
    />
  );
}

export default function DashboardPage() {
  // M24: HOME is the grouped module directory, and it is what REPLACES the
  // deleted left rail. It needs no network at all, so it renders OUTSIDE the
  // boundary -- a new user with a slow backend still sees every module the
  // product has while the numbers are still arriving.
  return (
    <div className="space-y-8 pb-4">
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardHome />
      </Suspense>
      <div className="px-6">
        <ModuleDirectory />
      </div>
    </div>
  );
}
