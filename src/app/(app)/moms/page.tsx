// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the three serial round-trips that ran before the first byte are
// gone, the frame streams first, and the meetings are fetched here on the
// server inside the Suspense boundary and handed to MoMsClient as props.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { MOMS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchMomsList, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import MoMsClient, { type Meeting } from "@/components/MoMsClient";
// R67 A-03: the shell is told which project this pane resolved. It is rendered
// inside the Suspense boundary below (see ModuleScreenContext's own header):
// the publication needs the project's NAME, which F-18's no-network resolution
// deliberately does not have, and making the frame wait for a name would undo
// the item this page exists to satisfy.
import { ModuleScreenContext } from "@/components/ModuleScreenContext";

const SKELETON = <ModuleListSkeletonBody columns={MOMS_LIST_COLUMNS} actions={["New Meeting"]} />;

async function MoMsSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage, source } = await resolveProjectForModule(
    requestedProjectId,
    organizationId
  );
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  const [registryColumns, list] = await Promise.all([
    getScreenColumns("moms.list", organizationId),
    fetchMomsList<Meeting>(organizationId, projectId, "meeting minutes"),
  ]);

  return (
    <>
      <ModuleScreenContext
        moduleId="moms"
        projectId={projectId}
        organizationId={organizationId}
        source={source}
      />
      <MoMsClient projectId={projectId} registryColumns={registryColumns} initial={list} />
    </>
  );
}

export default async function MoMsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Minutes of Meeting" />
      <Suspense fallback={SKELETON}>
        <MoMsSection requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
