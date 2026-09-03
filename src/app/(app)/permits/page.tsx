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
import { fetchPermitsList, getProjectName, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import PermitsListClient, { type Permit } from "@/components/PermitsListClient";

const SKELETON = <ModuleListSkeletonBody columns={PERMITS_LIST_COLUMNS} actions={["+ New"]} />;

// R67 D-07 (lane D1, folded into lane F2's streamed structure). The module used
// to name itself TWICE, one line apart: this PageHeading, and PermitsListClient's
// own ScreenFrame breadcrumb directly beneath it. Lane D1 removed the heading;
// that is the wrong half to remove here, because F-18/F-31 make the heading the
// thing that paints at TTFB and the skeleton would be left untitled. The
// duplicate is removed from the FRAME instead -- its band now names the PROJECT
// this screen queried, which is the other half of D-07 -- and the heading stays
// as the single module title, in the Suspense fallback and in the answer alike.
const HEADING_TITLE = "Permits";

async function PermitsSection({ requestedProjectId, withinDays }: { requestedProjectId?: string; withinDays?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, projectName: resolvedName, errorMessage, source } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return (
    <>
      <PageHeading title={HEADING_TITLE} />
      <ModuleProjectNotice errorMessage={errorMessage} />
    </>
  );

  // R42 seq24: DASHBOARD.PROJECT's own "Permits expiring" KPI must land here
  // PRE-FILTERED (GLOBAL: filters carried through a KPI click), not on the
  // unfiltered list -- withinDays passes straight through to the same
  // /api/permits?withinDays= param the KPI count itself used, so the two
  // always agree. That filtered read is NOT the one prefetched here (the
  // cached list is the unfiltered `all=true` one), so a withinDays arrival
  // hands the client no rows and lets it fetch its own filtered set.
  const [registryColumns, list, name] = await Promise.all([
    getScreenColumns("permits.list", organizationId),
    withinDays ? Promise.resolve(null) : fetchPermitsList<Permit>(organizationId, projectId, "permits"),
    // R67 D-65 x F-18: the name rides in the SAME batch as the list read, so
    // it costs no serial hop; getProjectName never throws and never blocks.
    resolvedName ? Promise.resolve(resolvedName) : getProjectName(projectId, organizationId),
  ]);

  return (
    <>
      {/* R67 D-07/D-13: the title band names the project this screen queried,
          and says when the project was chosen FOR the user rather than by them. */}
      <PageHeading title={HEADING_TITLE} context={name} contextNote={source === "auto" ? "auto-selected" : null} />
      <PermitsListClient
        projectId={projectId}
        // R67 D-65: the waiting caption names the project out loud ("Loading
        // permits for Cedar Heights Villa - Phase 1..."), which is also the only
        // way a user can tell a slow read from a read of the wrong project.
        projectName={name}
        withinDays={withinDays}
        registryColumns={registryColumns}
        initial={list}
      />
    </>
  );
}

export default async function PermitsPage({ searchParams }: { searchParams: Promise<{ projectId?: string; withinDays?: string }> }) {
  const { projectId, withinDays } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <Suspense
        fallback={
          <>
            <PageHeading title={HEADING_TITLE} />
            {SKELETON}
          </>
        }
      >
        <PermitsSection requestedProjectId={projectId} withinDays={withinDays} />
      </Suspense>
    </div>
  );
}
