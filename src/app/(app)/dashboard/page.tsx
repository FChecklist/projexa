import { callVeridian, VeridianApiError } from "@/lib/veridian-client";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { listUserCompanies } from "@/lib/company-scope";
import DashboardHomeView, { type OrgDashboard, type CurrencyRow, type RegistryColumn } from "@/components/DashboardHomeView";
import ModuleDirectory from "@/components/shell/ModuleDirectory";

// R46 P8 seq123 (M28 registry-model, DASHBOARD archetype -- function_id
// "dashboard.dashboard"): same pattern as permits/page.tsx's
// resolvePermitsListColumns and scope/page.tsx's resolveRegistryColumns. A
// missing or errored registry row is NOT fatal -- DashboardHomeView falls
// back to its own hardcoded labels when this is null.
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let data: OrgDashboard | null = null;
  let errorMessage: string | null = null;
  let currencies: CurrencyRow[] = [];

  const authCtx = await requireAuth();
  const userName = authCtx.user?.email?.split("@")[0] ?? "there";

  // R67 E-02: the Filter drawer's four fields arrive here, in the URL, so the
  // filtered view is shareable and Back undoes it. `one()` collapses Next's
  // string | string[] to the single value these params always carry.
  const params = await searchParams;
  const one = (key: string): string | null => {
    const v = params[key];
    return (Array.isArray(v) ? v[0] : v) ?? null;
  };
  const companyId = one("companyId");
  const departmentId = one("departmentId");
  const from = one("from");
  const to = one("to");

  const organizationId = await resolveScopedOrganizationId(authCtx.user?.id, authCtx.organizationId, companyId);

  const dashboardQuery = new URLSearchParams();
  if (departmentId) dashboardQuery.set("departmentId", departmentId);
  if (from) dashboardQuery.set("from", from);
  if (to) dashboardQuery.set("to", to);
  const dashboardPath = dashboardQuery.size > 0 ? `/dashboard?${dashboardQuery.toString()}` : "/dashboard";

  // Perf fix (2026-08-17, see scripts/measure-perf.mjs): the two VERIDIAN
  // calls below must run concurrently, not one-after-another -- neither
  // depends on the other's response. The registry-columns lookup is kicked
  // off here too (before the awaited allSettled block) so it runs
  // concurrently with both, not as a third serial round-trip.
  const columnsPromise = resolveDashboardColumns(organizationId); // never rejects
  const [dashboardResult, currencyResult] = await Promise.allSettled([
    callVeridian<OrgDashboard>(dashboardPath, { organizationId: organizationId ?? undefined }),
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
  // else: non-fatal. An empty list renders bare numbers behind a warning
  // glyph plus the footer notice -- never a guessed currency code (PR #156).

  // M24: HOME is the grouped module directory, and it is what REPLACES the
  // deleted left rail. Rendered beneath the greeting/summary so a returning
  // user still lands on their numbers first, while a new user -- who has none
  // of the earned affordances (history, pinning, ranking) -- can still see
  // every module the product has, grouped by domain.
  return (
    <div className="space-y-8 pb-4">
      <DashboardHomeView
        userName={userName}
        data={data}
        currencies={currencies}
        errorMessage={errorMessage}
        registryColumns={registryColumns}
        from={from}
        to={to}
      />
      <div className="px-6">
        <ModuleDirectory />
      </div>
    </div>
  );
}
