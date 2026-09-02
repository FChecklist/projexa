import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { requireAuth } from "@/lib/supabase/auth-guard";
import DashboardHomeView, { type OrgDashboard, type CurrencyRow, type RegistryColumn } from "@/components/DashboardHomeView";
import ModuleDirectory from "@/components/shell/ModuleDirectory";

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

export default async function DashboardPage() {
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
  // R67 D-02: the "Permits expiring" KPI's own count, org-wide, read
  // concurrently with the other two. VERIDIAN's /permits treats projectId as
  // optional, so omitting it is the org-wide list -- the same withinDays=30
  // window the card's own destination (/permits?withinDays=30) then applies,
  // so the number and the screen it opens can never disagree.
  const [dashboardResult, currencyResult, permitsResult] = await Promise.allSettled([
    callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined }),
    callVeridian<{ currencies: CurrencyRow[] }>("/currencies", { organizationId: organizationId ?? undefined }),
    callVeridian<{ permits: unknown[] }>("/permits?withinDays=30", { organizationId: organizationId ?? undefined }),
  ]);
  const registryColumns = await columnsPromise;

  // null, not 0, when that read failed -- "no permits are expiring" and "we
  // could not find out" must not render the same.
  const permitsExpiring =
    permitsResult.status === "fulfilled" && Array.isArray(permitsResult.value.permits)
      ? permitsResult.value.permits.length
      : null;

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
  return (
    <div className="space-y-8 pb-4">
      <DashboardHomeView userName={userName} data={data} currencies={currencies} errorMessage={errorMessage} registryColumns={registryColumns} permitsExpiring={permitsExpiring} />
      <div className="px-6">
        <ModuleDirectory />
      </div>
    </div>
  );
}
