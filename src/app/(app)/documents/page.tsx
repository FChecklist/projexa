// R67 F-18 / decision D-04 option A. See permits/page.tsx for the full
// rationale: the three serial round-trips that ran before the first byte are
// gone, the frame streams first, and the unfiltered document list -- what the
// screen's default "All categories" shows -- is fetched here on the server
// inside the Suspense boundary and handed to DocumentsClient as props.
import { Suspense } from "react";
import { PageHeading } from "@/components/PageHeading";
import { ModuleListSkeletonBody } from "@/components/ModuleListSkeleton";
import { ModuleProjectNotice } from "@/components/ModuleProjectNotice";
import { DOCUMENTS_LIST_COLUMNS } from "@/lib/module-list-columns";
import { fetchDocumentsList, getScreenColumns, resolveProjectForModule } from "@/lib/module-list-source";
import { getServerOrganizationId } from "@/lib/supabase/auth-guard";
import DocumentsClient, { type Doc } from "@/components/DocumentsClient";

const SKELETON = <ModuleListSkeletonBody columns={DOCUMENTS_LIST_COLUMNS} actions={["Upload"]} />;

async function DocumentsSection({ requestedProjectId }: { requestedProjectId?: string }) {
  const organizationId = await getServerOrganizationId();
  const { projectId, errorMessage } = await resolveProjectForModule(requestedProjectId, organizationId);
  if (!projectId) return <ModuleProjectNotice errorMessage={errorMessage} />;

  const [registryColumns, list] = await Promise.all([
    getScreenColumns("documents.list", organizationId),
    fetchDocumentsList<Doc>(organizationId, projectId, "documents"),
  ]);

  return <DocumentsClient projectId={projectId} registryColumns={registryColumns} initial={list} />;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeading title="Documents" />
      <Suspense fallback={SKELETON}>
        <DocumentsSection requestedProjectId={projectId} />
      </Suspense>
    </div>
  );
}
