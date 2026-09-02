import { Suspense } from "react";
import { callVeridian, VeridianApiError, createCachedVeridianGet } from "@/lib/veridian-client";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { resolveRegistryColumns } from "@/lib/screen-definitions";
import DashboardHomeView, { DashboardKpiSkeleton, type OrgDashboard, type CurrencyRow, type RegistryColumn } from "@/components/DashboardHomeView";
import ModuleDirectory from "@/components/shell/ModuleDirectory";

// R67 F-01 (R-006/R-011) -- WHAT CHANGED AND WHY IT MATTERED. This route paints
// PROJEXA's home screen, and it used to send NOTHING until every one of its
// server-side reads had finished: the VERIDIAN org dashboard (the earned-value
// aggregate), the currencies list, and the screen-definitions registry row. A
// user who had just logged in looked at a blank page for the duration of the
// slowest of the three.
//
// Now the greeting, the breadcrumb and four card skeletons are in the first
// flush of HTML, and only the data-dependent subtree is behind <Suspense>, so
// Next streams the tiles in when they resolve. The two lookups that are not
// live figures -- the currency master list and the registry row -- come from a
// 5-minute per-org server cache rather than being re-fetched on every visit
// to the home page.
//
// The greeting is rendered by BOTH the fallback and the resolved subtree, with
// the same userName, so the heading itself never changes or moves; only its
// summary line goes from "Loading your projects…" to the real sentence. Per
// D-04 every fetch stays in the server component: the VERIDIAN API key never
// reaches the browser.
const DASHBOARD_LOOKUP_TTL_SECONDS = 300;

// unstable_cache wrappers are created ONCE at module scope, not per request --
// see createCachedVeridianGet's own comment. The org id is both an explicit
// key part and the fetcher's sole argument, so one org's currency list can
// never be served to another (AR-04 / E-45).
const readCachedCurrencies = createCachedVeridianGet<{ currencies: CurrencyRow[] }>(
  "dashboard-currencies",
  "/currencies",
  DASHBOARD_LOOKUP_TTL_SECONDS
);

export default async function DashboardPage() {
  const authCtx = await requireAuth();
  const organizationId = authCtx.organizationId;
  const userName = authCtx.user?.email?.split("@")[0] ?? "there";

  // M24: HOME is the grouped module directory, and it is what REPLACES the
  // deleted left rail. Rendered beneath the greeting/summary so a returning
  // user still lands on their numbers first, while a new user -- who has none
  // of the earned affordances (history, pinning, ranking) -- can still see
  // every module the product has, grouped by domain.
  return (
    <div className="space-y-8 pb-4">
      <Suspense fallback={<DashboardKpiSkeleton userName={userName} />}>
        <DashboardHomeData userName={userName} organizationId={organizationId} />
      </Suspense>
      <div className="px-6">
        <ModuleDirectory />
      </div>
    </div>
  );
}

async function DashboardHomeData({ userName, organizationId }: { userName: string; organizationId: string | null }) {
  let data: OrgDashboard | null = null;
  let errorMessage: string | null = null;
  let currencies: CurrencyRow[] = [];

  // Perf fix (2026-08-17, see scripts/measure-perf.mjs), still in force: these
  // must run concurrently -- none depends on another's response.
  const [dashboardResult, currencyResult, registryColumns] = await Promise.all([
    callVeridian<OrgDashboard>("/dashboard", { organizationId: organizationId ?? undefined }).then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason })
    ),
    // Cached, and non-fatal: an unlabelled number is recoverable, a wrong
    // currency token is not (see the note below).
    (organizationId ? readCachedCurrencies(organizationId) : callVeridian<{ currencies: CurrencyRow[] }>("/currencies")).then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const, value: { currencies: [] as CurrencyRow[] } })
    ),
    // R46 P8 seq123 (M28 registry-model, DASHBOARD archetype -- function_id
    // "dashboard.dashboard"). A missing or errored registry row is NOT fatal:
    // DashboardHomeView falls back to its own hardcoded labels when null.
    resolveRegistryColumns("dashboard.dashboard", organizationId, DASHBOARD_LOOKUP_TTL_SECONDS) as Promise<RegistryColumn[] | null>,
  ]);

  if (dashboardResult.ok) {
    data = dashboardResult.value;
  } else {
    const err = dashboardResult.reason;
    errorMessage = err instanceof VeridianApiError ? err.message : "Failed to load dashboard from VERIDIAN";
  }
  if (currencyResult.ok) currencies = currencyResult.value.currencies ?? [];
  // else: non-fatal. NOTE, corrected R52: formatCurrency() does NOT fall back
  // to a rupee. PR #156 removed that fallback because it was the DEFAULT
  // RENDER, not a rare degradation path, and a UAE buyer saw rupees on the
  // landing screen. An empty list now renders the deployment default
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
