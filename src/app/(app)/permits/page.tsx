// R67 F-18 / decision D-04 option A.
//
// WHAT CHANGED. This page used to await three network round-trips IN SERIES --
// getServerOrganizationId(), resolveSelectedProject() (a VERIDIAN /dashboard
// call), then resolvePermitsListColumns() (a VERIDIAN /screen-definitions
// call) -- before Next.js could emit a single byte, and only then mounted a
// client component that went and fetched the permits itself. Measured: 1.5-1.65 s
// to first byte, against 616 ms on /budgets, which skips the chain.
//
// Now the heading streams immediately, the frame with its real column heads is
// the Suspense fallback, and everything that needs the network happens inside
// the boundary: the project id comes from ?projectId= or the projexa_project
// cookie with NO call at all, the registry columns come from an hour-long
// per-org cache with the hardcoded columns as the synchronous answer, and the
// permits themselves are fetched HERE, on the server, and handed to the client
// as props -- so the client makes no round trip of its own on first paint.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { PERMITS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchPermitsList, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import PermitsListClient, { type Permit } from "@/components/PermitsListClient";

const SKELETON = <ModuleListSkeletonBody columns={PERMITS_LIST_COLUMNS} actions={["+ New"]} />;

async function PermitsSection({ requestedProjectId, withinDays }: { requestedProjectId?: string; withinDays?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  // R42 seq24: DASHBOARD.PROJECT's own "Permits expiring" KPI must land here
  // PRE-FILTERED (GLOBAL: filters carried through a KPI click), not on the
  // unfiltered list -- withinDays passes straight through to the same
  // /api/permits?withinDays= param the KPI count itself used, so the two
  // always agree. That filtered read is NOT the one prefetched here (the
  // cached list is the unfiltered `all=true` one), so a withinDays arrival
  // hands the client no rows and lets it fetch its own filtered set.
  const [registryColumns, list] = await Promise.all([
    getScreenColumns("permits.list", organizationId),
    withinDays ? Promise.resolve(null) : fetchPermitsList<Permit>(organizationId, projectId, "permits"),
  ]);

  return (
    <PermitsListClient
      projectId={projectId}
      withinDays={withinDays}
      registryColumns={registryColumns}
      initial={list}
    />
  );
}

export default async function PermitsPage({ searchParams }: { searchParams: Promise<{ projectId?: string; withinDays?: string }> }) {
  const { projectId, withinDays } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Permits" />
      <Suspense fallback={SKELETON}>
        <PermitsSection requestedProjectId={projectId} withinDays={withinDays} />
      </Suspense>
    </div>
  );
}
