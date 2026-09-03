import { cookies } from "next/headers";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { requireAuth } from "@/lib/supabase/auth-guard";
import DashboardHomeView, { type OrgDashboard, type CurrencyRow, type RegistryColumn } from "@/components/DashboardHomeView";
import DashboardProjectClient from "@/components/DashboardProjectClient";
import ModuleDirectory from "@/components/shell/ModuleDirectory";
import { dashboardScope, PROJECT_COOKIE } from "@/lib/project-selection";

// R46 P8 seq123 (M28 registry-model, DASHBOARD archetype -- function_id
// "dashboard.dashboard"): same pattern as permits/page.tsx's
// resolvePermitsListColumns and scope/page.tsx's resolveRegistryColumns. A
// missing or errored registry row is NOT fatal -- DashboardHomeView falls
// back to its own hardcoded labels when this is null. This route also has
// 3 separate, already-tracked backend timeout faults (R46S11_01/02/03,
// platform.r43_faults) on its /dashboard, /currencies data calls -- that is
// a VERIDIAN backend latency issue, unrelated to this registry wiring.
async function resolveDashboardColumns(organizationId: string | null): Promise<RegistryColumn[] | null> {
  try {
    const definition = await callVeridian<{ columns: RegistryColumn[] }>("/screen-definitions/dashboard.dashboard", {
      organizationId: organizationId ?? undefined,
    });
    return Array.isArray(definition.columns) && definition.columns.length > 0 ? definition.columns : null;
  } catch (err) {
    if (err instanceof VeridianApiError && err.status === 404) return null; // no row seeded yet -- expected, not an error
    console.error("[dashboard/page] screen_definitions resolve failed, falling back to hardcoded labels:", err instanceof Error ? err.message : err);
    return null;
  }
}

// R67 D-66 -- HOME follows the project context.
//
// "/dashboard renders the portfolio when the context is All and the project
// dashboard when a project is set; /dashboard/project stays a deep link that
// sets the context."
//
// Until now /dashboard ALWAYS rendered the org portfolio, whatever the rail
// said -- so a user who picked Cedar Heights in the top bar and then clicked
// HOME landed on a screen about every project, with the rail still naming
// one. That is the same split-brain R-253 recorded in the breadcrumb, in the
// one place a user returns to most often.
//
// The order of sources is the WS-A root rule's: the URL wins, then the
// px_project cookie the rail writes. There is deliberately NO projects[0]
// fallback -- that is the fault D-20 removed, and the home screen is the
// loudest possible place to re-introduce it.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  let data: OrgDashboard | null = null;
  let errorMessage: string | null = null;
  let currencies: CurrencyRow[] = [];

  const authCtx = await requireAuth();
  const organizationId = authCtx.organizationId;
  const userName = authCtx.user?.email?.split("@")[0] ?? "there";

  // Perf fix (2026-08-17, see scripts/measure-perf.mjs): the two VERIDIAN
  // calls below must run concurrently, not one-after-another -- neither
  // depends on the other's response. The registry-columns lookup is kicked
  // off here too (before the awaited allSettled block) so it runs
  // concurrently with both, not as a third serial round-trip.
  const columnsPromise = resolveDashboardColumns(organizationId); // never rejects
  const [dashboardResult, currencyResult] = await Promise.allSettled([
    callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined }),
    callVeridian<{ currencies: CurrencyRow[] }>("/currencies", { organizationId: organizationId ?? undefined }),
  ]);
  const registryColumns = await columnsPromise;

  if (dashboardResult.status === "fulfilled") {
    data = dashboardResult.value;
  } else {
    const err = dashboardResult.reason;
    errorMessage = err instanceof VeridianApiError ? err.message : "Failed to load dashboard from VERIDIAN";
  }
  if (currencyResult.status === "fulfilled") {
    currencies = currencyResult.value.currencies ?? [];
  }
  // else: non-fatal. NOTE, corrected R52: this used to say formatCurrency()
  // falls back to a rupee. It no longer does -- PR #156 removed that fallback
  // because it was the DEFAULT RENDER, not a rare degradation path, and a UAE
  // buyer saw rupees on the landing screen. An empty list now renders the
  // deployment default (NEXT_PUBLIC_DEFAULT_CURRENCY_CODE=AED in production)
  // or a bare number. Leaving the old comment would have told the next reader
  // something false about live behaviour.

  // M24: HOME is the grouped module directory, and it is what REPLACES the
  // deleted left rail. Rendered beneath the greeting/summary so a returning
  // user still lands on their numbers first, while a new user -- who has none
  // of the earned affordances (history, pinning, ranking) -- can still see
  // every module the product has, grouped by domain.
  // The scope is decided from the org's REAL project list, so a stale cookie
  // naming a project this org can no longer see is discarded rather than
  // followed into a blank screen.
  const { projectId } = await searchParams;
  const remembered = (await cookies()).get(PROJECT_COOKIE)?.value ?? null;
  const scope = dashboardScope(data?.projects ?? [], projectId, remembered);

  if (scope.project) {
    // The project dashboard renders its own "Dashboard / <project name>"
    // breadcrumb from the payload it fetches, so the rail and the breadcrumb
    // are naming the same project by construction.
    return (
      <div className="flex-1">
        <DashboardProjectClient projectId={scope.project.id} labels={registryColumns} />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-4">
      <DashboardHomeView userName={userName} data={data} currencies={currencies} errorMessage={errorMessage} registryColumns={registryColumns} />
      <div className="px-6">
        <ModuleDirectory />
      </div>
    </div>
  );
}
