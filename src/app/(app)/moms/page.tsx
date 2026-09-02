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

const SKELETON = <ModuleListSkeletonBody columns={MOMS_LIST_COLUMNS} actions={["New Meeting"]} />;

async function MoMsSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  const [registryColumns, list] = await Promise.all([
    getScreenColumns("moms.list", organizationId),
    fetchMomsList<Meeting>(organizationId, projectId, "meeting minutes"),
  ]);

  return <MoMsClient projectId={projectId} registryColumns={registryColumns} initial={list} />;
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
