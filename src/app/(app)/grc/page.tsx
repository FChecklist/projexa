import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { fetchGrcDashboard } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import GrcClient, { type GrcDashboard } from "@/components/GrcClient";

// A lightweight stand-in for the Suspense fallback -- deliberately NOT the
// real GrcClient: rendering the full client tree as a fallback would fire
// its OWN client-side fetch immediately, which would then just be discarded
// the moment GrcSection resolves -- exactly the wasted round trip this fix
// exists to remove. Real tab labels (same convention as reports/page.tsx's
// own SKELETON) so the frame doesn't shift shape once the real tabs mount.
const DASHBOARD_FALLBACK = (
  <ModuleListSkeletonBody
    columns={[]}
    tabs={["Dashboard", "Risk Register", "Audits & Findings", "Policies", "Vendor Risk", "Fraud & Incidents", "Access Review", "Compliance Register"]}
    label="GRC dashboard"
  />
);

// PROJEXA-E2E-001 cold-load fix (2026-09-21) -- see module-list-source.ts's
// fetchGrcDashboard for the full defect this closes. Resolves ?tab= server-
// side (Real-screen conversion, 2026-08-30, same pattern as
// accounting/page.tsx and employees/page.tsx). Only the default "Dashboard"
// tab is server-prefetched here -- the other 7 tabs stay client-fetch-only,
// deliberately out of this fix's scope (see GrcClient's DashboardPanel
// comment).
export default async function GrcPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const isDashboardTab = !tab || tab === "dashboard";

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Risk & Compliance" />
      {isDashboardTab ? (
        <Suspense fallback={DASHBOARD_FALLBACK}>
          <GrcSection initialTab={tab} />
        </Suspense>
      ) : (
        <GrcClient initialTab={tab} />
      )}
    </div>
  );
}

async function GrcSection({ initialTab }: { initialTab?: string }) {
  const organizationId = await getServerOrganizationId();
  const { data, errorMessage } = await fetchGrcDashboard<GrcDashboard>(organizationId);
  return <GrcClient initialTab={initialTab} initialDashboard={{ data, errorMessage }} />;
}
